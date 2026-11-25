# AGENTS.md

Vendor-agnostic instructions for agents working on this project.

**Document Viewer** (workspace name `document-viewer`) is a lightweight, distraction-free Windows desktop PDF reader built with Tauri v2 (Rust + WebView2), TypeScript (strict mode), React, Tailwind CSS, and `pdfjs-dist`, inspired by the clean aesthetic of Apple's Preview and GNOME's Evince (Papers).

> **Living Document Rule:** Once initial project scaffolding is complete—and whenever scripts, folder layouts, or architectural invariants change—update this `AGENTS.md` file so the commands, paths, and gotchas stay accurate.

## Build & Development Commands

- `npm install` — Install frontend dependencies and sync offline `pdfjs-dist` assets (`postinstall`)
- `npm run tauri dev` — Start Vite dev server and compile/launch the Tauri desktop app with hot reload
- `npm run tauri build` — Build frontend assets, compile the Rust release binary, and package Windows installers (`.msi` / `.exe`) into `src-tauri/target/release/bundle/`
- `npm run build` — Sync offline `pdfjs-dist` assets, run strict TypeScript check, and build the frontend bundle into `dist/`
- `npm run typecheck` (or `npx tsc --noEmit`) — Run strict TypeScript typechecking across the frontend
- `cargo check --manifest-path src-tauri/Cargo.toml` — Fast-check Rust compilation and types
- `cargo test --manifest-path src-tauri/Cargo.toml` — Run Rust unit tests (`pdf_io`, `storage`, `win_assoc`)
- `npm test` — Run frontend Vitest unit & component tests (`vitest run`)

## Repository Structure

- `scripts/` — `sync-pdfjs-assets.mjs` (copies `cmaps`, `iccs`, `standard_fonts`, `wasm` into `public/pdfjs/`) and `generate-icons.mjs` (generates PNG + multi-size Windows `.ico` in `src-tauri/icons/`).
- `src/` — React + TypeScript frontend:
  - `src/lib/` — Pure, framework-free logic (`virtualization.ts`, `zoom.ts`, `searchEngine.ts`)
  - `src/services/` — `tauriBridge.ts` (typed IPC + drag-drop + window APIs), `pdfEngine.ts` (offline PDF.js document/outline/link engine)
  - `src/hooks/` — `useTheme.ts`, `useKeyboardShortcuts.ts`
  - `src/components/` — `TopToolbar.tsx`, `TabStrip.tsx`, `PdfViewport.tsx`, `PdfPageCanvas.tsx`, `Sidebar/SidebarShell.tsx`, `Sidebar/TocPanel.tsx`, `SearchBar.tsx`, `SettingsDialog.tsx`, `PasswordDialog.tsx`, `EmptyState.tsx`, `ErrorState.tsx`
  - `src/__tests__/` — Vitest unit & component test suites
- `src-tauri/src/` — Rust Tauri v2 backend:
  - `pdf_io.rs` — Read-only `%PDF-` validation, Windows verbatim path normalization, partial-content SHA-256 hashing, CLI arg parsing
  - `storage.rs` — Atomic JSON persistence in `%APPDATA%` (`settings.json`, `reading_state.json` LRU-capped at 500 docs)
  - `win_assoc.rs` — Per-user `HKCU` ProgID/Capabilities registration, `SHChangeNotify`, and `ms-settings:defaultapps` launch
  - `commands.rs` & `lib.rs` — Tauri command handlers (`get_startup_files`, `pick_pdf_files`, `inspect_pdf_file`, `read_pdf_bytes`, `spawn_new_window`, `load_settings`, `save_settings`, `load_reading_state`, `save_reading_state`, `list_recent_documents`, `remove_recent_document`, `get_file_association_status`, `register_default_pdf_viewer`)

## Sandbox & Environment Gotchas
- **Run `npm install` and packaging outside the sandbox (`bypass=true`):** `npm install` (as well as `npm ci`, `npm update`, initial `cargo` builds fetching crates, and `npm run tauri build` if downloading NSIS/WiX bundler tools) requires network access and will hang inside a restricted sandbox.
- **PowerShell 5.1:** Default Windows PowerShell does not support `&&` chaining; use `; if ($LASTEXITCODE -eq 0) { ... }` when chaining commands.
- **Sandboxed Registry Tests:** `win_assoc::win_impl::tests` verifies deterministic `AssociationSpec` values in all environments and gracefully skips live `HKCU` test-key writes if the sandbox denies registry access (`PermissionDenied`).

## Version Control & Workflow Rules
- **Branch Strategy:** Keep `main` runnable at all times. Develop new features or refactors on short-lived feature branches (e.g., `feat/pdf-viewer-core`, `feat/view-modes-sidebar-search`, `feat/persistence-settings-win-assoc`, `feat/polish-packaging-docs`) and merge back into `main` once verified. Do not use Git worktrees unless explicitly instructed.
- **Atomic Checkpoints:** Commit working vertical slices frequently using Conventional Commits (`chore:`, `feat:`, `fix:`, `refactor:`) so any regressions can be cleanly reverted.
- **Verify Before Finishing:** Before concluding a task or suggesting a commit, ensure TypeScript compilation (`npx tsc --noEmit`), Vitest (`npm test`), Rust compilation/tests (`cargo check`, `cargo test`), and the build pipeline succeed without errors.
- **Ignored Artifacts:** Never commit `node_modules/`, `dist/`, `public/pdfjs/`, `src-tauri/target/`, or local test PDFs.
- **Commit Author Identity:** Before creating any commits, verify that `git config user.name` and `git config user.email` are set. Never invent or override them with placeholder identities (e.g., `dev@localhost`). If either value is unset, pause and ask the user for their preferred Git name and email to configure locally (`git config --local`).
- **AI Co-Authorship Attribution:** Append a `Co-Authored-By: <Agent Name> <noreply@<vendor>.com>` trailer (identifying the active coding agent/harness) at the bottom of commit messages for AI-generated or AI-assisted commits.

## Architecture & Repository Gotchas
- **Tauri v2 Capabilities & Security:** Keep permissions minimal in `src-tauri/capabilities/`. Route OS integrations (file dialogs, reading PDF files, Windows registry/default-app settings, CLI argument handling) through explicit Rust Tauri commands or official Tauri v2 plugins rather than granting broad frontend filesystem access.
- **Read-Only In-Place Viewing:** Open PDFs directly from their existing disk paths without copying, moving, or modifying the user's original files. Persist app settings and per-document reading state (last page, scroll offset, view mode, zoom) separately in Windows `%APPDATA%`.
- **Reader & Performance Invariants:**
  - **Virtualized / Lazy Rendering:** Never render all pages at once. Only render pages visible in the viewport plus a small lookahead buffer (1–2 pages) and evict off-screen canvases (cancelling `RenderTask` and zeroing canvas dimensions) to keep RAM flat on 500+ page documents.
  - **HiDPI Rendering:** Always account for `window.devicePixelRatio` when sizing and rendering PDF canvases so text stays sharp under Windows display scaling.
  - **Sidebar / TOC Simplicity:** The Table of Contents must remain strictly manual (click-to-jump and manual expand/collapse only). Do **not** implement active-section highlighting, scroll-syncing, or automatic expand/collapse.
- **Offline `pdfjs-dist` Assets:** Bundle the PDF.js Web Worker and supporting assets (`cmaps`, `iccs`, `standard_fonts`, `wasm`) locally inside the app—never fetch them from external CDNs at runtime.
- **Windows `.pdf` File Association:** `.pdf` handler registration is a core feature. Register the app's ProgID and capabilities under `HKCU` (per-user, no admin elevation required) and launch `ms-settings:defaultapps` via `ShellExecuteW` so the user can confirm the default handler in compliance with Windows 10/11 rules. Ensure the Rust entrypoint handles `.pdf` file paths passed as CLI arguments on startup.
