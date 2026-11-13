/** Animatable layer properties. x/y/rotation are added to the layer's base
 *  transform; scaleX/scaleY/opacity are multipliers (neutral value 1). */
export type Prop = "x" | "y" | "rotation" | "scaleX" | "scaleY" | "opacity";

export const PROPS: Prop[] = ["x", "y", "rotation", "scaleX", "scaleY", "opacity"];

export const NEUTRAL: Record<Prop, number> = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
};

/** A curve point. Handles are stored relative to the key: (inT <= 0, outT >= 0). */
export interface Keyframe {
  t: number;
  v: number;
  inT: number;
  inV: number;
  outT: number;
  outV: number;
}

/** Sprite swap: from time t (seconds) on, the layer shows this image.
 *  image null = the range's own image. */
export interface SpriteKey {
  t: number;
  image: string | null; // asset id
}

export interface Clip {
  /** seconds */
  duration: number;
  loop: boolean;
  /** Extra motion strength at the loud end of the range: 0 = time-only,
   *  1 = motion doubles when the voice reaches the top of the range. */
  volumeBoost: number;
  tracks: Partial<Record<Prop, Keyframe[]>>;
  /** frame-by-frame image swaps over the clip time, sorted by t (optional) */
  sprites?: SpriteKey[];
}

/** What a layer shows/does while a given voice range is active. */
export interface LayerRange {
  image: string | null; // asset id
  blinkImage: string | null; // asset id, used while blinking
  clip: Clip;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  perRange: Record<string, LayerRange>; // keyed by VoiceRange.id
}

/** A volume band. The active range is the highest one whose threshold the
 *  mic level reaches; the first range is always the fallback (silence). */
export interface VoiceRange {
  id: string;
  name: string;
  threshold: number; // dBFS
}

export type HotkeyMode = "press" | "hold" | "toggle";

export interface AvatarState {
  id: string;
  name: string;
  ranges: VoiceRange[];
  layers: Layer[];
  hotkey: string | null;
  hotkeyMode: HotkeyMode;
  blinkInterval: number; // seconds, 0 disables blinking
  blinkDuration: number; // seconds
  transition: number; // seconds to blend motion when the range changes
}

export interface Avatar {
  version: 1;
  name: string;
  /** small preview for the library screen, regenerated on save */
  thumb?: string;
  states: AvatarState[];
  assets: Record<string, string>; // asset id -> data URL
}

export interface Settings {
  micDeviceId: string | null;
  noiseReduction: boolean;
  gainDb: number;
  /** seconds the level must stay below a range before dropping out of it */
  releaseDelay: number;
  /** local server for the OBS overlay and remote control */
  serverPort: number;
}

export interface MicInfo {
  name: string;
  sample_rate: number;
  denoise_supported: boolean;
}
