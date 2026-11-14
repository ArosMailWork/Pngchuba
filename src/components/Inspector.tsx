import { useShallow } from "zustand/react/shallow";
import { useRef } from "react";
import { restartClip } from "../engine";
import { readImageFile } from "../platform";
import { currentState, editCurrent, selectedLayerIds, uid, useStore } from "../store";
import { AvatarState, Clip, Layer, TRANSFORM_KEYS, VOWELS } from "../types";
import { CurveEditor, NumberInput } from "./CurveEditor";

/** Bottom dock: per-layer settings for each voice range + curve editor. */
export function Inspector() {
  const st = useStore((s) => currentState(s));
  const layerId = useStore((s) => s.selectedLayerId);
  const rangeId = useStore((s) => s.selectedRangeId);
  const preview = useStore((s) => s.previewRange);
  const assets = useStore((s) => s.avatar.assets);
  const set = useStore((s) => s.set);
  const multi = useStore(useShallow((s) => selectedLayerIds(s)));
  const copiedClip = useStore((s) => s.copiedClip);

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

  const copyPlaceToAll = () =>
    editLayer((l) => {
      for (const r of st.ranges) for (const k of TRANSFORM_KEYS) l.perRange[r.id][k] = lr[k];
    });

  const copyClipToAll = () =>
    editLayer((l) => {
      for (const r of st.ranges) l.perRange[r.id].clip = structuredClone(lr.clip);
    });

  const others = multi.filter((id) => id !== layer.id);
  /** Copies this layer's animation to the other selected layers (this range or all). */
  const clipToSelected = (allRanges: boolean) =>
    editCurrent((s) => {
      for (const l of s.layers)
        if (others.includes(l.id))
          for (const r of allRanges ? st.ranges : [range])
            l.perRange[r.id].clip = structuredClone(layer.perRange[r.id].clip);
    });

  /** Pastes the copied animation into this range of every selected layer. Sprite
   *  frames pointing at images this avatar doesn't have are dropped. */
  const paste = () => {
    if (!copiedClip) return;
    const clip = structuredClone(copiedClip);
    clip.sprites = clip.sprites?.filter((k) => !k.image || assets[k.image]);
    editCurrent((s) => {
      for (const l of s.layers) if (multi.includes(l.id)) l.perRange[range.id].clip = structuredClone(clip);
    });
  };

  return (
    <div className="inspector">
      {multi.length > 1 && (
        <div className="row wrap multi-bar">
          <span className="muted">Đang chọn {multi.length} layer:</span>
          <button onClick={() => clipToSelected(false)} title={`Chép animation range "${range.name}" của "${layer.name}" sang các layer đang chọn`}>
            Áp animation range này cho {others.length} layer kia
          </button>
          <button onClick={() => clipToSelected(true)} title={`Chép animation mọi range của "${layer.name}" sang các layer đang chọn`}>
            Áp mọi range cho {others.length} layer kia
          </button>
        </div>
      )}
      <div className="row wrap">
        <input
          className="name"
          value={layer.name}
          onChange={(e) => editLayer((l) => void (l.name = e.target.value))}
        />
        <span className="muted small" title="Kéo hình trên khung xem trước để di chuyển, kéo góc để đổi cỡ, kéo chấm tròn để xoay">
          Vị trí ({range.name}):
        </span>
        {TRANSFORM_KEYS.map((k) => (
          <label key={k}>
            {{ x: "X", y: "Y", rotation: "Xoay", scale: "Tỉ lệ" }[k]}
            <NumberInput
              value={lr[k]}
              step={k === "scale" ? 0.05 : 1}
              onChange={(v) => editLayer((l) => void (l.perRange[range.id][k] = v))}
            />
          </label>
        ))}
        <button onClick={copyPlaceToAll} title="Dùng vị trí/cỡ/góc xoay này cho mọi range của layer">
          Áp vị trí cho mọi range
        </button>
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
        <button onClick={() => set({ copiedClip: structuredClone(lr.clip) })} title="Copy animation của range này">
          📋 Copy
        </button>
        <button
          disabled={!copiedClip}
          onClick={paste}
          title={multi.length > 1 ? `Dán animation vào range này của ${multi.length} layer đang chọn` : "Dán animation vào range này"}
        >
          📥 Dán{multi.length > 1 ? ` (${multi.length})` : ""}
        </button>
      </div>

      <div className="row wrap">
        <label title="Layer này chuyển động theo layer cha (ví dụ miệng theo đầu), cộng thêm animation riêng của nó">
          Gắn vào layer
          <select
            value={layer.parentId ?? ""}
            onChange={(e) => editLayer((l) => void (l.parentId = e.target.value || null))}
          >
            <option value="">(không)</option>
            {st.layers
              .filter((l) => l.id !== layer.id && !isDescendant(st, l.id, layer.id))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </label>
        <label className="check" title="Phóng to không bị nhòe, hợp với hình pixel art">
          <input
            type="checkbox"
            checked={!!layer.pixelated}
            onChange={(e) => editLayer((l) => void (l.pixelated = e.target.checked))}
          />
          Giữ nét pixel
        </label>
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
                l.perRange[r.id].vowels = structuredClone(lr.vowels);
              }
            })
          }
        >
          Áp hình cho mọi range
        </button>
      </div>

      <div className="row wrap" title="Khi đang nói và app nghe ra nguyên âm, layer hiện hình tương ứng (ô trống = giữ hình thường). Bật/hiệu chỉnh ở Cài đặt > Khẩu hình.">
        <span className="muted">Khẩu hình ({range.name}):</span>
        {VOWELS.map((v) => {
          const id = lr.vowels?.[v];
          return (
            <ImageSlot
              key={v}
              compact
              label={v.toUpperCase()}
              src={id ? assets[id] : undefined}
              onPick={(asset) =>
                editLayer((l) => {
                  const r = l.perRange[range.id];
                  const next = { ...r.vowels };
                  if (asset) next[v] = asset;
                  else delete next[v];
                  r.vowels = next;
                })
              }
            />
          );
        })}
      </div>

      <CurveEditor clip={lr.clip} onChange={setClip} rangeIndex={rangeIndex} />
    </div>
  );
}

/** True when `id` sits somewhere under `ancestor` in the parent chain. */
function isDescendant(st: AvatarState, id: string, ancestor: string): boolean {
  let cur = st.layers.find((l) => l.id === id);
  for (let i = 0; cur?.parentId && i < 16; i++) {
    if (cur.parentId === ancestor) return true;
    cur = st.layers.find((l) => l.id === cur!.parentId);
  }
  return false;
}

function ImageSlot({
  label,
  src,
  onPick,
  compact = false,
}: {
  label: string;
  src?: string;
  onPick: (assetId: string | null) => void;
  /** small square with the label under it (vowel mouths) */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file?: File) => {
    if (!file) return;
    const data = await readImageFile(file);
    const id = uid();
    useStore.getState().edit((a) => void (a.assets[id] = data));
    onPick(id);
  };
  const fileInput = (
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
  );
  if (compact)
    return (
      <div className="vowel-slot">
        <div
          className="thumb"
          onClick={() => input.current?.click()}
          onContextMenu={(e) => (e.preventDefault(), onPick(null))}
          title={src ? "Bấm để đổi hình, chuột phải để bỏ" : "Bấm để chọn hình"}
        >
          {src ? <img src={src} alt="" /> : <span>+</span>}
        </div>
        <span className="small">{label}</span>
        {fileInput}
      </div>
    );
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
