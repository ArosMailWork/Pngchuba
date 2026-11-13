import { useEffect, useState } from "react";
import { listInputDevices, overlayUrl, restartMic, setNoiseReduction, startServer } from "../platform";
import { useStore } from "../store";
import { NumberInput } from "./CurveEditor";

/** Mic + OBS settings, shared by the live screen and the editor. */
export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const mic = useStore((s) => s.mic);
  const micError = useStore((s) => s.micError);
  const setSettings = useStore((s) => s.setSettings);
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    listInputDevices().then(setDevices).catch(() => {});
  }, []);

  const copyLink = () => {
    navigator.clipboard.writeText(overlayUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="settings">
      <h4>🎙 Microphone</h4>
      <select
        value={settings.micDeviceId ?? ""}
        onChange={(e) => {
          setSettings({ micDeviceId: e.target.value || null });
          restartMic();
        }}
      >
        <option value="">(Mặc định của hệ thống)</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <div className="muted small">
        {micError ? `Lỗi mic: ${micError}` : mic ? `${mic.name} · ${mic.sample_rate} Hz` : "Đang mở mic…"}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.noiseReduction}
          onChange={(e) => {
            setSettings({ noiseReduction: e.target.checked });
            setNoiseReduction(e.target.checked);
          }}
        />
        Lọc ồn
      </label>
      {settings.noiseReduction && mic && !mic.denoise_supported && (
        <div className="warn small">Lọc ồn chỉ chạy khi mic để 48000 Hz (chỉnh trong Sound settings của Windows).</div>
      )}
      <label className="field">
        Gain mic (dB)
        <NumberInput value={settings.gainDb} step={1} onChange={(v) => setSettings({ gainDb: v })} />
      </label>
      <label className="field" title="Giữ range cao thêm một chút sau khi ngừng nói, tránh nhấp nháy">
        Độ trễ khi hạ range (s)
        <NumberInput value={settings.releaseDelay} step={0.05} min={0}
          onChange={(v) => setSettings({ releaseDelay: v })} />
      </label>

      <h4>📺 OBS / Streamlabs</h4>
      <div className="small">
        Thêm <b>Browser Source</b> rồi dán link này. Nền trong suốt, chỉ có avatar.
      </div>
      <div className="row">
        <code className="link grow">{overlayUrl()}</code>
        <button onClick={copyLink}>{copied ? "Đã copy!" : "Copy"}</button>
      </div>
      <label className="field">
        Cổng
        <NumberInput
          value={settings.serverPort}
          min={1024}
          max={65535}
          onChange={(v) => {
            setSettings({ serverPort: Math.round(v) });
            startServer().then(() => setServerError(null)).catch((err) => setServerError(String(err)));
          }}
        />
      </label>
      {serverError && <div className="warn small">{serverError}</div>}
      <div className="muted small">
        Điều khiển từ xa: ws://127.0.0.1:{settings.serverPort}/control · gửi {'{"type":"set","state":"tên state"}'}
      </div>
    </div>
  );
}
