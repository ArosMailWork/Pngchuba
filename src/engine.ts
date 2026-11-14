/**
 * Per-frame avatar runtime. Reads the store directly and writes transforms
 * straight to the layer <img> elements, so React never re-renders per frame.
 */
import { clipTime, evalProp, spriteAt } from "./curve";
import { currentState, useStore } from "./store";
import { AvatarState, FadeKind, Layer, LayerRange, Prop, PROPS, Transform, Vowel } from "./types";
import { classifyVowel } from "./vowels";

/** Final per-frame values of a layer: base placement + animation. */
type Values = Record<Prop, number>;

/** 2D affine matrix [a, b, c, d, e, f] as in CSS matrix(). */
type Mat = [number, number, number, number, number, number];

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** translate, then rotate (degrees), then scale: same as the CSS functions. */
function trs(x: number, y: number, deg: number, sx: number, sy: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c * sx, s * sx, -s * sy, c * sy, x, y];
}

function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** What a layer showed last frame, so a range/state switch can fade it out. */
interface Shown {
  src: string;
  transform: string;
  opacity: number;
  filter: string;
}

export const runtime = {
  /** latest mic level from Rust, dBFS before gain */
  rawDb: -100,
  /** gain-adjusted level, smoothed for the volume boost */
  levelDb: -100,
  rangeIndex: 0,
  /** clip-local time of the active range, for the curve editor playhead */
  clipT: 0,
  blinking: false,
  /** latest formants from Rust (Hz, 0 = none) */
  f1: 0,
  f2: 0,
  /** vowel the mouth shows now, null = none (silent, consonant, lip-sync off) */
  vowel: null as Vowel | null,
};

const imgs = new Map<string, HTMLImageElement>();
const lastValues = new Map<string, Values>();
let fromValues = new Map<string, Values>();
/** base placement, blended between ranges like the values */
const lastBase = new Map<string, Transform>();
let fromBase = new Map<string, Transform>();
let lastShown = new Map<string, Shown>();
/** what was on screen right before the last switch, and layers compared to it */
let prevShown = new Map<string, Shown>();
let checked = new Set<string>();
/** layers whose image changed at the last switch: they fade/pop in */
let entering = new Set<string>();
/** copies of the previous images fading out, with their own opacity */
let ghosts: { el: HTMLImageElement; opacity: number }[] = [];
let ghostLayer: HTMLElement | null = null;
let fadeKind: FadeKind = "none";
let activeKey = "";
let rangeStart = 0;
let belowSince: number | null = null;
let nextBlink = 0;
let blinkUntil = 0;
let vowelCandidate: Vowel | null = null;
let vowelSince = 0;
let lastVoiced = 0;

export function registerLayerImg(layerId: string, el: HTMLImageElement | null) {
  if (el) imgs.set(layerId, el);
  else imgs.delete(layerId);
}

/** The <img> currently drawing a layer (for the stage editing handles). */
export const layerImg = (layerId: string) => imgs.get(layerId);

/** Container (behind the layers) for the fading-out copies. */
export function registerGhostLayer(el: HTMLElement | null) {
  clearFades();
  ghostLayer = el;
}

function clearGhosts() {
  ghosts.forEach((g) => g.el.remove());
  ghosts = [];
}

function clearFades() {
  clearGhosts();
  entering = new Set();
}

/** Restarts the active range's clip from t=0 (used when editing curves). */
export function restartClip() {
  rangeStart = performance.now();
  fromValues = new Map();
  fromBase = new Map();
  clearFades();
}

function addGhost(shown: Shown) {
  if (!ghostLayer) return;
  const el = document.createElement("img");
  el.className = "layer";
  el.alt = "";
  el.src = shown.src;
  el.style.transform = shown.transform;
  el.style.opacity = String(shown.opacity);
  el.style.filter = shown.filter;
  ghostLayer.appendChild(el);
  ghosts.push({ el, opacity: shown.opacity });
}

/** Opacity/scale multipliers of an entering image at fade progress p (0..1). */
function fadeIn(kind: FadeKind, p: number): { opacity: number; scale: number } {
  if (kind === "crossfade") return { opacity: p, scale: 1 };
  if (kind === "fadeThrough") return { opacity: Math.max(0, p * 2 - 1), scale: 1 };
  if (kind === "pop") {
    // ease-out-back from 0.6: overshoots a bit, then settles at 1
    const c = 1.70158;
    const q = p - 1;
    return { opacity: Math.min(1, p * 4), scale: 0.6 + 0.4 * (1 + (c + 1) * q * q * q + c * q * q) };
  }
  return { opacity: 1, scale: 1 };
}

/** Opacity multiplier of the previous images at fade progress p. */
function fadeOut(kind: FadeKind, p: number): number {
  if (kind === "crossfade") return 1 - p;
  if (kind === "fadeThrough") return Math.max(0, 1 - p * 2);
  return 0;
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
  const switched = key !== activeKey;
  if (switched) {
    const firstFrame = activeKey === "";
    activeKey = key;
    rangeStart = now;
    fromValues = new Map(lastValues);
    fromBase = new Map(lastBase);
    clearFades();
    fadeKind = firstFrame || !(st.transition > 0) ? "none" : (st.fade ?? "none");
    prevShown = lastShown;
    checked = new Set();
    // layers of the previous state that are gone now (state switch)
    if (fadeKind !== "none") {
      const ids = new Set(st.layers.map((l) => l.id));
      for (const [id, before] of prevShown) if (!ids.has(id)) addGhost(before);
    }
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

  updateVowel(s.settings.lipSync && idx > 0, s.settings.vowelProfile, now);

  // volume boost: 0 at the bottom of the range, 1 at the next threshold
  const top = st.ranges[idx + 1]?.threshold ?? range.threshold + 20;
  const bottom = idx === 0 ? -60 : range.threshold;
  const norm = Math.min(1, Math.max(0, (runtime.levelDb - bottom) / Math.max(1, top - bottom)));

  const elapsed = (now - rangeStart) / 1000;
  const blend = st.transition > 0 ? Math.min(1, elapsed / st.transition) : 1;
  const ease = blend * blend * (3 - 2 * blend); // smoothstep
  const shown = new Map<string, Shown>();

  // 1) every layer's own motion (base placement + animation), blended at switches
  const own = new Map<string, { lr: LayerRange; t: number; v: Values; base: Transform }>();
  for (const layer of st.layers) {
    const lr = layer.perRange[range.id];
    if (!lr) continue;
    const t = clipTime(lr.clip, elapsed);
    const factor = 1 + lr.clip.volumeBoost * norm;
    const from = fromValues.get(layer.id);
    const v = {} as Values;
    for (const p of PROPS) {
      const a = evalProp(lr.clip, p, t, factor);
      // x/y/rotation add to the range's placement, scales multiply it
      const target =
        p === "x" ? lr.x + a
        : p === "y" ? lr.y + a
        : p === "rotation" ? lr.rotation + a
        : p === "scaleX" || p === "scaleY" ? lr.scale * a
        : a;
      v[p] = from && ease < 1 ? from[p] + (target - from[p]) * ease : target;
    }
    const fb = fromBase.get(layer.id);
    const base = {} as Transform;
    for (const k of ["x", "y", "rotation", "scale"] as const)
      base[k] = fb && ease < 1 ? fb[k] + (lr[k] - fb[k]) * ease : lr[k];
    lastValues.set(layer.id, v);
    lastBase.set(layer.id, base);
    own.set(layer.id, { lr, t, v, base });
  }

  // 2) world matrix: a child gets its parent's motion relative to the
  //    parent's base placement (parent standing still = child unchanged)
  const byId = new Map(st.layers.map((l) => [l.id, l]));
  const world = new Map<string, Mat>();
  const worldOf = (layer: Layer, depth = 0): Mat => {
    const known = world.get(layer.id);
    if (known) return known;
    const o = own.get(layer.id)!;
    let m = trs(o.v.x, o.v.y, o.v.rotation, o.v.scaleX, o.v.scaleY);
    const parent = layer.parentId ? byId.get(layer.parentId) : undefined;
    const p = parent && own.get(parent.id);
    if (parent && p && depth < 16) {
      const pb = p.base;
      m = mul(mul(worldOf(parent, depth + 1), invert(trs(pb.x, pb.y, pb.rotation, pb.scale, pb.scale))), m);
    }
    world.set(layer.id, m);
    return m;
  };

  // 3) draw
  for (const layer of st.layers) {
    const el = imgs.get(layer.id);
    const o = own.get(layer.id);
    if (!el) continue;
    const lr = o?.lr;
    const vowelImage = runtime.vowel ? lr?.vowels?.[runtime.vowel] : undefined;
    const assetId =
      lr && o &&
      (runtime.blinking && lr.blinkImage ? lr.blinkImage : (vowelImage || (spriteAt(lr.clip, o.t) ?? lr.image)));
    const src = assetId ? s.avatar.assets[assetId] : undefined;
    if (!layer.visible || !o || !src) {
      el.style.display = "none";
      continue;
    }
    if (el.getAttribute("src") !== src) el.src = src;
    el.style.display = "";
    el.style.imageRendering = layer.pixelated ? "pixelated" : "";

    // checked on the first frame a layer is drawn after the switch (React may
    // mount a new state's <img> a frame late). Same image = motion blend only.
    if (fadeKind !== "none" && blend < 1 && !checked.has(layer.id)) {
      checked.add(layer.id);
      const before = prevShown.get(layer.id);
      if (before?.src !== src) {
        entering.add(layer.id);
        if (before) addGhost(before);
      }
    }

    if (layer.id === s.selectedLayerId) runtime.clipT = o.t;
    const fx = entering.has(layer.id) ? fadeIn(fadeKind, blend) : { opacity: 1, scale: 1 };
    const m = mul(worldOf(layer), [fx.scale, 0, 0, fx.scale, 0, 0]);
    const transform = `translate(-50%, -50%) matrix(${m.map((x) => +x.toFixed(5)).join(",")})`;
    const opacity = Math.max(0, Math.min(1, o.v.opacity));
    const bright = Math.max(0, o.v.brightness);
    const filter = bright !== 1 ? `brightness(${bright})` : "";
    el.style.transform = transform;
    el.style.opacity = String(opacity * fx.opacity);
    el.style.filter = filter;
    shown.set(layer.id, { src, transform, opacity, filter });
  }

  lastShown = shown;

  if (ghosts.length) {
    const k = fadeOut(fadeKind, blend);
    if (k <= 0) clearGhosts();
    else for (const g of ghosts) g.el.style.opacity = String(g.opacity * k);
  }
}

const VOWEL_SETTLE_MS = 40; // a new vowel must last this long before it shows
const VOWEL_HOLD_MS = 120; // keep the last vowel through short unvoiced gaps

/** Smoothed vowel from the latest formants (only while talking). */
function updateVowel(enabled: boolean, profile: Parameters<typeof classifyVowel>[2], now: number) {
  if (!enabled) {
    runtime.vowel = null;
    vowelCandidate = null;
    return;
  }
  const v = classifyVowel(runtime.f1, runtime.f2, profile);
  if (v) {
    lastVoiced = now;
    if (v !== vowelCandidate) {
      vowelCandidate = v;
      vowelSince = now;
    }
    if (now - vowelSince >= VOWEL_SETTLE_MS) runtime.vowel = v;
  } else if (now - lastVoiced > VOWEL_HOLD_MS) {
    runtime.vowel = null;
    vowelCandidate = null;
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
