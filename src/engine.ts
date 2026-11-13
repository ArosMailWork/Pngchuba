/**
 * Per-frame avatar runtime. Reads the store directly and writes transforms
 * straight to the layer <img> elements, so React never re-renders per frame.
 */
import { clipTime, evalProp, spriteAt } from "./curve";
import { currentState, useStore } from "./store";
import { AvatarState, Prop, PROPS } from "./types";

type Values = Record<Prop, number>;

export const runtime = {
  /** latest mic level from Rust, dBFS before gain */
  rawDb: -100,
  /** gain-adjusted level, smoothed for the volume boost */
  levelDb: -100,
  rangeIndex: 0,
  /** clip-local time of the active range, for the curve editor playhead */
  clipT: 0,
  blinking: false,
};

const imgs = new Map<string, HTMLImageElement>();
const lastValues = new Map<string, Values>();
let fromValues = new Map<string, Values>();
let activeKey = "";
let rangeStart = 0;
let belowSince: number | null = null;
let nextBlink = 0;
let blinkUntil = 0;

export function registerLayerImg(layerId: string, el: HTMLImageElement | null) {
  if (el) imgs.set(layerId, el);
  else imgs.delete(layerId);
}

/** Restarts the active range's clip from t=0 (used when editing curves). */
export function restartClip() {
  rangeStart = performance.now();
  fromValues = new Map();
}

/** Picks the voice range for this frame, applying the release delay. */
function pickRange(st: AvatarState, db: number, now: number, releaseDelay: number): number {
  let target = 0;
  st.ranges.forEach((r, i) => {
    if (i > 0 && db >= r.threshold) target = i;
  });
  const cur = Math.min(runtime.rangeIndex, st.ranges.length - 1);
  if (target >= cur) {
    belowSince = null;
    return target;
  }
  belowSince ??= now;
  if (now - belowSince >= releaseDelay * 1000) {
    belowSince = null;
    return target;
  }
  return cur;
}

function tick(now: number) {
  const s = useStore.getState();
  const st = currentState(s);
  const db = runtime.rawDb + s.settings.gainDb;
  // fast attack, slower release, so the volume boost doesn't jitter
  runtime.levelDb += (db - runtime.levelDb) * (db > runtime.levelDb ? 0.6 : 0.15);

  let idx = pickRange(st, db, now, s.settings.releaseDelay);
  const forced = s.previewRange ? st.ranges.findIndex((r) => r.id === s.selectedRangeId) : -1;
  if (forced >= 0) idx = forced;
  runtime.rangeIndex = idx;
  const range = st.ranges[idx];

  const key = st.id + ":" + range.id;
  if (key !== activeKey) {
    activeKey = key;
    rangeStart = now;
    fromValues = new Map(lastValues);
  }

  // blinking
  if (st.blinkInterval > 0) {
    if (now >= nextBlink) {
      blinkUntil = now + st.blinkDuration * 1000;
      nextBlink = now + st.blinkInterval * 1000 * (0.7 + Math.random() * 0.6);
    }
    runtime.blinking = now < blinkUntil;
  } else {
    runtime.blinking = false;
  }

  // volume boost: 0 at the bottom of the range, 1 at the next threshold
  const top = st.ranges[idx + 1]?.threshold ?? range.threshold + 20;
  const bottom = idx === 0 ? -60 : range.threshold;
  const norm = Math.min(1, Math.max(0, (runtime.levelDb - bottom) / Math.max(1, top - bottom)));

  const elapsed = (now - rangeStart) / 1000;
  const blend = st.transition > 0 ? Math.min(1, elapsed / st.transition) : 1;
  const ease = blend * blend * (3 - 2 * blend); // smoothstep

  for (const layer of st.layers) {
    const el = imgs.get(layer.id);
    if (!el) continue;
    const lr = layer.perRange[range.id];
    const t = lr ? clipTime(lr.clip, elapsed) : 0;
    const assetId = lr && (runtime.blinking && lr.blinkImage ? lr.blinkImage : (spriteAt(lr.clip, t) ?? lr.image));
    const src = assetId ? s.avatar.assets[assetId] : undefined;
    if (!layer.visible || !lr || !src) {
      el.style.display = "none";
      continue;
    }
    if (el.getAttribute("src") !== src) el.src = src;
    el.style.display = "";

    if (layer.id === s.selectedLayerId) runtime.clipT = t;
    const factor = 1 + lr.clip.volumeBoost * norm;
    const from = fromValues.get(layer.id);
    const v = {} as Values;
    for (const p of PROPS) {
      const target = evalProp(lr.clip, p, t, factor);
      v[p] = from && ease < 1 ? from[p] + (target - from[p]) * ease : target;
    }
    lastValues.set(layer.id, v);

    el.style.transform =
      `translate(-50%, -50%) translate(${layer.x + v.x}px, ${layer.y + v.y}px) ` +
      `rotate(${layer.rotation + v.rotation}deg) ` +
      `scale(${layer.scale * v.scaleX}, ${layer.scale * v.scaleY})`;
    el.style.opacity = String(Math.max(0, Math.min(1, v.opacity)));
  }
}

let started = false;
export function startEngine() {
  if (started) return;
  started = true;
  const loop = (now: number) => {
    tick(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

