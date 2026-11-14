import { useEffect } from "react";
// combined file: declares unicode-range per subset so Vietnamese glyphs are used
import "@fontsource/patrick-hand/400.css";
import { Home } from "./components/Home";
import { Inspector } from "./components/Inspector";
import { Live } from "./components/Live";
import { Sidebar } from "./components/Sidebar";
import { Stage } from "./components/Stage";
import { startEngine } from "./engine";
import { initPlatform } from "./platform";
import { useStore } from "./store";
import "./App.css";

let initialized = false;

/** Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo, in the editor only. */
function onUndoKey(e: KeyboardEvent) {
  const s = useStore.getState();
  if (s.screen !== "edit" || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) s.undo();
  else if (k === "y" || (k === "z" && e.shiftKey)) s.redo();
  else return;
  e.preventDefault();
}

export default function App() {
  const screen = useStore((s) => s.screen);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);

  useEffect(() => {
    if (initialized) return; // StrictMode runs effects twice in dev
    initialized = true;
    startEngine();
    initPlatform().catch((err) => console.error("init failed", err));
    window.addEventListener("keydown", onUndoKey);
  }, []);

  if (screen === "home") return <Home />;
  if (screen === "live") return <Live />;
  return (
    <div className="editor">
      <div className="main">
        <div className="editor-top">
          <button onClick={() => useStore.getState().set({ screen: "live", previewRange: false })}>✓ Xong</button>
          <button onClick={() => useStore.getState().set({ screen: "home", previewRange: false })}>← Thư viện</button>
          <button disabled={!canUndo} onClick={() => useStore.getState().undo()} title="Hoàn tác (Ctrl+Z)">↶</button>
          <button disabled={!canRedo} onClick={() => useStore.getState().redo()} title="Làm lại (Ctrl+Y / Ctrl+Shift+Z)">↷</button>
        </div>
        <Stage editable hint='Chọn layer bên dưới rồi bấm "Chọn hình" để bắt đầu' />
        <div className="dock">
          <Inspector />
        </div>
      </div>
      <Sidebar />
    </div>
  );
}
