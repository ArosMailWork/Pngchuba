import { create } from "zustand";
import { produce } from "immer";
import { PRESETS } from "./presets";
import { Avatar, AvatarState, Layer, LayerRange, MicInfo, Settings, VoiceRange } from "./types";

export const uid = () => Math.random().toString(36).slice(2, 10);

const preset = (name: string) => PRESETS.find((p) => p.name === name)!.make();

export function newLayerRange(clipPreset = "Đứng yên"): LayerRange {
  return { image: null, blinkImage: null, clip: preset(clipPreset) };
}

export function newLayer(ranges: VoiceRange[], name = "Layer"): Layer {
  const perRange: Record<string, LayerRange> = {};
  ranges.forEach((r) => (perRange[r.id] = newLayerRange()));
  return { id: uid(), name, visible: true, x: 0, y: 0, rotation: 0, scale: 1, perRange };
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
};

const SETTINGS_KEY = "pngtubah.settings";

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export type Screen = "home" | "live" | "edit";

interface Store {
  avatar: Avatar;
  settings: Settings;
  /** live state shown on stage (also the one being edited) */
  currentStateId: string;
  selectedLayerId: string | null;
  selectedRangeId: string | null;
  /** force the selected range on stage, so animations can be tuned silently */
  previewRange: boolean;
  screen: Screen;
  /** library file the current avatar autosaves to */
  libraryId: string | null;
  mic: MicInfo | null;
  micError: string | null;

  edit: (fn: (a: Avatar) => void) => void;
  setAvatar: (a: Avatar, libraryId: string | null) => void;
  setSettings: (patch: Partial<Settings>) => void;
  set: (patch: Partial<Store>) => void;
}

const initialAvatar = newAvatar();

export const useStore = create<Store>((set) => ({
  avatar: initialAvatar,
  settings: loadSettings(),
  currentStateId: initialAvatar.states[0].id,
  selectedLayerId: initialAvatar.states[0].layers[0].id,
  selectedRangeId: initialAvatar.states[0].ranges[1].id,
  previewRange: false,
  screen: "home",
  libraryId: null,
  mic: null,
  micError: null,

  edit: (fn) => set((s) => ({ avatar: produce(s.avatar, fn) })),
  setAvatar: (avatar, libraryId) =>
    set({
      avatar,
      libraryId,
      previewRange: false,
      currentStateId: avatar.states[0].id,
      selectedLayerId: avatar.states[0].layers[0]?.id ?? null,
      selectedRangeId: avatar.states[0].ranges[0].id,
    }),
  setSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return { settings };
    }),
  set: (patch) => set(patch),
}));

export function currentState(s = useStore.getState()): AvatarState {
  return s.avatar.states.find((x) => x.id === s.currentStateId) ?? s.avatar.states[0];
}

/** Edits the state currently on stage. */
export function editCurrent(fn: (st: AvatarState) => void) {
  const id = currentState().id;
  useStore.getState().edit((a) => fn(a.states.find((x) => x.id === id)!));
}
