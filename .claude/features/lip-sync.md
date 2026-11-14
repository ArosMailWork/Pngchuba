# Vowel lip-sync (a i u e o)

Mouth layers can show a different image per vowel while talking.

## Rust (`src-tauri/src/formants.rs`, used by `audio.rs`)
- Signal (denoised when noise reduction is on, raw otherwise) resampled to 16 kHz.
- `FormantTracker`: 512-sample frames (32 ms), a new estimate every 256 samples. `analyze()`: reject quiet frames (RMS < 0.003) and unvoiced ones (lag-1 autocorrelation / energy < 0.3); pre-emphasis 0.97, Hamming, LPC order 12 (Levinson), envelope 1/|A|^2 sampled 100..4100 Hz every 10 Hz; F1 = first peak in 200..1100 Hz, F2 = next peak > F1+150 in 600..3200 Hz. None -> (0, 0).
- Latest F1/F2 stored in atomics, sent with the level: `mic-level` `{db,f1,f2}` and overlay feed `{"type":"level","db","f1","f2"}`.
- Tests (`cargo test --lib formants`): synthetic vowels (pulse train + resonators) give F2 within 15%, F1 reads ~50 Hz high (within 25%); silence/noise rejected; resampler keeps the rate.

## Frontend
- `src/vowels.ts`: `DEFAULT_PROFILE` (average [F1,F2], already shifted for the analyzer's F1 bias), `classifyVowel` = nearest vowel in log(F1), log(F2); squared distance > 0.25 = no vowel. `medianFormants` for calibration (needs >= 5 voiced samples).
- Engine (`updateVowel` in `engine.ts`): only when `settings.lipSync` and the active range index > 0 (talking). A new vowel must persist 40 ms before it shows; the last vowel is kept through 120 ms gaps, then `runtime.vowel = null`. Image priority: blink > vowel image of the range > sprite > range image. Missing vowel image = normal image.
- Settings (`components/VowelSettings.tsx`, inside SettingsPanel): on/off, live readout (vowel + F1/F2), "Thu A..O" records 1.8 s of formants and stores the median in `settings.vowelProfile[v]`, "Về mặc định" clears it. Profile + switch are sent to the OBS overlay in the `live` message.
- Editor: Inspector "Khẩu hình (<range>)" = 5 image slots per layer per range (`LayerRange.vowels`).
