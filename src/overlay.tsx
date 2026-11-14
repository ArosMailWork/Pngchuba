/**
 * OBS / Streamlabs Browser Source page: only the avatar, transparent background.
 * Fed by the app over ws://<host>/ws (avatar JSON, live state, mic level).
 */
import ReactDOM from "react-dom/client";
import { Stage } from "./components/Stage";
import { runtime, startEngine } from "./engine";
import { useStore } from "./store";

const host = new URLSearchParams(location.search).get("feed") ?? location.host;

function connect() {
  const ws = new WebSocket(`ws://${host}/ws`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const s = useStore.getState();
    if (msg.type === "level") {
      runtime.rawDb = msg.db;
      runtime.f1 = msg.f1 ?? 0;
      runtime.f2 = msg.f2 ?? 0;
    }
    else if (msg.type === "avatar") {
      const keep = msg.avatar.states.some((x: { id: string }) => x.id === s.currentStateId);
      s.set({ avatar: msg.avatar, ...(keep ? {} : { currentStateId: msg.avatar.states[0].id }) });
    } else if (msg.type === "live") {
      s.set({
        currentStateId: msg.currentStateId,
        settings: {
          ...s.settings,
          gainDb: msg.gainDb,
          releaseDelay: msg.releaseDelay,
          lipSync: msg.lipSync ?? s.settings.lipSync,
          vowelProfile: msg.vowelProfile ?? s.settings.vowelProfile,
        },
      });
    }
  };
  // the app may be closed or restarting: keep retrying quietly
  ws.onclose = () => setTimeout(connect, 1000);
}

connect();
startEngine();
ReactDOM.createRoot(document.getElementById("root")!).render(<Stage overlay />);
