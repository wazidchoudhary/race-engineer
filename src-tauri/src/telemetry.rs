/// UDP telemetry runtime — supports multiple slots (one UDP listener per driver).
use crate::parser::{self, HEADER_SIZE};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;
use tokio::sync::oneshot;

pub const DEFAULT_PORT: u16 = 20777;
pub const PRIMARY_SLOT: &str = "primary";

#[derive(Debug, Clone, Default)]
pub struct TelemetryState {
    pub session_data: Option<Value>,
    pub participants: Option<Value>,
    pub lap_data: Option<Value>,
    pub car_telemetry: Option<Value>,
    pub car_status: Option<Value>,
    pub car_damage: Option<Value>,
    pub car_setup: Option<Value>,
    pub next_front_wing: f64,
    pub player_car_index: usize,
    pub best_lap_times: HashMap<usize, u32>,
    pub fastest_lap: Option<Value>,
    pub manual_track_id: Option<i8>,
    /// Optional LAN relay destination "host:port". When set, every received
    /// UDP packet is forwarded unchanged so another machine can observe.
    pub lan_relay: Option<String>,

    // ── Lap-trace recording (for generating accurate track maps from
    // live game data). When `recording_track` is Some, the Motion handler
    // samples the player's (x, z) world position each tick and appends it
    // to `recording_samples`. On next lap-start the trace is saved to
    // disk keyed by trackId and recording stops.
    pub recording_track: Option<i8>,
    pub recording_samples: Vec<(f32, f32)>,
    pub recording_last_lap_distance: f32,
    pub recording_started_at_lap: bool,
    pub current_track_id: Option<i8>,
}

pub type SharedState = Arc<Mutex<TelemetryState>>;

/// Handle to a running UDP listener — drop or send shutdown to cancel.
pub struct TelemetryHandle {
    pub shutdown: oneshot::Sender<()>,
    pub port: u16,
}

/// Scope: name of the slot this listener is for. "primary" slot uses
/// legacy (unsuffixed) event names for backward compatibility; other slots
/// emit `<event>::<slot>` instead.
fn emit_for(app: &AppHandle, slot: &str, event: &str, payload: impl serde::Serialize + Clone) {
    if slot == PRIMARY_SLOT {
        let _ = app.emit(event, payload);
    } else {
        let name = format!("{}::{}", event, slot);
        let _ = app.emit(&name, payload);
    }
}

pub async fn start_udp_listener(
    slot: String,
    port: u16,
    state: SharedState,
    app: AppHandle,
) -> Result<TelemetryHandle, String> {
    let addr = format!("0.0.0.0:{}", port);
    let socket = UdpSocket::bind(&addr)
        .await
        .map_err(|e| format!("Cannot bind UDP port {} (slot {}): {}", port, slot, e))?;

    log::info!("Telemetry slot={} listening on UDP :{}", slot, port);

    let (tx, mut rx) = oneshot::channel::<()>();
    emit_for(&app, &slot, "telemetry-started", json!({ "port": port, "slot": &slot }));

    let state_clone = state.clone();
    let app_clone = app.clone();
    let slot_clone = slot.clone();

    tokio::spawn(async move {
        let mut buf = vec![0u8; 4096];
        // Diagnostic counter — emit a `packet-rx` event every 30 packets so
        // the UI can show "we are actually receiving UDP" vs "the socket is
        // silent." Zero rx for >2s after start_telemetry == firewall block
        // or wrong destination IP from the game, not a parser/UI bug.
        let mut packet_count: u64 = 0;
        loop {
            tokio::select! {
                _ = &mut rx => break,
                result = socket.recv(&mut buf) => {
                    let n = match result {
                        Ok(n) => n,
                        Err(e) => {
                            log::error!("UDP recv error on slot {}: {}", slot_clone, e);
                            emit_for(&app_clone, &slot_clone, "telemetry-error",
                                json!({ "message": e.to_string(), "slot": &slot_clone }));
                            break;
                        }
                    };
                    if n < HEADER_SIZE { continue; }
                    let packet = &buf[..n];

                    // Optional LAN relay — forward the raw bytes unchanged.
                    let relay = state_clone.lock().ok()
                        .and_then(|s| s.lan_relay.clone());
                    if let Some(dst) = relay {
                        if let Err(e) = socket.send_to(packet, &dst).await {
                            log::warn!("relay send_to {} failed: {}", dst, e);
                        }
                    }

                    if let Some(header) = parser::parse_header(packet) {
                        if packet_count == 0 {
                            log::info!("First UDP packet received on slot {} (len={}, packet_id={})",
                                slot_clone, n, header.packet_id);
                        }
                        packet_count += 1;
                        if packet_count % 30 == 0 {
                            emit_for(&app_clone, &slot_clone, "packet-rx",
                                json!({ "count": packet_count, "lastPacketId": header.packet_id }));
                        }
                        handle_packet(&slot_clone, header, packet, &state_clone, &app_clone);
                    }
                }
            }
        }
        log::info!("Telemetry slot={} stopped on :{} (received {} packets)",
            slot_clone, port, packet_count);
        emit_for(&app_clone, &slot_clone, "telemetry-stopped",
            json!({ "slot": &slot_clone, "packetCount": packet_count }));
    });

    Ok(TelemetryHandle { shutdown: tx, port })
}

fn handle_packet(slot: &str, header: parser::Header, data: &[u8], state: &SharedState, app: &AppHandle) {
    let mut s = match state.lock() { Ok(s) => s, Err(_) => return };
    let idx = header.player_car_index as usize;
    if idx < parser::MAX_CARS { s.player_car_index = idx; }

    match header.packet_id {
        0 => {
            if let Some(motion) = parser::parse_motion(data) {
                let player_idx = s.player_car_index;
                // If a lap-trace recording is in progress for this track,
                // append the player's (x, z) sample. Start recording once
                // lapDistance is near 0 (fresh lap); stop after one lap.
                if s.recording_track == s.current_track_id && s.recording_track.is_some() {
                    let player_pos = motion.as_array()
                        .and_then(|a| a.get(player_idx))
                        .cloned();
                    if let Some(p) = player_pos {
                        let x = p["x"].as_f64().unwrap_or(0.0) as f32;
                        let z = p["z"].as_f64().unwrap_or(0.0) as f32;
                        if s.recording_started_at_lap {
                            s.recording_samples.push((x, z));
                        }
                    }
                }
                drop(s);
                emit_for(app, slot, "motion-update", motion);
            }
        }
        1 => {
            if let Some(mut session) = parser::parse_session(data) {
                if let Some(override_id) = s.manual_track_id {
                    session["trackId"] = json!(override_id);
                }
                let track_id = session["trackId"].as_i64().map(|v| v as i8);
                s.current_track_id = track_id;
                if let Some(existing) = &s.session_data {
                    let changed = existing["trackId"] != session["trackId"]
                        || existing["sessionType"] != session["sessionType"];
                    if changed {
                        s.best_lap_times.clear();
                        s.fastest_lap = None;
                        log::info!("Slot {} session changed: track={} type={}",
                            slot, session["trackId"], session["sessionType"]);
                    }
                }
                s.session_data = Some(session.clone());
                let payload = enrich_session(&session);
                drop(s);
                emit_for(app, slot, "session-update", payload);
            }
        }
        2 => {
            if let Some(lap) = parser::parse_lap_data(data) {
                let player_idx = s.player_car_index;

                // Lap-trace recorder lifecycle: watch the player's
                // lapDistance. When it crosses near 0 from a high value
                // (start of a new lap), begin recording. When it crosses
                // near 0 a second time (lap complete), stop and emit a
                // "track-trace-complete" event so the renderer can save
                // the trace to disk.
                if s.recording_track.is_some() {
                    let player_lap = lap.as_array()
                        .and_then(|a| a.get(player_idx))
                        .cloned()
                        .unwrap_or(Value::Null);
                    let cur = player_lap["lapDistance"].as_f64().unwrap_or(0.0) as f32;
                    let prev = s.recording_last_lap_distance;
                    let lap_reset = prev > 500.0 && cur < 50.0;
                    if !s.recording_started_at_lap && lap_reset {
                        s.recording_started_at_lap = true;
                        s.recording_samples.clear();
                        log::info!("track-trace recording started on slot {}", slot);
                    } else if s.recording_started_at_lap && lap_reset {
                        let samples = std::mem::take(&mut s.recording_samples);
                        let track_id = s.recording_track.take().unwrap_or(-1);
                        s.recording_started_at_lap = false;
                        drop(s);
                        log::info!("track-trace recording complete: {} samples for track {}",
                            samples.len(), track_id);
                        let payload = json!({
                            "trackId": track_id,
                            "samples": samples.iter()
                                .map(|(x, z)| json!([x, z]))
                                .collect::<Vec<_>>(),
                        });
                        emit_for(app, slot, "track-trace-complete", payload);
                        // Reacquire lock for normal emit below
                        s = match state.lock() { Ok(s) => s, Err(_) => return };
                    }
                    s.recording_last_lap_distance = cur;
                }

                s.lap_data = Some(lap.clone());
                drop(s);
                emit_for(app, slot, "lap-update",
                    json!({ "lapData": lap, "playerCarIndex": player_idx }));
            }
        }
        4 => {
            if let Some(participants) = parser::parse_participants(data) {
                s.participants = Some(participants.clone());
                drop(s);
                emit_for(app, slot, "participants-update", participants);
            }
        }
        5 => {
            if let Some(setup_packet) = parser::parse_car_setup(data) {
                let player_idx = s.player_car_index;
                if let (Some(setups), next_fw) = (
                    setup_packet["carSetups"].as_array(),
                    setup_packet["nextFrontWingValue"].as_f64().unwrap_or(0.0),
                ) {
                    s.car_setup = Some(Value::Array(setups.clone()));
                    s.next_front_wing = next_fw;
                    let player_setup = setups.get(player_idx).cloned().unwrap_or(Value::Null);
                    let mut ps = player_setup.clone();
                    if let Value::Object(ref mut m) = ps {
                        m.insert("nextFrontWingValue".into(), json!(next_fw));
                    }
                    let all = Value::Array(setups.clone());
                    drop(s);
                    emit_for(app, slot, "setup-update", ps);
                    emit_for(app, slot, "allsetup-update", all);
                }
            }
        }
        6 => {
            if let Some(tel) = parser::parse_car_telemetry(data) {
                let player_idx = s.player_car_index;
                let player_tel = tel.as_array()
                    .and_then(|a| a.get(player_idx))
                    .cloned()
                    .unwrap_or(Value::Null);
                s.car_telemetry = Some(tel.clone());
                drop(s);
                emit_for(app, slot, "telemetry-update", player_tel);
                emit_for(app, slot, "alltelemetry-update", tel);
            }
        }
        7 => {
            if let Some(status) = parser::parse_car_status(data) {
                let player_idx = s.player_car_index;
                let player_status = status.as_array()
                    .and_then(|a| a.get(player_idx))
                    .cloned()
                    .unwrap_or(Value::Null);
                s.car_status = Some(status.clone());
                drop(s);
                emit_for(app, slot, "status-update", player_status);
                emit_for(app, slot, "allstatus-update", status);
            }
        }
        3 => {
            if let Some(event) = parser::parse_event(data) {
                if event["type"] == "FTLP" {
                    let v_idx = event["vehicleIdx"].as_u64().unwrap_or(0) as usize;
                    let ms = event["lapTimeMs"].as_u64().unwrap_or(0) as u32;
                    s.fastest_lap = Some(json!({ "vehicleIdx": v_idx, "lapTimeMs": ms }));
                    let fl = s.fastest_lap.clone().unwrap();
                    drop(s);
                    emit_for(app, slot, "fastest-lap-update", fl);
                } else {
                    drop(s);
                }
                emit_for(app, slot, "event-update", event);
            }
        }
        10 => {
            if let Some(damage) = parser::parse_car_damage(data) {
                let player_idx = s.player_car_index;
                let player_dmg = damage.as_array()
                    .and_then(|a| a.get(player_idx))
                    .cloned()
                    .unwrap_or(Value::Null);
                s.car_damage = Some(damage);
                drop(s);
                emit_for(app, slot, "damage-update", player_dmg);
            }
        }
        11 => {
            if let Some(hist) = parser::parse_session_history(data) {
                if hist.best_lap_time_ms > 0 {
                    s.best_lap_times.insert(hist.car_idx, hist.best_lap_time_ms);
                }
                let best_laps: HashMap<String, u32> = s.best_lap_times
                    .iter()
                    .map(|(k, v)| (k.to_string(), *v))
                    .collect();
                let car_idx = hist.car_idx;
                let laps = hist.laps;
                drop(s);
                if !best_laps.is_empty() {
                    emit_for(app, slot, "best-laps-update", best_laps);
                }
                emit_for(app, slot, "driver-history-update",
                    json!({ "carIdx": car_idx, "laps": laps }));
            }
        }
        _ => {}
    }
}

fn enrich_session(session: &Value) -> Value {
    let track_id = session["trackId"].as_i64().unwrap_or(-1);
    let session_type = session["sessionType"].as_u64().unwrap_or(0);
    let weather = session["weather"].as_u64().unwrap_or(0);

    let track_name = track_name(track_id as i8);
    let session_type_name = session_type_name(session_type as u8);
    let weather_name = weather_name(weather as u8);

    let mut enriched = session.clone();
    if let Value::Object(ref mut m) = enriched {
        m.insert("trackName".into(), json!(track_name));
        m.insert("sessionTypeName".into(), json!(session_type_name));
        m.insert("weatherName".into(), json!(weather_name));
    }
    enriched
}

fn track_name(id: i8) -> &'static str {
    match id {
        0  => "Melbourne",     1  => "Paul Ricard",  2  => "Shanghai",
        3  => "Bahrain",       4  => "Catalunya",    5  => "Monaco",
        6  => "Montreal",      7  => "Silverstone",  8  => "Hockenheim",
        9  => "Hungaroring",   10 => "Spa",          11 => "Monza",
        12 => "Singapore",     13 => "Suzuka",       14 => "Abu Dhabi",
        15 => "Texas",         16 => "Brazil",       17 => "Austria",
        18 => "Sochi",         19 => "Mexico",       20 => "Baku",
        21 => "Sakhir Short",  22 => "Silverstone Short", 23 => "Texas Short",
        24 => "Suzuka Short",  25 => "Hanoi",        26 => "Zandvoort",
        27 => "Imola",         28 => "Portimao",     29 => "Jeddah",
        30 => "Miami",         31 => "Las Vegas",    32 => "Losail",
        _  => "Unknown Track",
    }
}

fn session_type_name(t: u8) -> &'static str {
    match t {
        0 => "Unknown", 1 => "P1", 2 => "P2", 3 => "P3", 4 => "Short Practice",
        5 => "Q1", 6 => "Q2", 7 => "Q3", 8 => "Short Q", 9 => "OSQ",
        10 => "Race", 11 => "Race 2", 12 => "Race 3", 13 => "Time Trial",
        _ => "Unknown",
    }
}

fn weather_name(w: u8) -> &'static str {
    match w {
        0 => "Clear", 1 => "Light Cloud", 2 => "Overcast",
        3 => "Light Rain", 4 => "Heavy Rain", 5 => "Storm",
        _ => "Clear",
    }
}
