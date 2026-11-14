import { lazy, Suspense, useEffect } from "react";
// combined file: declares unicode-range per subset so Vietnamese glyphs are used
import "@fontsource/patrick-hand/400.css";
import { Home } from "./components/Home";
import { Live } from "./components/Live";
import { startEngine } from "./engine";
import { initPlatform } from "./platform";
import { useStore } from "./store";
import "./App.css";

// the editor (dock, curve editor...) is only loaded when opened
const EditorLayout = lazy(() => import("./components/EditorLayout").then((m) => ({ default: m.EditorLayout })));

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
    <Suspense fallback={null}>
      <EditorLayout />
    </Suspense>
  );
}
