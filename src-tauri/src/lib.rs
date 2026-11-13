mod audio;
mod library;
mod server;
mod veado;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(audio::AudioState::default())
        .manage(server::ServerState::default())
        .invoke_handler(tauri::generate_handler![
            audio::list_input_devices,
            audio::start_mic,
            audio::stop_mic,
            audio::set_noise_reduction,
            server::server_start,
            server::overlay_publish,
            server::control_send,
            library::library_list,
            library::library_load,
            library::library_save,
            library::library_delete,
            veado::import_veado_file,
            veado::import_veado_samples,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
