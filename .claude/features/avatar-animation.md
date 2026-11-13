# Avatar animation: layers, voice ranges, curves

## Data model (`src/types.ts`)
Avatar -> states[] -> { ranges[], layers[] }.
- `VoiceRange { id, name, threshold(dBFS) }`, kept sorted ascending. Range 0 = silence fallback (threshold ignored).
- `Layer.perRange[rangeId] = { image, blinkImage, clip }` — every layer must have an entry for every range of its state (added/removed together in `Sidebar.tsx` RangesSection).
- `Clip { duration, loop, volumeBoost, tracks: {prop: Keyframe[]}, sprites?: SpriteKey[] }`. Keyframe handles are relative (inT<=0, outT>=0).
- `SpriteKey { t, image }` (sorted by t): from t on the layer shows `image` (asset id; null = the range's `image`). The first key also covers t < its time. Optional, old files have none.
- x/y/rotation are additive offsets on the layer base transform; scaleX/scaleY/opacity are multipliers (neutral 1).
- Images are data URLs in `avatar.assets`; unused ones (not image/blinkImage/sprite key) are pruned on save (`serializeAvatar` in `platform.ts`).

## Runtime (`src/engine.ts`)
rAF loop (shared by the app and the OBS overlay page), reads zustand store directly, writes `<img>` style (no React re-render).
1. level = rawDb (from Rust `mic-level`) + gainDb.
2. Range = highest threshold reached. Up = instant; down only after `settings.releaseDelay`.
3. `previewRange` forces the inspector's selected range.
4. On state/range change: clip restarts at t=0, motion blends from last values over `state.transition` (smoothstep).
5. Volume boost factor = 1 + volumeBoost * position of level inside the range (0 at its threshold, 1 at next threshold; top range: +20 dB).
6. Blink: random interval 0.7–1.3 × blinkInterval, uses `blinkImage` if set.
7. Image priority: blinkImage (while blinking) > sprite frame at clip time (`spriteAt` in `curve.ts`) > range image.

## Curve editor (`src/components/CurveEditor.tsx`)
Double-click add key, drag key/handles, right-click delete, Shift snap 0.05s, Alt breaks handle alignment. Changing duration rescales key times (curves and sprite keys). Path is sampled from `evalTrack` so it matches runtime. Applying a preset replaces motion but keeps the clip's sprite frames.

"Sprite" tab -> `components/SpriteTrack.tsx`: timeline bar of frames, per-frame start time, image picker (existing avatar assets, "hình range" = null, or upload).

## Presets (`src/presets.ts`)
`squashClip(duration, volumeBoost, anchor)`: chibi-gif squash & stretch (scaleY 1.08 -> 0.92, scaleX opposite); `anchor` (half shown height px) adds a Y track so the bottom edge stays put. Preset "Bóp kiểu GIF" = `squashClip(0.3, 0.6)`.

## Sample avatar (`src/sampleAvatar.ts`)
Home "+ Avatar mẫu (GIF)" -> `gifSampleAvatar()`: images `src/assets/sample/gif-{open,closed}.png` (220 px, frames from a chibi gif, background removed), imported `?inline` as data URLs. Silent = closed + "Thở"; Nói = 0.3 s, Hét = 0.2 s loops: sprites open/closed + `squashClip(..., 220)` (layer scale 2). Blinking off.

## Mic (`src-tauri/src/audio.rs`)
cpal stream on its own thread; mono RMS -> peak per 16 ms -> `mic-level` event. RNNoise (nnnoiseless) only when the device runs at 48 kHz.

## Hotkeys (`src/platform.ts`)
Global shortcuts re-registered when any state's hotkey/mode changes. Modes: press, hold (revert on release), toggle.

## Related
- Screens, library, autosave: `library-and-screens.md`
- OBS overlay + remote control server: `obs-overlay.md`
- veadotube import: `veado-import.md`
