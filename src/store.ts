import { create } from "zustand";
import { produce } from "immer";
import { PRESETS } from "./presets";
import {
  Avatar,
  AvatarState,
  Clip,
  CustomPreset,
  Keyframe,
  Layer,
  LayerRange,
  MicInfo,
  Settings,
  Transform,
  VoiceRange,
} from "./types";

export const uid = () => Math.random().toString(36).slice(2, 10);

const preset = (name: string) => PRESETS.find((p) => p.name === name)!.make();

export const IDENTITY: Transform = { x: 0, y: 0, rotation: 0, scale: 1 };

export function newLayerRange(clipPreset = "Đứng yên", place: Transform = IDENTITY): LayerRange {
  const { x, y, rotation, scale } = place;
  return { x, y, rotation, scale, image: null, blinkImage: null, clip: preset(clipPreset) };
}

export function newLayer(ranges: VoiceRange[], name = "Layer"): Layer {
  const perRange: Record<string, LayerRange> = {};
  ranges.forEach((r) => (perRange[r.id] = newLayerRange()));
  return { id: uid(), name, visible: true, perRange };
}

export function newState(name = "State"): AvatarState {
  const ranges: VoiceRange[] = [
    { id: uid(), name: "Im lặng", threshold: -100 },
    { id: uid(), name: "Nói", threshold: -42 },
    { id: uid(), name: "Hét", threshold: -14 },
  ];
  const layer = newLayer(ranges, "Layer 1");
  layer.perRange[ranges[0].id].clip = preset("Thở");
  layer.perRange[ranges[1].id].clip = preset("Nảy khi nói");
  layer.perRange[ranges[2].id].clip = preset("Lắc mạnh (hét)");
  return {
    id: uid(),
    name,
    ranges,
    layers: [layer],
    hotkey: null,
    hotkeyMode: "press",
    blinkInterval: 4,
    blinkDuration: 0.15,
    transition: 0.12,
    fade: "none",
  };
}

export function newAvatar(name = "Avatar mới"): Avatar {
  return { version: 1, name, states: [newState("Bình thường")], assets: {} };
}

export const DEFAULT_SETTINGS: Settings = {
  micDeviceId: null,
  noiseReduction: false,
  gainDb: 0,
  releaseDelay: 0.15,
  serverPort: 7878,
  lipSync: true,
  vowelProfile: {},
};

const SETTINGS_KEY = "pngtubah.settings";

const PRESETS_KEY = "pngtubah.presets";

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadPresets(): CustomPreset[] {
  try {
    const list = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// ---------- undo history ----------
// Snapshots of the whole avatar. immer shares unchanged parts (and the big
// asset strings) between snapshots, so an unlimited history stays cheap.
// Bursts of edits (typing, sliders) less than MERGE_MS apart form one step;
// pointer drags are one step between beginGesture() and endGesture().
const MERGE_MS = 400;
let past: Avatar[] = [];
let future: Avatar[] = [];
let lastEdit = -Infinity;
let inGesture = false;
let gestureFresh = false;

export function beginGesture() {
  inGesture = true;
  gestureFresh = true;
}

export function endGesture() {
  inGesture = false;
  lastEdit = -Infinity; // the next edit starts a new step
}

export type Screen = "home" | "live" | "edit";

interface Store {
  avatar: Avatar;
  settings: Settings;
  /** live state shown on stage (also the one being edited) */
  currentStateId: string;
  selectedLayerId: string | null;
  /** multi-selection (Ctrl/Shift click); only counts when it contains selectedLayerId */
  selectedLayerIds: string[];
  selectedRangeId: string | null;
  /** force the selected range on stage, so animations can be tuned silently */
  previewRange: boolean;
  screen: Screen;
  /** library file the current avatar autosaves to */
  libraryId: string | null;
  mic: MicInfo | null;
  micError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  customPresets: CustomPreset[];
  /** copied animation (whole clip) and copied curve (one track) */
  copiedClip: Clip | null;
  copiedTrack: { keys: Keyframe[]; duration: number } | null;

  /** undoable avatar change */
  edit: (fn: (a: Avatar) => void) => void;
  undo: () => void;
  redo: () => void;
  setCustomPresets: (list: CustomPreset[]) => void;
  setAvatar: (a: Avatar, libraryId: string | null) => void;
  setSettings: (patch: Partial<Settings>) => void;
  set: (patch: Partial<Store>) => void;
}

const initialAvatar = newAvatar();

/** Keeps the selection valid after undo/redo removed what it pointed to. */
function selectionFor(s: Store, avatar: Avatar): Partial<Store> {
  const st = avatar.states.find((x) => x.id === s.currentStateId) ?? avatar.states[0];
  const hasLayer = st.layers.some((l) => l.id === s.selectedLayerId);
  const hasRange = st.ranges.some((r) => r.id === s.selectedRangeId);
  return {
    avatar,
    currentStateId: st.id,
    selectedLayerId: hasLayer ? s.selectedLayerId : (st.layers[st.layers.length - 1]?.id ?? null),
    selectedRangeId: hasRange ? s.selectedRangeId : st.ranges[0].id,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

export const useStore = create<Store>((set) => ({
  avatar: initialAvatar,
  settings: loadSettings(),
  currentStateId: initialAvatar.states[0].id,
  selectedLayerId: initialAvatar.states[0].layers[0].id,
  selectedRangeId: initialAvatar.states[0].ranges[1].id,
  selectedLayerIds: [],
  previewRange: false,
  screen: "home",
  libraryId: null,
  mic: null,
  micError: null,
  canUndo: false,
  canRedo: false,
  customPresets: loadPresets(),
  copiedClip: null,
  copiedTrack: null,

  edit: (fn) =>
    set((s) => {
      const avatar = produce(s.avatar, fn);
      if (avatar === s.avatar) return {};
      const now = performance.now();
      const newStep = inGesture ? gestureFresh : now - lastEdit > MERGE_MS;
      if (newStep) past.push(s.avatar);
      gestureFresh = false;
      lastEdit = now;
      future = [];
      return { avatar, canUndo: past.length > 0, canRedo: false };
    }),
  undo: () =>
    set((s) => {
      const prev = past.pop();
      if (!prev) return {};
      future.push(s.avatar);
      lastEdit = -Infinity;
      return selectionFor(s, prev);
    }),
  redo: () =>
    set((s) => {
      const next = future.pop();
      if (!next) return {};
      past.push(s.avatar);
      lastEdit = -Infinity;
      return selectionFor(s, next);
    }),
  setCustomPresets: (customPresets) => {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(customPresets));
    set({ customPresets });
  },
  setAvatar: (avatar, libraryId) => {
    past = [];
    future = [];
    set({
      avatar,
      canUndo: false,
      canRedo: false,
      libraryId,
      previewRange: false,
      currentStateId: avatar.states[0].id,
      selectedLayerId: avatar.states[0].layers[0]?.id ?? null,
      selectedRangeId: avatar.states[0].ranges[0].id,
    });
  },
  setSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return { settings };
    }),
  set: (patch) => set(patch),
}));

/** Layers selected in the current state: the multi-selection when it includes
 *  the primary layer, otherwise just the primary one. */
export function selectedLayerIds(s = useStore.getState()): string[] {
  const st = currentState(s);
  const ids = s.selectedLayerId && s.selectedLayerIds.includes(s.selectedLayerId) ? s.selectedLayerIds : [s.selectedLayerId];
  return ids.filter((id): id is string => !!id && st.layers.some((l) => l.id === id));
}

export function currentState(s = useStore.getState()): AvatarState {
  return s.avatar.states.find((x) => x.id === s.currentStateId) ?? s.avatar.states[0];
}

/** Edits the state currently on stage. */
export function editCurrent(fn: (st: AvatarState) => void) {
  const id = currentState().id;
  useStore.getState().edit((a) => fn(a.states.find((x) => x.id === id)!));
}
