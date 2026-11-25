import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ListTree } from 'lucide-react';
import type { OutlineNode } from '../../types/viewer';
import { TocPanel } from './TocPanel';

export const DEFAULT_SIDEBAR_WIDTH = 272;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;
export const MAX_SIDEBAR_VIEWPORT_RATIO = 0.45;

export function getMaxSidebarWidth(windowWidth: number): number {
  const safeWinW = Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : 1120;
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, Math.floor(safeWinW * MAX_SIDEBAR_VIEWPORT_RATIO)),
  );
}

export function clampSidebarWidth(width: number, windowWidth: number): number {
  const maxAllowed = getMaxSidebarWidth(windowWidth);
  const raw = Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH;
  return Math.round(Math.min(maxAllowed, Math.max(MIN_SIDEBAR_WIDTH, raw)));
}

export interface SidebarPanelDefinition {
  id: string;
  title: string;
  icon: ReactNode;
  render: () => ReactNode;
}

interface SidebarShellProps {
  isOpen: boolean;
  outline: OutlineNode[];
  expandedTocIds?: string[] | null;
  onExpandedTocIdsChange?: (nextIds: string[]) => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  onWidthCommit?: (width: number) => void;
  activePanelId: string;
  onSelectPanel: (panelId: string) => void;
  onSelectDestination: (pageNumber: number, topPt: number | null) => void;
  extraPanels?: SidebarPanelDefinition[];
}

export function SidebarShell({
  isOpen,
  outline,
  expandedTocIds,
  onExpandedTocIdsChange,
  width = DEFAULT_SIDEBAR_WIDTH,
  onWidthChange,
  onWidthCommit,
  activePanelId,
  onSelectPanel,
  onSelectDestination,
  extraPanels = [],
}: SidebarShellProps) {
  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1120,
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  if (!isOpen) return null;

  const maxAllowed = getMaxSidebarWidth(windowWidth);
  const effectiveWidth = clampSidebarWidth(width, windowWidth);

  const panels: SidebarPanelDefinition[] = [
    {
      id: 'toc',
      title: 'Contents',
      icon: <ListTree className="h-3.5 w-3.5" />,
      render: () => (
        <TocPanel
          outline={outline}
          expandedIds={expandedTocIds}
          onExpandedIdsChange={onExpandedTocIdsChange}
          onSelectDestination={onSelectDestination}
        />
      ),
    },
    ...extraPanels,
  ];

  const activePanel = panels.find((p) => p.id === activePanelId) ?? panels[0]!;

  const handleResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (typeof e.button === 'number' && e.button !== 0) return;
    e.preventDefault();

    dragCleanupRef.current?.();

    const startX = e.clientX ?? effectiveWidth;
    const startWidth = effectiveWidth;
    let latestWidth = startWidth;

    setIsDragging(true);
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.body.classList.add('select-none');

    const onPointerMove = (moveEvent: PointerEvent) => {
      const currentWinW = typeof window !== 'undefined' ? window.innerWidth : windowWidth;
      const clientX = typeof moveEvent.clientX === 'number' ? moveEvent.clientX : startX;
      const next = clampSidebarWidth(startWidth + (clientX - startX), currentWinW);
      if (next !== latestWidth) {
        latestWidth = next;
        onWidthChange?.(next);
      }
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      document.body.classList.remove('select-none');
      setIsDragging(false);
      dragCleanupRef.current = null;
    };

    const finishDrag = () => {
      cleanup();
      onWidthCommit?.(latestWidth);
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
  };

  const handleResizeDoubleClick = () => {
    const resetWidth = clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, windowWidth);
    onWidthChange?.(resetWidth);
    onWidthCommit?.(resetWidth);
  };

  const handleResizeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowLeft') {
      next = clampSidebarWidth(effectiveWidth - 16, windowWidth);
    } else if (e.key === 'ArrowRight') {
      next = clampSidebarWidth(effectiveWidth + 16, windowWidth);
    } else if (e.key === 'Home') {
      next = MIN_SIDEBAR_WIDTH;
    } else if (e.key === 'End') {
      next = maxAllowed;
    }
    if (next !== null) {
      e.preventDefault();
      onWidthChange?.(next);
      onWidthCommit?.(next);
    }
  };

  return (
    <aside
      aria-label="Document Sidebar"
      style={{ width: `${effectiveWidth}px` }}
      className="relative flex h-full shrink-0 flex-col border-r border-[var(--border-subtle)] bg-white/80 backdrop-blur-md dark:bg-neutral-900/85"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2">
        {panels.map((panel) => {
          const isActive = panel.id === activePanel.id;
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => onSelectPanel(panel.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition ${
                isActive
                  ? 'bg-black/8 text-neutral-900 dark:bg-white/12 dark:text-neutral-100'
                  : 'text-neutral-500 hover:bg-black/5 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/8 dark:hover:text-neutral-200'
              }`}
            >
              {panel.icon}
              <span>{panel.title}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {activePanel.render()}
      </div>

      {/* Vertical drag handle along the right edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={maxAllowed}
        aria-valuenow={effectiveWidth}
        tabIndex={0}
        onPointerDown={handleResizePointerDown}
        onDoubleClick={handleResizeDoubleClick}
        onKeyDown={handleResizeKeyDown}
        title="Drag to resize sidebar (double-click to reset)"
        className="group absolute bottom-0 right-0 top-0 z-20 flex w-2 translate-x-1/2 cursor-col-resize items-stretch justify-center focus:outline-none"
      >
        <div
          className={`h-full w-0.5 transition-colors ${
            isDragging
              ? 'bg-blue-500 dark:bg-blue-400'
              : 'bg-transparent group-hover:bg-blue-500/50 group-focus-visible:bg-blue-500 dark:group-hover:bg-blue-400/50'
          }`}
        />
      </div>
    </aside>
  );
}
