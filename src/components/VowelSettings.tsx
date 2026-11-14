import { useEffect, useRef, useState } from "react";
import { runtime } from "../engine";
import { useStore } from "../store";
import { Vowel, VOWELS } from "../types";
import { DEFAULT_PROFILE, medianFormants } from "../vowels";

const RECORD_MS = 1800;

/** Lip-sync on/off, live vowel readout and per-voice calibration. */
export function VowelSettings() {
  const lipSync = useStore((s) => s.settings.lipSync);
  const profile = useStore((s) => s.settings.vowelProfile);
  const setSettings = useStore((s) => s.setSettings);
  const [recording, setRecording] = useState<Vowel | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const liveRef = useRef<HTMLSpanElement>(null);

  // live readout, straight from the engine (no React re-render per frame)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (liveRef.current) {
        const { vowel, f1, f2 } = runtime;
        liveRef.current.textContent =
          `${vowel ? vowel.toUpperCase() : "—"}` + (f1 > 0 ? `  (F1 ${Math.round(f1)} · F2 ${Math.round(f2)} Hz)` : "");
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const record = (v: Vowel) => {
    setRecording(v);
    setNote(null);
    const samples: [number, number][] = [];
    const timer = setInterval(() => {
      if (runtime.f1 > 0 && runtime.f2 > 0) samples.push([runtime.f1, runtime.f2]);
    }, 16);
    setTimeout(() => {
      clearInterval(timer);
      setRecording(null);
      const m = medianFormants(samples);
      if (!m) return setNote(`Chưa nghe rõ "${v}", thử nói to và kéo dài hơn nhé.`);
      setSettings({ vowelProfile: { ...useStore.getState().settings.vowelProfile, [v]: m } });
      setNote(`Đã lưu "${v}": F1 ${m[0]} · F2 ${m[1]} Hz`);
    }, RECORD_MS);
  };

  return (
    <>
      <h4>👄 Khẩu hình (a i u e o)</h4>
      <label className="check" title="Khi đang nói, đổi hình miệng theo nguyên âm nghe được (cần chọn hình A/I/U/E/O cho layer miệng)">
        <input type="checkbox" checked={lipSync} onChange={(e) => setSettings({ lipSync: e.target.checked })} />
        Đổi hình miệng theo nguyên âm
      </label>
      {lipSync && (
        <>
          <div className="small">
            Đang nghe: <span ref={liveRef} className="mono" />
          </div>
          <div className="muted small">
            Hiệu chỉnh theo giọng (tùy chọn): bấm một nút rồi kéo dài âm đó khoảng 2 giây, ví dụ "aaaa".
          </div>
          <div className="row wrap">
            {VOWELS.map((v) => (
              <button
                key={v}
                disabled={recording !== null}
                className={profile[v] ? "active" : ""}
                title={`Đang dùng F1 ${(profile[v] ?? DEFAULT_PROFILE[v])[0]} · F2 ${(profile[v] ?? DEFAULT_PROFILE[v])[1]} Hz${profile[v] ? " (giọng của bạn)" : " (mặc định)"}`}
                onClick={() => record(v)}
              >
                {recording === v ? `🔴 ${v.toUpperCase()}…` : `Thu ${v.toUpperCase()}`}
              </button>
            ))}
            {Object.keys(profile).length > 0 && (
              <button disabled={recording !== null} onClick={() => setSettings({ vowelProfile: {} })}>
                Về mặc định
              </button>
            )}
          </div>
          {note && <div className="small">{note}</div>}
        </>
      )}
    </>
  );
}
