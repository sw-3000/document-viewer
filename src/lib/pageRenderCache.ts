import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { PageDimension } from '../types/viewer';
import { computeHiDpiCanvasSize } from './zoom';

export function makeScaleKey(scale: number, dpr: number): string {
  return `${scale.toFixed(3)}@${dpr.toFixed(2)}`;
}

export function makePageCacheKey(pageNumber: number, scale: number, dpr: number): string {
  return `${pageNumber}@${makeScaleKey(scale, dpr)}`;
}

interface CacheEntry {
  pageNumber: number;
  scaleKey: string;
  canvas: HTMLCanvasElement;
}

interface InFlightEntry {
  pageNumber: number;
  scaleKey: string;
  promise: Promise<HTMLCanvasElement | null>;
  cancel: () => void;
}

function releaseCanvasMemory(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Bounded LRU offscreen canvas cache for paginated (Single Page / Two Pages)
 * view modes so flipping to adjacent pages/spreads blits instantaneously
 * without placeholder flicker while capping GPU bitmap memory.
 */
export class PageRenderCache {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlightEntry>();

  constructor(maxEntries = 10) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get size(): number {
    return this.entries.size;
  }

  get(pageNumber: number, scale: number, dpr: number): HTMLCanvasElement | null {
    const key = makePageCacheKey(pageNumber, scale, dpr);
    const hit = this.entries.get(key);
    if (!hit) return null;
    // Promote to most recently used
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.canvas;
  }

  set(
    pageNumber: number,
    scale: number,
    dpr: number,
    canvas: HTMLCanvasElement,
  ): void {
    const scaleKey = makeScaleKey(scale, dpr);
    const key = `${pageNumber}@${scaleKey}`;
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.canvas !== canvas) {
        releaseCanvasMemory(existing.canvas);
      }
      this.entries.delete(key);
    }

    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) {
        releaseCanvasMemory(oldest.canvas);
      }
    }

    this.entries.set(key, { pageNumber, scaleKey, canvas });
  }

  prune(allowedPages: Set<number>, scale: number, dpr: number): void {
    const currentScaleKey = makeScaleKey(scale, dpr);

    for (const [key, entry] of this.entries) {
      if (entry.scaleKey !== currentScaleKey || !allowedPages.has(entry.pageNumber)) {
        this.entries.delete(key);
        releaseCanvasMemory(entry.canvas);
      }
    }

    for (const [key, task] of this.inFlight) {
      if (task.scaleKey !== currentScaleKey || !allowedPages.has(task.pageNumber)) {
        this.inFlight.delete(key);
        task.cancel();
      }
    }
  }

  prefetch(
    pdfDoc: PDFDocumentProxy,
    pageNumber: number,
    dimension: PageDimension,
    scale: number,
    dpr: number,
  ): Promise<HTMLCanvasElement | null> {
    const cached = this.get(pageNumber, scale, dpr);
    if (cached) {
      return Promise.resolve(cached);
    }

    const scaleKey = makeScaleKey(scale, dpr);
    const key = `${pageNumber}@${scaleKey}`;
    const existingTask = this.inFlight.get(key);
    if (existingTask) {
      return existingTask.promise;
    }

    let cancelled = false;
    let activeTask: RenderTask | null = null;
    let activePage: PDFPageProxy | null = null;
    let offscreenCanvas: HTMLCanvasElement | null = null;

    const cancel = () => {
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
      if (offscreenCanvas) {
        releaseCanvasMemory(offscreenCanvas);
        offscreenCanvas = null;
      }
    };

    const promise = (async (): Promise<HTMLCanvasElement | null> => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) {
          page.cleanup();
          return null;
        }
        activePage = page;

        const { pixelWidth, pixelHeight, renderScale } = computeHiDpiCanvasSize(
          dimension,
          scale,
          dpr,
        );

        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = pixelWidth;
        offscreenCanvas.height = pixelHeight;

        const ctx = offscreenCanvas.getContext('2d', { alpha: false });
        if (!ctx) {
          releaseCanvasMemory(offscreenCanvas);
          offscreenCanvas = null;
          return null;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pixelWidth, pixelHeight);

        const viewport = page.getViewport({ scale: renderScale });
        activeTask = page.render({
          canvasContext: ctx,
          canvas: offscreenCanvas,
          viewport,
        });

        await activeTask.promise;
        if (cancelled || !offscreenCanvas) {
          if (offscreenCanvas) {
            releaseCanvasMemory(offscreenCanvas);
          }
          return null;
        }

        const completedCanvas = offscreenCanvas;
        offscreenCanvas = null;
        this.set(pageNumber, scale, dpr, completedCanvas);
        return completedCanvas;
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (offscreenCanvas) {
          releaseCanvasMemory(offscreenCanvas);
          offscreenCanvas = null;
        }
        if (e?.name !== 'RenderingCancelledException' && !cancelled) {
          return null;
        }
        return null;
      } finally {
        this.inFlight.delete(key);
        if (activePage) {
          try {
            activePage.cleanup();
          } catch {
            // Ignore cleanup error
          }
        }
      }
    })();

    this.inFlight.set(key, { pageNumber, scaleKey, promise, cancel });
    return promise;
  }

  clear(): void {
    for (const task of this.inFlight.values()) {
      task.cancel();
    }
    this.inFlight.clear();

    for (const entry of this.entries.values()) {
      releaseCanvasMemory(entry.canvas);
    }
    this.entries.clear();
  }
}
