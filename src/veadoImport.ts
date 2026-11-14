/**
 * Converts a veadotube mini avatar (decoded in Rust, see veado.rs) into our
 * model: each veado state becomes a state with two voice ranges
 * (silent -> closed mouth image, talking -> open mouth image) and one layer.
 * veado effects are approximated with keyframe curves so they stay editable.
 */
import { evalTrack, makeKey } from "./curve";
import { newLayer, uid } from "./store";
import { Avatar, AvatarState, Clip, HotkeyMode, Keyframe, Prop, VoiceRange } from "./types";

interface VeadoEffect {
  kind: string;
  active: boolean;
  values: number[];
}

interface VeadoState {
  name: string;
  flags: number; // 0x1 = pixelated
  images: [number, number, number, number]; // closed, open, blink closed, blink open
  blink_duration: number;
  blink_min: number;
  blink_max: number;
  effects_closed: VeadoEffect[];
  effects_open: VeadoEffect[];
  transitions_open: VeadoEffect[];
  transitions_close: VeadoEffect[];
  signals: [string, string][];
  mode: string;
}

export interface VeadoAvatar {
  name: string;
  states: VeadoState[];
  images: Record<string, { data_url: string; width: number; height: number }>;
}

/** Target on-screen height for imported avatars (px). */
const FIT = 520;

export function convertVeado(v: VeadoAvatar): Avatar {
  const assets: Record<string, string> = {};
  const assetOf = new Map<number, string>();
  const asset = (id: number) => {
    if (!id || !v.images[id]) return null;
    if (!assetOf.has(id)) {
      const aid = uid();
      assets[aid] = v.images[id].data_url;
      assetOf.set(id, aid);
    }
    return assetOf.get(id)!;
  };

  const states = v.states.map((vs, i): AvatarState => {
    const ranges: VoiceRange[] = [
      { id: uid(), name: "Im lặng", threshold: -100 },
      { id: uid(), name: "Nói", threshold: -42 },
    ];
    const [closed, open, blinkClosed, blinkOpen] = vs.images;
    const base = v.images[closed] ?? v.images[open];
    const scale = base ? Math.min(1, FIT / Math.max(base.width, base.height)) : 1;
    // veado effect amounts are relative to the avatar; use half its shown height
    const unit = ((base?.height ?? FIT) * scale) / 2;

    const layer = newLayer(ranges, "Nhân vật");
    if (vs.flags & 1) layer.pixelated = true;
    const place = { x: 0, y: 0, rotation: 0, scale: +scale.toFixed(3) };
    layer.perRange[ranges[0].id] = {
      ...place,
      image: asset(closed),
      blinkImage: asset(blinkClosed),
      clip: effectsClip(vs.effects_closed, unit) ?? transitionClip(vs.transitions_close, unit) ?? idle(),
    };
    layer.perRange[ranges[1].id] = {
      ...place,
      image: asset(open) ?? asset(closed),
      blinkImage: asset(blinkOpen) ?? asset(blinkClosed),
      clip: effectsClip(vs.effects_open, unit) ?? transitionClip(vs.transitions_open, unit) ?? idle(),
    };

    return {
      id: uid(),
      name: vs.name || `State ${i + 1}`,
      ranges,
      layers: [layer],
      hotkey: hotkeyOf(vs.signals),
      hotkeyMode: modeOf(vs.mode),
      blinkInterval: +((vs.blink_min + vs.blink_max) / 2).toFixed(2),
      blinkDuration: vs.blink_duration,
      transition: 0.1,
    };
  });

  return { version: 1, name: v.name || "Avatar veado", states, assets };
}

const idle = (): Clip => ({ duration: 1, loop: true, volumeBoost: 0, tracks: {} });

/** Loop clip from all active state effects, played together. */
function effectsClip(effects: VeadoEffect[], unit: number): Clip | null {
  const parts = effects.filter((e) => e.active).map((e) => effectPart(e, unit)).filter((p): p is Part => !!p);
  if (!parts.length) return null;
  return parts.length === 1 ? loop(parts[0].T, parts[0].tracks) : combine(parts);
}

interface Part {
  T: number;
  tracks: Clip["tracks"];
}

/** One veado effect as looping curves (null = unsupported). */
function effectPart(e: VeadoEffect, unit: number): Part | null {
  const [a = 0, b = 0, c = 0, d = 0] = e.values;
  switch (e.kind) {
    case "wavemove": {
      // amount X, amount Y, period, period offset
      const T = Math.max(0.05, c || 1);
      return { T, tracks: { x: wave(a * unit, T, d), y: wave(b * unit, T, d + 0.25) } };
    }
    case "waverotate": {
      // amount (radians), period, period offset
      const T = Math.max(0.05, b || 1);
      return { T, tracks: { rotation: wave((a * 180) / Math.PI, T, c) } };
    }
    case "jump": {
      // amount X, amount Y, velocity: continuous hopping
      const h = 1 / Math.max(0.1, c || 2);
      return {
        T: 2 * h,
        tracks: {
          y: [...hop(b * unit, 0, h), ...hop(b * unit, h, h).slice(1)],
          x: a ? [makeKey(0, -a * unit, 2 * h), makeKey(h, a * unit, 2 * h), makeKey(2 * h, -a * unit, 2 * h)] : [],
        },
      };
    }
    case "randommove": {
      // amount, velocity: jittery shake
      const n = Math.round(Math.min(16, Math.max(4, b || 8)));
      return { T: 1, tracks: { x: jitter(a * unit, 1, n), y: jitter(a * unit, 1, n + 1) } };
    }
    case "darken": {
      // amount 0..1 -> constant brightness
      const v = round(Math.max(0, 1 - a));
      return { T: 1, tracks: { brightness: [makeKey(0, v, 1)] } };
    }
  }
  return null;
}

/** Several looping effects in one clip: a duration they all fit into
 *  (or the longest one), curves resampled and added together. */
function combine(parts: Part[]): Clip {
  const longest = Math.max(...parts.map((p) => p.T));
  let D = longest;
  for (let k = 1; k <= 8; k++) {
    const d = longest * k;
    if (parts.every((p) => Math.abs(d / p.T - Math.round(d / p.T)) < 0.02)) {
      D = d;
      break;
    }
  }
  const props = [...new Set(parts.flatMap((p) => Object.keys(p.tracks)))] as Prop[];
  const n = Math.min(200, Math.max(24, Math.ceil(D / 0.04)));
  const tracks: Clip["tracks"] = {};
  for (const prop of props) {
    const mult = prop === "brightness";
    const at = (t: number) =>
      parts.reduce((acc, p) => {
        const ks = p.tracks[prop];
        if (!ks?.length) return acc;
        const v = evalTrack(ks, t % p.T);
        return mult ? acc * v : acc + v;
      }, mult ? 1 : 0);
    const h = D / n / 3;
    tracks[prop] = Array.from({ length: n + 1 }, (_, i) => {
      const t = (i * D) / n;
      const slope = (at(Math.min(D, t + 1e-3)) - at(Math.max(0, t - 1e-3))) / 2e-3;
      return { t, v: round(at(t)), inT: -h, inV: round(-slope * h), outT: h, outV: round(slope * h) };
    });
  }
  return loop(D, tracks);
}

/** One-shot hop when entering the range (veado "jump" transition: amount, velocity). */
function transitionClip(transitions: VeadoEffect[], unit: number): Clip | null {
  const t = transitions.find((x) => x.active && x.kind === "jump");
  if (!t) return null;
  const [amount = 0.2, velocity = 4] = t.values;
  const d = 1 / Math.max(0.1, velocity);
  return { duration: d, loop: false, volumeBoost: 0.5, tracks: { y: hop(amount * unit, 0, d) } };
}

function loop(T: number, tracks: Clip["tracks"]): Clip {
  const clean: Clip["tracks"] = {};
  for (const [k, v] of Object.entries(tracks)) if (v && v.length) clean[k as keyof Clip["tracks"]] = v;
  return { duration: +T.toFixed(3), loop: true, volumeBoost: 0, tracks: clean };
}

/** A * sin(2pi (t/T + shift)) over one period: 5 keys, handles follow the slope.
 *  shift is in periods (0.25 = cosine). */
function wave(A: number, T: number, shift: number): Keyframe[] {
  if (!A) return [];
  const h = T * 0.09;
  return [0, 1, 2, 3, 4].map((i) => {
    const a = (i * Math.PI) / 2 + 2 * Math.PI * shift;
    const v = A * Math.sin(a);
    const slope = ((2 * Math.PI * A) / T) * Math.cos(a);
    return { t: (i * T) / 4, v: round(v), inT: -h, inV: round(-slope * h), outT: h, outV: round(slope * h) };
  });
}

/** Parabolic hop of height A starting at t0 lasting d. */
function hop(A: number, t0: number, d: number): Keyframe[] {
  const h = d / 6;
  const up = round((4 * A * h) / d); // parabola slope at the ground
  return [
    { t: t0, v: 0, inT: -h, inV: -up, outT: h, outV: -up },
    { t: t0 + d / 2, v: round(-A), inT: -h, inV: 0, outT: h, outV: 0 },
    { t: t0 + d, v: 0, inT: -h, inV: -up, outT: h, outV: -up },
  ];
}

/** Deterministic pseudo-random shake that loops seamlessly. */
function jitter(A: number, T: number, n: number): Keyframe[] {
  if (!A) return [];
  let seed = Math.round(A * 1000) + n;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280) * 2 - 1;
  const keys = Array.from({ length: n }, (_, i) => makeKey((i * T) / n, round(rnd() * A), T / n));
  keys.push({ ...keys[0], t: T });
  return keys;
}

const round = (v: number) => Math.round(v * 100) / 100;

function modeOf(mode: string): HotkeyMode {
  if (mode === "HOLD" || mode === "PRED") return "hold";
  if (mode.startsWith("TOG")) return "toggle";
  return "press";
}

const MODIFIERS: Record<string, string> = {
  ctrl: "Control", control: "Control", leftctrl: "Control", rightctrl: "Control",
  shift: "Shift", leftshift: "Shift", rightshift: "Shift",
  alt: "Alt", leftalt: "Alt", rightalt: "Alt",
};

const NAMED: Record<string, string> = {
  enter: "Enter", return: "Enter", space: "Space", tab: "Tab", escape: "Escape", esc: "Escape",
  backspace: "Backspace", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  insert: "Insert", delete: "Delete", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
};

/** veado keyboard signals -> global shortcut accelerator (best effort). */
function hotkeyOf(signals: [string, string][]): string | null {
  const mods: string[] = [];
  let key: string | null = null;
  for (const [provider, raw] of signals) {
    if (provider !== "input.keyboard") continue;
    const s = raw.toLowerCase();
    if (MODIFIERS[s]) mods.push(MODIFIERS[s]);
    else if (/^[a-z]$/.test(s)) key = "Key" + s.toUpperCase();
    else if (/^[0-9]$/.test(s)) key = "Digit" + s;
    else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(s)) key = s.toUpperCase();
    else if (/^(numpad|keypad)[0-9]$/.test(s)) key = "Numpad" + s.slice(-1);
    else if (NAMED[s]) key = NAMED[s];
  }
  return key ? [...new Set(mods), key].join("+") : null;
}
