//! Streaming helpers for the mic: a linear resampler and a formant tracker
//! (F1/F2 from an LPC spectral envelope) used for vowel lip-sync.

use std::f32::consts::PI;

/// Streaming linear-interpolation resampler with a one-pole low-pass in
/// front when downsampling (cheap anti-aliasing, fine for speech).
pub struct Resampler {
    step: f64,
    pos: f64,
    prev: f32,
    lp: f32,
    lp_a: f32,
}

impl Resampler {
    pub fn new(from: u32, to: u32) -> Self {
        let lp_a = if to < from {
            1.0 - (-2.0 * PI * 0.4 * to as f32 / from as f32).exp()
        } else {
            1.0
        };
        Self { step: from as f64 / to as f64, pos: 0.0, prev: 0.0, lp: 0.0, lp_a }
    }

    pub fn push(&mut self, x: f32, mut out: impl FnMut(f32)) {
        self.lp += self.lp_a * (x - self.lp);
        let cur = self.lp;
        while self.pos <= 1.0 {
            out(self.prev + (cur - self.prev) * self.pos as f32);
            self.pos += self.step;
        }
        self.pos -= 1.0;
        self.prev = cur;
    }
}

pub const RATE: u32 = 16_000;
const FRAME: usize = 512; // 32 ms
const HOP: usize = 256; // a new estimate every 16 ms
const ORDER: usize = 12;

/// Collects 16 kHz samples and estimates the first two formants of voiced
/// frames. `latest()` is (0, 0) for silence / unvoiced sounds.
pub struct FormantTracker {
    buf: Vec<f32>,
    fresh: usize,
    latest: (f32, f32),
}

impl Default for FormantTracker {
    fn default() -> Self {
        Self { buf: Vec::with_capacity(FRAME * 2), fresh: 0, latest: (0.0, 0.0) }
    }
}

impl FormantTracker {
    pub fn push(&mut self, x: f32) {
        self.buf.push(x);
        self.fresh += 1;
        if self.buf.len() >= FRAME && self.fresh >= HOP {
            let start = self.buf.len() - FRAME;
            self.latest = analyze(&self.buf[start..]).unwrap_or((0.0, 0.0));
            self.buf.drain(..start + HOP.min(FRAME));
            self.fresh = 0;
        }
    }

    pub fn latest(&self) -> (f32, f32) {
        self.latest
    }
}

/// F1/F2 (Hz) of one 16 kHz frame, or None when it is too quiet or unvoiced.
pub fn analyze(frame: &[f32]) -> Option<(f32, f32)> {
    let n = frame.len();
    let energy = frame.iter().map(|x| x * x).sum::<f32>() / n as f32;
    if energy.sqrt() < 0.003 {
        return None;
    }
    // voiced speech is low-pass dominated: strong lag-1 correlation
    let r0: f32 = frame.iter().map(|x| x * x).sum();
    let r1: f32 = frame.windows(2).map(|w| w[0] * w[1]).sum();
    if r1 / r0 < 0.3 {
        return None;
    }

    // pre-emphasis + Hamming window
    let mut x = vec![0.0f32; n];
    for i in 0..n {
        let pre = frame[i] - if i > 0 { 0.97 * frame[i - 1] } else { 0.0 };
        x[i] = pre * (0.54 - 0.46 * (2.0 * PI * i as f32 / (n - 1) as f32).cos());
    }
    let mut r = [0.0f32; ORDER + 1];
    for (k, rk) in r.iter_mut().enumerate() {
        *rk = (k..n).map(|i| x[i] * x[i - k]).sum();
    }
    r[0] *= 1.0 + 1e-6; // white noise correction
    let a = levinson(&r)?;

    // spectral envelope 1/|A(e^jw)|^2, local maxima = formant candidates
    let step = 10.0;
    let freqs: Vec<f32> = (0..400).map(|i| 100.0 + i as f32 * step).collect();
    let env: Vec<f32> = freqs
        .iter()
        .map(|&f| {
            let w = 2.0 * PI * f / RATE as f32;
            let (mut re, mut im) = (1.0f32, 0.0f32);
            for (k, ak) in a.iter().enumerate() {
                let ph = w * (k + 1) as f32;
                re += ak * ph.cos();
                im -= ak * ph.sin();
            }
            1.0 / (re * re + im * im)
        })
        .collect();
    let peaks: Vec<f32> = (1..env.len() - 1)
        .filter(|&i| env[i] > env[i - 1] && env[i] >= env[i + 1])
        .map(|i| freqs[i])
        .collect();
    let f1 = *peaks.iter().find(|&&f| (200.0..=1100.0).contains(&f))?;
    let f2 = *peaks.iter().find(|&&f| f > f1 + 150.0 && (600.0..=3200.0).contains(&f))?;
    Some((f1, f2))
}

/// LPC coefficients a[1..=ORDER] (A(z) = 1 + sum a_k z^-k) from autocorrelation.
fn levinson(r: &[f32; ORDER + 1]) -> Option<[f32; ORDER]> {
    if r[0] <= 0.0 {
        return None;
    }
    let mut a = [0.0f32; ORDER + 1];
    a[0] = 1.0;
    let mut err = r[0];
    for i in 1..=ORDER {
        let acc: f32 = (0..i).map(|j| a[j] * r[i - j]).sum();
        let k = -acc / err;
        let prev = a;
        for j in 1..i {
            a[j] = prev[j] + k * prev[i - j];
        }
        a[i] = k;
        err *= 1.0 - k * k;
        if err <= 0.0 {
            return None;
        }
    }
    let mut out = [0.0f32; ORDER];
    out.copy_from_slice(&a[1..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Glottal pulse train at 120 Hz through two-pole resonators.
    fn vowel(formants: &[f32]) -> Vec<f32> {
        let fs = RATE as f32;
        let mut x: Vec<f32> = (0..FRAME * 4).map(|i| if i % (RATE as usize / 120) == 0 { 1.0 } else { 0.0 }).collect();
        for &f in formants {
            let bw = 80.0;
            let rr = (-PI * bw / fs).exp();
            let (c1, c2) = (2.0 * rr * (2.0 * PI * f / fs).cos(), -rr * rr);
            let (mut y1, mut y2) = (0.0, 0.0);
            for s in x.iter_mut() {
                let y = *s + c1 * y1 + c2 * y2;
                y2 = y1;
                y1 = y;
                *s = y;
            }
        }
        let peak = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        x.iter().map(|v| v / peak * 0.3).collect()
    }

    #[test]
    fn finds_first_two_formants() {
        for (f1, f2) in [(750.0, 1250.0), (300.0, 2300.0), (350.0, 1300.0), (480.0, 2000.0), (500.0, 900.0)] {
            let x = vowel(&[f1, f2, 2800.0]);
            let (e1, e2) = analyze(&x[FRAME * 2..FRAME * 3]).expect("voiced");
            assert!((e1 - f1).abs() / f1 < 0.25, "F1 {e1} vs {f1}");
            assert!((e2 - f2).abs() / f2 < 0.15, "F2 {e2} vs {f2}");
        }
    }

    #[test]
    fn silence_and_noise_are_rejected() {
        assert!(analyze(&[0.0; FRAME]).is_none());
        let mut seed = 1u32;
        let noise: Vec<f32> = (0..FRAME)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5
            })
            .collect();
        assert!(analyze(&noise).is_none());
    }

    #[test]
    fn resampler_keeps_rate() {
        let mut r = Resampler::new(44_100, 48_000);
        let mut n = 0;
        for _ in 0..44_100 {
            r.push(0.0, |_| n += 1);
        }
        assert!((n as i32 - 48_000).abs() <= 2, "{n}");
    }
}
