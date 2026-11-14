# Library and screens

## Screens (`store.screen`, routed in `src/App.tsx`)
- `home` — `components/Home.tsx`: avatar cards. Click card / "Dùng" -> `live`; "✎ Custom" -> `edit`. Buttons: new avatar, one button per sample avatar in `SAMPLES` (`src/sampleAvatar.ts`, see `avatar-animation.md`), import `.pngtubah`/`.veado` files, import veadotube premade avatars (pick the veadotube-mini folder).
- `live` — `components/Live.tsx`: stage + toolbar (fades until hover; "📋 Link OBS" copies `overlayUrl()` to the clipboard) + state buttons + settings popover (`SettingsPanel`).
- `edit` — editor (`components/EditorLayout.tsx`): Unity-like dock (dockview-react). Panels: Sân khấu (Stage, editable: drag/resize/rotate layers, see `avatar-animation.md`, + top buttons), Inspector, Layer, State, Avatar, Voice range, Cài đặt. Panel bodies are the `*Section` components exported from `components/Sidebar.tsx` (each wrapped in `Section` = padded column, no title; the tab is the title). "✓ Xong" -> live, "← Thư viện" -> home. Both reset `previewRange`. Undo/redo buttons + Ctrl+Z / Ctrl+Y.

## Editor dock (`components/EditorLayout.tsx`)
Drag a tab onto a panel edge = split, onto a tab bar = group as tabs; drag the gap between groups = resize. Panels cannot be closed (tab close button hidden), so nothing gets lost.
Floating ("nhổ ra"): Shift+drag a tab, or right-click a tab > "Nhổ ra (cửa sổ nổi)" (`addFloatingGroup`, 420x360 at 80,80). A floating window moves by its title strip and docks back by dragging its tab onto the grid, or right-click > "Gắn lại vào khung" (`group.api.moveTo({ position: "right" })`). Right-click > "Phóng to" / "Thu nhỏ lại" maximizes a grid panel (`tabMenu` in `EditorLayout.tsx`). Floating windows are part of the saved layout. Popout to real OS windows is not used (Tauri webview + engine refs across documents).
Tauri: `dragDropEnabled: false` on the main window (`tauri.conf.json`), otherwise WebView2 swallows HTML5 drag & drop and tabs cannot be dropped/snapped. The app does not use Tauri file-drop events. Layout (`api.toJSON()`) is saved to localStorage `pngtubah.layout` on every layout change; restored on open. If the saved layout fails to parse or misses a panel id (older version), the default layout is built instead. "⊞ Bố cục mặc định" clears the saved layout and rebuilds the default: stage top-left, Inspector below it, right column Layer/State/Avatar tabs above Voice range/Cài đặt tabs. Theme: `dockview-theme-chalk` CSS variables in `App.css` (colors from the chalkboard theme). Hidden tabs are unmounted (dockview default), the engine handles layer `<img>` refs coming and going.

## Library (`src-tauri/src/library.rs`)
`<app_data_dir>/avatars/<id>.pngtubah` (JSON). Commands: `library_list` (reads only `name` + `thumb`), `library_load`, `library_save` (write tmp + rename), `library_delete`. Ids are validated `[A-Za-z0-9_-]`.

## Autosave (`initPlatform` in `src/platform.ts`)
Avatar edits (same `libraryId` as before) are saved 1 s after the last change. Opening an avatar does not trigger a save. Each save regenerates `avatar.thumb` (160 px canvas render of state 0 / range 0) and drops unused assets (`serializeAvatar`).

## Mic status
`restartMic()` stores `mic` / `micError` in the store; `SettingsPanel` only displays them (it can be mounted in both live and edit screens).

## Theme
Doodle chalkboard in `src/App.css` (wobbly border-radius, Patrick Hand font from `@fontsource/patrick-hand/400.css`). Must use the combined CSS: it declares `unicode-range`; the per-subset files don't, and then Vietnamese glyphs render decomposed. Stage CSS lives in `components/Stage.css` so the overlay page gets it too.
