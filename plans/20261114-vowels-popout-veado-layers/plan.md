# Vowel lip-sync, popout panels, veado import, layer tools

Status: done

## Decisions (from the user)
- Vowel detection: works out of the box with average formants + optional per-voice calibration.
- Vowel mouth images: per layer AND per voice range (`LayerRange.vowels`).
- Layer improvements: parent/child, multi-select, copy/paste animation, duplicate + quick rename.
- Undo persistence: out of scope.

## Phases
1. Audio (Rust `audio.rs`): linear resample to 48 kHz so RNNoise works on any mic; formant analysis
   (16 kHz, LPC envelope peaks -> F1/F2, voiced check); `mic-level` payload `{db,f1,f2}`; overlay feed too.
2. Popout panels: main window built in Rust with `on_new_window` allowing only our `popout.html`;
   tab menu "Tách ra cửa sổ riêng".
3. Model + engine: `brightness` prop (CSS filter), `Layer.pixelated`, `Layer.parentId` (world matrix =
   parent motion delta x child), `LayerRange.vowels`, vowel classification + smoothing in engine.
4. veado import: pixelated flag (state flags bit 0x1), darken -> brightness, several effects merged,
   wave phase offsets.
5. Custom presets travel with exported avatar files (merge on import, skip same names).
6. UI: vowel image slots, calibration in settings, parent picker, multi-select (list + stage),
   copy/paste clip/track, duplicate layer, double-click rename.
7. Lazy-load the editor (smaller main chunk).
8. Docs: feature files + README.

## Acceptance
- `tsc` clean, `vite build` no chunk warning for main, `cargo build` ok, exe rebuilt.
- Harness screenshots: parent/child motion, vowel images switch with simulated formants.
- Formant analysis checked offline on synthetic vowels (Rust unit test).
