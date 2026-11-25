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
- `cargo test --manifest-path src-tauri/Cargo.toml` — Run Rust unit tests
- `npm test` — Run frontend Vitest unit tests (`vitest run`)

## Sandbox & Environment Gotchas
- **Run `npm install` outside the sandbox (`bypass=true`):** `npm install` requires network access and will hang indefinitely if run inside a restricted sandbox. Always execute `npm install` (as well as `npm ci`, `npm update`, or initial `cargo` builds that fetch crates from crates.io) with sandbox bypass enabled (`bypass=true`). Never wait on a stalled sandboxed install.

## Version Control & Workflow Rules
- **Branch Strategy:** Keep `main` runnable at all times. Develop new features or refactors on short-lived feature branches (e.g., `feat/pdf-viewer`, `feat/toc-sidebar`, `feat/windows-file-assoc`, `fix/virtual-scroll`) and merge back into `main` once verified. Do not use Git worktrees unless explicitly instructed.
- **Atomic Checkpoints:** Commit working vertical slices frequently using Conventional Commits (`chore:`, `feat:`, `fix:`, `refactor:`) so any regressions can be cleanly reverted.
- **Verify Before Finishing:** Before concluding a task or suggesting a commit, ensure TypeScript compilation (`npx tsc --noEmit`), Rust compilation (`cargo check`), and the dev/build pipeline succeed without errors.
- **Ignored Artifacts:** Never commit `node_modules/`, `dist/`, `src-tauri/target/`, or local test PDFs.
- **Commit Author Identity:** Before creating any commits, verify that `git config user.name` and `git config user.email` are set. Never invent or override them with placeholder identities (e.g., `dev@localhost`). If either value is unset, pause and ask the user for their preferred Git name and email to configure locally (`git config --local`).
- **AI Co-Authorship Attribution:** Append a `Co-Authored-By: <Agent Name> <noreply@<vendor>.com>` trailer (identifying the active coding agent/harness) at the bottom of commit messages for AI-generated or AI-assisted commits.

## Architecture & Repository Gotchas
- **Tauri v2 Capabilities & Security:** Keep permissions minimal in `src-tauri/capabilities/`. Route OS integrations (file dialogs, reading PDF files, Windows registry/default-app settings, CLI argument handling) through explicit Rust Tauri commands or official Tauri v2 plugins rather than granting broad frontend filesystem access.
- **Read-Only In-Place Viewing:** Open PDFs directly from their existing disk paths without copying, moving, or modifying the user's original files. Persist app settings and per-document reading state (last page, scroll offset, view mode, zoom) separately in Windows `%APPDATA%`.
- **Reader & Performance Invariants:**
  - **Virtualized / Lazy Rendering:** Never render all pages at once. Only render pages visible in the viewport plus a small lookahead buffer (1–2 pages) and evict off-screen canvases to keep RAM flat on 500+ page documents.
  - **HiDPI Rendering:** Always account for `window.devicePixelRatio` when sizing and rendering PDF canvases so text stays sharp under Windows display scaling.
  - **Sidebar / TOC Simplicity:** The Table of Contents must remain strictly manual (click-to-jump and manual expand/collapse only). Do **not** implement active-section highlighting, scroll-syncing, or automatic expand/collapse.
- **Offline `pdfjs-dist` Assets:** Bundle the PDF.js Web Worker and supporting assets (`cmaps`, `standard_fonts`, etc.) locally inside the app—never fetch them from external CDNs at runtime.
- **Windows `.pdf` File Association:** `.pdf` handler registration is a core feature. Register the app's ProgID and capabilities under `HKCU` (per-user, no admin elevation required) and launch `ms-settings:defaultapps` so the user can confirm the default handler in compliance with Windows 10/11 rules. Ensure the Rust entrypoint handles `.pdf` file paths passed as CLI arguments on startup.