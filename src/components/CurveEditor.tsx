import { useEffect, useRef, useState } from "react";
import { clamp, evalTrack, makeKey } from "../curve";
import { runtime } from "../engine";
import { PRESETS } from "../presets";
import { Clip, Keyframe, NEUTRAL, Prop, PROPS } from "../types";
import { SpriteTrack } from "./SpriteTrack";

const LABEL: Record<Prop, string> = {
  x: "X",
  y: "Y",
  rotation: "Xoay",
  scaleX: "Giãn X",
  scaleY: "Giãn Y",
  opacity: "Độ mờ",
};

/** Minimum visible value window per property, so flat curves still have room. */
const DEFAULT_SPAN: Record<Prop, [number, number]> = {
  x: [-30, 30],
  y: [-30, 30],
  rotation: [-15, 15],
  scaleX: [0.85, 1.15],
  scaleY: [0.85, 1.15],
  opacity: [0, 1],
};

const H = 210;
const PAD = { l: 44, r: 14, t: 12, b: 20 };

type Drag = { kind: "key" | "in" | "out"; i: number; view: [number, number] } | null;

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<SVGLineElement>(null);

  const keys = clip.tracks[prop] ?? [];
  const dur = clip.duration;

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setSel(null), [prop]);

  // value window: fit keys + handles, frozen while dragging to avoid feedback
  const view: [number, number] = drag?.view ?? fitView(keys, prop);
  const plotW = width - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const tx = (t: number) => PAD.l + (t / dur) * plotW;
  const vy = (v: number) => PAD.t + ((view[1] - v) / (view[1] - view[0])) * plotH;
  const toT = (x: number) => ((x - PAD.l) / plotW) * dur;
  const toV = (y: number) => view[1] - ((y - PAD.t) / plotH) * (view[1] - view[0]);

  // live playhead, updated outside React
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const line = playheadRef.current;
      if (line) {
        const live = runtime.rangeIndex === rangeIndex;
        line.style.display = live ? "" : "none";
        if (live) {
          const x = String(PAD.l + (runtime.clipT / dur) * plotW);
          line.setAttribute("x1", x);
          line.setAttribute("x2", x);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rangeIndex, dur, plotW]);

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

  const startDrag = (e: React.PointerEvent, kind: "key" | "in" | "out", i: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as Element).closest("svg")!.setPointerCapture(e.pointerId);
    setSel(i);
    setDrag({ kind, i, view });
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

  // curve path sampled from the evaluator, so it matches the runtime exactly
  let path = "";
  if (keys.length) {
    const n = 160;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * dur;
      path += `${i ? "L" : "M"}${tx(t).toFixed(1)},${vy(evalTrack(keys, t)).toFixed(1)}`;
    }
  }

  const selKey = sel !== null ? keys[sel] : null;
  const neutralY = vy(NEUTRAL[prop]);

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
        <select
          value=""
          onChange={(e) => {
            const p = PRESETS.find((x) => x.name === e.target.value);
            // presets only carry motion, keep the layer's sprite frames
            if (p) onChange({ ...p.make(), sprites: clip.sprites });
          }}
        >
          <option value="">Preset…</option>
          {PRESETS.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
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
          onPointerMove={onPointerMove}
          onPointerUp={() => setDrag(null)}
          onDoubleClick={addKey}
          onContextMenu={(e) => e.preventDefault()}
        >
          <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} className="plot-bg" />
          {gridTimes(dur).map((t) => (
            <g key={t}>
              <line x1={tx(t)} x2={tx(t)} y1={PAD.t} y2={PAD.t + plotH} className="grid" />
              <text x={tx(t)} y={H - 5} className="axis" textAnchor="middle">
                {+t.toFixed(2)}s
              </text>
            </g>
          ))}
          {[view[0], (view[0] + view[1]) / 2, view[1]].map((v) => (
            <text key={v} x={PAD.l - 6} y={vy(v) + 4} className="axis" textAnchor="end">
              {+v.toFixed(2)}
            </text>
          ))}
          {neutralY >= PAD.t && neutralY <= PAD.t + plotH && (
            <line x1={PAD.l} x2={PAD.l + plotW} y1={neutralY} y2={neutralY} className="neutral" />
          )}
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
            bẻ gãy tay nắm{prop === "y" ? " · Y âm = đi lên" : ""}
          </span>
        )}
        <span className="spacer" />
        {keys.length > 0 && <button onClick={() => setKeys([])}>Xóa track {LABEL[prop]}</button>}
      </div>
    </div>
  );
}

function fitView(keys: Keyframe[], prop: Prop): [number, number] {
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

function gridTimes(dur: number) {
  const step = [0.05, 0.1, 0.25, 0.5, 1, 2, 5].find((s) => dur / s <= 8) ?? 10;
  const out = [];
  for (let t = 0; t <= dur + 1e-9; t += step) out.push(+t.toFixed(4));
  return out;
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
