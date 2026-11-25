# Document Viewer

A lightweight, fast, distraction-free desktop PDF reader for **Windows 10 / 11 (x64)** built with **Tauri v2 (Rust + WebView2)**, **TypeScript**, **React**, **Tailwind CSS**, and **PDF.js (`pdfjs-dist`)**, inspired by the clean, content-first aesthetic of Apple Preview and GNOME Evince (Papers).

## Features

- **Read-Only In-Place Opening:** Open PDFs via File Open dialog (`Ctrl+O`), drag-and-drop anywhere on the window, Recent Documents, or Windows Explorer CLI double-click—never copying or altering original files.
- **Multi-Document Support:** Minimal tab strip (auto-hidden when only 1 document is open) plus one-click pop-out to separate native windows (`Ctrl+Shift+N`).
- **Encrypted & Corrupt File Handling:** Prompts securely for passwords on encrypted PDFs and displays clear diagnostics on damaged/missing files.
- **View & Zoom Modes:**
  - **Continuous Scroll**, **Single Page**, and **Two Pages** (with optional Separate Cover Page offset).
  - **Fit Width**, **Fit Page**, **Actual Size (100%)**, preset zoom levels, `Ctrl + Mouse Wheel` / trackpad pinch zoom anchored at the cursor, and **Fullscreen (`F11`)** with auto-hiding top chrome.
- **Navigation & Search:**
  - Collapsible extensible left sidebar (`Ctrl+B`) with a strictly manual **Table of Contents** (nested expand/collapse + click-to-jump; no scroll-sync distraction).
  - Toolbar page jump input (`14 / 320`), clickable internal PDF links, and non-blocking in-document text search (`Ctrl+F`) with match highlights.
- **Virtualized HiDPI Engine:** Renders only visible pages plus a 2-page lookahead buffer (`window.devicePixelRatio` scaled, GPU canvas memory freed on eviction) using 100% offline-bundled PDF.js workers, CMaps, ICC profiles, standard fonts, and WASM decoders.
- **Persistence & Windows Integration:** Saves per-document reading state (page, scroll offset, view mode, zoom) and app preferences atomically under `%APPDATA%`. Registers `.pdf` handler metadata under per-user `HKCU` (no admin elevation required) and opens Windows Default Apps (`ms-settings:defaultapps`).

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+O` | Open PDF file(s) |
| `Ctrl+Shift+N` | Open new viewer window |
| `Ctrl+W` | Close active document tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle open tabs |
| `Ctrl+B` | Toggle Table of Contents sidebar |
| `Ctrl+F` | Find in document |
| `Enter` / `F3` | Next search match |
| `Shift+Enter` / `Shift+F3` | Previous search match |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0` | Zoom In / Zoom Out / Actual Size (100%) |
| `Ctrl+1` / `Ctrl+2` | Fit Width / Fit Page |
| `Ctrl+Mouse Wheel` | Smooth cursor-anchored zoom |
| `ArrowLeft` / `ArrowRight` | Previous / Next page or facing spread |
| `PageUp` / `PageDown` | Scroll viewport (Continuous) or step page/spread |
| `Home` / `End` | Jump to first / last page |
| `F11` | Toggle Fullscreen |
| `Ctrl+,` | Open Settings |
| `Esc` | Close modal / Find bar / exit Fullscreen |

## Development & Build Commands

```powershell
# 1. Install frontend dependencies and sync offline pdfjs-dist assets
npm install

# 2. Run desktop app in development mode with hot reload
npm run tauri dev

# 3. Typecheck, run frontend & Rust test suites, and build frontend bundle
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml

# 4. Build release binary and Windows installers (.exe NSIS / .msi)
npm run tauri build
```

Generated release binaries and installers are placed in `src-tauri/target/release/bundle/`.

## License

MIT — see [LICENSE](LICENSE).
