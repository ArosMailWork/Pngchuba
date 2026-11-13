//! Avatar library: one `<id>.pngtubah` JSON file per avatar in the app data folder.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct LibraryItem {
    id: String,
    name: String,
    thumb: Option<String>,
    modified: u64,
}

/// Only the fields the library screen needs; the rest of the file is skipped.
#[derive(Deserialize)]
struct Head {
    #[serde(default)]
    name: String,
    #[serde(default)]
    thumb: Option<String>,
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("avatars");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("id không hợp lệ".into());
    }
    Ok(dir(app)?.join(format!("{id}.pngtubah")))
}

#[tauri::command]
pub async fn library_list(app: AppHandle) -> Result<Vec<LibraryItem>, String> {
    let mut items = Vec::new();
    for entry in fs::read_dir(dir(&app)?).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|e| e != "pngtubah") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(head) = serde_json::from_str::<Head>(&text) else { continue };
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs());
        items.push(LibraryItem {
            id: path.file_stem().unwrap().to_string_lossy().into_owned(),
            name: head.name,
            thumb: head.thumb,
            modified,
        });
    }
    items.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(items)
}

#[tauri::command]
pub async fn library_load(app: AppHandle, id: String) -> Result<String, String> {
    fs::read_to_string(file(&app, &id)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn library_save(app: AppHandle, id: String, json: String) -> Result<(), String> {
    // write then rename, so a crash never leaves a half-written avatar
    let path = file(&app, &id)?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn library_delete(app: AppHandle, id: String) -> Result<(), String> {
    fs::remove_file(file(&app, &id)?).map_err(|e| e.to_string())
}
