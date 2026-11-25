import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  PageDimension,
  SearchMatch,
  TabSession,
  ViewMode,
  ZoomMode,
} from '../types/viewer';
import {
  buildVisibleRowsForMode,
  captureScrollAnchor,
  computeRowLayouts,
  computeScrollOffsetRatio,
  computeScrollTopFromRatio,
  findVisibleRowRange,
  getPaginatedPrefetchPages,
  resolveScrollTopForAnchor,
  type ScrollAnchor,
} from '../lib/virtualization';
import { PageRenderCache } from '../lib/pageRenderCache';
import { CSS_UNITS, clampScale, computeScaleForZoomMode } from '../lib/zoom';
import { PdfPageCanvas } from './PdfPageCanvas';

interface PdfViewportProps {
  session: TabSession;
  pdfDoc: PDFDocumentProxy;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  matchesByPage?: Map<number, SearchMatch[]>;
  activeMatch?: SearchMatch | null;
  onPageChange: (pageNumber: number) => void;
  onScrollRatioChange: (ratio: number) => void;
  onWheelZoom: (newScale: number) => void;
  onComputedScaleChange: (effectiveScale: number) => void;
  onNavigateToPage: (pageNumber: number, topPt?: number | null) => void;
}

const BUFFER_ROWS = 2;
const SPREAD_GAP = 16;
const PAGE_GAP = 18;
const VERTICAL_PADDING = 24;

export function PdfViewport({
  session,
  pdfDoc,
  viewportRef,
  matchesByPage,
  activeMatch,
  onPageChange,
  onScrollRatioChange,
  onWheelZoom,
  onComputedScaleChange,
  onNavigateToPage,
}: PdfViewportProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const internalRef = useRef<HTMLDivElement | null>(null);
  const containerRef = viewportRef ?? internalRef;
  const [viewportSize, setViewportSize] = useState({ width: 900, height: 700 });
  const [hasMeasuredViewport, setHasMeasuredViewport] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [dpr, setDpr] = useState(() =>
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  );
  const renderCache = useMemo(() => new PageRenderCache(10), [pdfDoc]);
  const lastPrefetchScaleRef = useRef<{ scale: number; dpr: number } | null>(null);

  useEffect(() => {
    lastPrefetchScaleRef.current = null;
    return () => {
      renderCache.clear();
    };
  }, [renderCache]);

  // Track pending zoom anchor so Ctrl+Wheel zooms around cursor cleanly
  const zoomAnchorRef = useRef<{
    contentXRatio: number;
    contentYRatio: number;
    clientOffsetX: number;
    clientOffsetY: number;
  } | null>(null);

  const restoredInitialScrollRef = useRef<string | null>(null);
  const lastNavSeqRef = useRef<number>(0);
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null);
  const isRestoringScrollRef = useRef(false);
  const prevLayoutRef = useRef<{
    sessionId: string;
    scale: number;
    viewMode: ViewMode;
    totalHeight: number;
  } | null>(null);

  const applyProgrammaticScrollTop = useCallback(
    (el: HTMLDivElement, targetTop: number, totalHeight: number) => {
      const maxScroll = Math.max(0, totalHeight - el.clientHeight);
      const clampedTop = Math.min(maxScroll, Math.max(0, targetTop));
      isRestoringScrollRef.current = true;
      el.scrollTop = clampedTop;
      setScrollTop(clampedTop);

      const releaseGuard = () => {
        isRestoringScrollRef.current = false;
      };
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(releaseGuard);
      } else {
        queueMicrotask(releaseGuard);
      }
      return clampedTop;
    },
    [],
  );

  // Observe non-scrolling outer wrapper so scrollbar appearance/disappearance
  // can never trigger a ResizeObserver -> zoom -> scrollbar feedback loop.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const updateSize = () => {
      const nextW = Math.floor(wrapper.clientWidth);
      const nextH = Math.floor(wrapper.clientHeight);
      if (nextW > 0 && nextH > 0) {
        setHasMeasuredViewport(true);
      }
      setViewportSize((prev) =>
        prev.width === nextW && prev.height === nextH
          ? prev
          : { width: nextW, height: nextH },
      );
    };
    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(wrapper);

    const handleDprChange = () => {
      setDpr(window.devicePixelRatio || 1);
    };
    window.addEventListener('resize', handleDprChange);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleDprChange);
    };
  }, []);

  // Build rows for active view mode
  const rows = useMemo(
    () =>
      buildVisibleRowsForMode(
        session.totalPages,
        session.viewMode,
        session.coverOffset,
        session.currentPage,
      ),
    [session.totalPages, session.viewMode, session.coverOffset, session.currentPage],
  );

  // Determine effective logical scale from zoomMode & current page/spread dimensions
  const effectiveScale = useMemo(() => {
    const activeRow = rows[0];
    const p1Num =
      session.viewMode === 'continuous' ? session.currentPage : activeRow?.pages[0] ?? 1;
    const p2Num =
      session.viewMode === 'two-page' && activeRow && activeRow.pages.length > 1
        ? activeRow.pages[1]
        : undefined;

    const firstDim: PageDimension = session.pageDimensions[p1Num - 1] ??
      session.pageDimensions[0] ?? { widthPt: 612, heightPt: 792 };
    const secondDim: PageDimension | undefined = p2Num
      ? session.pageDimensions[p2Num - 1]
      : undefined;

    return computeScaleForZoomMode(session.zoomMode, session.zoomScale, {
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      page: firstDim,
      secondPage: secondDim,
      spreadGap: SPREAD_GAP,
    });
  }, [
    rows,
    session.viewMode,
    session.currentPage,
    session.pageDimensions,
    session.zoomMode,
    session.zoomScale,
    viewportSize.width,
    viewportSize.height,
  ]);

  useEffect(() => {
    onComputedScaleChange(effectiveScale);
  }, [effectiveScale, onComputedScaleChange]);

  // Pre-render ±1 adjacent pages/spreads in paginated modes (Single Page / Two Pages)
  // so page flips blit from cache immediately without placeholder flicker.
  // Debounce cache pruning/prefetching when scale/dpr is actively resizing so live window
  // drags do not thrash PageRenderCache on every intermediate pixel tick.
  useEffect(() => {
    if (session.viewMode === 'continuous' || session.totalPages <= 0) {
      return;
    }

    const prefetchPages = getPaginatedPrefetchPages(
      session.totalPages,
      session.viewMode,
      session.coverOffset,
      session.currentPage,
      1,
    );
    const allowedSet = new Set(prefetchPages);

    const prevScale = lastPrefetchScaleRef.current;
    const isRescaling =
      prevScale !== null &&
      (prevScale.scale !== effectiveScale || prevScale.dpr !== dpr);
    const delayMs = isRescaling ? 150 : 0;

    if (!isRescaling) {
      lastPrefetchScaleRef.current = { scale: effectiveScale, dpr };
      renderCache.prune(allowedSet, effectiveScale, dpr);
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      lastPrefetchScaleRef.current = { scale: effectiveScale, dpr };
      renderCache.prune(allowedSet, effectiveScale, dpr);
      for (const pageNum of prefetchPages) {
        if (cancelled) return;
        const dim = session.pageDimensions[pageNum - 1] ??
          session.pageDimensions[0] ?? { widthPt: 612, heightPt: 792 };
        void renderCache.prefetch(pdfDoc, pageNum, dim, effectiveScale, dpr);
      }
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    pdfDoc,
    renderCache,
    session.viewMode,
    session.totalPages,
    session.coverOffset,
    session.currentPage,
    session.pageDimensions,
    effectiveScale,
    dpr,
  ]);

  const layoutMetrics = useMemo(
    () =>
      computeRowLayouts(rows, session.pageDimensions, effectiveScale, {
        pageGap: PAGE_GAP,
        verticalPadding: VERTICAL_PADDING,
        spreadGap: SPREAD_GAP,
      }),
    [rows, session.pageDimensions, effectiveScale],
  );

  const visibleRange = useMemo(
    () =>
      findVisibleRowRange(
        layoutMetrics.rows,
        scrollTop,
        viewportSize.height,
        BUFFER_ROWS,
      ),
    [layoutMetrics.rows, scrollTop, viewportSize.height],
  );

  // Apply cursor-anchored wheel zoom or resize scroll-anchoring synchronously
  // before paint so resizing the window/sidebar never jumps to a wrong page.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const anchor = zoomAnchorRef.current;
    if (anchor) {
      zoomAnchorRef.current = null;
      const targetScrollLeft = Math.max(
        0,
        anchor.contentXRatio * Math.max(el.scrollWidth, layoutMetrics.maxRowWidth) -
          anchor.clientOffsetX,
      );
      const targetScrollTop = Math.max(
        0,
        anchor.contentYRatio * layoutMetrics.totalHeight - anchor.clientOffsetY,
      );
      el.scrollLeft = targetScrollLeft;
      const applied = applyProgrammaticScrollTop(el, targetScrollTop, layoutMetrics.totalHeight);
      if (session.viewMode === 'continuous') {
        scrollAnchorRef.current = captureScrollAnchor(layoutMetrics.rows, applied);
      }
      prevLayoutRef.current = {
        sessionId: session.id,
        scale: effectiveScale,
        viewMode: session.viewMode,
        totalHeight: layoutMetrics.totalHeight,
      };
      return;
    }

    const prev = prevLayoutRef.current;
    prevLayoutRef.current = {
      sessionId: session.id,
      scale: effectiveScale,
      viewMode: session.viewMode,
      totalHeight: layoutMetrics.totalHeight,
    };

    if (
      session.viewMode !== 'continuous' ||
      restoredInitialScrollRef.current !== session.id ||
      !prev ||
      prev.sessionId !== session.id ||
      prev.viewMode !== 'continuous'
    ) {
      return;
    }

    if (prev.scale === effectiveScale && prev.totalHeight === layoutMetrics.totalHeight) {
      return;
    }

    const activeAnchor =
      scrollAnchorRef.current ?? { pageNumber: session.currentPage, offsetWithinRow: 0 };
    const targetTop = resolveScrollTopForAnchor(layoutMetrics.rows, activeAnchor);
    const applied = applyProgrammaticScrollTop(el, targetTop, layoutMetrics.totalHeight);
    scrollAnchorRef.current = captureScrollAnchor(layoutMetrics.rows, applied);
    onScrollRatioChange(
      computeScrollOffsetRatio(applied, layoutMetrics.totalHeight, el.clientHeight),
    );
  }, [
    session.id,
    session.viewMode,
    session.currentPage,
    effectiveScale,
    layoutMetrics.totalHeight,
    layoutMetrics.maxRowWidth,
    layoutMetrics.rows,
    applyProgrammaticScrollTop,
    onScrollRatioChange,
  ]);

  // Restore saved scroll position once on document open after viewport measurement
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasMeasuredViewport || restoredInitialScrollRef.current === session.id) return;
    if (layoutMetrics.totalHeight <= 0) return;

    restoredInitialScrollRef.current = session.id;
    prevLayoutRef.current = {
      sessionId: session.id,
      scale: effectiveScale,
      viewMode: session.viewMode,
      totalHeight: layoutMetrics.totalHeight,
    };

    if (session.viewMode === 'continuous') {
      if (session.scrollOffsetRatio > 0) {
        const target = computeScrollTopFromRatio(
          session.scrollOffsetRatio,
          layoutMetrics.totalHeight,
          el.clientHeight,
        );
        const applied = applyProgrammaticScrollTop(el, target, layoutMetrics.totalHeight);
        scrollAnchorRef.current = captureScrollAnchor(layoutMetrics.rows, applied);
      } else if (session.currentPage > 1) {
        const targetRow = layoutMetrics.rows[session.currentPage - 1];
        if (targetRow) {
          const target = Math.max(0, targetRow.top - VERTICAL_PADDING);
          const applied = applyProgrammaticScrollTop(el, target, layoutMetrics.totalHeight);
          scrollAnchorRef.current = captureScrollAnchor(layoutMetrics.rows, applied);
        }
      } else {
        scrollAnchorRef.current = captureScrollAnchor(layoutMetrics.rows, 0);
      }
    } else {
      applyProgrammaticScrollTop(el, 0, layoutMetrics.totalHeight);
      scrollAnchorRef.current = null;
    }
  }, [
    hasMeasuredViewport,
    session.id,
    session.viewMode,
    session.scrollOffsetRatio,
    session.currentPage,
    effectiveScale,
    layoutMetrics.totalHeight,
    layoutMetrics.rows,
    applyProgrammaticScrollTop,
  ]);

  // Handle explicit jump navigation (TOC, page input, search match, link)
  useEffect(() => {
    const nav = session.navigationRequest;
    if (!nav || nav.seq === lastNavSeqRef.current) return;
    lastNavSeqRef.current = nav.seq;

    const el = containerRef.current;
    if (!el) return;

    if (session.viewMode === 'continuous') {
      const targetRow = layoutMetrics.rows[nav.pageNumber - 1];
      if (targetRow) {
        let extraOffset = 0;
        if (nav.topPct !== null && nav.topPct !== undefined) {
          extraOffset = Math.max(0, (nav.topPct / 100) * targetRow.height - 80);
        } else if (nav.topPt !== null && nav.topPt !== undefined) {
          const dim = session.pageDimensions[nav.pageNumber - 1];
          if (dim) {
            const fromTopPt = Math.max(0, dim.heightPt - nav.topPt);
            extraOffset = fromTopPt * CSS_UNITS * effectiveScale;
          }
        }
        const targetTop = Math.max(0, targetRow.top + extraOffset - 16);
        const applied = applyProgrammaticScrollTop(el, targetTop, layoutMetrics.totalHeight);
        scrollAnchorRef.current = captureScrollAnchor(layoutMetrics.rows, applied);
        onScrollRatioChange(
          computeScrollOffsetRatio(applied, layoutMetrics.totalHeight, el.clientHeight),
        );
      }
    } else {
      applyProgrammaticScrollTop(el, 0, layoutMetrics.totalHeight);
      scrollAnchorRef.current = null;
    }
  }, [
    session.navigationRequest,
    session.viewMode,
    session.pageDimensions,
    layoutMetrics.rows,
    layoutMetrics.totalHeight,
    effectiveScale,
    applyProgrammaticScrollTop,
    onScrollRatioChange,
  ]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (isRestoringScrollRef.current) return;

    const nextTop = el.scrollTop;
    setScrollTop(nextTop);

    if (session.viewMode === 'continuous') {
      scrollAnchorRef.current = captureScrollAnchor(layoutMetrics.rows, nextTop);
      const range = findVisibleRowRange(
        layoutMetrics.rows,
        nextTop,
        el.clientHeight,
        BUFFER_ROWS,
      );
      if (range.primaryPage !== session.currentPage) {
        onPageChange(range.primaryPage);
      }
      onScrollRatioChange(
        computeScrollOffsetRatio(nextTop, layoutMetrics.totalHeight, el.clientHeight),
      );
    }
  }, [
    session.viewMode,
    session.currentPage,
    layoutMetrics.rows,
    layoutMetrics.totalHeight,
    onPageChange,
    onScrollRatioChange,
  ]);

  // Ctrl + Mouse Wheel / trackpad pinch zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const clientOffsetX = e.clientX - rect.left;
      const clientOffsetY = e.clientY - rect.top;
      const contentW = Math.max(el.scrollWidth, layoutMetrics.maxRowWidth, 1);
      const contentH = Math.max(layoutMetrics.totalHeight, 1);

      zoomAnchorRef.current = {
        contentXRatio: (el.scrollLeft + clientOffsetX) / contentW,
        contentYRatio: (el.scrollTop + clientOffsetY) / contentH,
        clientOffsetX,
        clientOffsetY,
      };

      const zoomFactor = Math.exp(-e.deltaY * 0.0022);
      const nextScale = clampScale(effectiveScale * zoomFactor);
      onWheelZoom(nextScale);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [effectiveScale, layoutMetrics.maxRowWidth, layoutMetrics.totalHeight, onWheelZoom]);

  const visibleRowsSlice = useMemo(() => {
    if (visibleRange.endRow < visibleRange.startRow) return [];
    return layoutMetrics.rows.slice(visibleRange.startRow, visibleRange.endRow + 1);
  }, [layoutMetrics.rows, visibleRange.startRow, visibleRange.endRow]);

  const isDiscreteSmall =
    session.viewMode !== 'continuous' && layoutMetrics.totalHeight <= viewportSize.height;

  return (
    <div
      ref={wrapperRef}
      className="relative flex-1 min-w-0 min-h-0 overflow-hidden bg-[var(--bg-canvas)]"
    >
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="pdf-scroll-container relative h-full w-full overflow-auto bg-[var(--bg-canvas)] focus:outline-none"
        tabIndex={0}
        aria-label="PDF document viewport"
      >
        <div
          className={
            isDiscreteSmall
              ? 'relative mx-auto flex min-h-full w-full items-center justify-center px-6'
              : 'relative mx-auto w-full px-6'
          }
          style={{
            height: isDiscreteSmall ? undefined : `${layoutMetrics.totalHeight}px`,
            minWidth: `${layoutMetrics.maxRowWidth + 48}px`,
          }}
        >
        {isDiscreteSmall ? (
          <div className="flex items-center justify-center gap-4 py-6">
            {visibleRowsSlice[0]?.pages.map((pageNum) => {
              const dim = session.pageDimensions[pageNum - 1] ??
                session.pageDimensions[0] ?? { widthPt: 612, heightPt: 792 };
              return (
                <PdfPageCanvas
                  key={`${session.id}-p-${pageNum}`}
                  pdfDoc={pdfDoc}
                  pageNumber={pageNum}
                  dimension={dim}
                  scale={effectiveScale}
                  devicePixelRatio={dpr}
                  renderCache={renderCache}
                  matchesForPage={matchesByPage?.get(pageNum)}
                  activeMatchId={activeMatch?.id}
                  onNavigateToPage={onNavigateToPage}
                />
              );
            })}
          </div>
        ) : (
          visibleRowsSlice.map((row) => (
            <div
              key={`${session.id}-row-${row.rowIndex}`}
              className="absolute left-0 right-0 flex items-start justify-center gap-4"
              style={{
                top: `${row.top}px`,
                height: `${row.height}px`,
              }}
            >
              {row.pages.map((pageNum) => {
                const dim = session.pageDimensions[pageNum - 1] ??
                  session.pageDimensions[0] ?? { widthPt: 612, heightPt: 792 };
                return (
                  <PdfPageCanvas
                    key={`${session.id}-p-${pageNum}`}
                    pdfDoc={pdfDoc}
                    pageNumber={pageNum}
                    dimension={dim}
                    scale={effectiveScale}
                    devicePixelRatio={dpr}
                    renderCache={session.viewMode !== 'continuous' ? renderCache : undefined}
                    matchesForPage={matchesByPage?.get(pageNum)}
                    activeMatchId={activeMatch?.id}
                    onNavigateToPage={onNavigateToPage}
                  />
                );
              })}
            </div>
          ))
        )}
        </div>
      </div>
    </div>
  );
}

// Re-export types so callers importing from PdfViewport don't duplicate
export type { ViewMode, ZoomMode };
