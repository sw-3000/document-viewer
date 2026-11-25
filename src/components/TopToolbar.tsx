import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns2,
  File as FileIcon,
  FolderOpen,
  Maximize2,
  Minimize2,
  PanelLeft,
  Rows3,
  Search,
  Settings,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { TabSession, ViewMode, ZoomMode } from '../types/viewer';
import { ZOOM_PRESETS, formatZoomPercent } from '../lib/zoom';

interface TopToolbarProps {
  session: TabSession | null;
  effectiveScale: number;
  sidebarOpen: boolean;
  searchOpen: boolean;
  isFullscreen: boolean;
  isMaximized?: boolean;
  onOpenFile: () => void;
  onToggleSidebar: () => void;
  onJumpToPage: (page: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onChangeViewMode: (mode: ViewMode) => void;
  onToggleCoverOffset: () => void;
  onChangeZoomMode: (mode: ZoomMode, customScale?: number) => void;
  onZoomStep: (direction: 'in' | 'out') => void;
  onToggleSearch: () => void;
  onToggleFullscreen: () => void;
  onOpenSettings: () => void;
  onMinimizeWindow?: () => void;
  onToggleMaximizeWindow?: () => void;
  onCloseWindow?: () => void;
}

export function TopToolbar({
  session,
  effectiveScale,
  sidebarOpen,
  searchOpen,
  isFullscreen,
  isMaximized = false,
  onOpenFile,
  onToggleSidebar,
  onJumpToPage,
  onPrevPage,
  onNextPage,
  onChangeViewMode,
  onToggleCoverOffset,
  onChangeZoomMode,
  onZoomStep,
  onToggleSearch,
  onToggleFullscreen,
  onOpenSettings,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onCloseWindow,
}: TopToolbarProps) {
  const hasReadyDoc = session !== null && session.status === 'ready';
  const [pageInput, setPageInput] = useState(session ? String(session.currentPage) : '');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);

  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const viewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  const zoomTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (session) {
      setPageInput(String(session.currentPage));
    } else {
      setPageInput('');
    }
  }, [session?.id, session?.currentPage]);

  // Close open toolbar dropdowns on outside pointerdown (across entire document,
  // including PDF canvas/sidebar) and on Escape (capturing before global shortcuts).
  useEffect(() => {
    if (!viewMenuOpen && !zoomMenuOpen) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (viewMenuOpen && target && !viewMenuRef.current?.contains(target)) {
        setViewMenuOpen(false);
      }
      if (zoomMenuOpen && target && !zoomMenuRef.current?.contains(target)) {
        setZoomMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (viewMenuOpen) {
        setViewMenuOpen(false);
        viewTriggerRef.current?.focus();
      }
      if (zoomMenuOpen) {
        setZoomMenuOpen(false);
        zoomTriggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [viewMenuOpen, zoomMenuOpen]);

  const handlePageSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const parsed = Number.parseInt(pageInput.trim(), 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.min(Math.max(1, parsed), Math.max(1, session.totalPages));
      onJumpToPage(clamped);
      setPageInput(String(clamped));
    } else {
      setPageInput(String(session.currentPage));
    }
  };

  const viewModeIcon =
    session?.viewMode === 'single' ? (
      <FileIcon className="h-4 w-4" />
    ) : session?.viewMode === 'two-page' ? (
      <Columns2 className="h-4 w-4" />
    ) : (
      <Rows3 className="h-4 w-4" />
    );

  const zoomLabel =
    session?.zoomMode === 'fit-width'
      ? `Fit Width (${formatZoomPercent(effectiveScale)})`
      : session?.zoomMode === 'fit-page'
        ? `Fit Page (${formatZoomPercent(effectiveScale)})`
        : formatZoomPercent(effectiveScale);

  return (
    <header
      data-tauri-drag-region
      className="relative z-30 flex h-11 shrink-0 items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-2.5 pr-0 backdrop-blur-md"
    >
      {/* Left group: Sidebar + Open */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggleSidebar}
          disabled={!hasReadyDoc}
          title="Toggle Sidebar (Ctrl+B)"
          aria-label="Toggle Sidebar"
          aria-pressed={sidebarOpen}
          className={`rounded-md p-1.5 transition ${
            sidebarOpen && hasReadyDoc
              ? 'bg-black/8 text-neutral-900 dark:bg-white/12 dark:text-white'
              : 'text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/8'
          } disabled:pointer-events-none disabled:opacity-35`}
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onOpenFile}
          title="Open PDF (Ctrl+O)"
          aria-label="Open PDF"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/8"
        >
          <FolderOpen className="h-4 w-4" />
          <span className="hidden sm:inline">Open</span>
        </button>
      </div>

      {/* Left flexible drag region */}
      <div data-tauri-drag-region className="h-full min-w-2 flex-1" />

      {/* Center group: Page Navigation + View Mode + Zoom (or document title) */}
      {hasReadyDoc && session ? (
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Page indicator / quick-jump */}
          <div className="flex items-center rounded-md border border-black/8 bg-white/70 px-1 py-0.5 dark:border-white/10 dark:bg-neutral-800/70">
            <button
              type="button"
              onClick={onPrevPage}
              disabled={session.currentPage <= 1}
              title="Previous Page"
              aria-label="Previous Page"
              className="rounded p-0.5 text-neutral-600 hover:bg-black/5 disabled:opacity-35 dark:text-neutral-300 dark:hover:bg-white/10"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <form onSubmit={handlePageSubmit} className="flex items-center gap-1 px-1">
              <input
                type="text"
                inputMode="numeric"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => setPageInput(String(session.currentPage))}
                aria-label="Current page number"
                className="w-10 rounded bg-transparent text-center text-xs font-medium tabular-nums text-neutral-900 outline-none focus:bg-black/5 dark:text-neutral-100 dark:focus:bg-white/10"
              />
              <span className="text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
                / {session.totalPages}
              </span>
            </form>
            <button
              type="button"
              onClick={onNextPage}
              disabled={session.currentPage >= session.totalPages}
              title="Next Page"
              aria-label="Next Page"
              className="rounded p-0.5 text-neutral-600 hover:bg-black/5 disabled:opacity-35 dark:text-neutral-300 dark:hover:bg-white/10"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mx-0.5 h-4 w-px bg-black/10 dark:bg-white/10" />

          {/* View Mode Selector */}
          <div ref={viewMenuRef} className="relative">
            <button
              ref={viewTriggerRef}
              type="button"
              onClick={() => {
                setViewMenuOpen((v) => !v);
                setZoomMenuOpen(false);
              }}
              title="View Mode"
              aria-label="View Mode"
              aria-haspopup="menu"
              aria-expanded={viewMenuOpen}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/8"
            >
              {viewModeIcon}
              <span className="hidden md:inline">
                {session.viewMode === 'continuous'
                  ? 'Continuous'
                  : session.viewMode === 'single'
                    ? 'Single Page'
                    : 'Two Pages'}
              </span>
            </button>

            {viewMenuOpen && (
              <div
                role="menu"
                aria-label="View Mode Options"
                className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-black/10 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-neutral-900"
              >
                {(
                  [
                    { id: 'continuous', label: 'Continuous Scroll', icon: Rows3 },
                    { id: 'single', label: 'Single Page', icon: FileIcon },
                    { id: 'two-page', label: 'Two Pages', icon: Columns2 },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const active = session.viewMode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onChangeViewMode(item.id);
                        setViewMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ${
                        active
                          ? 'bg-blue-600/10 font-medium text-blue-600 dark:text-blue-400'
                          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                    </button>
                  );
                })}

                <div className="my-1 h-px bg-black/8 dark:bg-white/10" />
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={session.coverOffset}
                  onClick={() => {
                    onToggleCoverOffset();
                    setViewMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <span className="flex items-center gap-2">
                    <BookOpen className="h-3.5 w-3.5" />
                    Cover Page Offset
                  </span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      session.coverOffset
                        ? 'bg-blue-600 dark:bg-blue-400'
                        : 'bg-neutral-300 dark:bg-neutral-600'
                    }`}
                  />
                </button>
              </div>
            )}
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onZoomStep('out')}
              title="Zoom Out (Ctrl+-)"
              aria-label="Zoom Out"
              className="rounded-md p-1.5 text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/8"
            >
              <ZoomOut className="h-4 w-4" />
            </button>

            <div ref={zoomMenuRef} className="relative">
              <button
                ref={zoomTriggerRef}
                type="button"
                onClick={() => {
                  setZoomMenuOpen((v) => !v);
                  setViewMenuOpen(false);
                }}
                title="Zoom Options"
                aria-label="Zoom Options"
                aria-haspopup="menu"
                aria-expanded={zoomMenuOpen}
                className="min-w-[84px] rounded-md px-2 py-1 text-center text-xs font-medium tabular-nums text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/8"
              >
                {zoomLabel}
              </button>

              {zoomMenuOpen && (
                <div
                  role="menu"
                  aria-label="Zoom Presets"
                  className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-black/10 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-neutral-900"
                >
                  {(
                    [
                      { mode: 'fit-width', label: 'Fit Width' },
                      { mode: 'fit-page', label: 'Fit Page' },
                      { mode: 'actual-size', label: 'Actual Size (100%)' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.mode}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onChangeZoomMode(opt.mode);
                        setZoomMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs ${
                        session.zoomMode === opt.mode
                          ? 'bg-blue-600/10 font-medium text-blue-600 dark:text-blue-400'
                          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-black/8 dark:bg-white/10" />
                  {ZOOM_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onChangeZoomMode('custom', preset);
                        setZoomMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-md px-2.5 py-1 text-left text-xs tabular-nums text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      {Math.round(preset * 100)}%
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onZoomStep('in')}
              title="Zoom In (Ctrl++)"
              aria-label="Zoom In"
              className="rounded-md p-1.5 text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/8"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div
          data-tauri-drag-region
          className="flex h-full items-center truncate px-2 text-xs font-medium text-neutral-500 dark:text-neutral-400"
        >
          {session ? session.fileName : 'Document Viewer'}
        </div>
      )}

      {/* Right flexible drag region */}
      <div data-tauri-drag-region className="h-full min-w-2 flex-1" />

      {/* Right group: Search, Fullscreen, Settings + Windows caption controls */}
      <div className="flex h-full shrink-0 items-center">
        <div className="flex items-center gap-1 pr-1.5">
          <button
            type="button"
            onClick={onToggleSearch}
            disabled={!hasReadyDoc}
            title="Find in Document (Ctrl+F)"
            aria-label="Find in Document"
            aria-pressed={searchOpen}
            className={`rounded-md p-1.5 transition ${
              searchOpen && hasReadyDoc
                ? 'bg-black/8 text-neutral-900 dark:bg-white/12 dark:text-white'
                : 'text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/8'
            } disabled:pointer-events-none disabled:opacity-35`}
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen (Esc / F11)' : 'Fullscreen (F11)'}
            aria-label="Toggle Fullscreen"
            className="rounded-md p-1.5 text-neutral-600 transition hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/8"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings (Ctrl+,)"
            aria-label="Settings"
            className="rounded-md p-1.5 text-neutral-600 transition hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/8"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {/* Integrated Windows 11 Caption Controls */}
        <div className="flex h-full items-stretch border-l border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onMinimizeWindow}
            aria-label="Minimize"
            title="Minimize"
            className="flex h-full w-11 items-center justify-center text-neutral-700 transition-colors hover:bg-black/6 dark:text-neutral-200 dark:hover:bg-white/10"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 5h8" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>

          <button
            type="button"
            onClick={onToggleMaximizeWindow}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            title={isMaximized ? 'Restore' : 'Maximize'}
            className="flex h-full w-11 items-center justify-center text-neutral-700 transition-colors hover:bg-black/6 dark:text-neutral-200 dark:hover:bg-white/10"
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path
                  d="M3 1.5h5.5V7M1.5 3h5.5v5.5H1.5z"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <rect
                  x="1.5"
                  y="1.5"
                  width="7"
                  height="7"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={onCloseWindow}
            aria-label="Close"
            title="Close"
            className="flex h-full w-11 items-center justify-center text-neutral-700 transition-colors hover:bg-[#c42b1c] hover:text-white active:bg-[#b3271a] dark:text-neutral-200"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M1.5 1.5l7 7M8.5 1.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.1"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
