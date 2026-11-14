import { useEffect, useState } from "react";
import {
  createAvatar,
  deleteFromLibrary,
  importFiles,
  importVeadoSamples,
  LibraryItem,
  listLibrary,
  openFromLibrary,
} from "../platform";
import { SAMPLES } from "../sampleAvatar";
import { Screen, useStore } from "../store";

/** Library screen: pick an avatar to use, or "Custom" to edit it. */
export function Home() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = useStore((s) => s.set);

  const refresh = () => listLibrary().then(setItems).catch((e) => alert(String(e)));
  useEffect(() => void refresh(), []);

  const task = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const openAs = (id: string, screen: Screen) =>
    task("Đang mở…", async () => {
      await openFromLibrary(id);
      set({ screen });
    });

  return (
    <div className="home board">
      <header className="home-head">
        <h1 className="title">pngtubah</h1>
        <div className="row wrap">
          <button className="btn-accent" onClick={() => task("Đang tạo…", async () => {
            await createAvatar();
            set({ screen: "edit" });
          })}>
            + Avatar mới
          </button>
          {SAMPLES.map((sm) => (
            <button
              key={sm.label}
              title={sm.title}
              onClick={() => task("Đang tạo…", async () => {
                await createAvatar(sm.make());
                set({ screen: "edit" });
              })}
            >
              + Avatar mẫu ({sm.label})
            </button>
          ))}
          <button onClick={() => task("Đang nhập…", importFiles)}>Nhập file (.pngtubah / .veado)</button>
          <button onClick={() => task("Đang nhập avatar mẫu…", importVeadoSamples)}>Nhập avatar mẫu veadotube</button>
        </div>
      </header>

      {busy && <div className="busy">{busy}</div>}

      <div className="cards">
        {items?.length === 0 && (
          <div className="empty-note">
            Chưa có avatar nào. Tạo mới, hoặc nhập file .veado từ veadotube nhé!
          </div>
        )}
        {items?.map((it, i) => (
          <div key={it.id} className="card" style={{ "--tilt": `${((i * 7) % 5) - 2}deg` } as React.CSSProperties}>
            <div className="card-thumb" onClick={() => openAs(it.id, "live")} title="Dùng avatar này">
              {it.thumb ? <img src={it.thumb} alt="" /> : <span>?</span>}
            </div>
            <div className="card-name">{it.name || "(chưa đặt tên)"}</div>
            <div className="row">
              <button className="grow" onClick={() => openAs(it.id, "live")}>Dùng</button>
              <button className="grow" onClick={() => openAs(it.id, "edit")}>✎ Custom</button>
              <button
                title="Xóa"
                onClick={() => confirm(`Xóa "${it.name}"?`) && task("Đang xóa…", () => deleteFromLibrary(it.id))}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
