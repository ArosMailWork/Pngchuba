import { Vowel, VOWELS } from "./types";

/** Average [F1, F2] (Hz) per vowel as measured by our analyzer (it reads F1
 *  a bit high), used until the user records their own voice. */
export const DEFAULT_PROFILE: Record<Vowel, [number, number]> = {
  a: [800, 1300],
  i: [350, 2300],
  u: [400, 1350],
  e: [530, 2000],
  o: [560, 950],
};

/** Farther than this (squared log distance) from every vowel = not a vowel. */
const MAX_DIST = 0.25;

/** Nearest vowel to the formants, in log-frequency space. */
export function classifyVowel(
  f1: number,
  f2: number,
  profile: Partial<Record<Vowel, [number, number]>>,
): Vowel | null {
  if (!(f1 > 0 && f2 > 0)) return null;
  let best: Vowel | null = null;
  let bestD = MAX_DIST;
  for (const v of VOWELS) {
    const [p1, p2] = profile[v] ?? DEFAULT_PROFILE[v];
    const d = Math.log(f1 / p1) ** 2 + Math.log(f2 / p2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** Median of recorded [F1, F2] pairs (calibration). */
export function medianFormants(samples: [number, number][]): [number, number] | null {
  if (samples.length < 5) return null;
  const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return [Math.round(med(samples.map((s) => s[0]))), Math.round(med(samples.map((s) => s[1])))];
}
