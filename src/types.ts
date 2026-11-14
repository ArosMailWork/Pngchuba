/** Animatable layer properties. x/y/rotation are added to the layer's base
 *  transform; scaleX/scaleY/opacity/brightness are multipliers (neutral value 1). */
export type Prop = "x" | "y" | "rotation" | "scaleX" | "scaleY" | "opacity" | "brightness";

export const PROPS: Prop[] = ["x", "y", "rotation", "scaleX", "scaleY", "opacity", "brightness"];

export const NEUTRAL: Record<Prop, number> = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  brightness: 1,
};

export type Vowel = "a" | "i" | "u" | "e" | "o";
export const VOWELS: Vowel[] = ["a", "i", "u", "e", "o"];

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

/** Base placement of a layer, in px from the stage center / degrees / factor. */
export interface Transform {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export const TRANSFORM_KEYS = ["x", "y", "rotation", "scale"] as const;

/** What a layer shows/does while a given voice range is active. */
export interface LayerRange extends Transform {
  image: string | null; // asset id
  blinkImage: string | null; // asset id, used while blinking
  clip: Clip;
  /** mouth image per detected vowel while talking (asset ids, optional) */
  vowels?: Partial<Record<Vowel, string>>;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  perRange: Record<string, LayerRange>; // keyed by VoiceRange.id
  /** follows the motion of this layer (same state), e.g. mouth -> head */
  parentId?: string | null;
  /** nearest-neighbour scaling, keeps pixel art crisp */
  pixelated?: boolean;
}

/** A volume band. The active range is the highest one whose threshold the
 *  mic level reaches; the first range is always the fallback (silence). */
export interface VoiceRange {
  id: string;
  name: string;
  threshold: number; // dBFS
}

export type HotkeyMode = "press" | "hold" | "toggle";

/** How images change when the range or state switches.
 *  crossfade: old fades out while new fades in; fadeThrough: old out, then new in;
 *  pop: new image springs in from smaller. */
export type FadeKind = "none" | "crossfade" | "fadeThrough" | "pop";

export interface AvatarState {
  id: string;
  name: string;
  ranges: VoiceRange[];
  layers: Layer[];
  hotkey: string | null;
  hotkeyMode: HotkeyMode;
  blinkInterval: number; // seconds, 0 disables blinking
  blinkDuration: number; // seconds
  transition: number; // seconds to blend motion / fade images when the range or state changes
  /** image effect when entering a range of this state or this state itself (missing = none) */
  fade?: FadeKind;
}

export interface Avatar {
  version: 1;
  name: string;
  /** small preview for the library screen, regenerated on save */
  thumb?: string;
  states: AvatarState[];
  assets: Record<string, string>; // asset id -> data URL
  /** only in exported files: the user's presets, merged on import */
  presets?: CustomPreset[];
}

/** A user-made animation preset, shared by all avatars (motion only, no sprites). */
export interface CustomPreset {
  id: string;
  name: string;
  clip: Clip;
}

export interface Settings {
  micDeviceId: string | null;
  noiseReduction: boolean;
  gainDb: number;
  /** seconds the level must stay below a range before dropping out of it */
  releaseDelay: number;
  /** local server for the OBS overlay and remote control */
  serverPort: number;
  /** switch mouth images by detected vowel (a i u e o) */
  lipSync: boolean;
  /** calibrated [F1, F2] (Hz) per vowel; missing = built-in average */
  vowelProfile: Partial<Record<Vowel, [number, number]>>;
}

export interface MicInfo {
  name: string;
  sample_rate: number;
  /** the open mic is a Bluetooth headset (picked explicitly) */
  bluetooth: boolean;
  /** the default mic is a Bluetooth headset, so it was not opened */
  blocked: boolean;
}
