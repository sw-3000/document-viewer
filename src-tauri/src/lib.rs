mod commands;
mod pdf_io;

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

pub struct AppState {
    pub pending_startup_files: Mutex<HashMap<String, Vec<String>>>,
    pub next_window_id: AtomicU64,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_paths: Vec<String> = pdf_io::parse_cli_pdf_args(std::env::args_os())
        .into_iter()
        .map(|p| p.display().to_string())
        .collect();

    let mut initial_map = HashMap::new();
    if !startup_paths.is_empty() {
        initial_map.insert("main".to_string(), startup_paths);
    }

    let state = AppState {
        pending_startup_files: Mutex::new(initial_map),
        next_window_id: AtomicU64::new(1),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::get_startup_files,
            commands::pick_pdf_files,
            commands::inspect_pdf_file,
            commands::read_pdf_bytes,
            commands::spawn_new_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Document Viewer");
}
