mod parser;
mod telemetry;
mod network;

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use telemetry::{SharedState, TelemetryHandle, TelemetryState, PRIMARY_SLOT};

// ── App-level state ───────────────────────────────────────────────────────────
/// Holds per-slot telemetry listeners. "primary" is the default slot used by
/// the main window; additional slots can be started for multi-driver engineering.
struct AppState {
    slots: HashMap<String, SharedState>,
    handles: HashMap<String, TelemetryHandle>,
    api_key: Option<String>,
    premium: bool,
    usage_input_tokens: u64,
    usage_cached_input_tokens: u64,
    usage_output_tokens: u64,
    usage_cache_creation_tokens: u64,
}

impl AppState {
    fn telemetry_state(&mut self, slot: &str) -> SharedState {
        self.slots
            .entry(slot.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(TelemetryState::default())))
            .clone()
    }
}

type SafeAppState = Arc<Mutex<AppState>>;

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn start_telemetry(
    port: Option<u16>,
    slot: Option<String>,
    state: State<'_, SafeAppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let port = port.unwrap_or(telemetry::DEFAULT_PORT);
    let slot_name = slot.unwrap_or_else(|| PRIMARY_SLOT.to_string());
    let (telemetry_state, old_handle) = {
        let mut s = state.lock().map_err(|_| "Lock error")?;
        let ts = s.telemetry_state(&slot_name);
        let old = s.handles.remove(&slot_name);
        (ts, old)
    };

    if let Some(h) = old_handle {
        let _ = h.shutdown.send(());
    }

    let handle = telemetry::start_udp_listener(slot_name.clone(), port, telemetry_state, app).await?;
    state.lock().map_err(|_| "Lock error")?.handles.insert(slot_name.clone(), handle);
    Ok(json!({ "success": true, "port": port, "slot": slot_name }))
}

#[tauri::command]
fn stop_telemetry(
    slot: Option<String>,
    state: State<'_, SafeAppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let mut s = state.lock().map_err(|_| "Lock error")?;
    let slot_name = slot.unwrap_or_else(|| PRIMARY_SLOT.to_string());
    let had_listener = match s.handles.remove(&slot_name) {
        Some(h) => { let _ = h.shutdown.send(()); true }
        None => false,
    };
    // The listener task emits `telemetry-stopped` itself when it unwinds;
    // only emit here when there was nothing running (so the UI still syncs).
    if !had_listener {
        let event = if slot_name == PRIMARY_SLOT {
            "telemetry-stopped".to_string()
        } else {
            format!("telemetry-stopped::{}", slot_name)
        };
        let _ = app.emit(&event, json!({ "slot": slot_name.clone() }));
    }
    Ok(json!({ "success": true, "slot": slot_name }))
}

#[tauri::command]
fn list_telemetry_slots(state: State<'_, SafeAppState>) -> Result<Value, String> {
    let s = state.lock().map_err(|_| "Lock error")?;
    let slots: Vec<Value> = s.handles.iter()
        .map(|(slot, handle)| json!({ "slot": slot, "port": handle.port }))
        .collect();
    Ok(json!({ "slots": slots }))
}

#[tauri::command]
async fn open_driver_window(
    slot: String,
    app: AppHandle,
) -> Result<Value, String> {
    let label = format!("driver-{}", slot);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(json!({ "success": true, "reused": true }));
    }
    let url = WebviewUrl::App(format!("index.html?slot={}", slot).into());
    WebviewWindowBuilder::new(&app, &label, url)
        .title(&format!("Apex Engineer — Driver {}", slot))
        .inner_size(1440.0, 900.0)
        .min_inner_size(1100.0, 700.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(json!({ "success": true, "reused": false, "label": label }))
}

/// Opens a single page (e.g. "timing", "rival") in its own window. The page
/// renders without the sidebar so the user can dock it side-by-side.
#[tauri::command]
async fn open_page_window(
    page: String,
    slot: Option<String>,
    app: AppHandle,
) -> Result<Value, String> {
    let safe_page: String = page.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe_page.is_empty() {
        return Err("Invalid page name".into());
    }
    let slot_name = slot.unwrap_or_else(|| PRIMARY_SLOT.to_string());
    let label = format!("page-{}-{}", safe_page, slot_name);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(json!({ "success": true, "reused": true, "label": label }));
    }
    let url = WebviewUrl::App(
        format!("index.html?page={}&slot={}", safe_page, slot_name).into(),
    );
    WebviewWindowBuilder::new(&app, &label, url)
        .title(&format!("Apex — {}", safe_page))
        .inner_size(1200.0, 800.0)
        .min_inner_size(700.0, 500.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(json!({ "success": true, "reused": false, "label": label }))
}

/// Spawns a compact always-on-top overlay window (for OBS / stream use).
#[tauri::command]
async fn open_overlay_window(
    slot: Option<String>,
    app: AppHandle,
) -> Result<Value, String> {
    let slot = slot.unwrap_or_else(|| "primary".to_string());
    let label = "overlay";
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.set_focus();
        return Ok(json!({ "success": true, "reused": true }));
    }
    let url = WebviewUrl::App(format!("index.html?overlay=1&slot={}", slot).into());
    WebviewWindowBuilder::new(&app, label, url)
        .title("Apex Overlay")
        .inner_size(560.0, 140.0)
        .min_inner_size(360.0, 80.0)
        .always_on_top(true)
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

/// Configure LAN relay for a slot. Pass `None` host to disable.
#[tauri::command]
fn set_lan_relay(
    slot: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    state: State<'_, SafeAppState>,
) -> Result<Value, String> {
    let slot_name = slot.unwrap_or_else(|| PRIMARY_SLOT.to_string());
    let mut s = state.lock().map_err(|_| "Lock error")?;
    let ts_arc = s.telemetry_state(&slot_name);
    let mut ts = ts_arc.lock().map_err(|_| "Lock error")?;
    ts.lan_relay = match (host, port) {
        (Some(h), Some(p)) if !h.trim().is_empty() => Some(format!("{}:{}", h.trim(), p)),
        _ => None,
    };
    let active = ts.lan_relay.clone();
    Ok(json!({ "success": true, "slot": slot_name, "relay": active }))
}

#[tauri::command]
fn set_manual_track(
    track_id: i8,
    slot: Option<String>,
    state: State<'_, SafeAppState>,
) -> Result<Value, String> {
    let slot_name = slot.unwrap_or_else(|| PRIMARY_SLOT.to_string());
    let mut s = state.lock().map_err(|_| "Lock error")?;
    let ts_arc = s.telemetry_state(&slot_name);
    let mut ts = ts_arc.lock().map_err(|_| "Lock error")?;
    ts.manual_track_id = if track_id == -1 { None } else { Some(track_id) };
    Ok(json!({ "success": true, "slot": slot_name }))
}

// ── Track-trace recording ────────────────────────────────────────────────────
/// Arms the lap-trace recorder on the given slot for the current track.
/// Recording actually starts when the player next crosses the start/finish
/// line (detected via lapDistance wrap) and stops after one full lap. The
/// renderer listens for `track-trace-complete` event and persists the data.
#[tauri::command]
fn start_track_trace(
    slot: Option<String>,
    state: State<'_, SafeAppState>,
) -> Result<Value, String> {
    let slot_name = slot.unwrap_or_else(|| PRIMARY_SLOT.to_string());
    let mut s = state.lock().map_err(|_| "Lock error")?;
    let ts_arc = s.telemetry_state(&slot_name);
    let mut ts = ts_arc.lock().map_err(|_| "Lock error")?;
    let Some(track_id) = ts.current_track_id else {
        return Ok(json!({ "success": false, "error": "No active track" }));
    };
    ts.recording_track = Some(track_id);
    ts.recording_samples.clear();
    ts.recording_started_at_lap = false;
    ts.recording_last_lap_distance = 0.0;
    Ok(json!({ "success": true, "trackId": track_id, "slot": slot_name }))
}

#[tauri::command]
fn stop_track_trace(
    slot: Option<String>,
    state: State<'_, SafeAppState>,
) -> Result<Value, String> {
    let slot_name = slot.unwrap_or_else(|| PRIMARY_SLOT.to_string());
    let mut s = state.lock().map_err(|_| "Lock error")?;
    let ts_arc = s.telemetry_state(&slot_name);
    let mut ts = ts_arc.lock().map_err(|_| "Lock error")?;
    ts.recording_track = None;
    ts.recording_samples.clear();
    ts.recording_started_at_lap = false;
    Ok(json!({ "success": true }))
}

fn trace_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("track-traces"))
}

/// Saves a completed trace to disk. Called from the renderer after it
/// receives the `track-trace-complete` event.
#[tauri::command]
fn save_track_trace(
    track_id: i8,
    samples: Vec<(f32, f32)>,
    app: AppHandle,
) -> Result<Value, String> {
    if samples.is_empty() {
        return Ok(json!({ "success": false, "error": "empty trace" }));
    }
    let dir = trace_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", track_id));
    let (mut min_x, mut max_x, mut min_z, mut max_z) =
        (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
    for &(x, z) in &samples {
        if x < min_x { min_x = x; }
        if x > max_x { max_x = x; }
        if z < min_z { min_z = z; }
        if z > max_z { max_z = z; }
    }
    let body = json!({
        "trackId": track_id,
        "samples": samples,
        "bbox": { "minX": min_x, "maxX": max_x, "minZ": min_z, "maxZ": max_z },
        "recordedAt": chrono_now(),
    });
    std::fs::write(&path, serde_json::to_string(&body).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "success": true, "path": path.to_string_lossy() }))
}

#[tauri::command]
fn load_track_trace(track_id: i8, app: AppHandle) -> Result<Value, String> {
    let path = trace_dir(&app)?.join(format!("{}.json", track_id));
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(_) => Ok(Value::Null),
    }
}

#[tauri::command]
fn list_track_traces(app: AppHandle) -> Result<Value, String> {
    let dir = trace_dir(&app)?;
    if !dir.exists() { return Ok(json!([])); }
    let mut ids = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if let Some(name) = entry.path().file_stem().and_then(|s| s.to_str()) {
            if let Ok(id) = name.parse::<i8>() { ids.push(id); }
        }
    }
    Ok(json!(ids))
}

// ── Team Telemetry 25 BYO-data import ─────────────────────────────────────────
// Reads the user's locally-installed TT data from the path they configure.
// Files are NOT copied into our app — we read them on demand only.
//
// Layout we expect (relative to the configured root):
//   Tracks/Track_<id>.csv               racing line samples (distance;X;Z;0)
//   Tracks/Box_<id>.csv                 pit lane samples    (distance;X;Z)
//   Tracks/Description/Track_Settings_<id>.csv   key;value pairs
fn parse_xz_csv(text: &str, has_trailing_zero: bool) -> Vec<[f64; 2]> {
    let mut out = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split(';').collect();
        let needed = if has_trailing_zero { 4 } else { 3 };
        if parts.len() < needed { continue; }
        let x = match parts[1].trim().parse::<f64>() { Ok(v) => v, Err(_) => continue };
        let z = match parts[2].trim().parse::<f64>() { Ok(v) => v, Err(_) => continue };
        out.push([x, z]);
    }
    out
}

fn parse_tt_settings(text: &str) -> Value {
    // First line is human readable ("Settings for Track-ID 20 Baku;20"); the
    // rest are `key;value` lines, with some "!Comment:" lines we ignore.
    let mut map = serde_json::Map::new();
    for (i, line) in text.lines().enumerate() {
        if i == 0 || line.starts_with("!") || line.is_empty() { continue; }
        let mut it = line.splitn(2, ';');
        let key = it.next().unwrap_or("").trim();
        let value = it.next().unwrap_or("").trim();
        if key.is_empty() { continue; }
        // Try to parse as number, fall back to string
        let v = if let Ok(n) = value.parse::<f64>() {
            json!(n)
        } else if value.eq_ignore_ascii_case("true") {
            json!(true)
        } else if value.eq_ignore_ascii_case("false") {
            json!(false)
        } else {
            json!(value)
        };
        map.insert(key.to_string(), v);
    }
    Value::Object(map)
}

#[tauri::command]
fn load_tt_track(track_id: i8, tt_path: String) -> Result<Value, String> {
    let root = std::path::PathBuf::from(&tt_path);
    let tracks = root.join("Tracks");
    let track_file = tracks.join(format!("Track_{}.csv", track_id));
    let box_file = tracks.join(format!("Box_{}.csv", track_id));
    let settings_file = tracks
        .join("Description")
        .join(format!("Track_Settings_{}.csv", track_id));

    let racing_line = std::fs::read_to_string(&track_file)
        .map(|s| parse_xz_csv(&s, true))
        .unwrap_or_default();
    let pit_lane = std::fs::read_to_string(&box_file)
        .map(|s| parse_xz_csv(&s, false))
        .unwrap_or_default();
    let settings = std::fs::read_to_string(&settings_file)
        .map(|s| parse_tt_settings(&s))
        .unwrap_or(Value::Null);

    if racing_line.is_empty() {
        return Ok(json!({ "found": false, "trackId": track_id }));
    }

    // Compute racing-line bbox + path length so the renderer can derive a
    // motion → TT scale factor without having to traverse the points itself.
    let mut min_x = f64::MAX;
    let mut max_x = f64::MIN;
    let mut min_z = f64::MAX;
    let mut max_z = f64::MIN;
    for &[x, z] in &racing_line {
        if x < min_x { min_x = x; }
        if x > max_x { max_x = x; }
        if z < min_z { min_z = z; }
        if z > max_z { max_z = z; }
    }
    let mut path_len = 0.0;
    for w in racing_line.windows(2) {
        let dx = w[1][0] - w[0][0];
        let dz = w[1][1] - w[0][1];
        path_len += (dx * dx + dz * dz).sqrt();
    }

    Ok(json!({
        "found": true,
        "trackId": track_id,
        "racingLine": racing_line,
        "pitLane": pit_lane,
        "settings": settings,
        "bbox": { "minX": min_x, "maxX": max_x, "minZ": min_z, "maxZ": max_z },
        "pathLength": path_len,
    }))
}

#[tauri::command]
fn set_api_key(key: String, state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut s = state.lock().map_err(|_| "Lock error")?;
    s.api_key = if key.trim().is_empty() { None } else { Some(key.trim().to_string()) };
    Ok(())
}

#[tauri::command]
fn set_premium(enabled: bool, state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut s = state.lock().map_err(|_| "Lock error")?;
    s.premium = enabled;
    Ok(())
}

#[tauri::command]
fn get_premium(state: State<'_, SafeAppState>) -> Result<Value, String> {
    let s = state.lock().map_err(|_| "Lock error")?;
    Ok(json!({
        "premium": s.premium,
        "hasApiKey": s.api_key.is_some(),
    }))
}

/// Validates an Anthropic API key by making a minimal Messages call and
/// inspecting the response. Returns `{ valid: bool, error?: string, model?: string }`.
/// This updates usage counters with the tokens consumed by the probe.
#[tauri::command]
async fn validate_api_key(
    key: String,
    state: State<'_, SafeAppState>,
) -> Result<Value, String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Ok(json!({ "valid": false, "error": "empty_key" }));
    }
    if !key.starts_with("sk-ant-") {
        return Ok(json!({ "valid": false, "error": "Expected key to start with sk-ant-" }));
    }

    let client = reqwest::Client::new();
    let body = json!({
        "model": STRATEGY_MODEL,
        "max_tokens": 1,
        "messages": [{ "role": "user", "content": "ok" }]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => return Ok(json!({ "valid": false, "error": format!("Network error: {}", e) })),
    };

    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(json!({}));

    if status.is_success() {
        if let Some(usage) = body.get("usage") {
            let app_state = state.inner().clone();
            record_usage(&app_state, usage);
        }
        Ok(json!({
            "valid": true,
            "model": STRATEGY_MODEL,
        }))
    } else {
        let err_msg = body["error"]["message"]
            .as_str()
            .unwrap_or("Validation failed")
            .to_string();
        Ok(json!({
            "valid": false,
            "error": err_msg,
            "status": status.as_u16(),
        }))
    }
}

#[tauri::command]
fn get_usage(state: State<'_, SafeAppState>) -> Result<Value, String> {
    let s = state.lock().map_err(|_| "Lock error")?;
    // Haiku 4.5 pricing: $1/M input, $0.10/M cached, $1.25/M cache-write, $5/M output
    let cost = (s.usage_input_tokens as f64) / 1_000_000.0 * 1.0
        + (s.usage_cached_input_tokens as f64) / 1_000_000.0 * 0.10
        + (s.usage_cache_creation_tokens as f64) / 1_000_000.0 * 1.25
        + (s.usage_output_tokens as f64) / 1_000_000.0 * 5.0;
    Ok(json!({
        "inputTokens": s.usage_input_tokens,
        "cachedInputTokens": s.usage_cached_input_tokens,
        "cacheCreationTokens": s.usage_cache_creation_tokens,
        "outputTokens": s.usage_output_tokens,
        "costUsd": (cost * 10000.0).round() / 10000.0,
    }))
}

#[tauri::command]
fn reset_usage(state: State<'_, SafeAppState>) -> Result<(), String> {
    let mut s = state.lock().map_err(|_| "Lock error")?;
    s.usage_input_tokens = 0;
    s.usage_cached_input_tokens = 0;
    s.usage_output_tokens = 0;
    s.usage_cache_creation_tokens = 0;
    Ok(())
}

fn record_usage(app_state: &SafeAppState, usage: &Value) {
    if let Ok(mut s) = app_state.lock() {
        s.usage_input_tokens += usage["input_tokens"].as_u64().unwrap_or(0);
        s.usage_cached_input_tokens += usage["cache_read_input_tokens"].as_u64().unwrap_or(0);
        s.usage_cache_creation_tokens += usage["cache_creation_input_tokens"].as_u64().unwrap_or(0);
        s.usage_output_tokens += usage["output_tokens"].as_u64().unwrap_or(0);
    }
}

// ── Settings ──────────────────────────────────────────────────────────────────

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("race-engineer-settings.json"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Value {
    match settings_path(&app) {
        Ok(path) => {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(json!({}))
        }
        Err(_) => json!({}),
    }
}

#[tauri::command]
fn save_settings(settings: Value, app: AppHandle) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// ── Export file ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ExportPayload {
    content: String,
    #[serde(rename = "defaultName")]
    default_name: Option<String>,
}

#[tauri::command]
async fn save_export_file(
    payload: ExportPayload,
    app: AppHandle,
) -> Result<Value, String> {
    if payload.content.is_empty() {
        return Ok(json!({ "error": "No content to export" }));
    }
    let default_name = payload.default_name.unwrap_or_else(|| "export.csv".into());

    let docs_dir = app.path().document_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    let file_path = app.dialog()
        .file()
        .set_title("Export Race Data")
        .set_file_name(&default_name)
        .set_directory(&docs_dir)
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            std::fs::write(&path_str, &payload.content)
                .map_err(|e| e.to_string())?;
            Ok(json!({ "success": true, "filePath": path_str }))
        }
        None => Ok(json!({ "cancelled": true })),
    }
}

// ── Lookups ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_lookups() -> Value {
    json!({
        "TRACK_NAMES": {
            "0":"Melbourne","1":"Paul Ricard","2":"Shanghai","3":"Bahrain",
            "4":"Catalunya","5":"Monaco","6":"Montreal","7":"Silverstone",
            "8":"Hockenheim","9":"Hungaroring","10":"Spa","11":"Monza",
            "12":"Singapore","13":"Suzuka","14":"Abu Dhabi","15":"Texas",
            "16":"Brazil","17":"Austria","18":"Sochi","19":"Mexico",
            "20":"Baku","21":"Sakhir Short","22":"Silverstone Short",
            "23":"Texas Short","24":"Suzuka Short","25":"Hanoi",
            "26":"Zandvoort","27":"Imola","28":"Portimao","29":"Jeddah",
            "30":"Miami","31":"Las Vegas","32":"Losail",
            "39":"Silverstone (Reverse)","40":"Austria (Reverse)",
            "41":"Zandvoort (Reverse)","42":"Madrid"
        },
        "SESSION_TYPES": {
            "0":"Unknown","1":"P1","2":"P2","3":"P3","4":"Short Practice",
            "5":"Q1","6":"Q2","7":"Q3","8":"Short Q","9":"OSQ",
            "10":"SQ1","11":"SQ2","12":"SQ3","13":"Short Sprint Q",
            "14":"OSQ Sprint","15":"Race","16":"Race 2","17":"Race 3",
            "18":"Time Trial"
        },
        "WEATHER": {
            "0":"Clear","1":"Light Cloud","2":"Overcast",
            "3":"Light Rain","4":"Heavy Rain","5":"Storm"
        },
        "TEAM_COLORS": {
            "0":"#27F4D2","1":"#E80020","2":"#3671C6","3":"#64C4FF",
            "4":"#229971","5":"#0093CC","6":"#6692FF","7":"#B6BABD",
            "8":"#FF8000","9":"#52E252","41":"#3671C6","253":"#FFFFFF",
            "476":"#27F4D2","477":"#E80020","478":"#3671C6","479":"#64C4FF",
            "480":"#229971","481":"#0093CC","482":"#6692FF","483":"#B6BABD",
            "484":"#FF8000","485":"#F50537","486":"#B59A57"
        },
        "TYRE_COMPOUNDS": {
            "16":{"label":"S","name":"Soft","color":"#FF3333"},
            "17":{"label":"M","name":"Medium","color":"#FFD700"},
            "18":{"label":"H","name":"Hard","color":"#CCCCCC"},
            "7":{"label":"I","name":"Intermediate","color":"#39B54A"},
            "8":{"label":"W","name":"Wet","color":"#4477FF"}
        },
        "ACTUAL_COMPOUNDS": {
            "16":"C5","17":"C4","18":"C3","19":"C2","20":"C1","21":"C0","22":"C6",
            "7":"Inter","8":"Wet","9":"Dry","10":"Wet"
        }
    })
}

// ── Ask Engineer / Strategy (Claude API) ──────────────────────────────────────

const STRATEGY_MODEL: &str = "claude-haiku-4-5-20251001";

// Static engineer doctrine — cached via prompt caching (90% token discount on re-use).
// Written as one large block so Anthropic's cache sees a stable prefix across calls.
const ENGINEER_DOCTRINE: &str = r#"You are a Formula 1 race engineer embedded with a driver during a live session. You speak over the radio: short, calm, precise. Never generic — always grounded in the exact telemetry you are given.

Guiding principles:
• Safety first. Call out imminent hazards (SC, puncture risk, heavy damage, rain onset) before performance calls.
• Never invent data. If something isn't in the snapshot, don't claim it.
• Be specific. Lap numbers, gap seconds, compound names, wear percentages.
• British pitwall cadence. Under 12 words for normal calls, under 6 for emergencies.

Pit strategy doctrine:
• PIT LOSS per circuit (seconds): Monaco 19, Singapore 23, Melbourne 21, Silverstone 22, Spa 22, Monza 20, Austin 21, default 22.
• TYRE WEAR ZONES: 0-35% safe, 35-50% early degradation, 50-65% cliff incoming, 65-75% danger, 75%+ critical pit now.
• UNDERCUT window: when rival ahead gap 1.5-3.5s AND tyres are 2+ laps newer AND pit window open. Typically 1.5-2s gain per lap on fresh tyres.
• OVERCUT window: when rival ahead just pitted AND your tyres still in a healthy zone AND track position lap time delta < 1s to out-lap from pits.
• SC OPPORTUNITY: a full safety car pit costs ~50% of normal pit loss. Always call pit if SC deployed + pit window open + tyre age > 6 laps.
• FREE STOP (VSC): VSC pit loss is ~half of normal. Call pit if VSC active AND tyre age > 8 laps AND no fresh rubber already mounted.
• WEATHER CROSSOVER: Slick→Inter crossover roughly when track wetness 30-40%. Inter→Wet when rainPercentage > 60%. Dry→Inter: pit immediately if lap pace loss > 4s on slicks.
• DAMAGE STOP: front wing > 40%, or >2 corners damaged, or engine/gearbox >25% — call pit this lap regardless of window.
• STRATEGIC STAY: if tyres < 30% wear AND no damage AND pit window still open for 8+ laps, prefer extending the stint.
• FUEL TARGETING: if fuelInTank < lapsRemaining * estFuelPerLap * 1.02, call fuel saving. If > 1.2x, call push.
• ERS: defend/attack with ERS only within the last 3 laps of a stint or final 5 laps of race, else bank.

Response style:
• Use the structured tool output — do not answer in free prose unless explicitly asked for a chat reply.
• reasoning ≤ 2 sentences, British engineer tone.
• radioMessage is what the driver hears. Short. No preamble like "Copy" or "Right Lewis."
"#;

#[derive(Deserialize)]
struct AskPayload {
    question: String,
    context: Option<Value>,
    mode: Option<String>,
}

#[tauri::command]
async fn ask_engineer(
    payload: AskPayload,
    state: State<'_, SafeAppState>,
) -> Result<Value, String> {
    let (api_key, premium) = {
        let s = state.lock().map_err(|_| "Lock error")?;
        let key = s.api_key.clone();
        (key, s.premium)
    };

    if !premium {
        return Ok(json!({
            "error": "premium_required",
            "message": "AI engineer responses are a Premium feature. Upgrade in Settings or use Free mode's predefined radio calls."
        }));
    }

    let api_key = match api_key {
        Some(k) => k,
        None => return Ok(json!({ "error": "No API key set. Go to Settings and enter your Anthropic API key." })),
    };

    let ctx_value = payload.context.as_ref().filter(|v| !v.is_null()).cloned();
    let ctx_str = ctx_value
        .as_ref()
        .map(|v| format!("\nLIVE TELEMETRY CONTEXT:\n{}\n", serde_json::to_string_pretty(v).unwrap_or_default()))
        .unwrap_or_default();

    let mode_suffix = if payload.mode.as_deref() == Some("ENGINEER_DECISION") {
        "\n\nOUTPUT MODE: ENGINEER_DECISION\nRespond in EXACTLY this format:\nspeak: yes/no\nurgency: low/medium/high/critical\ncategory: <type>\nreason: <one sentence>\nradio: <max 2 short sentences>"
    } else { "" };

    let user_content = format!("{}{}\n\n{}", ctx_str, mode_suffix, payload.question);

    // System block uses caching — the doctrine is identical across calls.
    let system_blocks = json!([
        {
            "type": "text",
            "text": ENGINEER_DOCTRINE,
            "cache_control": { "type": "ephemeral" }
        }
    ]);

    let client = reqwest::Client::new();
    let body = json!({
        "model": STRATEGY_MODEL,
        "max_tokens": 512,
        "system": system_blocks,
        "messages": [{ "role": "user", "content": user_content }]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let resp_json: Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = resp_json.get("error") {
        let msg = err["message"].as_str().unwrap_or("API error");
        return Ok(json!({ "error": format!("API error: {}", msg) }));
    }

    if let Some(usage) = resp_json.get("usage") {
        let app_state = state.inner().clone();
        record_usage(&app_state, usage);
    }

    let text = resp_json["content"][0]["text"].as_str().unwrap_or("").to_string();
    Ok(json!({ "response": text }))
}

// ── Strategy call — structured JSON output via tool use ──────────────────────

#[derive(Deserialize)]
struct StrategyPayload {
    /// Full telemetry snapshot — player car + rivals + session + history
    snapshot: Value,
    /// What triggered this call: e.g. "lap_complete", "sc_deployed", "rain_onset", "user_ask"
    trigger: String,
    /// Optional explicit driver question to steer the call
    question: Option<String>,
}

#[tauri::command]
async fn call_strategy(
    payload: StrategyPayload,
    state: State<'_, SafeAppState>,
) -> Result<Value, String> {
    let (api_key, premium) = {
        let s = state.lock().map_err(|_| "Lock error")?;
        (s.api_key.clone(), s.premium)
    };

    if !premium {
        return Ok(json!({
            "error": "premium_required",
            "message": "Strategy calls require Premium. Using rule-based fallback."
        }));
    }
    let api_key = match api_key {
        Some(k) => k,
        None => return Ok(json!({ "error": "No API key set." })),
    };

    let snapshot_str = serde_json::to_string(&payload.snapshot).unwrap_or_default();
    let question = payload.question.unwrap_or_else(|| {
        "Given the telemetry snapshot and trigger, decide the best strategic call NOW.".into()
    });

    let user_text = format!(
        "TRIGGER: {}\n\nSNAPSHOT:\n{}\n\nQUESTION: {}",
        payload.trigger, snapshot_str, question
    );

    // Tool definition forces structured output.
    let strategy_tool = json!({
        "name": "strategy_call",
        "description": "Return the single best strategic call for the driver right now.",
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "pit_now", "pit_next_lap", "pit_in_n_laps", "stay_out",
                        "push", "save_tyres", "save_fuel", "manage_ers",
                        "defend", "attack_undercut", "attack_overcut", "hold_position"
                    ]
                },
                "targetLap": { "type": ["integer", "null"] },
                "targetCompound": {
                    "type": ["string", "null"],
                    "enum": ["soft", "medium", "hard", "inter", "wet", null]
                },
                "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                "urgency": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
                "reasoning": { "type": "string", "maxLength": 300 },
                "radioMessage": { "type": "string", "maxLength": 140 },
                "alternativeAction": { "type": ["string", "null"] },
                "triggerConditions": {
                    "type": "array",
                    "items": { "type": "string" },
                    "maxItems": 3
                }
            },
            "required": ["action", "confidence", "urgency", "reasoning", "radioMessage"]
        }
    });

    let system_blocks = json!([
        {
            "type": "text",
            "text": ENGINEER_DOCTRINE,
            "cache_control": { "type": "ephemeral" }
        }
    ]);

    let body = json!({
        "model": STRATEGY_MODEL,
        "max_tokens": 600,
        "system": system_blocks,
        "tools": [strategy_tool],
        "tool_choice": { "type": "tool", "name": "strategy_call" },
        "messages": [{ "role": "user", "content": user_text }]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let resp_json: Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = resp_json.get("error") {
        let msg = err["message"].as_str().unwrap_or("API error");
        return Ok(json!({ "error": format!("API error: {}", msg) }));
    }

    if let Some(usage) = resp_json.get("usage") {
        let app_state = state.inner().clone();
        record_usage(&app_state, usage);
    }

    // Extract tool_use block
    let decision = resp_json["content"]
        .as_array()
        .and_then(|blocks| blocks.iter().find(|b| b["type"] == "tool_use"))
        .and_then(|b| b.get("input").cloned())
        .unwrap_or(Value::Null);

    if decision.is_null() {
        return Ok(json!({ "error": "Model did not return a structured decision" }));
    }

    Ok(json!({ "decision": decision, "trigger": payload.trigger }))
}

// ── TTS ───────────────────────────────────────────────────────────────────────
// TTS via Edge TTS WebSocket (Microsoft neural voices).
// Returns base64-encoded MP3 audio.

const EDGE_TTS_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
// Chromium version the DRM token claims to be from — keep in sync with the
// Sec-MS-GEC-Version param and the User-Agent below.
const EDGE_TTS_CHROMIUM: &str = "130.0.2849.68";

/// Microsoft's DRM gate for the unofficial Edge TTS endpoint (required since
/// late 2024): SHA-256 of (Windows file time rounded down to 5 minutes +
/// trusted client token), upper-case hex.
fn sec_ms_gec() -> String {
    use sha2::{Digest, Sha256};
    let unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut ticks = unix + 11_644_473_600; // seconds since 1601-01-01
    ticks -= ticks % 300;                  // round down to 5-minute boundary
    let ticks_100ns = (ticks as u128) * 10_000_000;
    let mut hasher = Sha256::new();
    hasher.update(format!("{}{}", ticks_100ns, EDGE_TTS_TOKEN).as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect()
}

#[derive(Deserialize)]
struct TtsPayload {
    text: String,
    voice: Option<String>,
    /// Playback rate multiplier (1.0 = normal). Mapped to SSML prosody.
    rate: Option<f32>,
}

#[tauri::command]
async fn tts_speak(payload: TtsPayload) -> Result<String, String> {
    // Edge TTS via the unofficial WebSocket API
    let voice = payload.voice.as_deref().unwrap_or("en-GB-RyanNeural");
    let rate = payload.rate.unwrap_or(1.0).clamp(0.5, 2.0);
    edge_tts(&payload.text, voice, rate).await.map_err(|e| {
        log::error!("edge_tts failed: {}", e);
        e
    })
}

async fn edge_tts(text: &str, voice: &str, rate: f32) -> Result<String, String> {
    use tokio_tungstenite::{connect_async, tungstenite::Message};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use futures_util::{SinkExt, StreamExt};

    let url = format!(
        "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken={}&Sec-MS-GEC={}&Sec-MS-GEC-Version=1-{}&ConnectionId={}",
        EDGE_TTS_TOKEN,
        sec_ms_gec(),
        EDGE_TTS_CHROMIUM,
        uuid_v4()
    );

    let request_id = uuid_v4();
    let timestamp = chrono_now();

    let config_msg = format!(
        "Path: speech.config\r\nX-RequestId: {}\r\nX-Timestamp: {}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":{{\"sentenceBoundaryEnabled\":false,\"wordBoundaryEnabled\":false}},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}}}}}",
        request_id, timestamp
    );

    let rate_pct = ((rate - 1.0) * 100.0).round() as i32;
    let ssml = format!(
        "<speak version='1.0' xml:lang='en-US'><voice name='{}'><prosody rate='{}{}%' pitch='+0Hz'>{}</prosody></voice></speak>",
        voice,
        if rate_pct >= 0 { "+" } else { "" },
        rate_pct,
        text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
    );

    let ssml_msg = format!(
        "Path: ssml\r\nX-RequestId: {}\r\nX-Timestamp: {}\r\nContent-Type: application/ssml+xml\r\n\r\n{}",
        request_id, timestamp, ssml
    );

    // Edge-like handshake headers — the endpoint rejects bare clients.
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("TTS request: {}", e))?;
    {
        let headers = request.headers_mut();
        let ua = format!(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{} Safari/537.36 Edg/{}",
            EDGE_TTS_CHROMIUM.split('.').next().unwrap_or("130"),
            EDGE_TTS_CHROMIUM
        );
        headers.insert("User-Agent", ua.parse().map_err(|_| "bad UA header")?);
        headers.insert(
            "Origin",
            "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
                .parse()
                .map_err(|_| "bad Origin header")?,
        );
        headers.insert("Pragma", "no-cache".parse().map_err(|_| "bad header")?);
        headers.insert("Cache-Control", "no-cache".parse().map_err(|_| "bad header")?);
        headers.insert(
            "Accept-Language",
            "en-US,en;q=0.9".parse().map_err(|_| "bad header")?,
        );
    }

    let (ws_stream, _) = connect_async(request).await.map_err(|e| format!("TTS connect: {}", e))?;
    let (mut write, mut read) = ws_stream.split();

    write.send(Message::Text(config_msg.into())).await.map_err(|e| e.to_string())?;
    write.send(Message::Text(ssml_msg.into())).await.map_err(|e| e.to_string())?;

    let mut audio_chunks: Vec<u8> = Vec::new();

    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                // Binary messages contain audio after the header
                if let Some(sep) = find_audio_separator(&data) {
                    audio_chunks.extend_from_slice(&data[sep..]);
                }
            }
            Ok(Message::Text(text)) => {
                if text.contains("Path:turn.end") { break; }
            }
            Err(e) => return Err(format!("TTS stream error: {}", e)),
            _ => {}
        }
    }

    if audio_chunks.is_empty() {
        return Err("TTS produced no audio".into());
    }

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&audio_chunks))
}

fn find_audio_separator(data: &[u8]) -> Option<usize> {
    // Edge TTS binary frames have a 2-byte header length, then header text, then audio
    if data.len() < 2 { return None; }
    let header_len = u16::from_be_bytes([data[0], data[1]]) as usize;
    let audio_start = 2 + header_len;
    if audio_start < data.len() { Some(audio_start) } else { None }
}

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{:032x}", t).chars().enumerate().map(|(i, c)| {
        if i == 8 || i == 12 || i == 16 || i == 20 { format!("-{}", c) } else { c.to_string() }
    }).collect()
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    format!("{}", ms)
}

// ── App setup ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut slots: HashMap<String, SharedState> = HashMap::new();
    slots.insert(PRIMARY_SLOT.to_string(), Arc::new(Mutex::new(TelemetryState::default())));
    let app_state: SafeAppState = Arc::new(Mutex::new(AppState {
        slots,
        handles: HashMap::new(),
        api_key: None,
        premium: false,
        usage_input_tokens: 0,
        usage_cached_input_tokens: 0,
        usage_output_tokens: 0,
        usage_cache_creation_tokens: 0,
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build())
        .on_window_event(|window, event| {
            // When the main window is closed, tear down all spawned child
            // windows (driver-*, page-*, overlay) so the app exits cleanly.
            if window.label() == "main" {
                if matches!(event, tauri::WindowEvent::CloseRequested { .. }
                                 | tauri::WindowEvent::Destroyed)
                {
                    let app = window.app_handle().clone();
                    for (label, w) in app.webview_windows() {
                        if label != "main" {
                            let _ = w.close();
                        }
                    }
                }
            }
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            start_telemetry,
            stop_telemetry,
            list_telemetry_slots,
            open_driver_window,
            open_page_window,
            open_overlay_window,
            start_track_trace,
            stop_track_trace,
            save_track_trace,
            load_track_trace,
            list_track_traces,
            load_tt_track,
            set_lan_relay,
            set_manual_track,
            set_api_key,
            set_premium,
            get_premium,
            validate_api_key,
            get_usage,
            reset_usage,
            load_settings,
            save_settings,
            save_export_file,
            get_lookups,
            ask_engineer,
            call_strategy,
            tts_speak,
            network::network_diagnose,
            network::network_auto_setup,
            network::network_remove_setup,
            network::open_external_url,
        ])
        .setup(|app| {
            // Load API key + premium flag from saved settings on startup
            if let Ok(settings_path) = app.path().app_data_dir()
                .map(|p| p.join("race-engineer-settings.json"))
            {
                if let Ok(raw) = std::fs::read_to_string(&settings_path) {
                    if let Ok(settings) = serde_json::from_str::<Value>(&raw) {
                        let key = settings["apiKey"].as_str().unwrap_or("").to_string();
                        let premium = settings["premium"].as_bool().unwrap_or(false);
                        let state_handle = app.state::<SafeAppState>();
                        let app_state: SafeAppState = Arc::clone(&state_handle);
                        drop(state_handle);
                        let lock_result = app_state.lock();
                        if let Ok(mut s) = lock_result {
                            if !key.is_empty() {
                                s.api_key = Some(key);
                            }
                            s.premium = premium;
                        }
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running Apex Engineer");
}
