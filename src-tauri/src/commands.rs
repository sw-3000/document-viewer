use crate::pdf_io::{self, PdfFileMetadata};
use crate::storage::{
    self, AppSettings, DocumentReadingState, RecentDocumentItem,
};
use crate::win_assoc::{self, FileAssociationStatus};
use crate::AppState;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub fn get_startup_files(window: tauri::Window, state: State<'_, AppState>) -> Vec<String> {
    let mut map = state
        .pending_startup_files
        .lock()
        .expect("startup files mutex poisoned");
    map.remove(window.label()).unwrap_or_default()
}

#[tauri::command]
pub async fn pick_pdf_files(window: tauri::Window) -> Result<Vec<String>, String> {
    let files = rfd::AsyncFileDialog::new()
        .set_title("Open PDF Document")
        .add_filter("PDF Documents", &["pdf"])
        .set_parent(&window)
        .pick_files()
        .await;

    Ok(files
        .unwrap_or_default()
        .into_iter()
        .map(|handle| {
            pdf_io::normalize_windows_path(handle.path())
                .display()
                .to_string()
        })
        .collect())
}

#[tauri::command]
pub fn inspect_pdf_file(path: String) -> Result<PdfFileMetadata, String> {
    pdf_io::inspect_pdf_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_pdf_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = pdf_io::read_pdf_bytes_validated(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

pub(crate) fn format_window_label(id: u64) -> String {
    format!("viewer-{id}")
}

pub(crate) fn normalize_spawn_file_path(file_path: Option<String>) -> Option<String> {
    let raw = file_path?.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    let normalized = pdf_io::normalize_windows_path(std::path::Path::new(&raw));
    Some(normalized.display().to_string())
}

#[tauri::command]
pub async fn spawn_new_window(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: Option<String>,
) -> Result<(), String> {
    let id = state.next_window_id.fetch_add(1, Ordering::Relaxed);
    let label = format_window_label(id);
    let normalized_path = normalize_spawn_file_path(file_path);

    if let Some(ref path) = normalized_path {
        let mut map = state
            .pending_startup_files
            .lock()
            .expect("startup files mutex poisoned");
        map.insert(label.clone(), vec![path.clone()]);
    }

    let build_result = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Document Viewer")
        .inner_size(1120.0, 820.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        .shadow(true)
        .build();

    if let Err(err) = build_result {
        let mut map = state
            .pending_startup_files
            .lock()
            .expect("startup files mutex poisoned");
        map.remove(&label);
        return Err(format!("Failed to open new window: {err}"));
    }

    Ok(())
}

#[tauri::command]
pub fn load_settings(app: AppHandle, state: State<'_, AppState>) -> Result<AppSettings, String> {
    let _guard = state.storage_lock.lock().expect("storage mutex poisoned");
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve %APPDATA% config directory: {e}"))?;
    Ok(storage::load_settings_from_dir(&config_dir))
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    let _guard = state.storage_lock.lock().expect("storage mutex poisoned");
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve %APPDATA% config directory: {e}"))?;
    storage::save_settings_to_dir(&config_dir, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_reading_state(
    app: AppHandle,
    state: State<'_, AppState>,
    doc_hash: String,
    file_path: String,
) -> Result<Option<DocumentReadingState>, String> {
    let _guard = state.storage_lock.lock().expect("storage mutex poisoned");
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve %APPDATA% config directory: {e}"))?;
    Ok(storage::load_reading_state_from_dir(
        &config_dir,
        &doc_hash,
        &file_path,
    ))
}

#[tauri::command]
pub fn save_reading_state(
    app: AppHandle,
    state: State<'_, AppState>,
    reading_state: DocumentReadingState,
) -> Result<(), String> {
    let _guard = state.storage_lock.lock().expect("storage mutex poisoned");
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve %APPDATA% config directory: {e}"))?;
    storage::save_reading_state_to_dir(&config_dir, reading_state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_recent_documents(
    app: AppHandle,
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<RecentDocumentItem>, String> {
    let _guard = state.storage_lock.lock().expect("storage mutex poisoned");
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve %APPDATA% config directory: {e}"))?;
    Ok(storage::list_recent_documents_from_dir(
        &config_dir,
        limit.unwrap_or(10),
    ))
}

#[tauri::command]
pub fn remove_recent_document(
    app: AppHandle,
    state: State<'_, AppState>,
    doc_hash: String,
) -> Result<(), String> {
    let _guard = state.storage_lock.lock().expect("storage mutex poisoned");
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve %APPDATA% config directory: {e}"))?;
    storage::remove_recent_document_from_dir(&config_dir, &doc_hash).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_file_association_status() -> FileAssociationStatus {
    win_assoc::get_status()
}

#[tauri::command]
pub fn register_default_pdf_viewer() -> Result<FileAssociationStatus, String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to determine executable path: {e}"))?;
    let normalized = pdf_io::normalize_windows_path(&exe_path);
    win_assoc::register_and_open_default_apps(&normalized)
        .map_err(|e| format!("Failed to register PDF handler: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_unique_window_labels() {
        assert_eq!(format_window_label(1), "viewer-1");
        assert_eq!(format_window_label(42), "viewer-42");
        assert_ne!(format_window_label(1), format_window_label(2));
    }

    #[test]
    fn normalizes_spawn_file_paths_cleanly() {
        assert_eq!(normalize_spawn_file_path(None), None);
        assert_eq!(normalize_spawn_file_path(Some("   ".to_string())), None);
        assert_eq!(
            normalize_spawn_file_path(Some(r" \\?\E:\Books\Guide.pdf ".to_string())),
            Some(r"E:\Books\Guide.pdf".to_string())
        );
    }
}
