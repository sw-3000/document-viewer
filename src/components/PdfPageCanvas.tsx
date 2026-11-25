import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { PageDimension, PdfLinkAnnotation, SearchMatch } from '../types/viewer';
import { computeHiDpiCanvasSize } from '../lib/zoom';
import type { PageRenderCache } from '../lib/pageRenderCache';
import { extractPageLinks } from '../services/pdfEngine';

export const LOADING_PLACEHOLDER_DELAY_MS = 180;
export const RESIZE_RENDER_DEBOUNCE_MS = 140;

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  dimension: PageDimension;
  scale: number;
  devicePixelRatio: number;
  renderCache?: PageRenderCache;
  matchesForPage?: SearchMatch[];
  activeMatchId?: string | null;
  onNavigateToPage?: (pageNumber: number, topPt?: number | null) => void;
}

export function PdfPageCanvas({
  pdfDoc,
  pageNumber,
  dimension,
  scale,
  devicePixelRatio,
  renderCache,
  matchesForPage,
  activeMatchId,
  onNavigateToPage,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [links, setLinks] = useState<PdfLinkAnnotation[]>([]);

  const renderedIdentityRef = useRef<{
    pdfDoc: PDFDocumentProxy;
    pageNumber: number;
  } | null>(null);
  const hasBitmapRef = useRef(false);

  const sizing = computeHiDpiCanvasSize(dimension, scale, devicePixelRatio);

  // Release GPU backing bitmap strictly on component unmount/eviction so live scale
  // changes on a mounted page keep the previous sharp bitmap intact via CSS scaling.
  useEffect(() => {
    return () => {
      hasBitmapRef.current = false;
      renderedIdentityRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, []);

  // Two-phase macOS Preview-style rendering:
  // - Cache hit: synchronous blit on visible canvas.
  // - Rescale of already-rendered mounted page: keep existing bitmap CSS-scaled (zero clear/flicker),
  //   then debounce offscreen HiDPI re-render and atomically blit once settled.
  // - Brand new page mount (cache miss): render offscreen immediately with 180ms delayed placeholder.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let activeTask: RenderTask | null = null;
    let activePage: PDFPageProxy | null = null;
    let offscreenCanvas: HTMLCanvasElement | null = null;
    let placeholderTimer: number | null = null;
    let debounceTimer: number | null = null;

    const clearTimers = () => {
      if (placeholderTimer !== null) {
        window.clearTimeout(placeholderTimer);
        placeholderTimer = null;
      }
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };

    const cached = renderCache?.get(pageNumber, scale, devicePixelRatio) ?? null;
    if (cached) {
      canvas.width = cached.width;
      canvas.height = cached.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.drawImage(cached, 0, 0);
      }
      hasBitmapRef.current = true;
      renderedIdentityRef.current = { pdfDoc, pageNumber };
      setShowPlaceholder(false);

      void (async () => {
        try {
          const page = await pdfDoc.getPage(pageNumber);
          if (cancelled) {
            page.cleanup();
            return;
          }
          activePage = page;
          const pageLinks = await extractPageLinks(pdfDoc, page);
          if (!cancelled) {
            setLinks(pageLinks);
          }
        } catch {
          // Ignore link extraction failures
        }
      })();

      return () => {
        cancelled = true;
        clearTimers();
        if (activePage) {
          try {
            activePage.cleanup();
          } catch {
            // Ignore cleanup error
          }
        }
      };
    }

    const isSamePageRescale =
      hasBitmapRef.current &&
      renderedIdentityRef.current?.pdfDoc === pdfDoc &&
      renderedIdentityRef.current?.pageNumber === pageNumber;

    const { pixelWidth, pixelHeight, renderScale } = computeHiDpiCanvasSize(
      dimension,
      scale,
      devicePixelRatio,
    );

    if (!isSamePageRescale) {
      hasBitmapRef.current = false;
      renderedIdentityRef.current = { pdfDoc, pageNumber };
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      const visibleCtx = canvas.getContext('2d', { alpha: false });
      if (visibleCtx) {
        visibleCtx.fillStyle = '#ffffff';
        visibleCtx.fillRect(0, 0, pixelWidth, pixelHeight);
      }
      setShowPlaceholder(false);
      placeholderTimer = window.setTimeout(() => {
        if (!cancelled) {
          setShowPlaceholder(true);
        }
      }, LOADING_PLACEHOLDER_DELAY_MS);
    } else {
      setShowPlaceholder(false);
    }

    const renderPage = async () => {
      try {
        if (renderCache) {
          const completed = await renderCache.prefetch(
            pdfDoc,
            pageNumber,
            dimension,
            scale,
            devicePixelRatio,
          );
          if (cancelled) return;
          clearTimers();
          if (completed) {
            canvas.width = completed.width;
            canvas.height = completed.height;
            const ctx = canvas.getContext('2d', { alpha: false });
            if (ctx) {
              ctx.drawImage(completed, 0, 0);
            }
            hasBitmapRef.current = true;
            renderedIdentityRef.current = { pdfDoc, pageNumber };
          }
          setShowPlaceholder(false);

          const page = await pdfDoc.getPage(pageNumber);
          if (cancelled) {
            page.cleanup();
            return;
          }
          activePage = page;
          const pageLinks = await extractPageLinks(pdfDoc, page);
          if (!cancelled) {
            setLinks(pageLinks);
          }
          return;
        }

        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) {
          page.cleanup();
          return;
        }
        activePage = page;

        // Render completely offscreen first, then resize & blit onto visible canvas atomically
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = pixelWidth;
        offscreenCanvas.height = pixelHeight;
        const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false });
        const visibleCtx = canvas.getContext('2d', { alpha: false });

        const targetCanvas = offscreenCtx ? offscreenCanvas : canvas;
        const targetCtx = offscreenCtx ?? visibleCtx;
        if (!targetCtx) {
          clearTimers();
          if (offscreenCanvas) {
            offscreenCanvas.width = 0;
            offscreenCanvas.height = 0;
            offscreenCanvas = null;
          }
          return;
        }

        if (!offscreenCtx) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
        }

        targetCtx.fillStyle = '#ffffff';
        targetCtx.fillRect(0, 0, pixelWidth, pixelHeight);

        const viewport = page.getViewport({ scale: renderScale });
        activeTask = page.render({
          canvasContext: targetCtx,
          canvas: targetCanvas,
          viewport,
        });

        await activeTask.promise;
        if (cancelled) return;

        clearTimers();
        if (offscreenCtx && offscreenCanvas) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
          const postCtx = canvas.getContext('2d', { alpha: false });
          if (postCtx) {
            postCtx.drawImage(offscreenCanvas, 0, 0);
          }
        }
        if (offscreenCanvas) {
          offscreenCanvas.width = 0;
          offscreenCanvas.height = 0;
          offscreenCanvas = null;
        }
        hasBitmapRef.current = true;
        renderedIdentityRef.current = { pdfDoc, pageNumber };
        setShowPlaceholder(false);

        const pageLinks = await extractPageLinks(pdfDoc, page);
        if (!cancelled) {
          setLinks(pageLinks);
        }
      } catch (err: unknown) {
        const e = err as { name?: string };
        clearTimers();
        if (e?.name !== 'RenderingCancelledException' && !cancelled) {
          setShowPlaceholder(false);
        }
      }
    };

    if (isSamePageRescale) {
      debounceTimer = window.setTimeout(() => {
        if (!cancelled) {
          void renderPage();
        }
      }, RESIZE_RENDER_DEBOUNCE_MS);
    } else {
      void renderPage();
    }

    return () => {
      cancelled = true;
      clearTimers();
      if (activeTask) {
        try {
          activeTask.cancel();
        } catch {
          // Ignore cancel error
        }
      }
      if (activePage) {
        try {
          activePage.cleanup();
        } catch {
          // Ignore cleanup error
        }
      }
      if (offscreenCanvas) {
        offscreenCanvas.width = 0;
        offscreenCanvas.height = 0;
        offscreenCanvas = null;
      }
    };
  }, [
    pdfDoc,
    pageNumber,
    dimension.widthPt,
    dimension.heightPt,
    scale,
    devicePixelRatio,
    renderCache,
  ]);

  return (
    <div
      className="relative shrink-0 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.12),0_1px_2px_rgba(15,23,42,0.08)] dark:shadow-[0_4px_18px_rgba(0,0,0,0.45)] ring-1 ring-black/5 dark:ring-white/10"
      style={{
        width: `${sizing.cssWidth}px`,
        height: `${sizing.cssHeight}px`,
      }}
      data-page-number={pageNumber}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{
          width: `${sizing.cssWidth}px`,
          height: `${sizing.cssHeight}px`,
        }}
      />

      {showPlaceholder && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/80 text-xs font-medium text-neutral-400"
        >
          Page {pageNumber}
        </div>
      )}

      {/* Search highlights overlay */}
      {matchesForPage && matchesForPage.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {matchesForPage.map((match) => {
            const isActive = match.id === activeMatchId;
            return match.boxes.map((box, idx) => (
              <div
                key={`${match.id}-${idx}`}
                className={
                  isActive
                    ? 'absolute rounded-[2px] bg-orange-500/40 ring-2 ring-orange-500'
                    : 'absolute rounded-[2px] bg-amber-300/45'
                }
                style={{
                  left: `${box.leftPct}%`,
                  top: `${box.topPct}%`,
                  width: `${box.widthPct}%`,
                  height: `${box.heightPct}%`,
                }}
              />
            ));
          })}
        </div>
      )}

      {/* Internal PDF link overlays */}
      {links.length > 0 && (
        <div className="absolute inset-0">
          {links.map((link) => (
            <button
              key={link.id}
              type="button"
              title={
                link.destPage !== null
                  ? `Jump to page ${link.destPage}`
                  : link.url ?? 'External link'
              }
              onClick={() => {
                if (link.destPage !== null && onNavigateToPage) {
                  onNavigateToPage(link.destPage, link.destTopPt);
                }
              }}
              className="absolute cursor-pointer rounded-[2px] hover:bg-blue-500/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              style={{
                left: `${link.leftPct}%`,
                top: `${link.topPct}%`,
                width: `${link.widthPct}%`,
                height: `${link.heightPct}%`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
