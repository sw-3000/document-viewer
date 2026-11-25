import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import type {
  AppSettings,
  DocumentReadingState,
  PageDimension,
  RecentDocumentItem,
  SearchMatch,
  TabSession,
  ViewMode,
  ZoomMode,
} from './types/viewer';
import {
  DEFAULT_APP_SETTINGS,
  closeCurrentWindow,
  getStartupFiles,
  inspectPdfFile,
  isWindowFullscreen,
  isWindowMaximized,
  listRecentDocuments,
  loadReadingState,
  loadSettings,
  minimizeCurrentWindow,
  pickPdfFiles,
  readPdfBytes,
  removeRecentDocument,
  saveReadingState,
  saveSettings,
  setWindowFullscreen,
  setWindowTitle,
  spawnNewWindow,
  subscribeToFileDrop,
  subscribeWindowMaximizedChange,
  toggleMaximizeCurrentWindow,
} from './services/tauriBridge';
import {
  PdfLoadError,
  backfillPageDimensions,
  loadPdfDocument,
  type LoadedPdfHandle,
} from './services/pdfEngine';
import { findSpreadForPage } from './lib/virtualization';
import { stepZoom } from './lib/zoom';
import {
  extractPageTextData,
  findMatchesInPageText,
  wrapMatchIndex,
  type PageTextData,
} from './lib/searchEngine';
import { useTheme } from './hooks/useTheme';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { TopToolbar } from './components/TopToolbar';
import { TabStrip } from './components/TabStrip';
import { PdfViewport } from './components/PdfViewport';
import { SidebarShell } from './components/Sidebar/SidebarShell';
import { SearchBar } from './components/SearchBar';
import { SettingsDialog } from './components/SettingsDialog';
import { PasswordDialog } from './components/PasswordDialog';
import { EmptyState } from './components/EmptyState';
import { ErrorState } from './components/ErrorState';

let nextTabSeq = 1;

function toReadingStatePayload(tab: TabSession): DocumentReadingState | null {
  if (tab.status !== 'ready' || !tab.docHash) return null;
  return {
    docHash: tab.docHash,
    filePath: tab.filePath,
    fileName: tab.fileName,
    totalPages: tab.totalPages,
    pageNumber: tab.currentPage,
    scrollOffsetRatio: tab.scrollOffsetRatio,
    viewMode: tab.viewMode,
    coverOffset: tab.coverOffset,
    zoomMode: tab.zoomMode,
    zoomScale: tab.zoomScale,
    ...(tab.expandedTocIds !== null ? { expandedTocIds: tab.expandedTocIds } : {}),
    updatedAtMs: Date.now(),
  };
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentDocuments, setRecentDocuments] = useState<RecentDocumentItem[]>([]);
  useTheme(settings.theme);

  const [tabs, setTabs] = useState<TabSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [effectiveScale, setEffectiveScale] = useState(1.0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_APP_SETTINGS.sidebarWidth);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState('toc');

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const [isSearchIndexing, setIsSearchIndexing] = useState(false);
  const [searchFocusTrigger, setSearchFocusTrigger] = useState(0);

  // Fullscreen & chrome auto-hide state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [chromePeek, setChromePeek] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);

  const handlesRef = useRef<Map<string, LoadedPdfHandle>>(new Map());
  const backfillAbortRef = useRef<Map<string, AbortController>>(new Map());
  const textCacheRef = useRef<Map<string, Map<number, PageTextData>>>(new Map());
  const poppingOutIdsRef = useRef<Set<string>>(new Set());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<TabSession[]>(tabs);
  tabsRef.current = tabs;
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const refreshRecentDocuments = useCallback(async () => {
    const list = await listRecentDocuments(10);
    setRecentDocuments(list);
  }, []);

  // Load persisted settings & recent documents on startup
  useEffect(() => {
    let active = true;
    void (async () => {
      const [loadedSettings, recents] = await Promise.all([
        loadSettings(),
        listRecentDocuments(10),
      ]);
      if (!active) return;
      setSettings(loadedSettings);
      setSidebarWidth(loadedSettings.sidebarWidth);
      setRecentDocuments(recents);
      setSettingsLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const title = activeTab
      ? `${activeTab.fileName} — Document Viewer`
      : 'Document Viewer';
    void setWindowTitle(title);
  }, [activeTab?.fileName]);

  // Keep Maximize/Restore icon synced with native window state
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void isWindowMaximized().then((max) => {
      if (active) setIsMaximized(max);
    });
    void subscribeWindowMaximizedChange((max) => {
      if (active) setIsMaximized(max);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const handleUpdateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    void saveSettings(next);
  }, []);

  const disposeTabResources = useCallback((tabId: string) => {
    backfillAbortRef.current.get(tabId)?.abort();
    backfillAbortRef.current.delete(tabId);
    textCacheRef.current.delete(tabId);
    const handle = handlesRef.current.get(tabId);
    if (handle) {
      handlesRef.current.delete(tabId);
      void handle.dispose();
    }
  }, []);

  const flushTabReadingState = useCallback(async (tab: TabSession) => {
    const payload = toReadingStatePayload(tab);
    if (payload) {
      await saveReadingState(payload);
    }
  }, []);

  const loadIntoTab = useCallback(
    async (tabId: string, filePath: string, password?: string) => {
      disposeTabResources(tabId);

      try {
        const meta = await inspectPdfFile(filePath);
        const [bytes, savedState] = await Promise.all([
          readPdfBytes(meta.filePath),
          loadReadingState(meta.docHash, meta.filePath),
        ]);
        const handle = await loadPdfDocument(bytes, password);

        handlesRef.current.set(tabId, handle);
        const abortCtrl = new AbortController();
        backfillAbortRef.current.set(tabId, abortCtrl);

        const curSettings = settingsRef.current;
        const shouldResumePage = Boolean(savedState && curSettings.resumeLastPage);

        const restoredPage = shouldResumePage && savedState
          ? Math.min(Math.max(1, savedState.pageNumber), handle.numPages)
          : 1;
        const restoredScroll = shouldResumePage && savedState ? savedState.scrollOffsetRatio : 0;
        const restoredViewMode: ViewMode = savedState
          ? savedState.viewMode
          : curSettings.defaultViewMode;
        const restoredCoverOffset = savedState
          ? savedState.coverOffset
          : curSettings.defaultCoverOffset;
        const restoredZoomMode: ZoomMode = savedState
          ? savedState.zoomMode
          : curSettings.defaultZoomMode;
        const restoredZoomScale = savedState ? savedState.zoomScale : 1.0;
        const restoredExpandedTocIds =
          savedState && savedState.expandedTocIds !== undefined
            ? savedState.expandedTocIds
            : null;

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
                  currentPage: restoredPage,
                  scrollOffsetRatio: restoredScroll,
                  viewMode: restoredViewMode,
                  coverOffset: restoredCoverOffset,
                  zoomMode: restoredZoomMode,
                  zoomScale: restoredZoomScale,
                  pageDimensions: handle.initialDimensions,
                  outline: handle.outline,
                  expandedTocIds: restoredExpandedTocIds,
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

        const curSettings = settingsRef.current;
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
          viewMode: curSettings.defaultViewMode,
          coverOffset: curSettings.defaultCoverOffset,
          zoomMode: curSettings.defaultZoomMode,
          zoomScale: 1.0,
          pageDimensions: [],
          outline: [],
          expandedTocIds: null,
          navigationRequest: null,
        };

        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(tabId);
        void loadIntoTab(tabId, rawPath);
      }
    },
    [loadIntoTab],
  );

  const handleOpenPicker = useCallback(async () => {
    const selected = await pickPdfFiles();
    if (selected.length > 0) {
      await openFilePaths(selected);
    }
  }, [openFilePaths]);

  const closeTab = useCallback(
    (tabId: string) => {
      const target = tabsRef.current.find((t) => t.id === tabId);
      if (target) {
        void flushTabReadingState(target).then(() => refreshRecentDocuments());
      }
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
    [disposeTabResources, flushTabReadingState, refreshRecentDocuments],
  );

  const popOutTab = useCallback(
    async (tab: TabSession) => {
      if (poppingOutIdsRef.current.has(tab.id)) return;
      poppingOutIdsRef.current.add(tab.id);
      setWindowError(null);
      try {
        await flushTabReadingState(tab);
        await spawnNewWindow(tab.filePath);
        closeTab(tab.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setWindowError(msg || 'Failed to open document in a new window.');
      } finally {
        poppingOutIdsRef.current.delete(tab.id);
      }
    },
    [closeTab, flushTabReadingState],
  );

  // Debounced auto-save for the active document's reading state
  useEffect(() => {
    if (!activeTab || activeTab.status !== 'ready' || !activeTab.docHash) return;
    const payload = toReadingStatePayload(activeTab);
    if (!payload) return;

    const timer = window.setTimeout(() => {
      void saveReadingState(payload);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    activeTab?.id,
    activeTab?.status,
    activeTab?.docHash,
    activeTab?.currentPage,
    activeTab?.scrollOffsetRatio,
    activeTab?.viewMode,
    activeTab?.coverOffset,
    activeTab?.zoomMode,
    activeTab?.zoomScale,
    activeTab?.expandedTocIds,
  ]);

  // Flush reading state on window unload
  useEffect(() => {
    const handleUnload = () => {
      for (const tab of tabsRef.current) {
        const payload = toReadingStatePayload(tab);
        if (payload) {
          void saveReadingState(payload);
        }
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  // Load startup files passed via CLI args once settings are ready
  useEffect(() => {
    if (!settingsLoaded) return;
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
  }, [settingsLoaded, openFilePaths]);

  // Native WebView2 Drag-and-Drop
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribeToFileDrop({
      onEnter: () => setIsDraggingOver(true),
      onLeave: () => setIsDraggingOver(false),
      onDropPaths: (paths) => {
        if (paths.length > 0) {
          void openFilePaths(paths);
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

  const updateActiveTab = useCallback(
    (updater: (tab: TabSession) => TabSession) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? updater(t) : t)),
      );
    },
    [activeTabId],
  );

  const navigateToPage = useCallback(
    (pageNumber: number, topPt?: number | null, topPct?: number | null) => {
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
            topPct: topPct ?? null,
          },
        };
      });
    },
    [updateActiveTab],
  );

  const stepPage = useCallback(
    (delta: 1 | -1) => {
      if (!activeTab || activeTab.status !== 'ready') return;
      if (activeTab.viewMode === 'two-page') {
        const { spreadIndex, spreads } = findSpreadForPage(
          activeTab.currentPage,
          activeTab.totalPages,
          activeTab.coverOffset,
        );
        const nextSpread = spreads[spreadIndex + delta];
        if (nextSpread && nextSpread[0]) {
          navigateToPage(nextSpread[0]);
        }
      } else {
        navigateToPage(activeTab.currentPage + delta);
      }
    },
    [activeTab, navigateToPage],
  );

  // Lazy chunked text search across active document
  useEffect(() => {
    if (!searchOpen || !activeTab || activeTab.status !== 'ready') {
      setSearchMatches([]);
      setActiveMatchIndex(-1);
      setIsSearchIndexing(false);
      return;
    }

    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchMatches([]);
      setActiveMatchIndex(-1);
      setIsSearchIndexing(false);
      return;
    }

    const handle = handlesRef.current.get(activeTab.id);
    if (!handle) return;

    let cancelled = false;
    setIsSearchIndexing(true);

    let cache = textCacheRef.current.get(activeTab.id);
    if (!cache) {
      cache = new Map<number, PageTextData>();
      textCacheRef.current.set(activeTab.id, cache);
    }

    const runSearch = async () => {
      const collected: SearchMatch[] = [];
      let jumpedToFirst = false;

      for (let p = 1; p <= activeTab.totalPages; p++) {
        if (cancelled) return;
        let pageData = cache!.get(p);
        if (!pageData) {
          pageData = await extractPageTextData(handle.pdfDoc, p);
          if (cancelled) return;
          cache!.set(p, pageData);
          if (p % 4 === 0) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        const pageMatches = findMatchesInPageText(pageData, searchQuery, caseSensitive);
        if (pageMatches.length > 0) {
          collected.push(...pageMatches);
          setSearchMatches([...collected]);
          if (!jumpedToFirst) {
            jumpedToFirst = true;
            setActiveMatchIndex(0);
            const first = pageMatches[0]!;
            navigateToPage(first.pageNumber, null, first.boxes[0]?.topPct ?? null);
          }
        }
      }

      if (!cancelled) {
        setSearchMatches(collected);
        if (collected.length === 0) {
          setActiveMatchIndex(-1);
        }
        setIsSearchIndexing(false);
      }
    };

    void runSearch();
    return () => {
      cancelled = true;
    };
  }, [
    searchOpen,
    searchQuery,
    caseSensitive,
    activeTab?.id,
    activeTab?.status,
    activeTab?.totalPages,
  ]);

  const stepSearchMatch = useCallback(
    (delta: 1 | -1) => {
      if (searchMatches.length === 0) return;
      const nextIdx = wrapMatchIndex(activeMatchIndex, delta, searchMatches.length);
      setActiveMatchIndex(nextIdx);
      const match = searchMatches[nextIdx];
      if (match) {
        navigateToPage(match.pageNumber, null, match.boxes[0]?.topPct ?? null);
      }
    },
    [searchMatches, activeMatchIndex, navigateToPage],
  );

  const matchesByPage = useMemo(() => {
    const map = new Map<number, SearchMatch[]>();
    for (const m of searchMatches) {
      const list = map.get(m.pageNumber);
      if (list) {
        list.push(m);
      } else {
        map.set(m.pageNumber, [m]);
      }
    }
    return map;
  }, [searchMatches]);

  const activeMatch =
    activeMatchIndex >= 0 && activeMatchIndex < searchMatches.length
      ? searchMatches[activeMatchIndex] ?? null
      : null;

  const toggleFullscreen = useCallback(async () => {
    const current = await isWindowFullscreen().catch(() => isFullscreen);
    const next = !current;
    await setWindowFullscreen(next);
    setIsFullscreen(next);
    if (!next) setChromePeek(false);
  }, [isFullscreen]);

  const shortcutHandlers = useMemo(
    () => ({
      onOpenFile: () => void handleOpenPicker(),
      onNewWindow: () => void spawnNewWindow(),
      onCloseTab: () => {
        if (activeTab) closeTab(activeTab.id);
      },
      onCycleTab: (direction: 1 | -1) => {
        if (tabs.length < 2 || !activeTabId) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const nextIdx = (((idx + direction) % tabs.length) + tabs.length) % tabs.length;
        const nextTab = tabs[nextIdx];
        if (nextTab) setActiveTabId(nextTab.id);
      },
      onToggleSidebar: () => {
        if (activeTab?.status === 'ready') {
          setSidebarOpen((v) => !v);
        }
      },
      onOpenSearch: () => {
        if (activeTab?.status === 'ready') {
          setSearchOpen(true);
          setSearchFocusTrigger((c) => c + 1);
        }
      },
      onSearchStep: (dir: 1 | -1) => {
        if (searchOpen) stepSearchMatch(dir);
      },
      onZoomIn: () =>
        updateActiveTab((tab) => ({
          ...tab,
          zoomMode: 'custom',
          zoomScale: stepZoom(effectiveScale, 'in'),
        })),
      onZoomOut: () =>
        updateActiveTab((tab) => ({
          ...tab,
          zoomMode: 'custom',
          zoomScale: stepZoom(effectiveScale, 'out'),
        })),
      onZoomActual: () =>
        updateActiveTab((tab) => ({
          ...tab,
          zoomMode: 'actual-size',
          zoomScale: 1.0,
        })),
      onFitWidth: () =>
        updateActiveTab((tab) => ({ ...tab, zoomMode: 'fit-width' })),
      onFitPage: () =>
        updateActiveTab((tab) => ({ ...tab, zoomMode: 'fit-page' })),
      onPrevPage: () => stepPage(-1),
      onNextPage: () => stepPage(1),
      onScrollStep: (direction: 1 | -1) => {
        const el = viewportRef.current;
        if (!el) return;
        const delta = Math.max(120, Math.round(el.clientHeight * 0.88)) * direction;
        el.scrollBy({ top: delta, behavior: 'smooth' });
      },
      onFirstPage: () => {
        if (activeTab?.status === 'ready') navigateToPage(1);
      },
      onLastPage: () => {
        if (activeTab?.status === 'ready') navigateToPage(activeTab.totalPages);
      },
      onToggleFullscreen: () => void toggleFullscreen(),
      onOpenSettings: () => setSettingsOpen(true),
      onEscape: () => {
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery('');
          setSearchMatches([]);
          setActiveMatchIndex(-1);
          return;
        }
        if (isFullscreen) {
          void setWindowFullscreen(false);
          setIsFullscreen(false);
          setChromePeek(false);
        }
      },
      isContinuousMode: activeTab?.viewMode === 'continuous',
    }),
    [
      handleOpenPicker,
      activeTab,
      tabs,
      activeTabId,
      closeTab,
      searchOpen,
      settingsOpen,
      stepSearchMatch,
      updateActiveTab,
      effectiveScale,
      stepPage,
      toggleFullscreen,
      isFullscreen,
    ],
  );

  useKeyboardShortcuts(shortcutHandlers);

  const activeHandle = activeTab ? handlesRef.current.get(activeTab.id) ?? null : null;
  const showChrome = !isFullscreen || chromePeek || searchOpen;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-neutral-900 dark:text-neutral-100">
      {/* Fullscreen top-edge hover reveal zone */}
      {isFullscreen && (
        <div
          className="fixed left-0 right-0 top-0 z-50 h-3"
          onMouseEnter={() => setChromePeek(true)}
        />
      )}

      {showChrome && (
        <div
          onMouseLeave={() => {
            if (isFullscreen) setChromePeek(false);
          }}
        >
          <TopToolbar
            session={activeTab}
            effectiveScale={effectiveScale}
            sidebarOpen={sidebarOpen}
            searchOpen={searchOpen}
            isFullscreen={isFullscreen}
            isMaximized={isMaximized}
            onOpenFile={() => void handleOpenPicker()}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onJumpToPage={(p) => navigateToPage(p)}
            onPrevPage={() => stepPage(-1)}
            onNextPage={() => stepPage(1)}
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
            onToggleSearch={() => {
              if (searchOpen) {
                setSearchOpen(false);
                setSearchQuery('');
                setSearchMatches([]);
                setActiveMatchIndex(-1);
              } else {
                setSearchOpen(true);
                setSearchFocusTrigger((c) => c + 1);
              }
            }}
            onToggleFullscreen={() => void toggleFullscreen()}
            onOpenSettings={() => setSettingsOpen(true)}
            onMinimizeWindow={() => void minimizeCurrentWindow()}
            onToggleMaximizeWindow={() =>
              void toggleMaximizeCurrentWindow().then(() =>
                isWindowMaximized().then(setIsMaximized),
              )
            }
            onCloseWindow={() => void closeCurrentWindow()}
          />

          <TabStrip
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
            onCloseTab={closeTab}
            onPopOutTab={(tab) => void popOutTab(tab)}
          />
        </div>
      )}

      <main className="relative flex flex-1 overflow-hidden">
        {activeTab?.status === 'ready' && (
          <SidebarShell
            isOpen={sidebarOpen}
            outline={activeTab.outline}
            expandedTocIds={activeTab.expandedTocIds}
            onExpandedTocIdsChange={(ids) =>
              updateActiveTab((tab) => ({ ...tab, expandedTocIds: ids }))
            }
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
            onWidthCommit={(w) =>
              handleUpdateSettings({ ...settingsRef.current, sidebarWidth: w })
            }
            activePanelId={activeSidebarPanel}
            onSelectPanel={setActiveSidebarPanel}
            onSelectDestination={(page, topPt) => navigateToPage(page, topPt)}
          />
        )}

        {searchOpen && activeTab?.status === 'ready' && (
          <SearchBar
            query={searchQuery}
            caseSensitive={caseSensitive}
            totalMatches={searchMatches.length}
            activeMatchIndex={activeMatchIndex}
            isIndexing={isSearchIndexing}
            focusTrigger={searchFocusTrigger}
            onQueryChange={setSearchQuery}
            onToggleCaseSensitive={() => setCaseSensitive((v) => !v)}
            onPrevMatch={() => stepSearchMatch(-1)}
            onNextMatch={() => stepSearchMatch(1)}
            onClose={() => {
              setSearchOpen(false);
              setSearchQuery('');
              setSearchMatches([]);
              setActiveMatchIndex(-1);
            }}
          />
        )}

        {!activeTab && (
          <EmptyState
            recentDocuments={recentDocuments}
            onOpenFile={() => void handleOpenPicker()}
            onOpenRecent={(p) => void openFilePaths([p])}
            onRemoveRecent={(hash) => {
              void removeRecentDocument(hash).then(() => refreshRecentDocuments());
            }}
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
            viewportRef={viewportRef}
            matchesByPage={matchesByPage}
            activeMatch={activeMatch}
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
            onNavigateToPage={(page, topPt) => navigateToPage(page, topPt)}
          />
        )}
      </main>

      <SettingsDialog
        isOpen={settingsOpen}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onClose={() => setSettingsOpen(false)}
      />

      {windowError && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-50 px-3.5 py-2 text-xs text-red-700 shadow-lg dark:bg-red-950/90 dark:text-red-200"
        >
          <span>{windowError}</span>
          <button
            type="button"
            onClick={() => setWindowError(null)}
            className="rounded px-1.5 py-0.5 font-medium hover:bg-red-500/15"
          >
            Dismiss
          </button>
        </div>
      )}

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
