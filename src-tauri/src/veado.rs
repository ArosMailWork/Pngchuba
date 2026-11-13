//! Importer for veadotube mini avatars (`.veado`).
//! Spec: https://veado.tube/docs/tech/file/ (chunks, mini avatars, images).
//! Images are decoded (RAW./VDD.) and re-encoded as PNG, or APNG when animated,
//! so the frontend can use them as plain data URLs.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use base64::Engine;
use serde::Serialize;

#[derive(Serialize)]
pub struct VeadoEffect {
    kind: String,
    active: bool,
    values: Vec<f64>,
}

#[derive(Serialize)]
pub struct VeadoState {
    name: String,
    /// AIMG ids (0 = none): closed, open, blink closed, blink open
    images: [u32; 4],
    blink_duration: f64,
    blink_min: f64,
    blink_max: f64,
    effects_closed: Vec<VeadoEffect>,
    effects_open: Vec<VeadoEffect>,
    transitions_open: Vec<VeadoEffect>,
    transitions_close: Vec<VeadoEffect>,
    /// (provider, signal), e.g. ("input.keyboard", "enter")
    signals: Vec<(String, String)>,
    mode: String,
}

#[derive(Serialize)]
pub struct VeadoImage {
    data_url: String,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
pub struct VeadoAvatar {
    name: String,
    states: Vec<VeadoState>,
    images: HashMap<u32, VeadoImage>,
}

#[tauri::command]
pub async fn import_veado_file(path: String) -> Result<VeadoAvatar, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let name = Path::new(&path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        parse_avatar(&bytes, name)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reads the premade avatars bundled in a veadotube mini folder (`lib/data.bin`).
#[tauri::command]
pub async fn import_veado_samples(folder: String) -> Result<Vec<VeadoAvatar>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&folder).join("lib").join("data.bin");
        let data = std::fs::read(&path).map_err(|_| format!("không tìm thấy {}", path.display()))?;
        let mut out = Vec::new();
        for (name, bytes) in bundled_avatars(&data)? {
            out.push(parse_avatar(&bytes, name)?);
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// data.bin entries look like: [name len u8][name][flag u8][size u32][packed size u32][brotli data].
fn bundled_avatars(data: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let needle = b"avatars/";
    let mut out = Vec::new();
    let mut i = 1;
    while let Some(pos) = find(&data[i..], needle).map(|p| p + i) {
        i = pos + 1;
        let len = data[pos - 1] as usize;
        let Some(name) = data.get(pos..pos + len) else { continue };
        if !name.ends_with(b".veado") {
            continue;
        }
        let mut p = pos + len + 1;
        let size = u32_at(data, p + 0)? as usize;
        let packed = u32_at(data, p + 4)? as usize;
        p += 8;
        let blob = data.get(p..p + packed).ok_or("data.bin bị cắt")?;
        let mut bytes = Vec::with_capacity(size);
        brotli_decompressor::Decompressor::new(blob, 4096)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let stem = String::from_utf8_lossy(&name[8..len - 6]).into_owned();
        out.push((stem, bytes));
    }
    Ok(out)
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn u32_at(b: &[u8], p: usize) -> Result<u32, String> {
    b.get(p..p + 4)
        .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
        .ok_or_else(|| "file bị cắt".to_string())
}

// ---------------------------------------------------------------------------
// chunk reader

struct Reader<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Self { b, p: 0 }
    }
    fn bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        let s = self.b.get(self.p..self.p + n).ok_or("dữ liệu bị cắt")?;
        self.p += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.bytes(1)?[0])
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32, String> {
        Ok(self.u32()? as i32)
    }
    fn f64(&mut self) -> Result<f64, String> {
        Ok(f64::from_le_bytes(self.bytes(8)?.try_into().unwrap()))
    }
    fn varint(&mut self) -> Result<usize, String> {
        let (mut v, mut shift) = (0usize, 0);
        loop {
            let b = self.u8()?;
            v |= ((b & 0x7f) as usize) << shift;
            if b < 0x80 {
                return Ok(v);
            }
            shift += 7;
        }
    }
    fn string(&mut self) -> Result<String, String> {
        let n = self.varint()?;
        Ok(String::from_utf8_lossy(self.bytes(n)?).into_owned())
    }
    fn effects(&mut self) -> Result<Vec<VeadoEffect>, String> {
        let n = self.varint()?;
        (0..n)
            .map(|_| {
                let kind = self.string()?;
                let flags = self.u8()?;
                if flags & 4 != 0 {
                    self.u32()?; // custom preset chunk id
                }
                if flags & 2 != 0 {
                    self.string()?; // built-in preset id
                }
                let count = self.varint()?;
                let values = (0..count).map(|_| self.f64()).collect::<Result<_, _>>()?;
                Ok(VeadoEffect { kind, active: flags & 1 != 0, values })
            })
            .collect()
    }
}

fn parse_avatar(bytes: &[u8], name: String) -> Result<VeadoAvatar, String> {
    if !bytes.starts_with(b"VEADOTUBE") {
        return Err("không phải file veadotube".into());
    }
    // id -> (type, body)
    let mut chunks: HashMap<u32, (&[u8], &[u8])> = HashMap::new();
    let mut order: Vec<u32> = Vec::new();
    let mut r = Reader { b: bytes, p: 9 };
    while r.p + 12 <= bytes.len() {
        let id = r.u32()?;
        let kind = r.bytes(4)?;
        let len = r.u32()? as usize;
        if id == 0 || kind == [0u8; 4] {
            break;
        }
        let body = r.bytes(len)?;
        chunks.insert(id, (kind, body));
        order.push(id);
    }

    let mlst = order
        .iter()
        .find_map(|id| (chunks[id].0 == b"MLST").then_some(chunks[id].1))
        .ok_or("file không phải mini avatar (thiếu MLST)")?;

    let mut states = Vec::new();
    for ids in mlst.chunks_exact(4) {
        let id = u32::from_le_bytes(ids.try_into().unwrap());
        if let Some((kind, body)) = chunks.get(&id) {
            if *kind == b"MSTA" {
                states.push(parse_state(body)?);
            }
        }
    }

    let mut images = HashMap::new();
    for st in &states {
        for &id in &st.images {
            if id != 0 && !images.contains_key(&id) {
                images.insert(id, decode_aimg(&chunks, id)?);
            }
        }
    }
    Ok(VeadoAvatar { name, states, images })
}

/// MSTA layout as written by veadotube mini 1.4+ (u32 flags, 8 image ids,
/// blink duration/min/max, 4 effect lists, shortcuts, shortcut mode).
fn parse_state(body: &[u8]) -> Result<VeadoState, String> {
    let mut r = Reader::new(body);
    let name = r.string()?;
    let _flags = r.u32()?;
    let mut ids = [0u32; 8];
    for id in &mut ids {
        *id = r.u32()?;
    }
    let blink_duration = r.f64()?;
    let blink_min = r.f64()?;
    let blink_max = r.f64()?;
    let effects_closed = r.effects()?;
    let effects_open = r.effects()?;
    let transitions_open = r.effects()?;
    let transitions_close = r.effects()?;
    let n = r.varint()?;
    let signals = (0..n)
        .map(|_| Ok((r.string()?, r.string()?)))
        .collect::<Result<_, String>>()?;
    let mode = String::from_utf8_lossy(r.bytes(4).unwrap_or(b"PRES")).into_owned();
    Ok(VeadoState {
        name,
        images: [ids[4], ids[5], ids[6], ids[7]],
        blink_duration,
        blink_min,
        blink_max,
        effects_closed,
        effects_open,
        transitions_open,
        transitions_close,
        signals,
        mode,
    })
}

// ---------------------------------------------------------------------------
// images

struct Texture {
    w: u32,
    h: u32,
    /// RGBA, top row first
    rgba: Vec<u8>,
}

fn decode_aimg(chunks: &HashMap<u32, (&[u8], &[u8])>, id: u32) -> Result<VeadoImage, String> {
    let (kind, body) = chunks.get(&id).ok_or("thiếu hình")?;
    if *kind != b"AIMG" {
        return Err(format!("chunk {id} không phải AIMG"));
    }
    let mut r = Reader::new(body);
    let w = r.u32()?;
    let h = r.u32()?;
    let n = r.varint()?;
    let loops = if n > 1 { r.varint()? } else { 0 };

    let mut frames = Vec::with_capacity(n);
    for _ in 0..n {
        let tex_id = r.u32()?;
        let ox = r.i32()?;
        let oy = r.i32()?;
        let duration = r.f64()?;
        let mut canvas = vec![0u8; (w * h * 4) as usize];
        if tex_id != 0 {
            let (k, tb) = chunks.get(&tex_id).ok_or("thiếu texture")?;
            if *k == b"ABMP" {
                let tex = decode_abmp(tb)?;
                blit(&mut canvas, w, h, &tex, ox, oy);
            }
        }
        frames.push((canvas, duration));
    }

    let png = encode_png(w, h, &frames, loops as u32)?;
    Ok(VeadoImage {
        data_url: format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        ),
        width: w,
        height: h,
    })
}

/// Copies a texture into the frame. Offsets are measured from the bottom-left,
/// since veado images are stored bottom row first.
fn blit(canvas: &mut [u8], w: u32, h: u32, tex: &Texture, ox: i32, oy: i32) {
    for ty in 0..tex.h as i32 {
        // tex.rgba is already top-first; convert to bottom-based row index
        let from_bottom = oy + (tex.h as i32 - 1 - ty);
        let y = h as i32 - 1 - from_bottom;
        if y < 0 || y >= h as i32 {
            continue;
        }
        for tx in 0..tex.w as i32 {
            let x = ox + tx;
            if x < 0 || x >= w as i32 {
                continue;
            }
            let s = ((ty as u32 * tex.w + tx as u32) * 4) as usize;
            let d = ((y as u32 * w + x as u32) * 4) as usize;
            canvas[d..d + 4].copy_from_slice(&tex.rgba[s..s + 4]);
        }
    }
}

fn decode_abmp(body: &[u8]) -> Result<Texture, String> {
    let mut r = Reader::new(body);
    let w = r.u32()?;
    let h = r.u32()?;
    let format = r.bytes(4)?;
    let n = (w * h) as usize;
    // channels in bottom-to-top order
    let mut px = vec![0u8; n * 4];
    match format {
        b"RAW." => px.copy_from_slice(r.bytes(n * 4)?),
        b"VDD." => decode_vdd(&mut r, n, &mut px)?,
        f => return Err(format!("định dạng hình chưa hỗ trợ: {}", String::from_utf8_lossy(f))),
    }
    // flip to top-first rows
    let row = w as usize * 4;
    let mut rgba = vec![0u8; n * 4];
    for y in 0..h as usize {
        let src = (h as usize - 1 - y) * row;
        rgba[y * row..(y + 1) * row].copy_from_slice(&px[src..src + row]);
    }
    Ok(Texture { w, h, rgba })
}

/// VeadoDelta: per channel (A, R, G, B), delta-coded values packed with a
/// prefix code, LSB-first. Color channels skip fully transparent pixels.
fn decode_vdd(r: &mut Reader, n: usize, px: &mut [u8]) -> Result<(), String> {
    let lens = [r.u32()?, r.u32()?, r.u32()?, r.u32()?];
    // channel order in file: alpha, red, green, blue -> rgba offsets
    let offsets = [3usize, 0, 1, 2];
    for (c, &len) in lens.iter().enumerate() {
        let off = offsets[c];
        if len >= 0xFFFF_FF00 {
            let v = (len & 0xFF) as u8;
            for i in 0..n {
                px[i * 4 + off] = v;
            }
            continue;
        }
        let words = r.bytes(len as usize * 4)?;
        let mut bits = BitReader { b: words, pos: 0 };
        let mut value: u8 = if c == 0 { 255 } else { 0 };
        let mut pending_zeros = 0usize;
        for i in 0..n {
            if c != 0 && px[i * 4 + 3] == 0 {
                continue;
            }
            let delta = if pending_zeros > 0 {
                pending_zeros -= 1;
                0
            } else {
                match bits.delta()? {
                    Delta::Value(d) => d,
                    Delta::Zeros(k) => {
                        pending_zeros = k - 1;
                        0
                    }
                }
            };
            value = value.wrapping_add(delta as u8);
            px[i * 4 + off] = value;
        }
    }
    Ok(())
}

enum Delta {
    Value(i32),
    Zeros(usize),
}

struct BitReader<'a> {
    b: &'a [u8],
    pos: usize,
}

impl BitReader<'_> {
    fn bits(&mut self, n: u32) -> Result<u32, String> {
        let mut v = 0;
        for i in 0..n {
            let byte = *self.b.get(self.pos / 8).ok_or("dữ liệu VDD bị cắt")?;
            v |= (((byte >> (self.pos % 8)) & 1) as u32) << i;
            self.pos += 1;
        }
        Ok(v)
    }

    fn delta(&mut self) -> Result<Delta, String> {
        let mut d: i32 = 0;
        if self.bits(1)? == 1 {
            if self.bits(1)? == 1 {
                d = self.bits(1)? as i32 + 1;
            }
        } else if self.bits(1)? == 1 {
            d = if self.bits(1)? == 0 { self.bits(1)? as i32 + 3 } else { self.bits(2)? as i32 + 5 };
        } else if self.bits(1)? == 1 {
            d = if self.bits(1)? == 0 { self.bits(3)? as i32 + 9 } else { self.bits(4)? as i32 + 17 };
        } else if self.bits(1)? == 1 {
            d = if self.bits(1)? == 0 { self.bits(5)? as i32 + 33 } else { self.bits(6)? as i32 + 65 };
        } else {
            return Ok(Delta::Zeros(self.bits(8)? as usize + 7));
        }
        if d != 0 && self.bits(1)? == 0 {
            d = -d;
        }
        Ok(Delta::Value(d))
    }
}

fn encode_png(w: u32, h: u32, frames: &[(Vec<u8>, f64)], loops: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        if frames.len() > 1 {
            enc.set_animated(frames.len() as u32, loops).map_err(|e| e.to_string())?;
        }
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        for (data, duration) in frames {
            if frames.len() > 1 {
                let ms = (duration * 1000.0).round().clamp(1.0, 65535.0) as u16;
                writer.set_frame_delay(ms, 1000).map_err(|e| e.to_string())?;
            }
            writer.write_image_data(data).map_err(|e| e.to_string())?;
        }
        writer.finish().map_err(|e| e.to_string())?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Packs bits LSB-first, the order VDD streams use.
    fn pack(bits: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; bits.len().div_ceil(8)];
        for (i, &b) in bits.iter().enumerate() {
            out[i / 8] |= b << (i % 8);
        }
        out
    }

    #[test]
    fn vdd_prefix_codes() {
        let bits = [
            0, 1, 1, 1, 0, 1, // +6: "011", (6-5)=1 in 2 bits LSB-first, sign +
            0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, // run of 7+3 zeros
            1, 1, 1, 0, // -2: "11", (2-1)=1, sign -
        ];
        let words = pack(&bits);
        let mut r = BitReader { b: &words, pos: 0 };
        let mut v: u8 = 0;
        let mut out = Vec::new();
        while out.len() < 12 {
            match r.delta().unwrap() {
                Delta::Value(d) => {
                    v = v.wrapping_add(d as u8);
                    out.push(v);
                }
                Delta::Zeros(k) => out.extend(std::iter::repeat_n(v, k)),
            }
        }
        assert_eq!(out, [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 4]);
    }

    /// Decodes the premade avatars when a veadotube folder is available locally.
    #[test]
    fn decodes_bundled_samples() {
        let Ok(dir) = std::env::var("VEADO_DIR") else { return };
        let data = std::fs::read(Path::new(&dir).join("lib/data.bin")).unwrap();
        let avatars = bundled_avatars(&data).unwrap();
        assert_eq!(avatars.len(), 4);
        for (name, bytes) in avatars {
            let a = parse_avatar(&bytes, name.clone()).unwrap();
            assert!(!a.states.is_empty(), "{name}");
            assert!(!a.images.is_empty(), "{name}");
        }
    }
}
