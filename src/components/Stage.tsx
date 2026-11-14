import { registerGhostLayer, registerLayerImg } from "../engine";
import { currentState, useStore } from "../store";
import { StageGizmo, useStageEditing } from "./StageGizmo";
import "./Stage.css";

/** The avatar itself. Layer transforms are written per frame by the engine.
 *  `overlay`: transparent, no hints (OBS Browser Source).
 *  `editable`: click/drag layers and their handles to place them (editor). */
export function Stage({ overlay = false, editable = false, hint }: { overlay?: boolean; editable?: boolean; hint?: string }) {
  const st = useStore((s) => currentState(s));
  const hasImage = st.layers.some((l) => Object.values(l.perRange).some((r) => r.image));
  const editing = useStageEditing();

  return (
    <div className={overlay ? "stage" : "stage board"} {...(editable ? editing.handlers : {})}>
      {/* fading-out copies of the previous images, drawn behind the layers */}
      <div className="ghosts" ref={registerGhostLayer} />
      {st.layers.map((l) => (
        <img
          key={l.id}
          ref={(el) => registerLayerImg(l.id, el)}
          className="layer"
          draggable={false}
          alt=""
        />
      ))}
      {editable && <StageGizmo onStart={editing.start} />}
      {!overlay && !hasImage && hint && <div className="stage-hint">{hint}</div>}
    </div>
  );
}
