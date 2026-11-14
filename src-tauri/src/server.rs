//! Local HTTP server (127.0.0.1 only) for OBS / Streamlabs:
//! - `GET /`        overlay page (Browser Source URL): only the avatar, transparent
//! - `GET /ws`      overlay feed: avatar JSON, live state, mic level
//! - `GET /control` remote control websocket (Stream Deck, scripts...)

use std::sync::{Arc, Mutex};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State as AxState};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::Router;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::broadcast;

const DEV_URL: &str = "http://localhost:1420";

pub struct ServerState {
    overlay_tx: broadcast::Sender<Arc<str>>,
    control_tx: broadcast::Sender<Arc<str>>,
    /// last avatar/live messages, replayed to overlays that connect later
    cache: Mutex<[Option<Arc<str>>; 2]>,
    handle: Mutex<Option<JoinHandle<()>>>,
    port: Mutex<u16>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            overlay_tx: broadcast::channel(256).0,
            control_tx: broadcast::channel(64).0,
            cache: Mutex::new([None, None]),
            handle: Mutex::new(None),
            port: Mutex::new(0),
        }
    }
}

impl ServerState {
    /// Called from the audio thread ~60 times per second.
    pub fn publish_level(&self, db: f32, f1: f32, f2: f32) {
        if self.overlay_tx.receiver_count() > 0 {
            let msg = format!(r#"{{"type":"level","db":{db:.2},"f1":{f1:.0},"f2":{f2:.0}}}"#);
            let _ = self.overlay_tx.send(msg.into());
        }
    }
}

#[tauri::command]
pub async fn server_start(app: AppHandle, state: State<'_, ServerState>, port: u16) -> Result<(), String> {
    if let Some(old) = state.handle.lock().unwrap().take() {
        old.abort();
    }
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("không mở được cổng {port}: {e}"))?;
    let router = Router::new()
        .route("/", get(overlay_page))
        .route("/ws", get(overlay_ws))
        .route("/control", get(control_ws))
        .route("/{*path}", get(asset))
        .with_state(app.clone());
    let handle = tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    *state.handle.lock().unwrap() = Some(handle);
    *state.port.lock().unwrap() = port;
    Ok(())
}

/// kind: "avatar" | "live"; json is forwarded verbatim to overlays.
#[tauri::command]
pub fn overlay_publish(state: State<ServerState>, kind: String, json: String) {
    let msg: Arc<str> = json.into();
    let slot = if kind == "avatar" { 0 } else { 1 };
    state.cache.lock().unwrap()[slot] = Some(msg.clone());
    let _ = state.overlay_tx.send(msg);
}

#[tauri::command]
pub fn control_send(state: State<ServerState>, text: String) {
    let _ = state.control_tx.send(text.into());
}

async fn overlay_page(AxState(app): AxState<AppHandle>) -> Response {
    if tauri::is_dev() {
        // dev assets live on the Vite server; tell the page where the feed is
        let port = *app.state::<ServerState>().port.lock().unwrap();
        return Redirect::temporary(&format!("{DEV_URL}/overlay.html?feed=127.0.0.1:{port}")).into_response();
    }
    asset(AxState(app), Path("overlay.html".into())).await
}

async fn asset(AxState(app): AxState<AppHandle>, Path(path): Path<String>) -> Response {
    match app.asset_resolver().get(path.trim_start_matches('/').to_string()) {
        Some(a) => ([(header::CONTENT_TYPE, a.mime_type.clone())], a.bytes.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn overlay_ws(AxState(app): AxState<AppHandle>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| async move {
        let state = app.state::<ServerState>();
        let mut rx = state.overlay_tx.subscribe();
        let cached: Vec<Arc<str>> = state.cache.lock().unwrap().iter().flatten().cloned().collect();
        let mut socket = socket;
        for msg in cached {
            if socket.send(Message::text(msg.to_string())).await.is_err() {
                return;
            }
        }
        forward(socket, &mut rx, |_| {}).await;
    })
}

async fn control_ws(AxState(app): AxState<AppHandle>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| async move {
        let mut rx = app.state::<ServerState>().control_tx.subscribe();
        forward(socket, &mut rx, |text| {
            let _ = app.emit("ws-message", text);
        })
        .await;
    })
}

/// Pumps broadcast messages out and hands incoming text to `on_text`.
async fn forward(mut socket: WebSocket, rx: &mut broadcast::Receiver<Arc<str>>, on_text: impl Fn(String)) {
    loop {
        tokio::select! {
            msg = socket.recv() => match msg {
                Some(Ok(Message::Text(t))) => on_text(t.to_string()),
                Some(Ok(_)) => {}
                _ => break,
            },
            out = rx.recv() => match out {
                Ok(text) => {
                    if socket.send(Message::text(text.to_string())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(_) => break,
            },
        }
    }
}
