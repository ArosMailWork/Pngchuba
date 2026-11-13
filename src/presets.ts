import { makeKey } from "./curve";
import { Clip } from "./types";

/** Chibi-gif squash & stretch: tall on the beat, squashed half a cycle later.
 *  `anchor` = half the shown layer height in px; shifts Y so the bottom stays put. */
export function squashClip(duration: number, volumeBoost: number, anchor = 0): Clip {
  const k = (f: number, v: number) => makeKey(f * duration, v, duration);
  const sy = [1.08, 0.92, 1.08];
  const tracks: Clip["tracks"] = {
    scaleY: sy.map((v, i) => k(i / 2, v)),
    scaleX: [k(0, 0.95), k(0.5, 1.06), k(1, 0.95)],
  };
  if (anchor) tracks.y = sy.map((v, i) => k(i / 2, Math.round((1 - v) * anchor)));
  return { duration, loop: true, volumeBoost, tracks };
}

/** Starting points users can apply, then tweak in the curve editor. */
export const PRESETS: { name: string; make: () => Clip }[] = [
  { name: "Đứng yên", make: () => ({ duration: 1, loop: true, volumeBoost: 0, tracks: {} }) },
  {
    name: "Thở",
    make: () => ({
      duration: 3,
      loop: true,
      volumeBoost: 0,
      tracks: {
        y: [makeKey(0, 0, 3), makeKey(1.5, -6, 3), makeKey(3, 0, 3)],
        scaleY: [makeKey(0, 1, 3), makeKey(1.5, 1.015, 3), makeKey(3, 1, 3)],
      },
    }),
  },
  {
    name: "Nảy khi nói",
    make: () => ({
      duration: 0.35,
      loop: false,
      volumeBoost: 0.8,
      tracks: {
        y: [
          { t: 0, v: 0, inT: 0, inV: 0, outT: 0.05, outV: -20 },
          makeKey(0.12, -24, 0.35),
          { t: 0.35, v: 0, inT: -0.08, inV: -4, outT: 0, outV: 0 },
        ],
      },
    }),
  },
  {
    name: "Nhún liên tục",
    make: () => ({
      duration: 0.5,
      loop: true,
      volumeBoost: 1,
      tracks: {
        y: [makeKey(0, 0, 0.5), makeKey(0.25, -14, 0.5), makeKey(0.5, 0, 0.5)],
        scaleY: [makeKey(0, 0.97, 0.5), makeKey(0.25, 1.03, 0.5), makeKey(0.5, 0.97, 0.5)],
      },
    }),
  },
  {
    name: "Lắc mạnh (hét)",
    make: () => ({
      duration: 0.24,
      loop: true,
      volumeBoost: 1.5,
      tracks: {
        x: [makeKey(0, 0, 0.24), makeKey(0.06, -6, 0.24), makeKey(0.18, 6, 0.24), makeKey(0.24, 0, 0.24)],
        rotation: [makeKey(0, 0, 0.24), makeKey(0.06, -3, 0.24), makeKey(0.18, 3, 0.24), makeKey(0.24, 0, 0.24)],
        y: [makeKey(0, -10, 0.24), makeKey(0.12, -16, 0.24), makeKey(0.24, -10, 0.24)],
      },
    }),
  },
  { name: "Bóp kiểu GIF", make: () => squashClip(0.3, 0.6) },
];
