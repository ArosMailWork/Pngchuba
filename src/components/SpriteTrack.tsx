import { useRef, useState } from "react";
import { clamp } from "../curve";
import { readImageFile } from "../platform";
import { uid, useStore } from "../store";
import { Clip, SpriteKey } from "../types";
import { NumberInput } from "./CurveEditor";

/** Frame-by-frame image swaps over the clip time (e.g. mouth open/closed). */
export function SpriteTrack({ clip, onChange }: { clip: Clip; onChange: (clip: Clip) => void }) {
  const assets = useStore((s) => s.avatar.assets);
  const [picking, setPicking] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const keys = clip.sprites ?? [];
  const dur = clip.duration;

  const setKeys = (next: SpriteKey[]) => {
    const sorted = [...next].sort((a, b) => a.t - b.t);
    onChange({ ...clip, sprites: sorted.length ? sorted : undefined });
    return sorted;
  };

  const addFrame = () => {
    const last = keys[keys.length - 1];
    const key = { t: last ? +((last.t + dur) / 2).toFixed(3) : 0, image: null };
    const next = setKeys([...keys, key]);
    setPicking(next.indexOf(key));
  };

  const setImage = (i: number, image: string | null) => {
    setKeys(keys.map((k, j) => (j === i ? { ...k, image } : k)));
    setPicking(null);
  };

  const setTime = (i: number, t: number) => {
    const moved = { ...keys[i], t: clamp(t, 0, dur) };
    const next = setKeys(keys.map((k, j) => (j === i ? moved : k)));
    if (picking === i) setPicking(next.indexOf(moved));
  };

  const remove = (i: number) => {
    setKeys(keys.filter((_, j) => j !== i));
    setPicking(null);
  };

  const upload = async (file?: File) => {
    if (!file || picking === null) return;
    const data = await readImageFile(file);
    const id = uid();
    useStore.getState().edit((a) => void (a.assets[id] = data));
    setImage(picking, id);
  };

  const thumb = (image: string | null) =>
    image && assets[image] ? <img src={assets[image]} alt="" /> : <span className="small">hình range</span>;

  return (
    <div className="sprite-track">
      <div className="sprite-bar">
        {keys.map((k, i) => {
          // the first frame also covers the time before its key (matches spriteAt)
          const start = i === 0 ? 0 : k.t;
          const end = keys[i + 1]?.t ?? dur;
          return (
            <div
              key={i}
              className={picking === i ? "sprite-seg active" : "sprite-seg"}
              style={{ left: `${(start / dur) * 100}%`, width: `${((end - start) / dur) * 100}%` }}
              onClick={() => setPicking(i)}
              title={`${+k.t.toFixed(3)}s`}
            >
              {thumb(k.image)}
            </div>
          );
        })}
        {keys.length === 0 && <span className="muted small">Chưa có frame, luôn dùng hình của range</span>}
      </div>

      <div className="row wrap">
        {keys.map((k, i) => (
          <div key={i} className={picking === i ? "sprite-key active" : "sprite-key"}>
            <div className="thumb" onClick={() => setPicking(picking === i ? null : i)} title="Đổi hình">
              {thumb(k.image)}
            </div>
            <label>
              Từ (s)
              <NumberInput value={k.t} step={0.01} min={0} max={dur} onChange={(t) => setTime(i, t)} />
            </label>
            <button onClick={() => remove(i)} title="Xóa frame">
              ✕
            </button>
          </div>
        ))}
        <button onClick={addFrame}>+ Thêm frame</button>
      </div>

      {picking !== null && keys[picking] && (
        <div className="sprite-picker row wrap">
          <span className="muted">Hình cho frame {picking + 1}:</span>
          <div className="thumb" onClick={() => setImage(picking, null)} title="Dùng hình của range">
            <span className="small">hình range</span>
          </div>
          {Object.entries(assets).map(([id, src]) => (
            <div
              key={id}
              className={keys[picking].image === id ? "thumb selected" : "thumb"}
              onClick={() => setImage(picking, id)}
            >
              <img src={src} alt="" />
            </div>
          ))}
          <button onClick={() => fileInput.current?.click()}>Tải hình mới…</button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/gif,image/webp,image/apng,image/jpeg"
            hidden
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}

      <div className="hint">
        Mỗi frame hiện từ mốc thời gian của nó tới frame kế tiếp, chạy theo thời gian clip (Lặp thì nháy liên tục).
        Đang chớp mắt thì hình chớp mắt được ưu tiên.
      </div>
    </div>
  );
}
