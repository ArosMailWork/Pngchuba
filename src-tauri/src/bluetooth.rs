//! Bluetooth headset microphone detection (Windows Core Audio).
//!
//! Opening a Bluetooth headset mic makes Windows switch the headset from A2DP
//! (stereo, 44.1/48 kHz) to the hands-free profile (mono, 16 kHz), so
//! everything the user hears through it gets worse. The app therefore never
//! opens such a mic implicitly (as the "system default"). Only listing
//! endpoint properties here; nothing is opened.

use std::collections::HashSet;

/// Endpoint ids (same strings as cpal's WASAPI `DeviceId::id()`) of capture
/// devices that are Bluetooth headsets.
#[cfg(windows)]
pub fn bluetooth_inputs() -> HashSet<String> {
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::{
        DEVICE_STATE_ACTIVE, IMMDeviceEnumerator, MMDeviceEnumerator, eCapture,
    };
    use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, STGM_READ};
    use windows::core::GUID;

    /// DEVPKEY_Device_EnumeratorName: "BTHENUM" / "BTHHFENUM" for Bluetooth audio.
    const PKEY_ENUMERATOR_NAME: PROPERTYKEY =
        PROPERTYKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 24 };

    let mut out = HashSet::new();
    unsafe {
        // threads that already initialized COM return an error we can ignore
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let Ok(e) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else {
            return out;
        };
        let Ok(coll) = e.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE) else { return out };
        for i in 0..coll.GetCount().unwrap_or(0) {
            let Ok(dev) = coll.Item(i) else { continue };
            let Some(id) = dev.GetId().ok().and_then(|p| p.to_string().ok()) else { continue };
            let Ok(store) = dev.OpenPropertyStore(STGM_READ) else { continue };
            let name = store.GetValue(&PKEY_Device_FriendlyName).map(|v| v.to_string()).unwrap_or_default();
            let enumerator = store.GetValue(&PKEY_ENUMERATOR_NAME).map(|v| v.to_string()).unwrap_or_default();
            // the enumerator is authoritative; the name covers drivers that hide it
            if enumerator.to_ascii_uppercase().starts_with("BTH") || name.contains("Hands-Free") {
                out.insert(id);
            }
        }
    }
    out
}

#[cfg(not(windows))]
pub fn bluetooth_inputs() -> HashSet<String> {
    HashSet::new()
}

#[cfg(test)]
mod tests {
    #[test]
    fn lists_bluetooth_inputs() {
        let host = cpal::default_host();
        let bt = super::bluetooth_inputs();
        use cpal::traits::{DeviceTrait, HostTrait};
        for d in host.input_devices().unwrap() {
            let id = d.id().map(|i| i.id().to_string()).unwrap_or_default();
            eprintln!("{} bluetooth={}", d, bt.contains(&id));
        }
    }
}
