use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

const MAX_RECENT_DOCUMENTS: usize = 500;
const SETTINGS_FILE: &str = "settings.json";
const READING_STATE_FILE: &str = "reading_state.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub resume_last_page: bool,
    pub default_view_mode: String,
    pub default_zoom_mode: String,
    pub default_cover_offset: bool,
    pub theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            resume_last_page: true,
            default_view_mode: "continuous".to_string(),
            default_zoom_mode: "fit-width".to_string(),
            default_cover_offset: true,
            theme: "system".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReadingState {
    pub doc_hash: String,
    pub file_path: String,
    pub file_name: String,
    pub total_pages: u32,
    pub page_number: u32,
    pub scroll_offset_ratio: f64,
    pub view_mode: String,
    pub cover_offset: bool,
    pub zoom_mode: String,
    pub zoom_scale: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expanded_toc_ids: Option<Vec<String>>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentDocumentItem {
    #[serde(flatten)]
    pub state: DocumentReadingState,
    pub exists: bool,
}

fn write_json_atomic<T: Serialize + ?Sized>(path: &Path, value: &T) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(value)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(&tmp_path, json)?;
    if let Err(err) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(err);
    }
    Ok(())
}

pub fn load_settings_from_dir(config_dir: &Path) -> AppSettings {
    let path = config_dir.join(SETTINGS_FILE);
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<AppSettings>(&bytes).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

pub fn save_settings_to_dir(config_dir: &Path, settings: &AppSettings) -> io::Result<()> {
    let path = config_dir.join(SETTINGS_FILE);
    write_json_atomic(&path, settings)
}

fn read_all_states(config_dir: &Path) -> Vec<DocumentReadingState> {
    let path = config_dir.join(READING_STATE_FILE);
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<Vec<DocumentReadingState>>(&bytes).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn write_all_states(config_dir: &Path, states: &[DocumentReadingState]) -> io::Result<()> {
    let path = config_dir.join(READING_STATE_FILE);
    write_json_atomic(&path, states)
}

pub fn load_reading_state_from_dir(
    config_dir: &Path,
    doc_hash: &str,
    file_path: &str,
) -> Option<DocumentReadingState> {
    let states = read_all_states(config_dir);
    if let Some(found) = states.iter().find(|s| s.doc_hash == doc_hash) {
        return Some(found.clone());
    }
    let lower_path = file_path.to_lowercase();
    states
        .into_iter()
        .find(|s| s.file_path.to_lowercase() == lower_path)
}

pub fn save_reading_state_to_dir(
    config_dir: &Path,
    entry: DocumentReadingState,
) -> io::Result<()> {
    let mut states = read_all_states(config_dir);
    let lower_path = entry.file_path.to_lowercase();
    states.retain(|s| s.doc_hash != entry.doc_hash && s.file_path.to_lowercase() != lower_path);
    states.push(entry);

    states.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    if states.len() > MAX_RECENT_DOCUMENTS {
        states.truncate(MAX_RECENT_DOCUMENTS);
    }

    write_all_states(config_dir, &states)
}

pub fn list_recent_documents_from_dir(
    config_dir: &Path,
    limit: usize,
) -> Vec<RecentDocumentItem> {
    let mut states = read_all_states(config_dir);
    states.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    states
        .into_iter()
        .take(limit)
        .map(|state| {
            let exists = Path::new(&state.file_path).exists();
            RecentDocumentItem { state, exists }
        })
        .collect()
}

pub fn remove_recent_document_from_dir(config_dir: &Path, doc_hash: &str) -> io::Result<()> {
    let mut states = read_all_states(config_dir);
    states.retain(|s| s.doc_hash != doc_hash);
    write_all_states(config_dir, &states)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_config_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("doc_viewer_storage_tests")
            .join(format!("{}_{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_state(hash: &str, path: &str, page: u32, ts: u64) -> DocumentReadingState {
        DocumentReadingState {
            doc_hash: hash.to_string(),
            file_path: path.to_string(),
            file_name: "sample.pdf".to_string(),
            total_pages: 120,
            page_number: page,
            scroll_offset_ratio: 0.25,
            view_mode: "continuous".to_string(),
            cover_offset: true,
            zoom_mode: "fit-width".to_string(),
            zoom_scale: 1.25,
            expanded_toc_ids: None,
            updated_at_ms: ts,
        }
    }

    #[test]
    fn settings_roundtrip_with_defaults() {
        let dir = temp_config_dir("settings");
        assert_eq!(load_settings_from_dir(&dir), AppSettings::default());

        let updated = AppSettings {
            resume_last_page: false,
            default_view_mode: "two-page".to_string(),
            default_zoom_mode: "fit-page".to_string(),
            default_cover_offset: false,
            theme: "dark".to_string(),
        };
        save_settings_to_dir(&dir, &updated).unwrap();
        assert_eq!(load_settings_from_dir(&dir), updated);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_state_lookup_matches_hash_then_case_insensitive_path() {
        let dir = temp_config_dir("lookup");
        let s1 = make_state("hash-abc", r"E:\Books\Manual.pdf", 42, 1000);
        save_reading_state_to_dir(&dir, s1).unwrap();

        // Exact hash match even if file moved
        let by_hash = load_reading_state_from_dir(&dir, "hash-abc", r"D:\Moved\Manual.pdf")
            .expect("should find by hash");
        assert_eq!(by_hash.page_number, 42);

        // Fallback case-insensitive path match if hash changed after minor metadata edit
        let by_path = load_reading_state_from_dir(&dir, "hash-other", r"e:\books\manual.pdf")
            .expect("should fallback to case-insensitive path");
        assert_eq!(by_path.page_number, 42);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn caps_recent_documents_at_500_sorted_by_recency() {
        let dir = temp_config_dir("lru");
        for i in 0..510u64 {
            let st = make_state(&format!("h-{i}"), &format!(r"E:\Docs\doc_{i}.pdf"), 1, i);
            save_reading_state_to_dir(&dir, st).unwrap();
        }

        let all = list_recent_documents_from_dir(&dir, 600);
        assert_eq!(all.len(), MAX_RECENT_DOCUMENTS);
        assert_eq!(all[0].state.doc_hash, "h-509");
        assert_eq!(all[499].state.doc_hash, "h-10");

        remove_recent_document_from_dir(&dir, "h-509").unwrap();
        let after_remove = list_recent_documents_from_dir(&dir, 5);
        assert_eq!(after_remove[0].state.doc_hash, "h-508");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn deserializes_legacy_reading_state_without_expanded_toc_ids() {
        let dir = temp_config_dir("legacy_toc");
        let legacy_json = r#"[
  {
    "docHash": "legacy-hash",
    "filePath": "E:\\Books\\Legacy.pdf",
    "fileName": "Legacy.pdf",
    "totalPages": 100,
    "pageNumber": 12,
    "scrollOffsetRatio": 0.4,
    "viewMode": "continuous",
    "coverOffset": true,
    "zoomMode": "fit-width",
    "zoomScale": 1.1,
    "updatedAtMs": 5000
  }
]"#;
        fs::write(dir.join(READING_STATE_FILE), legacy_json).unwrap();
        let loaded = load_reading_state_from_dir(&dir, "legacy-hash", r"E:\Books\Legacy.pdf")
            .expect("legacy state should deserialize");
        assert_eq!(loaded.page_number, 12);
        assert_eq!(loaded.expanded_toc_ids, None);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn persists_expanded_toc_ids_including_explicit_empty_list() {
        let dir = temp_config_dir("toc_persist");
        let mut with_ids = make_state("toc-1", r"E:\Books\One.pdf", 5, 100);
        with_ids.expanded_toc_ids = Some(vec!["0".to_string(), "1".to_string(), "1.10".to_string()]);
        save_reading_state_to_dir(&dir, with_ids).unwrap();

        let loaded_ids = load_reading_state_from_dir(&dir, "toc-1", r"E:\Books\One.pdf")
            .unwrap()
            .expanded_toc_ids;
        assert_eq!(
            loaded_ids,
            Some(vec!["0".to_string(), "1".to_string(), "1.10".to_string()])
        );

        let mut all_collapsed = make_state("toc-2", r"E:\Books\Two.pdf", 8, 200);
        all_collapsed.expanded_toc_ids = Some(Vec::new());
        save_reading_state_to_dir(&dir, all_collapsed).unwrap();

        let loaded_empty = load_reading_state_from_dir(&dir, "toc-2", r"E:\Books\Two.pdf")
            .unwrap()
            .expanded_toc_ids;
        assert_eq!(loaded_empty, Some(Vec::new()));

        let _ = fs::remove_dir_all(&dir);
    }
}
