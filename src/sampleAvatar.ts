import closedPng from "./assets/sample/gif-closed.png?inline";
import openPng from "./assets/sample/gif-open.png?inline";
import { squashClip } from "./presets";
import { newAvatar, uid } from "./store";
import { Avatar } from "./types";

/** Example avatar from a chibi gif: mouth closed while silent, mouth open
 *  while talking/shouting, plus squash & stretch. Shouting is faster and stronger. */
export function gifSampleAvatar(): Avatar {
  const a = newAvatar("Mẫu GIF (mở miệng + bóp)");
  const open = uid();
  const closed = uid();
  a.assets = { [open]: openPng, [closed]: closedPng };

  const st = a.states[0];
  st.blinkInterval = 0;
  const [, talk, shout] = st.ranges;
  const layer = st.layers[0];
  layer.name = "Nhân vật";
  for (const r of st.ranges) {
    layer.perRange[r.id].scale = 2;
    layer.perRange[r.id].image = r.id === st.ranges[0].id ? closed : open;
  }

  // source images are 220 px tall, shown at scale 2 -> anchor = 220
  layer.perRange[talk.id].clip = squashClip(0.3, 0.5, 220);
  layer.perRange[shout.id].clip = squashClip(0.2, 1, 220);
  return a;
}
