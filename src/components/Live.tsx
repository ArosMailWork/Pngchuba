import { useState } from "react";
import { overlayUrl, prettyAccel, switchTo } from "../platform";
import { currentState, useStore } from "../store";
import { SettingsPanel } from "./SettingsPanel";
import { Stage } from "./Stage";

/** Simple "use" screen: the avatar, a small toolbar and state buttons. */
export function Live() {
  const avatar = useStore((s) => s.avatar);
  const current = useStore((s) => currentState(s).id);
  const set = useStore((s) => s.set);
  const micBlocked = useStore((s) => !!s.mic?.blocked);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    navigator.clipboard.writeText(overlayUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="live">
      <Stage hint='Avatar này chưa có hình. Bấm "✎ Custom" để thêm.' />

      <div className="toolbar">
        <button onClick={() => set({ screen: "home" })}>← Thư viện</button>
        <span className="toolbar-name">{avatar.name}</span>
        <button onClick={copyLink} title={`Copy link OBS: ${overlayUrl()}`}>
          {copied ? "✓ Đã copy" : "📋 Link OBS"}
        </button>
        <button onClick={() => set({ screen: "edit" })}>✎ Custom</button>
        <button className={showSettings ? "active" : ""} onClick={() => setShowSettings(!showSettings)}>
          ⚙ Cài đặt
        </button>
        {micBlocked && (
          <button className="warn" onClick={() => setShowSettings(true)} title="Mic mặc định là tai nghe Bluetooth nên chưa mở. Bấm để chọn mic.">
            ⚠ Chưa mở mic (tai nghe Bluetooth)
          </button>
        )}
      </div>

      {avatar.states.length > 1 && (
        <div className="state-bar">
          {avatar.states.map((st) => (
            <button key={st.id} className={st.id === current ? "active" : ""} onClick={() => switchTo(st.id)}>
              {st.name}
              {st.hotkey && <span className="muted small"> · {prettyAccel(st.hotkey)}</span>}
            </button>
          ))}
        </div>
      )}

      {showSettings && (
        <div className="popover">
          <SettingsPanel />
        </div>
      )}
    </div>
  );
}
