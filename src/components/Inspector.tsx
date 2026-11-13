import { useRef } from "react";
import { restartClip } from "../engine";
import { readImageFile } from "../platform";
import { currentState, editCurrent, uid, useStore } from "../store";
import { Clip, Layer } from "../types";
import { CurveEditor, NumberInput } from "./CurveEditor";

/** Bottom dock: per-layer settings for each voice range + curve editor. */
export function Inspector() {
  const st = useStore((s) => currentState(s));
  const layerId = useStore((s) => s.selectedLayerId);
  const rangeId = useStore((s) => s.selectedRangeId);
  const preview = useStore((s) => s.previewRange);
  const assets = useStore((s) => s.avatar.assets);
  const set = useStore((s) => s.set);

  const layer = st.layers.find((l) => l.id === layerId);
  const rangeIndex = Math.max(0, st.ranges.findIndex((r) => r.id === rangeId));
  const range = st.ranges[rangeIndex];
  if (!layer) return <div className="inspector empty">Chọn một layer để chỉnh</div>;
  const lr = layer.perRange[range.id];

  const editLayer = (fn: (l: Layer) => void) =>
    editCurrent((s) => fn(s.layers.find((l) => l.id === layer.id)!));

  const setClip = (clip: Clip) =>
    editLayer((l) => {
      l.perRange[range.id].clip = clip;
    });

  const copyClipToAll = () =>
    editLayer((l) => {
      for (const r of st.ranges) l.perRange[r.id].clip = structuredClone(lr.clip);
    });

  return (
    <div className="inspector">
      <div className="row wrap">
        <input
          className="name"
          value={layer.name}
          onChange={(e) => editLayer((l) => void (l.name = e.target.value))}
        />
        {(["x", "y", "rotation", "scale"] as const).map((k) => (
          <label key={k}>
            {{ x: "X", y: "Y", rotation: "Xoay", scale: "Tỉ lệ" }[k]}
            <NumberInput
              value={layer[k]}
              step={k === "scale" ? 0.05 : 1}
              onChange={(v) => editLayer((l) => void (l[k] = v))}
            />
          </label>
        ))}
      </div>

      <div className="row wrap">
        <span className="muted">Range:</span>
        {st.ranges.map((r) => (
          <button
            key={r.id}
            className={r.id === range.id ? "tab active" : "tab"}
            onClick={() => set({ selectedRangeId: r.id })}
          >
            {r.name}
          </button>
        ))}
        <label className="check" title="Ép avatar dùng range này để chỉnh animation mà không cần nói">
          <input type="checkbox" checked={preview} onChange={(e) => set({ previewRange: e.target.checked })} />
          Xem trước range này
        </label>
        <button onClick={restartClip}>↺ Chạy lại</button>
        <button onClick={copyClipToAll} title="Dùng animation này cho mọi range của layer">
          Áp animation cho mọi range
        </button>
      </div>

      <div className="row wrap">
        <ImageSlot
          label="Hình"
          src={lr.image ? assets[lr.image] : undefined}
          onPick={(id) => editLayer((l) => void (l.perRange[range.id].image = id))}
        />
        <ImageSlot
          label="Hình khi chớp mắt"
          src={lr.blinkImage ? assets[lr.blinkImage] : undefined}
          onPick={(id) => editLayer((l) => void (l.perRange[range.id].blinkImage = id))}
        />
        <button
          disabled={!lr.image}
          title="Dùng cùng hình này cho mọi range"
          onClick={() =>
            editLayer((l) => {
              for (const r of st.ranges) {
                l.perRange[r.id].image = lr.image;
                l.perRange[r.id].blinkImage = lr.blinkImage;
              }
            })
          }
        >
          Áp hình cho mọi range
        </button>
      </div>

      <CurveEditor clip={lr.clip} onChange={setClip} rangeIndex={rangeIndex} />
    </div>
  );
}

function ImageSlot({
  label,
  src,
  onPick,
}: {
  label: string;
  src?: string;
  onPick: (assetId: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file?: File) => {
    if (!file) return;
    const data = await readImageFile(file);
    const id = uid();
    useStore.getState().edit((a) => void (a.assets[id] = data));
    onPick(id);
  };
  return (
    <div className="image-slot">
      <div className="thumb" onClick={() => input.current?.click()}>
        {src ? <img src={src} alt="" /> : <span>+</span>}
      </div>
      <div className="col">
        <span>{label}</span>
        <div className="row">
          <button onClick={() => input.current?.click()}>Chọn hình</button>
          {src && <button onClick={() => onPick(null)}>Bỏ</button>}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/gif,image/webp,image/apng,image/jpeg"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
