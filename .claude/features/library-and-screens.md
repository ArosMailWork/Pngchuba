# Library and screens

## Screens (`store.screen`, routed in `src/App.tsx`)
- `home` — `components/Home.tsx`: avatar cards. Click card / "Dùng" -> `live`; "✎ Custom" -> `edit`. Buttons: new avatar, sample avatar from the gif (`gifSampleAvatar`, see `avatar-animation.md`), import `.pngtubah`/`.veado` files, import veadotube premade avatars (pick the veadotube-mini folder).
- `live` — `components/Live.tsx`: stage + toolbar (fades until hover; "📋 Link OBS" copies `overlayUrl()` to the clipboard) + state buttons + settings popover (`SettingsPanel`).
- `edit` — editor: Stage (editable: drag/resize/rotate layers, see `avatar-animation.md`) + Inspector (bottom dock) + Sidebar. "✓ Xong" -> live, "← Thư viện" -> home. Both reset `previewRange`. Undo/redo buttons + Ctrl+Z / Ctrl+Y.

## Library (`src-tauri/src/library.rs`)
`<app_data_dir>/avatars/<id>.pngtubah` (JSON). Commands: `library_list` (reads only `name` + `thumb`), `library_load`, `library_save` (write tmp + rename), `library_delete`. Ids are validated `[A-Za-z0-9_-]`.

## Autosave (`initPlatform` in `src/platform.ts`)
Avatar edits (same `libraryId` as before) are saved 1 s after the last change. Opening an avatar does not trigger a save. Each save regenerates `avatar.thumb` (160 px canvas render of state 0 / range 0) and drops unused assets (`serializeAvatar`).

## Mic status
`restartMic()` stores `mic` / `micError` in the store; `SettingsPanel` only displays them (it can be mounted in both live and edit screens).

## Theme
Doodle chalkboard in `src/App.css` (wobbly border-radius, Patrick Hand font from `@fontsource/patrick-hand/400.css`). Must use the combined CSS: it declares `unicode-range`; the per-subset files don't, and then Vietnamese glyphs render decomposed. Stage CSS lives in `components/Stage.css` so the overlay page gets it too.
