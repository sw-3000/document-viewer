import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import type {
  AppSettings,
  PageDimension,
  TabSession,
  ViewMode,
  ZoomMode,
} from './types/viewer';
import {
  DEFAULT_APP_SETTINGS,
  getStartupFiles,
  inspectPdfFile,
  pickPdfFiles,
  readPdfBytes,
  setWindowTitle,
  subscribeToFileDrop,
} from './services/tauriBridge';
import {
  PdfLoadError,
  backfillPageDimensions,
  loadPdfDocument,
  type LoadedPdfHandle,
} from './services/pdfEngine';
import { stepZoom } from './lib/zoom';
import { useTheme } from './hooks/useTheme';
import { TopToolbar } from './components/TopToolbar';
import { PdfViewport } from './components/PdfViewport';
import { PasswordDialog } from './components/PasswordDialog';
import { EmptyState } from './components/EmptyState';
import { ErrorState } from './components/ErrorState';

let nextTabSeq = 1;

export default function App() {
  const [settings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  useTheme(settings.theme);

  const [tabs, setTabs] = useState<TabSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [effectiveScale, setEffectiveScale] = useState(1.0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const handlesRef = useRef<Map<string, LoadedPdfHandle>>(new Map());
  const backfillAbortRef = useRef<Map<string, AbortController>>(new Map());
  const tabsRef = useRef<TabSession[]>(tabs);
  tabsRef.current = tabs;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  useEffect(() => {
    const title = activeTab
      ? `${activeTab.fileName} — Document Viewer`
      : 'Document Viewer';
    void setWindowTitle(title);
  }, [activeTab?.fileName]);

  const disposeTabResources = useCallback((tabId: string) => {
    backfillAbortRef.current.get(tabId)?.abort();
    backfillAbortRef.current.delete(tabId);
    const handle = handlesRef.current.get(tabId);
    if (handle) {
      handlesRef.current.delete(tabId);
      void handle.dispose();
    }
  }, []);

  const loadIntoTab = useCallback(
    async (tabId: string, filePath: string, password?: string) => {
      disposeTabResources(tabId);

      try {
        const meta = await inspectPdfFile(filePath);
        const bytes = await readPdfBytes(meta.filePath);
        const handle = await loadPdfDocument(bytes, password);

        handlesRef.current.set(tabId, handle);
        const abortCtrl = new AbortController();
        backfillAbortRef.current.set(tabId, abortCtrl);

        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  filePath: meta.filePath,
                  fileName: meta.fileName,
                  docHash: meta.docHash,
                  fileSize: meta.fileSize,
                  status: 'ready',
                  passwordError: null,
                  errorMessage: null,
                  totalPages: handle.numPages,
                  currentPage: 1,
                  scrollOffsetRatio: 0,
                  pageDimensions: handle.initialDimensions,
                  outline: handle.outline,
                }
              : t,
          ),
        );

        backfillPageDimensions(
          handle.pdfDoc,
          handle.numPages,
          (updates: Array<{ pageNumber: number; dim: PageDimension }>) => {
            setTabs((prev) =>
              prev.map((t) => {
                if (t.id !== tabId) return t;
                const nextDims = t.pageDimensions.slice();
                for (const u of updates) {
                  nextDims[u.pageNumber - 1] = u.dim;
                }
                return { ...t, pageDimensions: nextDims };
              }),
            );
          },
          abortCtrl.signal,
        );
      } catch (err: unknown) {
        if (err instanceof PdfLoadError) {
          if (err.kind === 'need-password' || err.kind === 'incorrect-password') {
            setTabs((prev) =>
              prev.map((t) =>
                t.id === tabId
                  ? {
                      ...t,
                      status: 'password-required',
                      passwordError:
                        err.kind === 'incorrect-password' ? err.message : null,
                    }
                  : t,
              ),
            );
            return;
          }
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tabId
                ? { ...t, status: 'error', errorMessage: err.message }
                : t,
            ),
          );
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId ? { ...t, status: 'error', errorMessage: message } : t,
          ),
        );
      }
    },
    [disposeTabResources],
  );

  const openFilePaths = useCallback(
    async (paths: string[]) => {
      for (const rawPath of paths) {
        const existing = tabsRef.current.find(
          (t) => t.filePath.toLowerCase() === rawPath.toLowerCase(),
        );
        if (existing) {
          setActiveTabId(existing.id);
          continue;
        }

        const tabId = `tab-${nextTabSeq++}`;
        const fileName = rawPath.split(/[\\/]/).pop() || rawPath;
        const newTab: TabSession = {
          id: tabId,
          filePath: rawPath,
          fileName,
          docHash: null,
          fileSize: 0,
          status: 'loading',
          passwordError: null,
          errorMessage: null,
          totalPages: 0,
          currentPage: 1,
          scrollOffsetRatio: 0,
          viewMode: settings.defaultViewMode,
          coverOffset: settings.defaultCoverOffset,
          zoomMode: settings.defaultZoomMode,
          zoomScale: 1.0,
          pageDimensions: [],
          outline: [],
          navigationRequest: null,
        };

        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(tabId);
        void loadIntoTab(tabId, rawPath);
      }
    },
    [loadIntoTab, settings.defaultCoverOffset, settings.defaultViewMode, settings.defaultZoomMode],
  );

  const handleOpenPicker = useCallback(async () => {
    const selected = await pickPdfFiles();
    if (selected.length > 0) {
      await openFilePaths(selected);
    }
  }, [openFilePaths]);

  const closeTab = useCallback(
    (tabId: string) => {
      disposeTabResources(tabId);
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        setActiveTabId((cur) => {
          if (cur !== tabId) return cur;
          const fallback = next[Math.min(idx, next.length - 1)];
          return fallback ? fallback.id : null;
        });
        return next;
      });
    },
    [disposeTabResources],
  );

  // Load startup files passed via CLI args (or spawned secondary windows)
  useEffect(() => {
    let active = true;
    void (async () => {
      const startup = await getStartupFiles();
      if (active && startup.length > 0) {
        await openFilePaths(startup);
      }
    })();
    return () => {
      active = false;
    };
  }, [openFilePaths]);

  // Native WebView2 Drag-and-Drop
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribeToFileDrop({
      onEnter: () => setIsDraggingOver(true),
      onLeave: () => setIsDraggingOver(false),
      onDropPaths: (paths) => {
        const pdfs = paths.filter((p) => p.toLowerCase().endsWith('.pdf'));
        if (pdfs.length > 0) {
          void openFilePaths(pdfs);
        }
      },
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [openFilePaths]);

  // Cleanup all handles on window unmount
  useEffect(() => {
    return () => {
      for (const tab of tabsRef.current) {
        disposeTabResources(tab.id);
      }
    };
  }, [disposeTabResources]);

  const updateActiveTab = useCallback((updater: (tab: TabSession) => TabSession) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? updater(t) : t)),
    );
  }, [activeTabId]);

  const navigateToPage = useCallback(
    (pageNumber: number, topPt?: number | null) => {
      updateActiveTab((tab) => {
        const clamped = Math.min(Math.max(1, pageNumber), Math.max(1, tab.totalPages));
        const nextSeq = (tab.navigationRequest?.seq ?? 0) + 1;
        return {
          ...tab,
          currentPage: clamped,
          navigationRequest: {
            seq: nextSeq,
            pageNumber: clamped,
            topPt: topPt ?? null,
          },
        };
      });
    },
    [updateActiveTab],
  );

  const activeHandle = activeTab ? handlesRef.current.get(activeTab.id) ?? null : null;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-neutral-900 dark:text-neutral-100">
      <TopToolbar
        session={activeTab}
        effectiveScale={effectiveScale}
        sidebarOpen={false}
        searchOpen={false}
        isFullscreen={false}
        onOpenFile={() => void handleOpenPicker()}
        onToggleSidebar={() => {}}
        onJumpToPage={(p) => navigateToPage(p)}
        onPrevPage={() => activeTab && navigateToPage(activeTab.currentPage - 1)}
        onNextPage={() => activeTab && navigateToPage(activeTab.currentPage + 1)}
        onChangeViewMode={(mode: ViewMode) =>
          updateActiveTab((tab) => ({ ...tab, viewMode: mode }))
        }
        onToggleCoverOffset={() =>
          updateActiveTab((tab) => ({ ...tab, coverOffset: !tab.coverOffset }))
        }
        onChangeZoomMode={(mode: ZoomMode, customScale?: number) =>
          updateActiveTab((tab) => ({
            ...tab,
            zoomMode: mode,
            zoomScale: customScale ?? (mode === 'actual-size' ? 1.0 : effectiveScale),
          }))
        }
        onZoomStep={(dir) =>
          updateActiveTab((tab) => ({
            ...tab,
            zoomMode: 'custom',
            zoomScale: stepZoom(effectiveScale, dir),
          }))
        }
        onToggleSearch={() => {}}
        onToggleFullscreen={() => {}}
        onOpenSettings={() => {}}
      />

      <main className="relative flex flex-1 overflow-hidden">
        {!activeTab && (
          <EmptyState
            recentDocuments={[]}
            onOpenFile={() => void handleOpenPicker()}
            onOpenRecent={(p) => void openFilePaths([p])}
            onRemoveRecent={() => {}}
          />
        )}

        {activeTab?.status === 'loading' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--bg-canvas)]">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-400" />
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              Opening {activeTab.fileName}...
            </p>
          </div>
        )}

        {activeTab?.status === 'password-required' && (
          <PasswordDialog
            fileName={activeTab.fileName}
            errorMessage={activeTab.passwordError}
            onSubmit={(pw) => void loadIntoTab(activeTab.id, activeTab.filePath, pw)}
            onCancel={() => closeTab(activeTab.id)}
          />
        )}

        {activeTab?.status === 'error' && (
          <ErrorState
            fileName={activeTab.fileName}
            filePath={activeTab.filePath}
            message={activeTab.errorMessage ?? 'Failed to open document.'}
            onOpenAnother={() => void handleOpenPicker()}
            onCloseTab={() => closeTab(activeTab.id)}
          />
        )}

        {activeTab?.status === 'ready' && activeHandle && (
          <PdfViewport
            session={activeTab}
            pdfDoc={activeHandle.pdfDoc}
            onPageChange={(page) =>
              updateActiveTab((tab) =>
                tab.currentPage === page ? tab : { ...tab, currentPage: page },
              )
            }
            onScrollRatioChange={(ratio) =>
              updateActiveTab((tab) => ({ ...tab, scrollOffsetRatio: ratio }))
            }
            onWheelZoom={(nextScale) =>
              updateActiveTab((tab) => ({
                ...tab,
                zoomMode: 'custom',
                zoomScale: nextScale,
              }))
            }
            onComputedScaleChange={setEffectiveScale}
            onNavigateToPage={navigateToPage}
          />
        )}
      </main>

      {isDraggingOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-600/12 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-blue-500 bg-white/95 px-10 py-8 shadow-2xl dark:bg-neutral-900/95">
            <Upload className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Drop PDF to Open
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
