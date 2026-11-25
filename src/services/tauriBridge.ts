import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type {
  AppSettings,
  DocumentReadingState,
  FileAssociationStatus,
  PdfFileMetadata,
  RecentDocumentItem,
} from '../types/viewer';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function getStartupFiles(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>('get_startup_files');
}

export async function pickPdfFiles(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invoke<string[]>('pick_pdf_files');
}

export async function inspectPdfFile(path: string): Promise<PdfFileMetadata> {
  return invoke<PdfFileMetadata>('inspect_pdf_file', { path });
}

export async function readPdfBytes(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_pdf_bytes', { path });
}

export async function spawnNewWindow(filePath?: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('spawn_new_window', { filePath: filePath ?? null });
}

export async function setWindowTitle(title: string): Promise<void> {
  if (!isTauriRuntime()) {
    document.title = title;
    return;
  }
  await getCurrentWindow().setTitle(title);
}

export async function setWindowFullscreen(fullscreen: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().setFullscreen(fullscreen);
}

export async function isWindowFullscreen(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return getCurrentWindow().isFullscreen();
}

export async function closeCurrentWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().close();
}

export async function minimizeCurrentWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeCurrentWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().toggleMaximize();
}

export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return getCurrentWindow().isMaximized();
}

export async function subscribeWindowMaximizedChange(
  onChange: (maximized: boolean) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const win = getCurrentWindow();
  const unlisten = await win.onResized(async () => {
    try {
      onChange(await win.isMaximized());
    } catch {
      // Ignore errors if window is closing
    }
  });
  return unlisten;
}

export interface DragDropCallbacks {
  onEnter: () => void;
  onLeave: () => void;
  onDropPaths: (paths: string[]) => void;
}

export async function subscribeToFileDrop(callbacks: DragDropCallbacks): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === 'enter' || payload.type === 'over') {
      callbacks.onEnter();
    } else if (payload.type === 'leave') {
      callbacks.onLeave();
    } else if (payload.type === 'drop') {
      callbacks.onLeave();
      if (payload.paths.length > 0) {
        callbacks.onDropPaths(payload.paths);
      }
    }
  });
  return unlisten;
}

// Phase 3 persistence & Windows association bindings (graceful no-ops until wired on backend)
export const DEFAULT_APP_SETTINGS: AppSettings = {
  resumeLastPage: true,
  defaultViewMode: 'continuous',
  defaultZoomMode: 'fit-width',
  defaultCoverOffset: true,
  theme: 'system',
  sidebarWidth: 272,
};

export async function loadSettings(): Promise<AppSettings> {
  if (!isTauriRuntime()) return DEFAULT_APP_SETTINGS;
  try {
    const loaded = await invoke<Partial<AppSettings>>('load_settings');
    return { ...DEFAULT_APP_SETTINGS, ...loaded };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('save_settings', { settings });
  } catch {
    // No-op if backend command not yet registered in earlier phase
  }
}

export async function loadReadingState(
  docHash: string,
  filePath: string,
): Promise<DocumentReadingState | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<DocumentReadingState | null>('load_reading_state', {
      docHash,
      filePath,
    });
  } catch {
    return null;
  }
}

export async function saveReadingState(readingState: DocumentReadingState): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('save_reading_state', { readingState });
  } catch {
    // No-op if backend command not yet registered in earlier phase
  }
}

export async function listRecentDocuments(limit = 10): Promise<RecentDocumentItem[]> {
  if (!isTauriRuntime()) return [];
  try {
    return await invoke<RecentDocumentItem[]>('list_recent_documents', { limit });
  } catch {
    return [];
  }
}

export async function removeRecentDocument(docHash: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('remove_recent_document', { docHash });
  } catch {
    // Ignore
  }
}

export async function getFileAssociationStatus(): Promise<FileAssociationStatus> {
  if (!isTauriRuntime()) {
    return {
      isRegisteredInHkcu: false,
      currentDefaultProgId: null,
      isDefaultPdfViewer: false,
    };
  }
  return invoke<FileAssociationStatus>('get_file_association_status');
}

export async function registerDefaultPdfViewer(): Promise<FileAssociationStatus> {
  return invoke<FileAssociationStatus>('register_default_pdf_viewer');
}
