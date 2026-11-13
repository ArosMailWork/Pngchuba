/** Glue between the store and the Tauri backend: mic, hotkeys, server, library, files. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { runtime } from "./engine";
import { currentState, newAvatar, uid, useStore } from "./store";
import { Avatar, MicInfo } from "./types";
import { convertVeado, VeadoAvatar } from "./veadoImport";

// ---------- microphone ----------

export const listInputDevices = () =>
  invoke<{ id: string; name: string }[]>("list_input_devices");

/** (Re)opens the selected mic and records the result in the store. */
export async function restartMic() {
  const { settings, set } = useStore.getState();
  try {
    const mic = await invoke<MicInfo>("start_mic", {
      deviceId: settings.micDeviceId,
      noiseReduction: settings.noiseReduction,
    });
    set({ mic, micError: null });
  } catch (err) {
    set({ mic: null, micError: String(err) });
  }
}

export const setNoiseReduction = (enabled: boolean) =>
  invoke("set_noise_reduction", { enabled });

// ---------- hotkeys ----------

/** Turns a keydown into a global-shortcut accelerator, e.g. "Control+Shift+Digit1". */
export function accelFromEvent(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  return [...mods, e.code].join("+");
}

export const prettyAccel = (a: string) =>
  a.replace(/Key([A-Z])/, "$1").replace(/Digit(\d)/, "$1").replace(/Numpad/, "Num ");

let holdReturnTo: string | null = null;
let toggleReturnTo: string | null = null;

export function switchTo(id: string) {
  useStore.getState().set({ currentStateId: id });
}

async function registerHotkeys() {
  await unregisterAll();
  for (const st of useStore.getState().avatar.states) {
    if (!st.hotkey) continue;
    const id = st.id;
    const mode = st.hotkeyMode;
    try {
      await register(st.hotkey, (e) => {
        const cur = useStore.getState().currentStateId;
        if (mode === "press" && e.state === "Pressed") switchTo(id);
        if (mode === "hold") {
          if (e.state === "Pressed" && cur !== id) {
            holdReturnTo = cur;
            switchTo(id);
          } else if (e.state === "Released" && holdReturnTo) {
            switchTo(holdReturnTo);
            holdReturnTo = null;
          }
        }
        if (mode === "toggle" && e.state === "Pressed") {
          if (cur === id && toggleReturnTo) switchTo(toggleReturnTo);
          else {
            toggleReturnTo = cur;
            switchTo(id);
          }
        }
      });
    } catch (err) {
      console.warn("hotkey failed", st.hotkey, err);
    }
  }
}

// ---------- local server: OBS overlay + remote control ----------
// Remote control protocol on ws://127.0.0.1:<port>/control (JSON text):
//   -> {"type":"list"}                 <- {"type":"states","states":[{id,name}],"current":id}
//   -> {"type":"set","state":"<name or id>"}
//   <- {"type":"current","state":{id,name}}   (broadcast whenever the state changes)

const controlSend = (msg: object) => invoke("control_send", { text: JSON.stringify(msg) });

function handleControlMessage(text: string) {
  let msg: { type?: string; state?: string };
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  const s = useStore.getState();
  if (msg.type === "list") {
    controlSend({
      type: "states",
      states: s.avatar.states.map(({ id, name }) => ({ id, name })),
      current: s.currentStateId,
    });
  } else if (msg.type === "set" && msg.state) {
    const st = s.avatar.states.find((x) => x.id === msg.state || x.name === msg.state);
    if (st) switchTo(st.id);
  }
}

export const overlayUrl = () => `http://127.0.0.1:${useStore.getState().settings.serverPort}/`;

export async function startServer() {
  await invoke("server_start", { port: useStore.getState().settings.serverPort });
  publishAvatar();
  publishLive();
}

function publishAvatar() {
  // the avatar JSON is embedded as-is to avoid stringifying it twice
  const json = `{"type":"avatar","avatar":${JSON.stringify(useStore.getState().avatar)}}`;
  invoke("overlay_publish", { kind: "avatar", json }).catch(() => {});
}

function publishLive() {
  const s = useStore.getState();
  const json = JSON.stringify({
    type: "live",
    currentStateId: s.currentStateId,
    gainDb: s.settings.gainDb,
    releaseDelay: s.settings.releaseDelay,
  });
  invoke("overlay_publish", { kind: "live", json }).catch(() => {});
}

// ---------- library ----------

export interface LibraryItem {
  id: string;
  name: string;
  thumb: string | null;
  modified: number;
}

export const listLibrary = () => invoke<LibraryItem[]>("library_list");
export const deleteFromLibrary = (id: string) => invoke("library_delete", { id });

export async function openFromLibrary(id: string) {
  const avatar = parseAvatar(await invoke<string>("library_load", { id }));
  useStore.getState().setAvatar(avatar, id);
}

async function saveToLibrary(id: string, avatar: Avatar) {
  const thumb = await makeThumb(avatar).catch(() => avatar.thumb);
  await invoke("library_save", { id, json: serializeAvatar({ ...avatar, thumb }) });
}

export async function createAvatar(avatar = newAvatar()) {
  const id = uid();
  await saveToLibrary(id, avatar);
  useStore.getState().setAvatar(avatar, id);
}

/** Imports .pngtubah or .veado files into the library. Returns how many were added. */
export async function importFiles(): Promise<number> {
  const picked = await open({
    multiple: true,
    filters: [{ name: "Avatar", extensions: ["pngtubah", "veado"] }],
  });
  if (!picked) return 0;
  for (const path of picked) {
    const avatar = path.toLowerCase().endsWith(".veado")
      ? convertVeado(await invoke<VeadoAvatar>("import_veado_file", { path }))
      : parseAvatar(await readTextFile(path));
    await saveToLibrary(uid(), avatar);
  }
  return picked.length;
}

/** Imports the premade avatars shipped inside a veadotube mini folder. */
export async function importVeadoSamples(): Promise<number> {
  const folder = await open({ directory: true, title: "Chọn thư mục veadotube-mini" });
  if (!folder) return 0;
  const avatars = await invoke<VeadoAvatar[]>("import_veado_samples", { folder });
  for (const v of avatars) await saveToLibrary(uid(), convertVeado(v));
  return avatars.length;
}

export async function exportAvatar() {
  const a = useStore.getState().avatar;
  const path = await save({
    filters: [{ name: "pngtubah avatar", extensions: ["pngtubah"] }],
    defaultPath: `${a.name || "avatar"}.pngtubah`,
  });
  if (path) await writeTextFile(path, serializeAvatar(a));
}

function parseAvatar(text: string): Avatar {
  const a = JSON.parse(text) as Avatar;
  if (a.version !== 1 || !Array.isArray(a.states) || a.states.length === 0) {
    throw new Error("File avatar không hợp lệ");
  }
  a.name ??= "Avatar";
  return a;
}

/** JSON of the avatar, dropping images no layer references anymore. */
function serializeAvatar(a: Avatar): string {
  const used = new Set<string>();
  for (const st of a.states)
    for (const l of st.layers)
      for (const r of Object.values(l.perRange)) {
        if (r.image) used.add(r.image);
        if (r.blinkImage) used.add(r.blinkImage);
        for (const k of r.clip.sprites ?? []) if (k.image) used.add(k.image);
      }
  const assets = Object.fromEntries(Object.entries(a.assets).filter(([id]) => used.has(id)));
  return JSON.stringify({ ...a, assets });
}

/** 160px preview: first state, silent range, all visible layers. */
async function makeThumb(a: Avatar): Promise<string | undefined> {
  const st = a.states[0];
  const range = st.ranges[0];
  const layers = st.layers.filter((l) => l.visible && l.perRange[range.id]?.image);
  if (!layers.length) return undefined;
  const imgs = await Promise.all(
    layers.map(
      (l) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = a.assets[l.perRange[range.id].image!];
        }),
    ),
  );
  // fit the union of layer boxes into the thumbnail
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  layers.forEach((l, i) => {
    const w = imgs[i].width * l.scale, h = imgs[i].height * l.scale;
    minX = Math.min(minX, l.x - w / 2); maxX = Math.max(maxX, l.x + w / 2);
    minY = Math.min(minY, l.y - h / 2); maxY = Math.max(maxY, l.y + h / 2);
  });
  const size = 160;
  const k = size / Math.max(maxX - minX, maxY - minY);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.translate(size / 2, size / 2);
  g.scale(k, k);
  g.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
  layers.forEach((l, i) => {
    const w = imgs[i].width * l.scale, h = imgs[i].height * l.scale;
    g.save();
    g.translate(l.x, l.y);
    g.rotate((l.rotation * Math.PI) / 180);
    g.drawImage(imgs[i], -w / 2, -h / 2, w, h);
    g.restore();
  });
  return c.toDataURL("image/png");
}

/** Reads an image chosen with <input type=file> into a data URL asset. */
export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// ---------- wiring ----------

export async function initPlatform() {
  await listen<number>("mic-level", (e) => (runtime.rawDb = e.payload));
  await listen<string>("ws-message", (e) => handleControlMessage(e.payload));

  restartMic();
  startServer().catch((err) => console.warn("server failed", err));

  const sig = () =>
    useStore.getState().avatar.states.map((x) => `${x.id}|${x.hotkey}|${x.hotkeyMode}`).join(",");
  let hotkeySig = sig();
  registerHotkeys();

  let saveTimer: number | undefined;
  let publishTimer: number | undefined;
  useStore.subscribe((s, prev) => {
    if (sig() !== hotkeySig) {
      hotkeySig = sig();
      registerHotkeys();
    }
    if (
      s.currentStateId !== prev.currentStateId ||
      s.settings.gainDb !== prev.settings.gainDb ||
      s.settings.releaseDelay !== prev.settings.releaseDelay
    ) {
      publishLive();
    }
    if (s.currentStateId !== prev.currentStateId) {
      const { id, name } = currentState(s);
      controlSend({ type: "current", state: { id, name } }).catch(() => {});
    }
    if (s.avatar !== prev.avatar) {
      clearTimeout(publishTimer);
      publishTimer = window.setTimeout(publishAvatar, 300);
      // a freshly opened avatar doesn't need saving, only edits do
      if (s.libraryId && s.libraryId === prev.libraryId) {
        clearTimeout(saveTimer);
        const id = s.libraryId;
        saveTimer = window.setTimeout(() => {
          saveToLibrary(id, useStore.getState().avatar).catch((err) => console.warn("save failed", err));
        }, 1000);
      }
    }
  });
}
