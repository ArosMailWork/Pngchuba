# Avatar animation: layers, voice ranges, curves

## Data model (`src/types.ts`)
Avatar -> states[] -> { ranges[], layers[] }.
- `VoiceRange { id, name, threshold(dBFS) }`, kept sorted ascending. Range 0 = silence fallback (threshold ignored).
- `Layer.perRange[rangeId] = { x, y, rotation, scale, image, blinkImage, clip, vowels? }` — every layer must have an entry for every range of its state (added/removed together in `Sidebar.tsx` RangesSection; a new range copies the placement of the loudest range).
- Placement (`Transform`: x/y px from stage center, rotation deg, uniform scale) is per range. Files from before kept it on `Layer`; `parseAvatar` (`platform.ts`) copies it into every range and drops the layer fields. States are independent anyway (own layers).
- `AvatarState.fade?: FadeKind` (`none | crossfade | fadeThrough | pop`, missing = none) + `transition` (seconds, shared by motion blend and image effect).
- `Clip { duration, loop, volumeBoost, tracks: {prop: Keyframe[]}, sprites?: SpriteKey[] }`. Keyframe handles are relative (inT<=0, outT>=0).
- `SpriteKey { t, image }` (sorted by t): from t on the layer shows `image` (asset id; null = the range's `image`). The first key also covers t < its time. Optional, old files have none.
- x/y/rotation are additive offsets on the range's placement; scaleX/scaleY multiply its scale; opacity and brightness are multipliers (neutral 1). Brightness ("Độ sáng") = CSS `filter: brightness()`, e.g. veado `darken`.
- `LayerRange.vowels?: {a,i,u,e,o -> asset id}`: mouth image per detected vowel (see `lip-sync.md`).
- `Layer.parentId?`: the layer follows that layer's motion (same state). `Layer.pixelated?`: `image-rendering: pixelated`.
- Images are data URLs in `avatar.assets`; unused ones (not image/blinkImage/sprite key/vowel image) are pruned on save (`serializeAvatar` in `platform.ts`).

## Runtime (`src/engine.ts`)
rAF loop (shared by the app and the OBS overlay page), reads zustand store directly, writes `<img>` style (no React re-render).
1. level = rawDb (from Rust `mic-level`) + gainDb.
2. Range = highest threshold reached. Up = instant; down only after `settings.releaseDelay`.
3. `previewRange` forces the inspector's selected range.
4. On state/range change: clip restarts at t=0, final values (placement + motion) and the base placement blend from last values over `state.transition` (smoothstep).
4a. Parent/child: each layer's own matrix M = translate(v.x,v.y) rotate scale(v.scaleX,v.scaleY). World = World(parent) x inverse(Base(parent)) x M, Base = the parent's (blended) placement without animation. So a parent standing still leaves the child where it is placed, and the child gets the parent's motion around the parent's pivot. Drawn as `translate(-50%,-50%) matrix(...)` (pop scale multiplied at the end). Depth capped at 16; the Inspector only offers non-descendants. Opacity/brightness are not inherited.
4b. Image effect (`fade` of the state being entered, progress = elapsed / transition): only layers whose picture differs from what they showed before the switch (or new layers after a state switch) get it; each layer is checked on its first drawn frame (React may mount a new state's `<img>` a frame late). The previous picture becomes a "ghost" `<img>` in `.ghosts` (behind the layers, registered by `Stage`) and fades out: crossfade = old 1->0 while new 0->1; fadeThrough = old out in the first half, new in during the second; pop = old cut, new scales 0.6->1 with ease-out-back overshoot. Layers gone after a state switch are ghosted too. `restartClip()` clears ghosts. Never on the very first frame.
5. Volume boost factor = 1 + volumeBoost * position of level inside the range (0 at its threshold, 1 at next threshold; top range: +20 dB).
6. Blink: random interval 0.7–1.3 × blinkInterval, uses `blinkImage` if set.
7. Image priority: blinkImage (while blinking) > vowel image (`runtime.vowel`, see `lip-sync.md`) > sprite frame at clip time (`spriteAt` in `curve.ts`) > range image.

## Stage editing (`src/components/StageGizmo.tsx`, `<Stage editable>` in the editor only)
Click a layer on the stage to select it (rotated-box hit test, topmost first, sizes from the engine's `<img>` via `layerImg`), drag to move, drag a corner to scale (uniform, distance from center), drag the round knob to rotate (Shift = 15 degree steps). Edits the placement of the Inspector's selected range and turns on `previewRange` so that range is on stage. The box shows the base placement (without animation or parent motion). One drag = one undo step (`beginGesture`/`endGesture`). The Inspector has the same numbers + "Áp vị trí cho mọi range".
Multi-selection: Ctrl/Shift+click a layer on stage adds/removes it (no drag); dragging a layer that is in the multi-selection moves all selected layers by the same offset (move only; scale/rotate act on the primary). Other selected layers get a thin blue outline (`PickedOutline`).

## Layer tools (`components/Sidebar.tsx` LayersSection, `components/Inspector.tsx`)
- Selection: `store.selectedLayerId` (primary) + `store.selectedLayerIds`; `selectedLayerIds(s)` returns the multi list only when it contains the primary, so code that sets only `selectedLayerId` collapses the selection. Read it in components with `useShallow` (new array each call). Layer list: click = one, Ctrl+click = toggle, Shift+click = range; switching state clears it.
- Children are indented with "↳" by parent depth. Double-click a name = inline rename (Enter/blur saves, Esc cancels).
- "Nhân bản": clones selected layers (from committed state, not the immer draft: drafts can't be structuredClone'd) right above each original, "(bản sao)", a child copied with its parent follows the copy. "Xóa layer" removes all selected and clears dangling `parentId`.
- Inspector: "Gắn vào layer" (parent select), "Giữ nét pixel", 5 vowel image slots for the selected range (click = pick, right-click = clear; "Áp hình cho mọi range" copies them too). With several layers selected: copy this range's / all ranges' animation of the primary to the others.
- Copy/paste: "📋 Copy" stores the range clip in `store.copiedClip`; "📥 Dán" replaces the clip of this range in every selected layer (sprite keys pointing at missing assets are dropped). Curve editor: "📋 Copy track" / "📥 Dán track" (`store.copiedTrack {keys,duration}`, times rescaled to the target clip). Clipboard is in memory only.

## Curve editor (`src/components/CurveEditor.tsx`)
Double-click add key, drag key/handles, right-click delete, Shift snap 0.05s, Alt breaks handle alignment. Changing duration rescales key times (curves and sprite keys). Path is sampled from `evalTrack` over the visible part of the clip so it matches runtime.
View: auto-fit by default (value window frozen while dragging a key). Wheel = zoom values around the cursor, Shift/Ctrl+wheel = zoom time (native non-passive listener), right/middle-drag on the background = pan, "Vừa khung" = back to auto. Everything inside the plot is clipped (`<clipPath>`), time outside 0..duration is shaded. Value zoom resets on property/range change, time zoom on duration change. Key/handle drags are one undo step.

"Sprite" tab -> `components/SpriteTrack.tsx`: timeline bar of frames, per-frame start time, image picker (existing avatar assets, "hình range" = null, or upload).

## Presets (`src/presets.ts`)
`squashClip(duration, volumeBoost, anchor)`: chibi-gif squash & stretch (scaleY 1.08 -> 0.92, scaleX opposite); `anchor` (half shown height px) adds a Y track so the bottom edge stays put. Preset "Bóp kiểu GIF" = `squashClip(0.3, 0.6)`.
Applying any preset replaces motion but keeps the clip's sprite frames.
Exported `.pngtubah` files carry the user's presets (`avatar.presets`); importing merges them into `customPresets` (same name = skipped) and strips them from the avatar (`mergePresets` in `platform.ts`). Library files never contain presets.

User presets (`PresetPicker` in `CurveEditor.tsx`): `CustomPreset { id, name, clip }` in `store.customPresets`, persisted in localStorage `pngtubah.presets`, shared by all avatars (not exported with avatar files). "Lưu preset" saves the current clip without sprites (they point at one avatar's images); same name = overwrite after confirm. The pencil button = rename/delete. The preset select has groups "Có sẵn" / "Của tôi".

## Sample avatar (`src/sampleAvatar.ts`)
Samples are listed in `SAMPLES` (`src/sampleAvatar.ts`: label, tooltip, `make()`); Home renders one "+ Avatar mẫu (<label>)" button per entry.

Home "+ Avatar mẫu (GIF)" -> `gifSampleAvatar()`: images `src/assets/sample/gif-{open,closed}.png` (220 px, frames from a chibi gif, background removed), imported `?inline` as data URLs. Silent = closed + "Thở"; Nói = 0.3 s, Hét = 0.2 s loops: open-mouth image only (no sprite swap) + `squashClip(..., 220)`; scale 2 in every range. Blinking off.

## Mic (`src-tauri/src/audio.rs`)
**Bluetooth rule:** a Bluetooth headset mic is NEVER opened as the system default. Opening it makes Windows switch the headset from A2DP (stereo) to hands-free (mono 16 kHz), so everything the user hears gets worse (same rule as Streamtubah). `bluetooth.rs` lists Bluetooth capture endpoints via Core Audio (enumerator `BTH*` or name contains "Hands-Free"; ids = cpal WASAPI `DeviceId::id()`), only reading properties. `start_mic` with no device id + Bluetooth default -> returns `MicInfo { blocked: true }` without touching the device (no `default_input_config`). Picking the headset explicitly opens it (`MicInfo.bluetooth` -> warning). `list_input_devices` marks `bluetooth`. UI: SettingsPanel labels "— Bluetooth", warnings; Live toolbar shows "⚠ Chưa mở mic" when blocked. Verified on hardware: OPPO Enco Air3i detected as Bluetooth (`cargo test --lib lists_bluetooth -- --nocapture`).
cpal stream on its own thread; mono RMS -> peak per 16 ms -> `mic-level` event `{db, f1, f2}`. Noise reduction (RNNoise, nnnoiseless) works at any device rate: mono is resampled to 48 kHz (`formants::Resampler`, linear + one-pole low-pass when downsampling) before denoising. Formants: see `lip-sync.md`.

## Hotkeys (`src/platform.ts`)
Global shortcuts re-registered when any state's hotkey/mode changes. Modes: press, hold (revert on release), toggle.

## Undo / redo (`src/store.ts`)
Every `edit()` is undoable; history = whole-avatar snapshots in module arrays `past`/`future` (immer shares unchanged parts and the asset strings, so it is unlimited). Edits less than 400 ms apart merge into one step (typing, sliders); between `beginGesture()` and `endGesture()` all edits are one step (stage/curve drags). `setAvatar` clears history (it does not survive closing the app). After undo/redo, `selectionFor` keeps current state/layer/range ids valid. Keys (editor screen only, `App.tsx`): Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo; undo/redo buttons in the editor top bar. Undo changes the avatar, so autosave runs as usual.

## Related
- Screens, library, autosave: `library-and-screens.md`
- OBS overlay + remote control server: `obs-overlay.md`
- veadotube import: `veado-import.md`
- Vowel lip-sync: `lip-sync.md`
