//! Anonymous usage analytics via Aptabase (https://aptabase.com).
//!
//! Privacy posture (opt-out): every event emission is gated on the user's
//! consent (`analyticsEnabled` in the settings blob), mirrored into
//! [`ConsentCache`] (an `AtomicBool`) so the heartbeat loop can check consent
//! without taking the app-state lock. We send only what Aptabase auto-enriches —
//! an anonymous, non-persistent session id, OS name/version, locale, and app
//! version — plus three coarse events. We never send PII, telemetry packets,
//! API keys, or any race data.
//!
//! Events:
//!   * `app_installed` — once per install (guarded by a marker file). Gives a
//!     cleaner "new installs" count than Aptabase's derived first-seen.
//!   * `app_started`   — every launch. The primary "active" signal.
//!   * `heartbeat`     — every [`HEARTBEAT_INTERVAL`] while running, so an app
//!     left open across days still registers as active on later days.
//!
//! Aptabase is session-based, not identity-based: it stores no persistent user
//! id, so the dashboard's "active" / "new" figures are counts of anonymous
//! active instances/sessions per window — the closest analog to DAU/WAU/MAU.
//!
//! This module is kept in sync with the one in the Telemetry Relay (f1-relay)
//! app; only [`APP_KEY`] differs per app.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_aptabase::EventTracker;

/// Aptabase App Key for **Apex Engineer**. Get it from https://aptabase.com →
/// this app → "Instructions". Format `A-<REGION>-<id>` (e.g. `A-EU-1234567890`);
/// the region segment auto-selects the ingestion host, so you only paste the key.
/// Use a DIFFERENT key from the Telemetry Relay app so their metrics stay
/// separate in the dashboard.
///
/// Until a real key replaces the `A-XX-…` placeholder, [`is_configured`] returns
/// false and the whole analytics layer no-ops (the plugin is never registered),
/// so the app builds and runs unchanged.
pub const APP_KEY: &str = "A-XX-XXXXXXXXXX";

/// How often a still-running app re-announces itself as active. 6h stays
/// comfortably inside the free 20k-events/month budget (≤4/day per always-on
/// install).
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// True once a real App Key has been pasted into [`APP_KEY`]. While it still
/// holds the `A-XX-…` placeholder, analytics stays fully off.
pub fn is_configured() -> bool {
    APP_KEY.starts_with("A-") && !APP_KEY.contains("XX")
}

/// Synchronously-readable mirror of the user's `analyticsEnabled` setting, so the
/// heartbeat loop can check consent without locking app state. Kept in sync by
/// `save_settings` whenever the user toggles the setting.
#[derive(Clone)]
pub struct ConsentCache(Arc<AtomicBool>);

impl ConsentCache {
    pub fn new(enabled: bool) -> Self {
        Self(Arc::new(AtomicBool::new(enabled)))
    }
    pub fn get(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
    pub fn set(&self, enabled: bool) {
        self.0.store(enabled, Ordering::Relaxed);
    }
}

/// Fire startup events and launch the heartbeat loop. Call once from `.setup()`
/// after settings (and thus consent) are loaded. No-ops entirely if no App Key
/// is configured.
///
/// Startup events (`app_installed`, `app_started`) are sent only if the user
/// currently consents — we never retroactively report a session that began while
/// opted out. The heartbeat loop is always spawned (when configured) but gates
/// each tick on live consent, so toggling analytics on at runtime resumes
/// reporting without a restart.
pub fn start(app: &AppHandle, consent: ConsentCache, data_dir: &Path) {
    if !is_configured() {
        return;
    }

    if consent.get() {
        // One-time install signal, guarded by a marker file in the app data dir.
        let marker = data_dir.join(".analytics_installed");
        if !marker.exists() {
            let _ = app.track_event("app_installed", None);
            let _ = std::fs::write(&marker, b"1");
        }
        let _ = app.track_event("app_started", None);
    }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(HEARTBEAT_INTERVAL).await;
            if consent.get() {
                let _ = handle.track_event("heartbeat", None);
            }
        }
    });
}
