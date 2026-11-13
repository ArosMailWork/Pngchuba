import { Clip, Keyframe, NEUTRAL, Prop } from "./types";

/** Evaluates a keyframe track at time t (keys must be sorted by t). */
export function evalTrack(keys: Keyframe[], t: number): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;

  let i = 0;
  while (keys[i + 1].t < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  if (span <= 0) return b.v;

  // Cubic bezier: P0=a, P1=a+out, P2=b+in, P3=b. Handle times are clamped
  // inside the segment so time stays monotonic and we can solve for it.
  const x1 = a.t + clamp(a.outT, 0, span);
  const x2 = b.t + clamp(b.inT, -span, 0);
  const y1 = a.v + a.outV;
  const y2 = b.v + b.inV;

  // Bisection on the curve parameter s for x(s) = t.
  let lo = 0;
  let hi = 1;
  let s = 0.5;
  for (let n = 0; n < 24; n++) {
    s = (lo + hi) / 2;
    if (bez(a.t, x1, x2, b.t, s) < t) lo = s;
    else hi = s;
  }
  return bez(a.v, y1, y2, b.v, s);
}

function bez(p0: number, p1: number, p2: number, p3: number, s: number) {
  const u = 1 - s;
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Clip-local time for an elapsed time, honoring loop/hold. */
export function clipTime(clip: Clip, elapsed: number): number {
  if (clip.duration <= 0) return 0;
  return clip.loop ? elapsed % clip.duration : Math.min(elapsed, clip.duration);
}

/** Sprite image at clip time t: undefined when the clip has no sprite track,
 *  null when the active frame falls back to the range image. */
export function spriteAt(clip: Clip, t: number): string | null | undefined {
  const keys = clip.sprites;
  if (!keys?.length) return undefined;
  let image = keys[0].image;
  for (const k of keys) if (k.t <= t) image = k.image;
  return image;
}

/** Value of one property, with volume boost applied (factor >= 1). */
export function evalProp(clip: Clip, prop: Prop, t: number, factor: number): number {
  const keys = clip.tracks[prop];
  if (!keys || keys.length === 0) return NEUTRAL[prop];
  const v = evalTrack(keys, t);
  const neutral = NEUTRAL[prop];
  return neutral + (v - neutral) * factor;
}

/** Smooth default key: flat handles a fraction of the clip apart. */
export function makeKey(t: number, v: number, duration: number): Keyframe {
  const h = duration * 0.12;
  return { t, v, inT: -h, inV: 0, outT: h, outV: 0 };
}
