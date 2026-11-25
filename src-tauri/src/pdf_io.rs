use serde::Serialize;
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const HEADER_SEARCH_LIMIT: usize = 1024;
const HASH_CHUNK_SIZE: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PdfFileMetadata {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub doc_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdfIoError {
    NotFound(String),
    PermissionDenied(String),
    EmptyFile(String),
    InvalidPdfHeader(String),
    Io(String),
}

impl std::fmt::Display for PdfIoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(p) => write!(f, "File not found: {p}"),
            Self::PermissionDenied(p) => write!(f, "Permission denied reading file: {p}"),
            Self::EmptyFile(p) => write!(f, "The file is empty and not a valid PDF: {p}"),
            Self::InvalidPdfHeader(p) => {
                write!(f, "Invalid PDF file (missing %PDF- signature): {p}")
            }
            Self::Io(msg) => write!(f, "Failed to read file: {msg}"),
        }
    }
}

impl From<io::Error> for PdfIoError {
    fn from(err: io::Error) -> Self {
        match err.kind() {
            io::ErrorKind::NotFound => Self::NotFound(err.to_string()),
            io::ErrorKind::PermissionDenied => Self::PermissionDenied(err.to_string()),
            _ => Self::Io(err.to_string()),
        }
    }
}

/// Strips Windows verbatim path prefix (`\\?\` or `\\?\UNC\`) for clean UI presentation.
pub fn normalize_windows_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(unc_rest) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc_rest}"));
    }
    if let Some(rest) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

/// Parses CLI arguments after argv[0], skipping flags and normalizing existing PDF paths.
pub fn parse_cli_pdf_args<I>(args: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = OsString>,
{
    let mut results = Vec::new();
    for arg in args.into_iter().skip(1) {
        let s = arg.to_string_lossy();
        if s.is_empty() || s.starts_with('-') {
            continue;
        }
        let candidate = PathBuf::from(&arg);
        if candidate.exists() {
            let resolved = std::fs::canonicalize(&candidate)
                .map(|p| normalize_windows_path(&p))
                .unwrap_or_else(|_| normalize_windows_path(&candidate));
            results.push(resolved);
        } else {
            results.push(normalize_windows_path(&candidate));
        }
    }
    results
}

fn contains_pdf_header(bytes: &[u8]) -> bool {
    bytes.windows(5).any(|w| w == b"%PDF-")
}

/// Computes a fast, collision-resistant partial content SHA-256 over
/// `(file_size_u64_le || first_64kb || last_64kb)` without reading huge PDFs twice.
pub fn compute_doc_hash(file: &mut File, file_size: u64) -> io::Result<String> {
    let mut hasher = Sha256::new();
    hasher.update(file_size.to_le_bytes());

    file.seek(SeekFrom::Start(0))?;
    let mut head_buf = vec![0u8; HASH_CHUNK_SIZE.min(file_size as usize)];
    file.read_exact(&mut head_buf)?;
    hasher.update(&head_buf);

    if file_size as usize > HASH_CHUNK_SIZE {
        let tail_start = file_size - HASH_CHUNK_SIZE as u64;
        file.seek(SeekFrom::Start(tail_start))?;
        let mut tail_buf = vec![0u8; HASH_CHUNK_SIZE];
        file.read_exact(&mut tail_buf)?;
        hasher.update(&tail_buf);
    }

    Ok(hex::encode(hasher.finalize()))
}

/// Validates read-only access and `%PDF-` signature, returning normalized metadata & content hash.
pub fn inspect_pdf_file(path_str: &str) -> Result<PdfFileMetadata, PdfIoError> {
    let raw_path = Path::new(path_str);
    if !raw_path.exists() {
        return Err(PdfIoError::NotFound(path_str.to_string()));
    }

    let normalized = std::fs::canonicalize(raw_path)
        .map(|p| normalize_windows_path(&p))
        .unwrap_or_else(|_| normalize_windows_path(raw_path));

    let mut file = File::open(&normalized).map_err(|e| match e.kind() {
        io::ErrorKind::NotFound => PdfIoError::NotFound(normalized.display().to_string()),
        io::ErrorKind::PermissionDenied => {
            PdfIoError::PermissionDenied(normalized.display().to_string())
        }
        _ => PdfIoError::Io(e.to_string()),
    })?;

    let metadata = file.metadata()?;
    let file_size = metadata.len();
    if file_size == 0 {
        return Err(PdfIoError::EmptyFile(normalized.display().to_string()));
    }

    let header_len = HEADER_SEARCH_LIMIT.min(file_size as usize);
    let mut header_buf = vec![0u8; header_len];
    file.read_exact(&mut header_buf)?;
    if !contains_pdf_header(&header_buf) {
        return Err(PdfIoError::InvalidPdfHeader(
            normalized.display().to_string(),
        ));
    }

    let doc_hash = compute_doc_hash(&mut file, file_size)?;
    let file_name = normalized
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| normalized.display().to_string());

    Ok(PdfFileMetadata {
        file_path: normalized.display().to_string(),
        file_name,
        file_size,
        doc_hash,
    })
}

/// Validates a PDF file and reads its bytes read-only from disk without mutating the source file.
pub fn read_pdf_bytes_validated(path_str: &str) -> Result<Vec<u8>, PdfIoError> {
    let meta = inspect_pdf_file(path_str)?;
    let bytes = std::fs::read(&meta.file_path)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_test_file(name: &str, content: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join("doc_viewer_pdf_io_tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{}_{}", std::process::id(), name));
        let mut f = File::create(&path).unwrap();
        f.write_all(content).unwrap();
        f.flush().unwrap();
        path
    }

    #[test]
    fn validates_pdf_header_at_start_and_offset() {
        let p1 = temp_test_file("valid_start.pdf", b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
        let meta1 = inspect_pdf_file(p1.to_str().unwrap()).expect("valid header at byte 0");
        assert_eq!(meta1.doc_hash.len(), 64);
        assert!(meta1.file_size > 0);
        let _ = std::fs::remove_file(&p1);

        let mut offset_bytes = vec![b' '; 512];
        offset_bytes.extend_from_slice(b"%PDF-1.4\n%%EOF\n");
        let p2 = temp_test_file("valid_offset.pdf", &offset_bytes);
        inspect_pdf_file(p2.to_str().unwrap()).expect("valid header within first 1024 bytes");
        let _ = std::fs::remove_file(&p2);
    }

    #[test]
    fn rejects_empty_missing_and_non_pdf_files() {
        let missing = std::env::temp_dir().join("definitely_does_not_exist_12345.pdf");
        assert!(matches!(
            inspect_pdf_file(missing.to_str().unwrap()),
            Err(PdfIoError::NotFound(_))
        ));

        let empty = temp_test_file("empty.pdf", b"");
        assert!(matches!(
            inspect_pdf_file(empty.to_str().unwrap()),
            Err(PdfIoError::EmptyFile(_))
        ));
        let _ = std::fs::remove_file(&empty);

        let bad = temp_test_file("bad.pdf", b"<html><body>Not a PDF</body></html>");
        assert!(matches!(
            inspect_pdf_file(bad.to_str().unwrap()),
            Err(PdfIoError::InvalidPdfHeader(_))
        ));
        let _ = std::fs::remove_file(&bad);
    }

    #[test]
    fn computes_distinct_hashes_for_large_files_with_tail_differences() {
        let mut a = vec![b'A'; 200 * 1024];
        a[..8].copy_from_slice(b"%PDF-1.7");
        let mut b = a.clone();
        b[199 * 1024] = b'B';

        let pa = temp_test_file("large_a.pdf", &a);
        let pb = temp_test_file("large_b.pdf", &b);
        let ma = inspect_pdf_file(pa.to_str().unwrap()).unwrap();
        let mb = inspect_pdf_file(pb.to_str().unwrap()).unwrap();
        assert_ne!(ma.doc_hash, mb.doc_hash);
        let _ = std::fs::remove_file(&pa);
        let _ = std::fs::remove_file(&pb);
    }

    #[test]
    fn strips_windows_verbatim_prefix() {
        assert_eq!(
            normalize_windows_path(Path::new(r"\\?\E:\Books\guide.pdf")),
            PathBuf::from(r"E:\Books\guide.pdf")
        );
        assert_eq!(
            normalize_windows_path(Path::new(r"\\?\UNC\server\share\doc.pdf")),
            PathBuf::from(r"\\server\share\doc.pdf")
        );
    }

    #[test]
    fn parses_cli_args_skipping_exe_and_flags() {
        let existing = temp_test_file("cli_arg.pdf", b"%PDF-1.7\n");
        let args = vec![
            OsString::from("document-viewer.exe"),
            OsString::from("--minimized"),
            existing.as_os_str().to_os_string(),
            OsString::from(r"C:\missing\ghost.pdf"),
        ];
        let parsed = parse_cli_pdf_args(args);
        assert_eq!(parsed.len(), 2);
        assert!(!parsed[0].to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(parsed[1], PathBuf::from(r"C:\missing\ghost.pdf"));
        let _ = std::fs::remove_file(&existing);
    }
}
