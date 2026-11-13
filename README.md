# pngtubah

Lightweight PNGtuber app (Tauri 2 + React + Rust), inspired by veadotube mini.

- Avatar library (home screen) with autosave; the editor opens only via "Custom"
- Multiple image layers per state
- Voice ranges: several volume bands per state (e.g. silent / talking / shouting); each layer picks its own image, blink image and animation per range
- Keyframe curve editor (bezier handles) per animated property: X, Y, rotation, scale X/Y, opacity
- Sprite track: swap images frame by frame over the clip time (e.g. mouth open/closed), plus a sample avatar ("+ Avatar mẫu (GIF)") with 2 sprites and squash & stretch
- Clips run on time (duration, loop) and can be amplified by voice volume ("volume boost")
- States with global hotkeys (press / hold / toggle), automatic blinking
- Imports veadotube mini `.veado` avatars, including the premade ones shipped with veadotube
- OBS / Streamlabs Browser Source page with true transparency (no chroma key, no UI)
- RNNoise noise reduction, local websocket remote control
- Doodle chalkboard UI

## Download

Prebuilt Windows app: [`release/pngtubah.exe`](release/pngtubah.exe) (portable, needs WebView2 which ships with Windows 10/11).

## Develop

```bash
npm install
npm run tauri dev      # run in dev mode
npm run tauri build    # build installer
```

## Code map

| Path | Role |
| --- | --- |
| `src-tauri/src/audio.rs` | mic capture (cpal), RNNoise, emits `mic-level` (dBFS) at ~60 Hz |
| `src-tauri/src/server.rs` | local server: OBS overlay page + feed, remote control websocket |
| `src-tauri/src/library.rs` | avatar library files in app data |
| `src-tauri/src/veado.rs` | veadotube `.veado` importer (VDD image codec, APNG output) |
| `src/types.ts` | avatar data model |
| `src/curve.ts` | bezier keyframe evaluation |
| `src/engine.ts` | per-frame runtime: range picking, blink, animation, writes DOM transforms |
| `src/platform.ts` | Tauri glue: mic, hotkeys, server, library, import/export, autosave |
| `src/veadoImport.ts` | veado states/effects -> our model and curves |
| `src/overlay.tsx` | Browser Source page (avatar only, transparent) |
| `src/sampleAvatar.ts` | sample avatar built from `src/assets/sample/` |
| `src/components/` | UI: Home, Live, Stage, Sidebar, Inspector, CurveEditor, SpriteTrack, SettingsPanel |

## OBS / Streamlabs

Add a **Browser Source** with URL `http://127.0.0.1:7878/` ("📋 Link OBS" button in the live toolbar, or Copy in Settings). Transparent background, only the avatar.

## Remote control

`ws://127.0.0.1:7878/control`, JSON text messages:

- `{"type":"list"}` → `{"type":"states","states":[{"id","name"}],"current":"<id>"}`
- `{"type":"set","state":"<name or id>"}`
- broadcast on change: `{"type":"current","state":{"id","name"}}`
