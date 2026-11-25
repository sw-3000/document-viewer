import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';

vi.mock('../services/pdfEngine', () => ({
  extractPageLinks: vi.fn(async () => []),
}));

import { LOADING_PLACEHOLDER_DELAY_MS, PdfPageCanvas } from '../components/PdfPageCanvas';
import { PageRenderCache } from '../lib/pageRenderCache';

describe('PdfPageCanvas flicker-free cached blit & delayed placeholder', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const drawImageSpy = vi.fn();
  const fillRectSpy = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    drawImageSpy.mockClear();
    fillRectSpy.mockClear();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: '#ffffff',
      fillRect: fillRectSpy,
      drawImage: drawImageSpy,
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    vi.useRealTimers();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('blits synchronously from PageRenderCache without ever flashing a "Page X" placeholder', async () => {
    const cache = new PageRenderCache(10);
    const cachedCanvas = document.createElement('canvas');
    cachedCanvas.width = 612;
    cachedCanvas.height = 792;
    cache.set(4, 1.0, 1, cachedCanvas);

    const fakePdfDoc = {
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 612, height: 792 }),
        render: vi.fn(),
        getAnnotations: async () => [],
        cleanup: vi.fn(),
      })),
    } as unknown as PDFDocumentProxy;

    render(
      <PdfPageCanvas
        pdfDoc={fakePdfDoc}
        pageNumber={4}
        dimension={{ widthPt: 612, heightPt: 792 }}
        scale={1.0}
        devicePixelRatio={1}
        renderCache={cache}
      />,
    );

    expect(screen.queryByText('Page 4')).not.toBeInTheDocument();
    expect(drawImageSpy).toHaveBeenCalledWith(cachedCanvas, 0, 0);

    // Even after advancing timers past placeholder delay and flushing link lookup, placeholder never appears
    await act(async () => {
      vi.advanceTimersByTime(LOADING_PLACEHOLDER_DELAY_MS + 100);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText('Page 4')).not.toBeInTheDocument();
  });

  it('suppresses "Page X" placeholder during fast renders and shows it only after the 180ms delay', async () => {
    let resolveRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => {
      resolveRender = resolve;
    });

    const fakePdfDoc = {
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 612, height: 792 }),
        render: () => ({ promise: renderPromise, cancel: vi.fn() }),
        getAnnotations: async () => [],
        cleanup: vi.fn(),
      })),
    } as unknown as PDFDocumentProxy;

    render(
      <PdfPageCanvas
        pdfDoc={fakePdfDoc}
        pageNumber={12}
        dimension={{ widthPt: 612, heightPt: 792 }}
        scale={1.0}
        devicePixelRatio={1}
      />,
    );

    // Immediately after flip and at 100ms, no placeholder flash occurs
    expect(screen.queryByText('Page 12')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByText('Page 12')).not.toBeInTheDocument();

    // Only if render genuinely exceeds 180ms does the subtle placeholder appear
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText('Page 12')).toBeInTheDocument();

    // Completing the render clears the placeholder immediately
    await act(async () => {
      resolveRender();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText('Page 12')).not.toBeInTheDocument();
  });
});
