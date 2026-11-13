/**
 * Converts a veadotube mini avatar (decoded in Rust, see veado.rs) into our
 * model: each veado state becomes a state with two voice ranges
 * (silent -> closed mouth image, talking -> open mouth image) and one layer.
 * veado effects are approximated with keyframe curves so they stay editable.
 */
import { makeKey } from "./curve";
import { newLayer, uid } from "./store";
import { Avatar, AvatarState, Clip, HotkeyMode, Keyframe, VoiceRange } from "./types";

interface VeadoEffect {
  kind: string;
  active: boolean;
  values: number[];
}

interface VeadoState {
  name: string;
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
    layer.scale = +scale.toFixed(3);
    layer.perRange[ranges[0].id] = {
      image: asset(closed),
      blinkImage: asset(blinkClosed),
      clip: effectsClip(vs.effects_closed, unit) ?? transitionClip(vs.transitions_close, unit) ?? idle(),
    };
    layer.perRange[ranges[1].id] = {
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

/** Loop clip from the first supported state effect (others are dropped). */
function effectsClip(effects: VeadoEffect[], unit: number): Clip | null {
  for (const e of effects) {
    if (!e.active) continue;
    const [a = 0, b = 0, c = 0] = e.values;
    switch (e.kind) {
      case "wavemove": {
        // amount X, amount Y, period
        const T = Math.max(0.05, c || 1);
        return loop(T, { x: wave(a * unit, T, 0), y: wave(b * unit, T, 1) });
      }
      case "waverotate": {
        // amount (radians), period
        const T = Math.max(0.05, b || 1);
        return loop(T, { rotation: wave((a * 180) / Math.PI, T, 0) });
      }
      case "jump": {
        // amount X, amount Y, velocity: continuous hopping
        const d = 1 / Math.max(0.1, c || 2);
        return loop(2 * d, {
          y: [...hop(b * unit, 0, d), ...hop(b * unit, d, d).slice(1)],
          x: a ? [makeKey(0, -a * unit, 2 * d), makeKey(d, a * unit, 2 * d), makeKey(2 * d, -a * unit, 2 * d)] : [],
        });
      }
      case "randommove": {
        // amount, velocity: jittery shake
        const T = 1;
        const n = Math.round(Math.min(16, Math.max(4, b || 8)));
        return loop(T, { x: jitter(a * unit, T, n), y: jitter(a * unit, T, n) });
      }
    }
  }
  return null;
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

/** Sine (phase 0) or cosine (phase 1) over one period: 5 keys, handles follow the slope. */
function wave(A: number, T: number, phase: 0 | 1): Keyframe[] {
  if (!A) return [];
  const h = T * 0.09;
  return [0, 1, 2, 3, 4].map((i) => {
    const a = (i * Math.PI) / 2 + (phase * Math.PI) / 2;
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
