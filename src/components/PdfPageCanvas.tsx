import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { PageDimension, PdfLinkAnnotation, SearchMatch } from '../types/viewer';
import { computeHiDpiCanvasSize } from '../lib/zoom';
import { extractPageLinks } from '../services/pdfEngine';

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  dimension: PageDimension;
  scale: number;
  devicePixelRatio: number;
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
  matchesForPage,
  activeMatchId,
  onNavigateToPage,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);
  const [links, setLinks] = useState<PdfLinkAnnotation[]>([]);

  const sizing = computeHiDpiCanvasSize(dimension, scale, devicePixelRatio);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let activeTask: RenderTask | null = null;
    let activePage: PDFPageProxy | null = null;

    setRendered(false);

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) {
          page.cleanup();
          return;
        }
        activePage = page;

        const { pixelWidth, pixelHeight, renderScale } = computeHiDpiCanvasSize(
          dimension,
          scale,
          devicePixelRatio,
        );

        canvas.width = pixelWidth;
        canvas.height = pixelHeight;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        // Paint crisp white paper base before rendering
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pixelWidth, pixelHeight);

        const viewport = page.getViewport({ scale: renderScale });
        activeTask = page.render({
          canvasContext: ctx,
          canvas,
          viewport,
        });

        await activeTask.promise;
        if (!cancelled) {
          setRendered(true);
        }

        // Extract internal PDF links lazily for interactive TOC/cross-reference clicks
        const pageLinks = await extractPageLinks(pdfDoc, page);
        if (!cancelled) {
          setLinks(pageLinks);
        }
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e?.name !== 'RenderingCancelledException' && !cancelled) {
          // Keep page box visible even if a single complex page errors
          setRendered(true);
        }
      }
    };

    void renderPage();

    return () => {
      cancelled = true;
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
      // Explicitly release GPU backing bitmap on eviction
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [pdfDoc, pageNumber, dimension.widthPt, dimension.heightPt, scale, devicePixelRatio]);

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

      {!rendered && (
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
