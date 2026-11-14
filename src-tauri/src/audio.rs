//! Microphone capture: reads the selected input device with cpal, optionally
//! denoises it with nnnoiseless (RNNoise port, any device rate: resampled to
//! 48 kHz first) and publishes `mic-level` events ~60 times per second:
//! loudness (dBFS) plus the first two formants for vowel lip-sync.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, SizedSample};
use nnnoiseless::DenoiseState;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::formants::{self, FormantTracker, Resampler};

/// Lowest level we report; anything quieter is treated as silence.
const FLOOR_DB: f32 = -100.0;
const EMIT_INTERVAL: Duration = Duration::from_millis(16);
/// RNNoise works on 48 kHz audio.
const DENOISE_RATE: u32 = 48_000;

#[derive(Default)]
pub struct AudioState {
    stop_tx: Mutex<Option<Sender<()>>>,
    noise_reduction: Arc<AtomicBool>,
    /// Loudest RMS (f32 bits) seen since the last emit.
    peak_rms: Arc<AtomicU32>,
    /// Latest formants (f32 bits), 0 = none.
    f1: Arc<AtomicU32>,
    f2: Arc<AtomicU32>,
    emitter_started: AtomicBool,
}

#[derive(Serialize)]
pub struct InputDevice {
    id: String,
    name: String,
    /// Bluetooth headset mic: opening it degrades the headset audio
    bluetooth: bool,
}

#[derive(Serialize)]
pub struct MicInfo {
    name: String,
    sample_rate: u32,
    /// the open mic is a Bluetooth headset (chosen explicitly)
    bluetooth: bool,
    /// the system default mic is a Bluetooth headset, so nothing was opened
    blocked: bool,
}

#[derive(Serialize, Clone, Copy)]
pub struct Level {
    db: f32,
    f1: f32,
    f2: f32,
}

#[tauri::command]
pub fn list_input_devices() -> Result<Vec<InputDevice>, String> {
    let host = cpal::default_host();
    let devices = host.input_devices().map_err(|e| e.to_string())?;
    let bt = crate::bluetooth::bluetooth_inputs();
    Ok(devices
        .filter_map(|d| {
            let id = d.id().ok()?;
            Some(InputDevice {
                bluetooth: bt.contains(id.id()),
                id: id.to_string(),
                name: d.to_string(),
            })
        })
        .collect())
}

#[tauri::command]
pub fn set_noise_reduction(state: State<AudioState>, enabled: bool) {
    state.noise_reduction.store(enabled, Ordering::Relaxed);
}

/// (Re)starts capturing from `device_id`, or the system default when `None`.
#[tauri::command]
pub fn start_mic(
    app: AppHandle,
    state: State<AudioState>,
    device_id: Option<String>,
    noise_reduction: bool,
) -> Result<MicInfo, String> {
    stop_current(&state);
    state.noise_reduction.store(noise_reduction, Ordering::Relaxed);
    start_emitter(&app, &state);

    let host = cpal::default_host();
    let explicit = device_id.is_some();
    let device = match device_id {
        Some(id) => {
            let id = id.parse().map_err(|_| "invalid device id".to_string())?;
            host.device_by_id(&id).ok_or("device not found")?
        }
        None => host.default_input_device().ok_or("no input device")?,
    };
    // A Bluetooth headset mic switches the headset to hands-free quality while
    // open: never open it just because it is the system default.
    let bluetooth = device
        .id()
        .map(|id| crate::bluetooth::bluetooth_inputs().contains(id.id()))
        .unwrap_or(false);
    if bluetooth && !explicit {
        return Ok(MicInfo { name: device.to_string(), sample_rate: 0, bluetooth, blocked: true });
    }
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    let info = MicInfo {
        name: device.to_string(),
        sample_rate: config.sample_rate(),
        bluetooth,
        blocked: false,
    };

    // cpal streams are not Send on every platform, so each stream lives on
    // its own thread until we ask it to stop.
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let nr = state.noise_reduction.clone();
    let out = Outputs { peak: state.peak_rms.clone(), f1: state.f1.clone(), f2: state.f2.clone() };
    thread::spawn(move || {
        let stream = match config.sample_format() {
            SampleFormat::F32 => build::<f32>(&device, config.into(), nr, out.clone()),
            SampleFormat::I16 => build::<i16>(&device, config.into(), nr, out.clone()),
            SampleFormat::I32 => build::<i32>(&device, config.into(), nr, out.clone()),
            SampleFormat::U16 => build::<u16>(&device, config.into(), nr, out.clone()),
            f => Err(format!("unsupported sample format {f}")),
        };
        let stream = match stream.and_then(|s| s.play().map(|_| s).map_err(|e| e.to_string())) {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(e));
                return;
            }
        };
        let _ = ready_tx.send(Ok(()));
        let _ = stop_rx.recv(); // blocks until stopped or sender dropped
        drop(stream);
    });

    ready_rx.recv().map_err(|e| e.to_string())??;
    *state.stop_tx.lock().unwrap() = Some(stop_tx);
    Ok(info)
}

#[tauri::command]
pub fn stop_mic(state: State<AudioState>) {
    stop_current(&state);
}

fn stop_current(state: &AudioState) {
    if let Some(tx) = state.stop_tx.lock().unwrap().take() {
        let _ = tx.send(());
    }
}

/// One background thread forwards the peak level to the UI at a fixed rate,
/// so the audio callback never touches the event system.
fn start_emitter(app: &AppHandle, state: &AudioState) {
    if state.emitter_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    let peak = state.peak_rms.clone();
    let (f1, f2) = (state.f1.clone(), state.f2.clone());
    thread::spawn(move || loop {
        thread::sleep(EMIT_INTERVAL);
        let rms = f32::from_bits(peak.swap(0, Ordering::Relaxed));
        let db = if rms > 0.0 {
            (20.0 * rms.log10()).max(FLOOR_DB)
        } else {
            FLOOR_DB
        };
        let level = Level {
            db,
            f1: f32::from_bits(f1.load(Ordering::Relaxed)),
            f2: f32::from_bits(f2.load(Ordering::Relaxed)),
        };
        let _ = app.emit("mic-level", level);
        app.state::<crate::server::ServerState>().publish_level(level.db, level.f1, level.f2);
    });
}

/// Where the audio callback writes its results.
#[derive(Clone)]
struct Outputs {
    peak: Arc<AtomicU32>,
    f1: Arc<AtomicU32>,
    f2: Arc<AtomicU32>,
}

fn build<T>(
    device: &Device,
    config: cpal::StreamConfig,
    noise_reduction: Arc<AtomicBool>,
    out: Outputs,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = config.channels.max(1) as usize;
    let rate = config.sample_rate;
    let mut to_48k = Resampler::new(rate, DENOISE_RATE);
    let mut raw_to_16k = Resampler::new(rate, formants::RATE);
    let mut clean_to_16k = Resampler::new(DENOISE_RATE, formants::RATE);
    let mut tracker = FormantTracker::default();
    let mut denoiser = DenoiseState::new();
    let mut frame_in: Vec<f32> = Vec::with_capacity(DenoiseState::FRAME_SIZE);
    let mut frame_out = vec![0.0f32; DenoiseState::FRAME_SIZE];
    let mut mono: Vec<f32> = Vec::new();

    let callback = move |data: &[T], _: &cpal::InputCallbackInfo| {
        mono.clear();
        mono.extend(data.chunks(channels).map(|frame| {
            frame.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / channels as f32
        }));

        if noise_reduction.load(Ordering::Relaxed) {
            for &s in &mono {
                to_48k.push(s, |s48| {
                    // RNNoise expects samples in 16-bit integer range.
                    frame_in.push(s48 * 32768.0);
                    if frame_in.len() == DenoiseState::FRAME_SIZE {
                        denoiser.process_frame(&mut frame_out, &frame_in);
                        frame_in.clear();
                        record_peak(&out.peak, rms(frame_out.iter().map(|s| s / 32768.0)));
                        for &c in &frame_out {
                            clean_to_16k.push(c / 32768.0, |x| tracker.push(x));
                        }
                    }
                });
            }
        } else {
            frame_in.clear();
            record_peak(&out.peak, rms(mono.iter().copied()));
            for &s in &mono {
                raw_to_16k.push(s, |x| tracker.push(x));
            }
        }
        let (f1, f2) = tracker.latest();
        out.f1.store(f1.to_bits(), Ordering::Relaxed);
        out.f2.store(f2.to_bits(), Ordering::Relaxed);
    };

    device
        .build_input_stream::<T, _, _>(
            config,
            callback,
            |e| eprintln!("mic stream error: {e}"),
            None,
        )
        .map_err(|e| e.to_string())
}

fn rms(samples: impl Iterator<Item = f32>) -> f32 {
    let (sum, n) = samples.fold((0.0f32, 0u32), |(sum, n), s| (sum + s * s, n + 1));
    if n == 0 { 0.0 } else { (sum / n as f32).sqrt() }
}

fn record_peak(peak: &AtomicU32, value: f32) {
    let _ = peak.try_update(Ordering::Relaxed, Ordering::Relaxed, |cur| {
        (value > f32::from_bits(cur)).then_some(value.to_bits())
    });
}
