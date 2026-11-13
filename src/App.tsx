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

export default function App() {
  const screen = useStore((s) => s.screen);

  useEffect(() => {
    if (initialized) return; // StrictMode runs effects twice in dev
    initialized = true;
    startEngine();
    initPlatform().catch((err) => console.error("init failed", err));
  }, []);

  if (screen === "home") return <Home />;
  if (screen === "live") return <Live />;
  return (
    <div className="editor">
      <div className="main">
        <div className="editor-top">
          <button onClick={() => useStore.getState().set({ screen: "live", previewRange: false })}>✓ Xong</button>
          <button onClick={() => useStore.getState().set({ screen: "home", previewRange: false })}>← Thư viện</button>
        </div>
        <Stage hint='Chọn layer bên dưới rồi bấm "Chọn hình" để bắt đầu' />
        <div className="dock">
          <Inspector />
        </div>
      </div>
      <Sidebar />
    </div>
  );
}
