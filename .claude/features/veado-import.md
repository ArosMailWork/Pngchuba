# veadotube mini import

Spec: https://veado.tube/docs/tech/file/ (+ /images/, /miniavatar/). Verified against the 4 premade avatars in `veadotube-mini/lib/data.bin`.

## Rust (`src-tauri/src/veado.rs`)
- File = "VEADOTUBE" + chunks `[id u32][type 4cc][len u32][data]`; stop on id 0 / type 0. Lengths may be 0 (THMB).
- `MLST` -> list of `MSTA` ids. MSTA as written by mini 1.4 (matches the ImHex pattern, not the 1-byte-flags layout on the docs page): name, u32 flags, 8 u32 AIMG ids (4 thumbs + closed/open/blink-closed/blink-open), 3 f64 blink (duration, min, max), 4 effect lists, signals, 4cc mode (PRES/HOLD/...).
- `AIMG` frames -> `ABMP` textures (RAW. or VDD.), blitted at offsets (bottom-left origin) into full frames, encoded as PNG / APNG (`png` crate).
- VDD bit reader is LSB-first and multi-bit values are LSB-first too (verified: decodes exactly all bits of real channels).
- `data.bin`: find `avatars/*.veado` entries: `[len][name][flag u8][size u32][packed u32][brotli]`.
- Commands: `import_veado_file(path)`, `import_veado_samples(folder)`. Tests: `VEADO_DIR=<veadotube folder> cargo test --lib`.

## TS (`src/veadoImport.ts`)
Each veado state -> state with ranges Im lặng (-100 dB) / Nói (-42 dB), one layer scaled to fit 520 px. State flag 0x1 (pixelated) -> `layer.pixelated` (MSTA flags are a u32 in mini 1.4 files, sent as `flags`). Effects -> curves (unit = half the shown height): wavemove/waverotate -> sine keys (with the "period offset" param as phase), jump -> looping hops, randommove -> seeded jitter (x and y differ), darken -> constant `brightness` = 1 - amount, transition jump -> one-shot hop on the talking range. All active effects of a list play together (`combine`): clip duration = smallest multiple (x1..x8) of the longest period that every period divides (else the longest), each track resampled (24..200 keys, slope handles) and summed (brightness multiplied). Built-in/custom effect presets are not resolved (their values are read as stored). Keyboard signals -> accelerator (best effort).
