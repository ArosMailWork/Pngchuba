import { useEffect, useId, useRef, useState } from "react";
import { clamp, evalTrack, makeKey } from "../curve";
import { runtime } from "../engine";
import { PRESETS } from "../presets";
import { beginGesture, endGesture, uid, useStore } from "../store";
import { Clip, Keyframe, NEUTRAL, Prop, PROPS } from "../types";
import { SpriteTrack } from "./SpriteTrack";

const LABEL: Record<Prop, string> = {
  x: "X",
  y: "Y",
  rotation: "Xoay",
  scaleX: "Giãn X",
  scaleY: "Giãn Y",
  opacity: "Độ mờ",
  brightness: "Độ sáng",
};

/** Minimum visible value window per property, so flat curves still have room. */
const DEFAULT_SPAN: Record<Prop, [number, number]> = {
  x: [-30, 30],
  y: [-30, 30],
  rotation: [-15, 15],
  scaleX: [0.85, 1.15],
  scaleY: [0.85, 1.15],
  opacity: [0, 1],
  brightness: [0, 1.2],
};

const H = 210;
const PAD = { l: 44, r: 14, t: 12, b: 20 };

type Range = [number, number];
type Drag =
  | { kind: "key" | "in" | "out"; i: number; view: Range }
  | { kind: "pan"; x: number; y: number; t: Range; v: Range }
  | null;

interface Props {
  clip: Clip;
  onChange: (clip: Clip) => void;
  /** index of the range this clip belongs to, to show the live playhead */
  rangeIndex: number;
}

export function CurveEditor({ clip, onChange, rangeIndex }: Props) {
  const [prop, setProp] = useState<Prop>("y");
  const [spriteTab, setSpriteTab] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [width, setWidth] = useState(600);
  const [drag, setDrag] = useState<Drag>(null);
  // manual zoom/pan windows; null = fit automatically
  const [zoomT, setZoomT] = useState<Range | null>(null);
  const [zoomV, setZoomV] = useState<Range | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<SVGLineElement>(null);
  const clipId = "plot" + useId().replace(/[^a-zA-Z0-9]/g, "");

  const keys = clip.tracks[prop] ?? [];
  const copiedTrack = useStore((s) => s.copiedTrack);
  const dur = clip.duration;

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setSel(null);
    setZoomV(null);
  }, [prop, rangeIndex]);
  useEffect(() => setZoomT(null), [dur]);

  // value window: manual zoom, else fit keys + handles (frozen while dragging
  // a key, so the view doesn't run away from the pointer)
  const keyDrag = drag && drag.kind !== "pan" ? drag : null;
  const viewV: Range = zoomV ?? keyDrag?.view ?? fitView(keys, prop);
  const viewT: Range = zoomT ?? [0, dur];
  const plotW = width - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const tx = (t: number) => PAD.l + ((t - viewT[0]) / (viewT[1] - viewT[0])) * plotW;
  const vy = (v: number) => PAD.t + ((viewV[1] - v) / (viewV[1] - viewV[0])) * plotH;
  const toT = (x: number) => viewT[0] + ((x - PAD.l) / plotW) * (viewT[1] - viewT[0]);
  const toV = (y: number) => viewV[1] - ((y - PAD.t) / plotH) * (viewV[1] - viewV[0]);

  // live playhead, updated outside React
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const line = playheadRef.current;
      if (line) {
        const live = runtime.rangeIndex === rangeIndex;
        line.style.display = live ? "" : "none";
        if (live) {
          const x = String(PAD.l + ((runtime.clipT - viewT[0]) / (viewT[1] - viewT[0])) * plotW);
          line.setAttribute("x1", x);
          line.setAttribute("x2", x);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rangeIndex, viewT[0], viewT[1], plotW]);

  // wheel: zoom values around the cursor; Shift/Ctrl + wheel: zoom time.
  // Native listener because React's wheel listener is passive (can't block scrolling).
  const zoomRef = useRef({ viewT, viewV, toT, toV });
  zoomRef.current = { viewT, viewV, toT, toV };
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = zoomRef.current;
      const r = el.getBoundingClientRect();
      const f = Math.exp((e.deltaY || e.deltaX) * 0.0015);
      const around = (w: Range, c: number): Range => {
        const span = (w[1] - w[0]) * f;
        return span < 1e-4 || span > 1e6 ? w : [c + (w[0] - c) * f, c + (w[1] - c) * f];
      };
      if (e.shiftKey || e.ctrlKey) setZoomT(around(z.viewT, z.toT(e.clientX - r.left)));
      else setZoomV(around(z.viewV, z.toV(e.clientY - r.top)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const setKeys = (next: Keyframe[]) => {
    const tracks = { ...clip.tracks };
    if (next.length) tracks[prop] = next;
    else delete tracks[prop];
    onChange({ ...clip, tracks });
  };

  const svgPoint = (e: React.PointerEvent | React.MouseEvent) => {
    const r = (e.currentTarget as Element).closest("svg")!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = svgPoint(e);
    if (drag.kind === "pan") {
      const dt = ((p.x - drag.x) / plotW) * (drag.t[1] - drag.t[0]);
      const dv = ((p.y - drag.y) / plotH) * (drag.v[1] - drag.v[0]);
      setZoomT([drag.t[0] - dt, drag.t[1] - dt]);
      setZoomV([drag.v[0] + dv, drag.v[1] + dv]);
      return;
    }
    let t = clamp(toT(p.x), 0, dur);
    if (e.shiftKey) t = Math.round(t / 0.05) * 0.05;
    const v = toV(p.y);
    const next = keys.map((k) => ({ ...k }));
    const k = next[drag.i];
    if (drag.kind === "key") {
      const lo = drag.i > 0 ? next[drag.i - 1].t + 0.001 : 0;
      const hi = drag.i < next.length - 1 ? next[drag.i + 1].t - 0.001 : dur;
      k.t = clamp(t, lo, hi);
      k.v = round(v);
    } else {
      const dt = drag.kind === "out" ? Math.max(0, t - k.t) : Math.min(0, t - k.t);
      const dv = round(v - k.v);
      if (drag.kind === "out") [k.outT, k.outV] = [dt, dv];
      else [k.inT, k.inV] = [dt, dv];
      // keep handles in line (smooth) unless Alt is held
      if (!e.altKey && dt !== 0) {
        const slope = dv / dt;
        if (drag.kind === "out") k.inV = round(slope * k.inT);
        else k.outV = round(slope * k.outT);
      }
    }
    setKeys(next);
  };

  const endDrag = () => {
    if (drag && drag.kind !== "pan") endGesture();
    setDrag(null);
  };

  const startDrag = (e: React.PointerEvent, kind: "key" | "in" | "out", i: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as Element).closest("svg")!.setPointerCapture(e.pointerId);
    setSel(i);
    beginGesture();
    setDrag({ kind, i, view: viewV });
  };

  // right or middle button on the background: pan the view
  const startPan = (e: React.PointerEvent) => {
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = svgPoint(e);
    setDrag({ kind: "pan", x: p.x, y: p.y, t: viewT, v: viewV });
  };

  const addKey = (e: React.MouseEvent) => {
    const p = svgPoint(e);
    const t = clamp(toT(p.x), 0, dur);
    const k = makeKey(t, round(toV(p.y)), dur);
    const next = [...keys, k].sort((a, b) => a.t - b.t);
    setKeys(next);
    setSel(next.indexOf(k));
  };

  const removeKey = (i: number) => {
    setKeys(keys.filter((_, j) => j !== i));
    setSel(null);
  };

  const setDuration = (d: number) => {
    if (!(d > 0)) return;
    const r = d / dur;
    const tracks: Clip["tracks"] = {};
    for (const p of PROPS) {
      const ks = clip.tracks[p];
      if (ks) tracks[p] = ks.map((k) => ({ ...k, t: k.t * r, inT: k.inT * r, outT: k.outT * r }));
    }
    const sprites = clip.sprites?.map((k) => ({ ...k, t: k.t * r }));
    onChange({ ...clip, duration: d, tracks, sprites });
  };

  // curve path sampled from the evaluator over the visible part of the clip,
  // so it matches the runtime exactly
  let path = "";
  const t0 = Math.max(0, viewT[0]);
  const t1 = Math.min(dur, viewT[1]);
  if (keys.length && t1 > t0) {
    const n = 200;
    for (let i = 0; i <= n; i++) {
      const t = t0 + (i / n) * (t1 - t0);
      path += `${i ? "L" : "M"}${tx(t).toFixed(1)},${vy(evalTrack(keys, t)).toFixed(1)}`;
    }
  }

  const selKey = sel !== null ? keys[sel] : null;
  const zoomed = zoomT !== null || zoomV !== null;

  return (
    <div className="curve-editor">
      <div className="row wrap">
        {PROPS.map((p) => (
          <button
            key={p}
            className={!spriteTab && p === prop ? "tab active" : "tab"}
            onClick={() => {
              setProp(p);
              setSpriteTab(false);
            }}
          >
            {LABEL[p]}
            {clip.tracks[p]?.length ? " •" : ""}
          </button>
        ))}
        <button className={spriteTab ? "tab active" : "tab"} onClick={() => setSpriteTab(true)}>
          Sprite{clip.sprites?.length ? " •" : ""}
        </button>
        <span className="spacer" />
        <PresetPicker clip={clip} onChange={onChange} />
      </div>

      <div className="row wrap">
        <label>
          Thời gian (s)
          <NumberInput value={dur} step={0.05} min={0.05} onChange={setDuration} />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={clip.loop}
            onChange={(e) => onChange({ ...clip, loop: e.target.checked })}
          />
          Lặp
        </label>
        <label title="Nói càng to trong range này thì chuyển động càng mạnh">
          Tăng theo âm lượng
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={clip.volumeBoost}
            onChange={(e) => onChange({ ...clip, volumeBoost: +e.target.value })}
          />
          <span className="mono">×{(1 + clip.volumeBoost).toFixed(2)}</span>
        </label>
      </div>

      {spriteTab && <SpriteTrack clip={clip} onChange={onChange} />}

      <div ref={wrapRef} className="curve-wrap" style={{ display: spriteTab ? "none" : undefined }}>
        <svg
          width={width}
          height={H}
          onPointerDown={startPan}
          onMouseDown={(e) => e.button === 1 && e.preventDefault() /* no autoscroll */}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={addKey}
          onContextMenu={(e) => e.preventDefault()}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} />
            </clipPath>
          </defs>
          <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} className="plot-bg" />
          {gridTimes(viewT).map((t) => (
            <text key={t} x={tx(t)} y={H - 5} className="axis" textAnchor="middle">
              {+t.toFixed(3)}s
            </text>
          ))}
          {[viewV[0], (viewV[0] + viewV[1]) / 2, viewV[1]].map((v, i) => (
            <text key={i} x={PAD.l - 6} y={vy(v) + 4} className="axis" textAnchor="end">
              {fmtValue(v, viewV)}
            </text>
          ))}
          {/* everything drawn in the plot stays inside its frame */}
          <g clipPath={`url(#${clipId})`}>
            {/* outside the clip's time span */}
            <rect x={PAD.l} y={PAD.t} width={Math.max(0, tx(0) - PAD.l)} height={plotH} className="out-of-clip" />
            <rect x={tx(dur)} y={PAD.t} width={Math.max(0, PAD.l + plotW - tx(dur))} height={plotH} className="out-of-clip" />
            {gridTimes(viewT).map((t) => (
              <line key={t} x1={tx(t)} x2={tx(t)} y1={PAD.t} y2={PAD.t + plotH} className="grid" />
            ))}
            <line x1={PAD.l} x2={PAD.l + plotW} y1={vy(NEUTRAL[prop])} y2={vy(NEUTRAL[prop])} className="neutral" />
            <path d={path} className="curve" />
            {keys.map((k, i) => (
              <g key={i}>
                {sel === i && (
                  <>
                    <line x1={tx(k.t)} y1={vy(k.v)} x2={tx(k.t + k.inT)} y2={vy(k.v + k.inV)} className="handle-line" />
                    <line x1={tx(k.t)} y1={vy(k.v)} x2={tx(k.t + k.outT)} y2={vy(k.v + k.outV)} className="handle-line" />
                    <circle cx={tx(k.t + k.inT)} cy={vy(k.v + k.inV)} r={5} className="handle"
                      onPointerDown={(e) => startDrag(e, "in", i)} />
                    <circle cx={tx(k.t + k.outT)} cy={vy(k.v + k.outV)} r={5} className="handle"
                      onPointerDown={(e) => startDrag(e, "out", i)} />
                  </>
                )}
                <rect
                  x={tx(k.t) - 5}
                  y={vy(k.v) - 5}
                  width={10}
                  height={10}
                  transform={`rotate(45 ${tx(k.t)} ${vy(k.v)})`}
                  className={sel === i ? "key selected" : "key"}
                  onPointerDown={(e) => startDrag(e, "key", i)}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    removeKey(i);
                  }}
                />
              </g>
            ))}
            <line ref={playheadRef} y1={PAD.t} y2={PAD.t + plotH} className="playhead" />
          </g>
        </svg>
      </div>

      <div className="row wrap hint" style={{ display: spriteTab ? "none" : undefined }}>
        {selKey ? (
          <>
            <label>
              Thời điểm
              <NumberInput
                value={selKey.t}
                step={0.01}
                onChange={(t) => {
                  const next = keys.map((k, j) => (j === sel ? { ...k, t: clamp(t, 0, dur) } : k));
                  const moved = next[sel!];
                  next.sort((a, b) => a.t - b.t);
                  setKeys(next);
                  setSel(next.indexOf(moved));
                }}
              />
            </label>
            <label>
              Giá trị
              <NumberInput
                value={selKey.v}
                step={prop.startsWith("scale") || prop === "opacity" ? 0.01 : 1}
                onChange={(v) => setKeys(keys.map((k, j) => (j === sel ? { ...k, v } : k)))}
              />
            </label>
            <button onClick={() => removeKey(sel!)}>Xóa điểm</button>
          </>
        ) : (
          <span>
            Nhấp đúp để thêm điểm · kéo điểm/tay nắm · chuột phải để xóa · Shift: bắt lưới · Alt:
            bẻ gãy tay nắm · lăn chuột: phóng to/thu nhỏ (Shift/Ctrl: theo thời gian) · kéo chuột
            phải/giữa: di chuyển khung{prop === "y" ? " · Y âm = đi lên" : ""}
          </span>
        )}
        <span className="spacer" />
        <button
          disabled={!zoomed}
          onClick={() => {
            setZoomT(null);
            setZoomV(null);
          }}
          title="Tự căn khung nhìn vừa với đường cong"
        >
          ⤢ Vừa khung
        </button>
        {keys.length > 0 && (
          <button
            onClick={() => useStore.getState().set({ copiedTrack: { keys: structuredClone(keys), duration: dur } })}
            title="Copy đường cong này (dán được vào thuộc tính/layer/range khác)"
          >
            📋 Copy track
          </button>
        )}
        {copiedTrack && (
          <button
            onClick={() => {
              // fit the copied curve to this clip's duration
              const r = dur / copiedTrack.duration;
              setKeys(copiedTrack.keys.map((k) => ({ ...k, t: k.t * r, inT: k.inT * r, outT: k.outT * r })));
            }}
            title="Thay đường cong này bằng track đã copy (co giãn theo thời gian clip)"
          >
            📥 Dán track
          </button>
        )}
        {keys.length > 0 && <button onClick={() => setKeys([])}>Xóa track {LABEL[prop]}</button>}
      </div>
    </div>
  );
}

/** Built-in + user presets: apply, save the current motion, rename/delete own ones. */
function PresetPicker({ clip, onChange }: { clip: Clip; onChange: (clip: Clip) => void }) {
  const custom = useStore((s) => s.customPresets);
  const setCustom = useStore((s) => s.setCustomPresets);
  const [naming, setNaming] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  // presets only carry motion, keep the layer's sprite frames
  const apply = (c: Clip) => onChange({ ...structuredClone(c), sprites: clip.sprites });

  const save = () => {
    const name = naming?.trim();
    if (!name) return;
    // sprites point at this avatar's images, so a shared preset keeps motion only
    const motion: Clip = structuredClone({ ...clip, sprites: undefined });
    delete motion.sprites;
    const same = custom.find((p) => p.name === name);
    if (same && !confirm(`Ghi đè preset "${name}"?`)) return;
    setCustom(
      same
        ? custom.map((p) => (p.id === same.id ? { ...p, clip: motion } : p))
        : [...custom, { id: uid(), name, clip: motion }],
    );
    setNaming(null);
  };

  return (
    <div className="preset-picker">
      <div className="row">
        <select
          value=""
          onChange={(e) => {
            const [kind, ref] = [e.target.value[0], e.target.value.slice(2)];
            if (kind === "b") {
              const p = PRESETS.find((x) => x.name === ref);
              if (p) apply(p.make());
            } else if (kind === "c") {
              const p = custom.find((x) => x.id === ref);
              if (p) apply(p.clip);
            }
          }}
        >
          <option value="">Preset…</option>
          <optgroup label="Có sẵn">
            {PRESETS.map((p) => (
              <option key={p.name} value={"b:" + p.name}>
                {p.name}
              </option>
            ))}
          </optgroup>
          {custom.length > 0 && (
            <optgroup label="Của tôi">
              {custom.map((p) => (
                <option key={p.id} value={"c:" + p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button onClick={() => setNaming(naming === null ? `Preset ${custom.length + 1}` : null)} title="Lưu animation đang chỉnh thành preset (dùng được cho mọi avatar)">
          💾 Lưu preset
        </button>
        {custom.length > 0 && (
          <button className={managing ? "active" : ""} onClick={() => setManaging(!managing)} title="Đổi tên / xóa preset của tôi">
            ✎
          </button>
        )}
      </div>

      {naming !== null && (
        <div className="row preset-pop">
          <input
            className="name"
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setNaming(null);
            }}
          />
          <button onClick={save} disabled={!naming.trim()}>Lưu</button>
          <button onClick={() => setNaming(null)}>Hủy</button>
        </div>
      )}

      {managing && custom.length > 0 && (
        <div className="col preset-pop">
          {custom.map((p) => (
            <div key={p.id} className="row">
              <input
                className="name"
                value={p.name}
                onChange={(e) => setCustom(custom.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))}
              />
              <button
                title="Xóa preset"
                onClick={() => confirm(`Xóa preset "${p.name}"?`) && setCustom(custom.filter((x) => x.id !== p.id))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fitView(keys: Keyframe[], prop: Prop): Range {
  let [lo, hi] = DEFAULT_SPAN[prop];
  for (const k of keys) {
    for (const v of [k.v, k.v + k.inV, k.v + k.outV]) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

/** Tick times inside the visible window, at a readable step. */
function gridTimes([t0, t1]: Range) {
  const span = t1 - t0;
  const steps = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
  const step = steps.find((s) => span / s <= 8) ?? 120;
  const out = [];
  for (let t = Math.ceil(t0 / step - 1e-9) * step; t <= t1 + 1e-9; t += step) out.push(+t.toFixed(4));
  return out;
}

/** Axis label with as many decimals as the zoom level needs. */
function fmtValue(v: number, [lo, hi]: Range) {
  const digits = clamp(Math.ceil(-Math.log10(Math.max(1e-6, hi - lo))) + 2, 0, 5);
  return String(+v.toFixed(digits));
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) onChange(clamp(v, min ?? -Infinity, max ?? Infinity));
    else setText(String(round(value)));
  };
  return (
    <input
      type="number"
      className="num"
      value={text}
      step={step}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}
