import { useEffect, useRef, useState } from "react";
import { layerImg } from "../engine";
import { beginGesture, currentState, editCurrent, endGesture, selectedLayerIds, useStore } from "../store";
import { AvatarState, Transform } from "../types";

type Kind = "move" | "scale" | "rotate";
interface Drag {
  kind: Kind;
  layerId: string;
  rangeId: string;
  start: { x: number; y: number };
  base: Transform;
  /** moving a multi-selection: every selected layer's start placement */
  group: Map<string, Transform>;
}

/** Stage point relative to the stage center, in px (same space as layer x/y). */
function stagePoint(e: React.PointerEvent, stage: Element) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
}

const natural = (layerId: string) => {
  const el = layerImg(layerId);
  return el && el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null;
};

/** Topmost visible layer under the point, using its placement in the given range. */
function hitLayer(st: AvatarState, rangeId: string, p: { x: number; y: number }): string | null {
  for (let i = st.layers.length - 1; i >= 0; i--) {
    const l = st.layers[i];
    const lr = l.perRange[rangeId];
    const size = natural(l.id);
    if (!l.visible || !lr || !size) continue;
    const a = (-lr.rotation * Math.PI) / 180;
    const dx = p.x - lr.x;
    const dy = p.y - lr.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= (size.w * lr.scale) / 2 && Math.abs(ly) <= (size.h * lr.scale) / 2) return l.id;
  }
  return null;
}

/** Natural size of an image data URL (re-measured when it changes). */
function useImageSize(src: string | undefined) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!src) return setSize(null);
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);
  return size;
}

/**
 * Editor-only overlay on the stage: click a layer to select it, drag to move,
 * drag a corner to resize, drag the round knob to rotate (Shift: 15° steps).
 * Edits the placement of the selected voice range.
 */
export function useStageEditing() {
  const drag = useRef<Drag | null>(null);

  const start = (e: React.PointerEvent, kind: Kind, layerId: string) => {
    const s = useStore.getState();
    const st = currentState(s);
    const rangeId = s.selectedRangeId ?? st.ranges[0].id;
    const lr = st.layers.find((l) => l.id === layerId)?.perRange[rangeId];
    if (!lr) return;
    // dragging one layer of the multi-selection moves all of them
    const picked = selectedLayerIds(s);
    const together = kind === "move" && picked.length > 1 && picked.includes(layerId);
    const group = new Map<string, Transform>();
    if (together)
      for (const l of st.layers) {
        const r = l.perRange[rangeId];
        if (picked.includes(l.id) && r) group.set(l.id, { x: r.x, y: r.y, rotation: r.rotation, scale: r.scale });
      }
    const stage = (e.currentTarget as Element).closest(".stage")!;
    stage.setPointerCapture(e.pointerId);
    drag.current = {
      kind,
      layerId,
      rangeId,
      start: stagePoint(e, stage),
      base: { x: lr.x, y: lr.y, rotation: lr.rotation, scale: lr.scale },
      group,
    };
    beginGesture();
    // show the range being placed, whatever the mic is doing
    s.set({ selectedLayerId: layerId, previewRange: true, ...(together ? {} : { selectedLayerIds: [layerId] }) });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = useStore.getState();
    const st = currentState(s);
    const rangeId = s.selectedRangeId ?? st.ranges[0].id;
    const id = hitLayer(st, rangeId, stagePoint(e, e.currentTarget));
    if (!id) return;
    if (e.ctrlKey || e.shiftKey || e.metaKey) {
      // add/remove from the selection without moving anything
      const picked = selectedLayerIds(s);
      const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
      if (next.length) s.set({ selectedLayerIds: next, selectedLayerId: next.includes(s.selectedLayerId ?? "") ? s.selectedLayerId : id });
      return;
    }
    start(e, "move", id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = stagePoint(e, e.currentTarget);
    const b = d.base;
    const next: Partial<Transform> = {};
    if (d.kind === "move") {
      next.x = Math.round(b.x + p.x - d.start.x);
      next.y = Math.round(b.y + p.y - d.start.y);
    } else if (d.kind === "scale") {
      const r0 = Math.hypot(d.start.x - b.x, d.start.y - b.y);
      const r1 = Math.hypot(p.x - b.x, p.y - b.y);
      if (r0 > 0) next.scale = Math.max(0.01, Math.round(((b.scale * r1) / r0) * 1000) / 1000);
    } else {
      const a0 = Math.atan2(d.start.y - b.y, d.start.x - b.x);
      const a1 = Math.atan2(p.y - b.y, p.x - b.x);
      let deg = b.rotation + ((a1 - a0) * 180) / Math.PI;
      deg = ((((deg + 180) % 360) + 360) % 360) - 180; // keep within -180..180
      next.rotation = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10;
    }
    editCurrent((st) => {
      if (d.group.size) {
        const dx = (next.x ?? b.x) - b.x;
        const dy = (next.y ?? b.y) - b.y;
        for (const l of st.layers) {
          const from = d.group.get(l.id);
          const lr = l.perRange[d.rangeId];
          if (from && lr) Object.assign(lr, { x: from.x + dx, y: from.y + dy });
        }
        return;
      }
      const lr = st.layers.find((l) => l.id === d.layerId)?.perRange[d.rangeId];
      if (lr) Object.assign(lr, next);
    });
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    endGesture();
  };

  return { start, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

/** Thin outline of a layer that is also selected (multi-selection). */
function PickedOutline({ layerId }: { layerId: string }) {
  const st = useStore((s) => currentState(s));
  const rangeId = useStore((s) => s.selectedRangeId);
  const assets = useStore((s) => s.avatar.assets);
  const lr = rangeId ? st.layers.find((l) => l.id === layerId)?.perRange[rangeId] : undefined;
  const imageId = lr?.image ?? lr?.clip.sprites?.find((k) => k.image)?.image ?? null;
  const size = useImageSize(imageId ? assets[imageId] : undefined);
  if (!lr || !size) return null;
  return (
    <div
      className="gizmo picked"
      style={{
        width: size.w * lr.scale,
        height: size.h * lr.scale,
        transform: `translate(-50%, -50%) translate(${lr.x}px, ${lr.y}px) rotate(${lr.rotation}deg)`,
      }}
    />
  );
}

/** Selection box with resize corners and a rotate knob, at the layer's base placement. */
export function StageGizmo({ onStart }: { onStart: (e: React.PointerEvent, kind: Kind, layerId: string) => void }) {
  const others = useStore((s) => selectedLayerIds(s).filter((id) => id !== s.selectedLayerId).join(","));
  return (
    <>
      {others && others.split(",").map((id) => <PickedOutline key={id} layerId={id} />)}
      <MainGizmo onStart={onStart} />
    </>
  );
}

function MainGizmo({ onStart }: { onStart: (e: React.PointerEvent, kind: Kind, layerId: string) => void }) {
  const st = useStore((s) => currentState(s));
  const layerId = useStore((s) => s.selectedLayerId);
  const rangeId = useStore((s) => s.selectedRangeId);
  const assets = useStore((s) => s.avatar.assets);
  const layer = st.layers.find((l) => l.id === layerId);
  const lr = layer && rangeId ? layer.perRange[rangeId] : undefined;
  const imageId = lr?.image ?? lr?.clip.sprites?.find((k) => k.image)?.image ?? null;
  const size = useImageSize(imageId ? assets[imageId] : undefined);
  if (!layer || !lr || !size || !layer.visible) return null;

  const down = (kind: Kind) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onStart(e, kind, layer.id);
  };

  return (
    <div
      className="gizmo"
      style={{
        width: size.w * lr.scale,
        height: size.h * lr.scale,
        transform: `translate(-50%, -50%) translate(${lr.x}px, ${lr.y}px) rotate(${lr.rotation}deg)`,
      }}
      onPointerDown={down("move")}
    >
      {["nw", "ne", "sw", "se"].map((c) => (
        <div key={c} className={`gizmo-corner ${c}`} onPointerDown={down("scale")} title="Kéo để đổi cỡ" />
      ))}
      <div className="gizmo-stem" />
      <div className="gizmo-rotate" onPointerDown={down("rotate")} title="Kéo để xoay (Shift: bước 15°)" />
    </div>
  );
}
