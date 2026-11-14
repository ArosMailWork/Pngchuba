# OBS / Streamlabs overlay + remote control

Local server `src-tauri/src/server.rs` (axum, 127.0.0.1 only, port `settings.serverPort`, default 7878), started by `startServer()` in `src/platform.ts`.

| Route | Purpose |
| --- | --- |
| `GET /` | overlay page. Release: `overlay.html` from Tauri's asset resolver. Dev: redirect to `http://localhost:1420/overlay.html?feed=127.0.0.1:<port>` |
| `GET /{*path}` | built assets (`/assets/...`) |
| `GET /ws` | overlay feed. On connect replays cached `avatar` + `live`, then streams broadcasts |
| `GET /control` | remote control websocket; incoming text -> `ws-message` event; outgoing via `control_send` |

Feed messages (JSON):
- `{"type":"avatar","avatar":{...}}` — published 300 ms after avatar edits (`overlay_publish` kind `avatar`, cached).
- `{"type":"live","currentStateId","gainDb","releaseDelay","lipSync","vowelProfile"}` — on state/gain/delay change (cached).
- `{"type":"level","db","f1","f2"}` — from the audio emitter thread ~60/s (`ServerState::publish_level`), only when clients are connected.

Overlay page: `overlay.html` + `src/overlay.tsx` (second Vite input). Renders `<Stage overlay />` with transparent background and runs the same engine; reconnects every 1 s if the app is closed. Editor `previewRange` is never sent, so tuning curves doesn't show on stream.

Control protocol: `{"type":"list"}` -> states list, `{"type":"set","state":"<name|id>"}`, broadcast `{"type":"current",...}` on change.
