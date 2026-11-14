# pngtubah

Lightweight PNGtuber app (Tauri 2 + React + Rust), inspired by veadotube mini.

- Avatar library (home screen) with autosave; the editor opens only via "Custom"
- Multiple image layers per state
- Voice ranges: several volume bands per state (e.g. silent / talking / shouting); each layer picks its own image, blink image and animation per range
- Move / resize / rotate layers directly on the editor preview; placement is set per voice range
- Keyframe curve editor (bezier handles) per animated property: X, Y, rotation, scale X/Y, opacity; zoom (wheel) and pan (right/middle drag)
- Own animation presets, shared by all avatars
- Image transitions between ranges and states: crossfade, fade through, pop
- Unlimited undo / redo (Ctrl+Z, Ctrl+Y) in the editor
- Sprite track: swap images frame by frame over the clip time (e.g. mouth open/closed), plus sample avatars: "+ Avatar mẫu (GIF)" (closed mouth when silent, open when talking, squash & stretch); more samples = more entries in `SAMPLES` (`src/sampleAvatar.ts`)
- Clips run on time (duration, loop) and can be amplified by voice volume ("volume boost")
- States with global hotkeys (press / hold / toggle), automatic blinking
- Imports veadotube mini `.veado` avatars, including the premade ones shipped with veadotube (all effects combined, darken, pixelated)
- Exported avatar files carry your animation presets
- OBS / Streamlabs Browser Source page with true transparency (no chroma key, no UI)
- Vowel lip-sync: mouth image per vowel (a i u e o) per layer and range, detected from the mic (formants), optional calibration to your voice
- Layer tools: parent/child layers (mouth follows head), multi-select (list + stage), duplicate, double-click rename, copy/paste animations and single curves, brightness curve, crisp pixel-art scaling
- RNNoise noise reduction (any mic sample rate), local websocket remote control
- Bluetooth-safe mic: a Bluetooth headset mic is never opened as "default" (it would drop the headset to hands-free quality); pick it explicitly if you want it
- Doodle chalkboard UI; Unity-like dockable editor panels (drag tabs to snap/split/group, Shift+drag or right-click to float a panel, pop a panel out to its own window, resize, layout is remembered)

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
| `src-tauri/src/audio.rs` | mic capture (cpal), RNNoise (resampled to 48 kHz), emits `mic-level` `{db,f1,f2}` at ~60 Hz |
| `src-tauri/src/formants.rs` | resampler + formant tracker (LPC) for vowel lip-sync |
| `src-tauri/src/server.rs` | local server: OBS overlay page + feed, remote control websocket |
| `src-tauri/src/library.rs` | avatar library files in app data |
| `src-tauri/src/veado.rs` | veadotube `.veado` importer (VDD image codec, APNG output) |
| `src/types.ts` | avatar data model |
| `src/vowels.ts` | vowel classification from formants, default profile, calibration helper |
| `src/curve.ts` | bezier keyframe evaluation |
| `src/engine.ts` | per-frame runtime: range picking, blink, animation, writes DOM transforms |
| `src/platform.ts` | Tauri glue: mic, hotkeys, server, library, import/export, autosave |
| `src/veadoImport.ts` | veado states/effects -> our model and curves |
| `src/overlay.tsx` | Browser Source page (avatar only, transparent) |
| `src/sampleAvatar.ts` | sample avatars (`SAMPLES` list, one home button each), GIF sample from `src/assets/sample/` |
| `src/components/` | UI: Home, Live, EditorLayout (dock), Stage (+ StageGizmo: on-stage editing), Sidebar (panel sections), Inspector, CurveEditor, SpriteTrack, SettingsPanel |

## OBS / Streamlabs

Add a **Browser Source** with URL `http://127.0.0.1:7878/` ("📋 Link OBS" button in the live toolbar, or Copy in Settings). Transparent background, only the avatar.

## Remote control

`ws://127.0.0.1:7878/control`, JSON text messages:

- `{"type":"list"}` → `{"type":"states","states":[{"id","name"}],"current":"<id>"}`
- `{"type":"set","state":"<name or id>"}`
- broadcast on change: `{"type":"current","state":{"id","name"}}`
