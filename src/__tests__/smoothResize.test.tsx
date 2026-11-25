import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';

vi.mock('../services/pdfEngine', () => ({
  extractPageLinks: vi.fn(async () => []),
}));

import {
  PdfPageCanvas,
  RESIZE_RENDER_DEBOUNCE_MS,
} from '../components/PdfPageCanvas';
import { CSS_UNITS } from '../lib/zoom';

describe('PdfPageCanvas macOS Preview-style two-phase smooth resize', () => {
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

  it('scales existing bitmap via CSS during rapid drags without clearing or re-rendering until resize settles', async () => {
    const renderCalls: number[] = [];

    const fakePdfDoc = {
      getPage: vi.fn(async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 612 * scale,
          height: 792 * scale,
        }),
        render: ({ viewport }: { viewport: { width: number } }) => {
          renderCalls.push(viewport.width);
          return { promise: Promise.resolve(), cancel: vi.fn() };
        },
        getAnnotations: async () => [],
        cleanup: vi.fn(),
      })),
    } as unknown as PDFDocumentProxy;

    const dimension = { widthPt: 612, heightPt: 792 };

    const { container, rerender } = render(
      <PdfPageCanvas
        pdfDoc={fakePdfDoc}
        pageNumber={1}
        dimension={dimension}
        scale={1.0}
        devicePixelRatio={1}
      />,
    );

    // Let initial render at scale=1.0 complete
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderCalls).toHaveLength(1);

    const visibleCanvas = container.querySelector('canvas')!;
    const initialPixelW = visibleCanvas.width;
    const initialPixelH = visibleCanvas.height;
    expect(initialPixelW).toBe(Math.round(612 * CSS_UNITS));
    expect(initialPixelH).toBe(Math.round(792 * CSS_UNITS));

    // Simulate rapid window drag / sidebar drag ticks every 20ms
    const dragScales = [1.05, 1.1, 1.15, 1.2, 1.25];
    for (const s of dragScales) {
      rerender(
        <PdfPageCanvas
          pdfDoc={fakePdfDoc}
          pageNumber={1}
          dimension={dimension}
          scale={s}
          devicePixelRatio={1}
        />,
      );

      // CSS display size updates immediately at 60fps
      expect(visibleCanvas.style.width).toBe(`${Math.round(612 * CSS_UNITS * s)}px`);
      expect(visibleCanvas.style.height).toBe(`${Math.round(792 * CSS_UNITS * s)}px`);

      // Visible canvas backing store stays intact (never cleared/zeroed during drag!)
      expect(visibleCanvas.width).toBe(initialPixelW);
      expect(visibleCanvas.height).toBe(initialPixelH);

      act(() => {
        vi.advanceTimersByTime(20);
      });
    }

    // Zero redundant PDF.js renders fired during the live drag
    expect(renderCalls).toHaveLength(1);

    // Advance past trailing debounce -> exactly one HiDPI re-render fires at final scale 1.25
    await act(async () => {
      vi.advanceTimersByTime(RESIZE_RENDER_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderCalls).toHaveLength(2);
    expect(visibleCanvas.width).toBe(Math.round(612 * CSS_UNITS * 1.25));
    expect(visibleCanvas.height).toBe(Math.round(792 * CSS_UNITS * 1.25));
    expect(drawImageSpy).toHaveBeenCalled();
  });
});
