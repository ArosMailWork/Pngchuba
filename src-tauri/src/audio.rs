//! Microphone capture: reads the selected input device with cpal, optionally
//! denoises it with nnnoiseless (RNNoise port) and publishes the loudness
//! to the frontend as a `mic-level` event (dBFS, ~60 times per second).

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

/// Lowest level we report; anything quieter is treated as silence.
const FLOOR_DB: f32 = -100.0;
const EMIT_INTERVAL: Duration = Duration::from_millis(16);
/// RNNoise only works on 48 kHz audio.
const DENOISE_RATE: u32 = 48_000;

#[derive(Default)]
pub struct AudioState {
    stop_tx: Mutex<Option<Sender<()>>>,
    noise_reduction: Arc<AtomicBool>,
    /// Loudest RMS (f32 bits) seen since the last emit.
    peak_rms: Arc<AtomicU32>,
    emitter_started: AtomicBool,
}

#[derive(Serialize)]
pub struct InputDevice {
    id: String,
    name: String,
}

#[derive(Serialize)]
pub struct MicInfo {
    name: String,
    sample_rate: u32,
    /// false when noise reduction was requested but the device is not 48 kHz.
    denoise_supported: bool,
}

#[tauri::command]
pub fn list_input_devices() -> Result<Vec<InputDevice>, String> {
    let host = cpal::default_host();
    let devices = host.input_devices().map_err(|e| e.to_string())?;
    Ok(devices
        .filter_map(|d| {
            Some(InputDevice {
                id: d.id().ok()?.to_string(),
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
    let device = match device_id {
        Some(id) => {
            let id = id.parse().map_err(|_| "invalid device id".to_string())?;
            host.device_by_id(&id).ok_or("device not found")?
        }
        None => host.default_input_device().ok_or("no input device")?,
    };
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    let info = MicInfo {
        name: device.to_string(),
        sample_rate: config.sample_rate(),
        denoise_supported: config.sample_rate() == DENOISE_RATE,
    };

    // cpal streams are not Send on every platform, so each stream lives on
    // its own thread until we ask it to stop.
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let nr = state.noise_reduction.clone();
    let peak = state.peak_rms.clone();
    thread::spawn(move || {
        let stream = match config.sample_format() {
            SampleFormat::F32 => build::<f32>(&device, config.into(), nr, peak),
            SampleFormat::I16 => build::<i16>(&device, config.into(), nr, peak),
            SampleFormat::I32 => build::<i32>(&device, config.into(), nr, peak),
            SampleFormat::U16 => build::<u16>(&device, config.into(), nr, peak),
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
    thread::spawn(move || loop {
        thread::sleep(EMIT_INTERVAL);
        let rms = f32::from_bits(peak.swap(0, Ordering::Relaxed));
        let db = if rms > 0.0 {
            (20.0 * rms.log10()).max(FLOOR_DB)
        } else {
            FLOOR_DB
        };
        let _ = app.emit("mic-level", db);
        app.state::<crate::server::ServerState>().publish_level(db);
    });
}

fn build<T>(
    device: &Device,
    config: cpal::StreamConfig,
    noise_reduction: Arc<AtomicBool>,
    peak: Arc<AtomicU32>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = config.channels.max(1) as usize;
    let can_denoise = config.sample_rate == DENOISE_RATE;
    let mut denoiser = DenoiseState::new();
    let mut frame_in: Vec<f32> = Vec::with_capacity(DenoiseState::FRAME_SIZE);
    let mut frame_out = vec![0.0f32; DenoiseState::FRAME_SIZE];

    let callback = move |data: &[T], _: &cpal::InputCallbackInfo| {
        let mono = data.chunks(channels).map(|frame| {
            frame.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / channels as f32
        });

        if can_denoise && noise_reduction.load(Ordering::Relaxed) {
            for s in mono {
                // RNNoise expects samples in 16-bit integer range.
                frame_in.push(s * 32768.0);
                if frame_in.len() == DenoiseState::FRAME_SIZE {
                    denoiser.process_frame(&mut frame_out, &frame_in);
                    frame_in.clear();
                    record_peak(&peak, rms(frame_out.iter().map(|s| s / 32768.0)));
                }
            }
        } else {
            frame_in.clear();
            record_peak(&peak, rms(mono));
        }
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
