import { ReactNode, useEffect, useRef, useState } from "react";
import { runtime } from "../engine";
import { accelFromEvent, exportAvatar, prettyAccel } from "../platform";
import {
  currentState,
  editCurrent,
  newLayer,
  newLayerRange,
  newState,
  uid,
  useStore,
} from "../store";
import { AvatarState, FadeKind, HotkeyMode } from "../types";
import { NumberInput } from "./CurveEditor";

const DB_MIN = -80;

/** Body of one editor dock panel (the panel tab shows the title). */
export function Section({ children }: { children: ReactNode }) {
  return <div className="section-body">{children}</div>;
}

export function run(p: Promise<unknown>) {
  p.catch((err) => alert(String(err)));
}

// ---------------------------------------------------------------------------

export function AvatarSection() {
  const name = useStore((s) => s.avatar.name);
  return (
    <Section>
      <label className="field">
        Tên
        <input value={name} onChange={(e) => useStore.getState().edit((a) => void (a.name = e.target.value))} />
      </label>
      <div className="row wrap">
        <button onClick={() => run(exportAvatar())}>Xuất file…</button>
      </div>
      <div className="muted small">Mọi thay đổi được tự động lưu vào thư viện.</div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function cloneState(src: AvatarState): AvatarState {
  const st = structuredClone(src);
  const rangeMap = new Map(st.ranges.map((r) => [r.id, uid()]));
  st.id = uid();
  st.name = src.name + " (bản sao)";
  st.hotkey = null;
  st.ranges.forEach((r) => (r.id = rangeMap.get(r.id)!));
  st.layers.forEach((l) => {
    l.id = uid();
    l.perRange = Object.fromEntries(
      Object.entries(l.perRange).map(([k, v]) => [rangeMap.get(k) ?? k, v]),
    );
  });
  return st;
}

export function StatesSection() {
  const states = useStore((s) => s.avatar.states);
  const st = useStore((s) => currentState(s));
  const { set, edit } = useStore.getState();
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") return setCapturing(false);
      const accel = accelFromEvent(e);
      if (!accel) return;
      editCurrent((s) => void (s.hotkey = accel));
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capturing]);

  const select = (id: string) => {
    // read fresh: a state may have just been added in the same handler
    const next = useStore.getState().avatar.states.find((s) => s.id === id)!;
    set({
      currentStateId: id,
      selectedLayerId: next.layers[0]?.id ?? null,
      selectedRangeId: next.ranges[0].id,
    });
  };

  const add = (state: AvatarState) => {
    edit((a) => void a.states.push(state));
    select(state.id);
  };

  return (
    <Section>
      <div className="list">
        {states.map((s) => (
          <div key={s.id} className={"list-item" + (s.id === st.id ? " active" : "")} onClick={() => select(s.id)}>
            <span>{s.name}</span>
            <span className="muted small">{s.hotkey ? prettyAccel(s.hotkey) : ""}</span>
          </div>
        ))}
      </div>
      <div className="row wrap">
        <button onClick={() => add(newState(`State ${states.length + 1}`))}>+ Mới</button>
        <button onClick={() => add(cloneState(st))}>Nhân bản</button>
        <button
          disabled={states.length < 2}
          onClick={() => {
            if (!confirm(`Xóa state "${st.name}"?`)) return;
            const rest = states.filter((s) => s.id !== st.id);
            select(rest[0].id);
            edit((a) => void (a.states = a.states.filter((s) => s.id !== st.id)));
          }}
        >
          Xóa
        </button>
      </div>

      <label className="field">
        Tên
        <input value={st.name} onChange={(e) => editCurrent((s) => void (s.name = e.target.value))} />
      </label>
      <label className="field">
        Phím tắt
        <div className="row">
          <button onClick={() => setCapturing(true)}>
            {capturing ? "Bấm phím… (Esc để hủy)" : st.hotkey ? prettyAccel(st.hotkey) : "Gán phím"}
          </button>
          {st.hotkey && <button onClick={() => editCurrent((s) => void (s.hotkey = null))}>✕</button>}
        </div>
      </label>
      <label className="field">
        Kiểu kích hoạt
        <select
          value={st.hotkeyMode}
          onChange={(e) => editCurrent((s) => void (s.hotkeyMode = e.target.value as HotkeyMode))}
        >
          <option value="press">Bấm để chuyển</option>
          <option value="hold">Giữ phím (thả ra thì quay lại)</option>
          <option value="toggle">Bấm để bật/tắt</option>
        </select>
      </label>
      <label className="field">
        Chớp mắt mỗi (s, 0 = tắt)
        <NumberInput value={st.blinkInterval} step={0.5} min={0}
          onChange={(v) => editCurrent((s) => void (s.blinkInterval = v))} />
      </label>
      <label className="field">
        Thời gian chớp (s)
        <NumberInput value={st.blinkDuration} step={0.05} min={0.01}
          onChange={(v) => editCurrent((s) => void (s.blinkDuration = v))} />
      </label>
      <label className="field" title="Thời gian chuyển mượt (chuyển động + hiệu ứng hình) khi đổi range hoặc chuyển sang state này">
        Thời gian chuyển (s)
        <NumberInput value={st.transition} step={0.05} min={0}
          onChange={(v) => editCurrent((s) => void (s.transition = v))} />
      </label>
      <label className="field" title="Hiệu ứng khi hình đổi lúc đổi range hoặc khi chuyển sang state này. Layer giữ nguyên hình thì chỉ chuyển động mượt.">
        Hiệu ứng chuyển hình
        <select
          value={st.fade ?? "none"}
          onChange={(e) => editCurrent((s) => void (s.fade = e.target.value as FadeKind))}
        >
          <option value="none">Không (đổi ngay)</option>
          <option value="crossfade">Mờ chéo</option>
          <option value="fadeThrough">Mờ qua (tắt rồi hiện)</option>
          <option value="pop">Phóng (pop)</option>
        </select>
      </label>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export function RangesSection() {
  const st = useStore((s) => currentState(s));
  const gain = useStore((s) => s.settings.gainDb);
  const meterRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // meter is driven by rAF reading the engine, not React state
  useEffect(() => {
    let raf = 0;
    let lastIdx = -1;
    const loop = () => {
      const db = runtime.rawDb + useStore.getState().settings.gainDb;
      if (meterRef.current) meterRef.current.style.width = `${pct(db)}%`;
      if (labelRef.current) labelRef.current.textContent = `${Math.round(db)} dB`;
      if (runtime.rangeIndex !== lastIdx) setActiveIdx((lastIdx = runtime.rangeIndex));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sorted = (s: AvatarState) => s.ranges.sort((a, b) => a.threshold - b.threshold);

  return (
    <Section>
      <div className="meter">
        <div ref={meterRef} className="meter-fill" />
        {st.ranges.slice(1).map((r) => (
          <div key={r.id} className="meter-mark" style={{ left: `${pct(r.threshold)}%` }} title={r.name} />
        ))}
        <span ref={labelRef} className="meter-label mono" />
      </div>
      <div className="muted small">Mức mic hiện tại (đã cộng gain {gain} dB). Vạch trắng = ngưỡng.</div>

      {st.ranges.map((r, i) => (
        <div key={r.id} className={"range-row" + (i === activeIdx ? " active" : "")}>
          <input
            className="name"
            value={r.name}
            onChange={(e) => editCurrent((s) => void (s.ranges[i].name = e.target.value))}
          />
          {i === 0 ? (
            <span className="muted small grow">mặc định khi im lặng</span>
          ) : (
            <>
              <input
                type="range"
                className="grow"
                min={DB_MIN}
                max={0}
                value={r.threshold}
                onChange={(e) =>
                  editCurrent((s) => {
                    s.ranges[i].threshold = +e.target.value;
                    sorted(s);
                  })
                }
              />
              <span className="mono small">{r.threshold} dB</span>
              <button
                title="Xóa range"
                onClick={() =>
                  editCurrent((s) => {
                    s.ranges.splice(i, 1);
                    s.layers.forEach((l) => delete l.perRange[r.id]);
                  })
                }
              >
                ✕
              </button>
            </>
          )}
        </div>
      ))}
      <button
        onClick={() =>
          editCurrent((s) => {
            const topRange = s.ranges[s.ranges.length - 1];
            const top = topRange.threshold;
            const r = { id: uid(), name: `Range ${s.ranges.length + 1}`, threshold: Math.min(0, Math.max(top, DB_MIN) + 10) };
            s.ranges.push(r);
            // start where the layer sits in the loudest range, not at the center
            s.layers.forEach((l) => (l.perRange[r.id] = newLayerRange(undefined, l.perRange[topRange.id])));
            sorted(s);
          })
        }
      >
        + Thêm range
      </button>
    </Section>
  );
}

const pct = (db: number) => Math.max(0, Math.min(100, ((db - DB_MIN) / -DB_MIN) * 100));

// ---------------------------------------------------------------------------

export function LayersSection() {
  const st = useStore((s) => currentState(s));
  const selected = useStore((s) => s.selectedLayerId);
  const set = useStore((s) => s.set);

  // shown top-most first, stored bottom-most first
  const layers = [...st.layers].reverse();
  const move = (id: string, dir: 1 | -1) =>
    editCurrent((s) => {
      const i = s.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (j < 0 || j >= s.layers.length) return;
      [s.layers[i], s.layers[j]] = [s.layers[j], s.layers[i]];
    });

  return (
    <Section>
      <div className="list">
        {layers.map((l) => (
          <div
            key={l.id}
            className={"list-item" + (l.id === selected ? " active" : "")}
            onClick={() => set({ selectedLayerId: l.id })}
          >
            <input
              type="checkbox"
              checked={l.visible}
              title="Hiện/ẩn"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                editCurrent((s) => void (s.layers.find((x) => x.id === l.id)!.visible = e.target.checked))
              }
            />
            <span className="grow">{l.name}</span>
            <button onClick={(e) => (e.stopPropagation(), move(l.id, 1))} title="Lên trên">▲</button>
            <button onClick={(e) => (e.stopPropagation(), move(l.id, -1))} title="Xuống dưới">▼</button>
          </div>
        ))}
      </div>
      <div className="row">
        <button
          onClick={() => {
            const layer = newLayer(st.ranges, `Layer ${st.layers.length + 1}`);
            editCurrent((s) => void s.layers.push(layer));
            set({ selectedLayerId: layer.id });
          }}
        >
          + Thêm layer
        </button>
        <button
          disabled={!selected}
          onClick={() => {
            editCurrent((s) => void (s.layers = s.layers.filter((l) => l.id !== selected)));
            set({ selectedLayerId: null });
          }}
        >
          Xóa layer
        </button>
      </div>
    </Section>
  );
}
