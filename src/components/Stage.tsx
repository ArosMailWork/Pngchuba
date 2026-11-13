import { registerLayerImg } from "../engine";
import { currentState, useStore } from "../store";
import "./Stage.css";

/** The avatar itself. Layer transforms are written per frame by the engine.
 *  `overlay`: transparent, no hints (OBS Browser Source). */
export function Stage({ overlay = false, hint }: { overlay?: boolean; hint?: string }) {
  const st = useStore((s) => currentState(s));
  const hasImage = st.layers.some((l) => Object.values(l.perRange).some((r) => r.image));

  return (
    <div className={overlay ? "stage" : "stage board"}>
      {st.layers.map((l) => (
        <img
          key={l.id}
          ref={(el) => registerLayerImg(l.id, el)}
          className="layer"
          draggable={false}
          alt=""
        />
      ))}
      {!overlay && !hasImage && hint && <div className="stage-hint">{hint}</div>}
    </div>
  );
}
