import closedPng from "./assets/sample/gif-closed.png?inline";
import openPng from "./assets/sample/gif-open.png?inline";
import { squashClip } from "./presets";
import { newAvatar, uid } from "./store";
import { Avatar } from "./types";

/** Example avatar from a talking chibi gif: two sprites (mouth open/closed)
 *  swapped over time, plus squash & stretch. Shouting is faster and stronger. */
export function gifSampleAvatar(): Avatar {
  const a = newAvatar("Mẫu GIF (2 sprite + bóp)");
  const open = uid();
  const closed = uid();
  a.assets = { [open]: openPng, [closed]: closedPng };

  const st = a.states[0];
  st.blinkInterval = 0;
  const [, talk, shout] = st.ranges;
  const layer = st.layers[0];
  layer.name = "Nhân vật";
  layer.scale = 2;
  for (const r of st.ranges) layer.perRange[r.id].image = closed;

  // source images are 220 px tall, shown at scale 2 -> anchor = 220
  const talking = (duration: number, boost: number) => ({
    ...squashClip(duration, boost, 220),
    sprites: [
      { t: 0, image: open },
      { t: duration / 2, image: closed },
    ],
  });
  layer.perRange[talk.id].clip = talking(0.3, 0.5);
  layer.perRange[shout.id].clip = talking(0.2, 1);
  return a;
}
