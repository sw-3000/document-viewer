use crate::pdf_io::{self, PdfFileMetadata};
use crate::AppState;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State, WebviewUrl, WebviewWindowBuilder};

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

#[tauri::command]
pub fn spawn_new_window(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: Option<String>,
) -> Result<(), String> {
    let id = state.next_window_id.fetch_add(1, Ordering::Relaxed);
    let label = format!("viewer-{id}");

    if let Some(path) = file_path {
        let mut map = state
            .pending_startup_files
            .lock()
            .expect("startup files mutex poisoned");
        map.insert(label.clone(), vec![path]);
    }

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Document Viewer")
        .inner_size(1120.0, 820.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        .build()
        .map_err(|e| format!("Failed to open new window: {e}"))?;

    Ok(())
}
