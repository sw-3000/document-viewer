import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';

vi.mock('../services/pdfEngine', () => ({
  extractPageLinks: vi.fn(async () => []),
}));

import {
  CSS_UNITS,
  SCROLLBAR_GUTTER_PX,
  computeScaleForZoomMode,
} from '../lib/zoom';
import {
  buildVisibleRowsForMode,
  captureScrollAnchor,
  computeRowLayouts,
  findVisibleRowRange,
  resolveScrollTopForAnchor,
} from '../lib/virtualization';
import { PdfViewport } from '../components/PdfViewport';
import type { TabSession } from '../types/viewer';

describe('viewport zoom stability and zero resize oscillation', () => {
  it('converges monotonically across scrollbar-boundary widths without overflowing viewport', () => {
    const letter = { widthPt: 612, heightPt: 792 };

    let prevSingleScale = 0;
    let prevSpreadScale = 0;

    for (let width = 600; width <= 1600; width += 1) {
      const singleScale = computeScaleForZoomMode('fit-width', 1.0, {
        viewportWidth: width,
        viewportHeight: 820,
        page: letter,
      });
      const renderedWidthWithPad = Math.round(letter.widthPt * CSS_UNITS * singleScale) + 48;

      expect(singleScale).toBeGreaterThanOrEqual(prevSingleScale);
      expect(renderedWidthWithPad).toBeLessThanOrEqual(width - SCROLLBAR_GUTTER_PX);
      prevSingleScale = singleScale;

      const spreadScale = computeScaleForZoomMode('fit-width', 1.0, {
        viewportWidth: width,
        viewportHeight: 820,
        page: letter,
        secondPage: letter,
        spreadGap: 16,
      });
      const renderedSpreadWithPad =
        Math.round(letter.widthPt * CSS_UNITS * spreadScale) * 2 + 16 + 48;

      expect(spreadScale).toBeGreaterThanOrEqual(prevSpreadScale);
      expect(renderedSpreadWithPad).toBeLessThanOrEqual(width - SCROLLBAR_GUTTER_PX);
      prevSpreadScale = spreadScale;
    }
  });

  describe('PdfViewport ResizeObserver stability on sidebar toggle and window resize', () => {
    let observedCallback: ResizeObserverCallback | null = null;
    let observedTarget: Element | null = null;
    let mockWidth = 1120;
    let mockHeight = 776;
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    );
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight',
    );
    const originalGetContext = HTMLCanvasElement.prototype.getContext;

    beforeEach(() => {
      mockWidth = 1120;
      mockHeight = 776;
      observedCallback = null;
      observedTarget = null;

      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get: () => mockWidth,
      });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get: () => mockHeight,
      });
      HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

      globalThis.ResizeObserver = class MockResizeObserver {
        constructor(cb: ResizeObserverCallback) {
          observedCallback = cb;
        }
        observe(target: Element) {
          observedTarget = target;
        }
        disconnect() {}
        unobserve() {}
      };
    });

    afterEach(() => {
      globalThis.ResizeObserver = originalResizeObserver;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
      }
    });

    it('observes the non-scrolling wrapper and settles in a single scale update per resize', () => {
      const session: TabSession = {
        id: 'tab-stability',
        filePath: 'E:\\Docs\\book.pdf',
        fileName: 'book.pdf',
        docHash: 'hash1',
        fileSize: 2048,
        status: 'ready',
        passwordError: null,
        errorMessage: null,
        totalPages: 50,
        currentPage: 1,
        scrollOffsetRatio: 0,
        viewMode: 'continuous',
        coverOffset: true,
        zoomMode: 'fit-width',
        zoomScale: 1.0,
        pageDimensions: Array.from({ length: 50 }, () => ({
          widthPt: 612,
          heightPt: 792,
        })),
        outline: [],
        expandedTocIds: null,
        navigationRequest: null,
      };

      const fakePdfDoc = {
        getPage: vi.fn(async () => ({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 612 * scale,
            height: 792 * scale,
          }),
          render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
          getAnnotations: async () => [],
          cleanup: vi.fn(),
        })),
      } as unknown as PDFDocumentProxy;

      const scaleUpdates: number[] = [];

      render(
        <PdfViewport
          session={session}
          pdfDoc={fakePdfDoc}
          onPageChange={vi.fn()}
          onScrollRatioChange={vi.fn()}
          onWheelZoom={vi.fn()}
          onComputedScaleChange={(s) => scaleUpdates.push(s)}
          onNavigateToPage={vi.fn()}
        />,
      );

      // ResizeObserver must attach to the non-scrolling outer wrapper, NOT the scroll container
      const scrollContainer = screen.getByLabelText('PDF document viewport');
      expect(observedTarget).not.toBeNull();
      expect(observedTarget).not.toBe(scrollContainer);
      expect(observedTarget).toBe(scrollContainer.parentElement);

      const initialScaleCount = scaleUpdates.length;
      const initialScale = scaleUpdates[scaleUpdates.length - 1]!;

      // Simulate sidebar open (1120 -> 848)
      act(() => {
        mockWidth = 848;
        observedCallback?.([], {} as ResizeObserver);
      });
      // Re-fire ResizeObserver at the exact same dimensions (e.g., scrollbar toggle noise)
      act(() => {
        observedCallback?.([], {} as ResizeObserver);
      });

      expect(scaleUpdates.length).toBe(initialScaleCount + 1);
      const sidebarOpenScale = scaleUpdates[scaleUpdates.length - 1]!;
      expect(sidebarOpenScale).toBeLessThan(initialScale);

      // Simulate sidebar close (848 -> 1120)
      act(() => {
        mockWidth = 1120;
        observedCallback?.([], {} as ResizeObserver);
      });

      expect(scaleUpdates.length).toBe(initialScaleCount + 2);
      expect(scaleUpdates[scaleUpdates.length - 1]).toBe(initialScale);
    });

    it('keeps deep page 150 anchored across window and sidebar resizes without page jumping', () => {
      const totalPages = 400;
      const dims = Array.from({ length: totalPages }, () => ({
        widthPt: 612,
        heightPt: 792,
      }));
      const rows = buildVisibleRowsForMode(totalPages, 'continuous', true, 1);

      const initialFitScale = computeScaleForZoomMode('fit-width', 1.0, {
        viewportWidth: 1120,
        viewportHeight: 776,
        page: dims[0]!,
      });
      const initialLayout = computeRowLayouts(rows, dims, initialFitScale, {
        pageGap: 18,
        verticalPadding: 24,
        spreadGap: 16,
      });

      const page150Row = initialLayout.rows[149]!;
      const initialPage150ScrollTop = Math.round(page150Row.top + page150Row.height * 0.3);
      const initialScrollRatio =
        initialPage150ScrollTop / Math.max(1, initialLayout.totalHeight - 776);

      // Pure helper check across scale changes
      const captured = captureScrollAnchor(initialLayout.rows, initialPage150ScrollTop)!;
      expect(captured.pageNumber).toBe(150);
      expect(captured.offsetWithinRow).toBeCloseTo(0.3, 2);

      const session: TabSession = {
        id: 'tab-deep-anchor',
        filePath: 'E:\\Docs\\long-book.pdf',
        fileName: 'long-book.pdf',
        docHash: 'hash400',
        fileSize: 8192,
        status: 'ready',
        passwordError: null,
        errorMessage: null,
        totalPages,
        currentPage: 150,
        scrollOffsetRatio: initialScrollRatio,
        viewMode: 'continuous',
        coverOffset: true,
        zoomMode: 'fit-width',
        zoomScale: 1.0,
        pageDimensions: dims,
        outline: [],
        expandedTocIds: null,
        navigationRequest: null,
      };

      const fakePdfDoc = {
        getPage: vi.fn(async () => ({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 612 * scale,
            height: 792 * scale,
          }),
          render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
          getAnnotations: async () => [],
          cleanup: vi.fn(),
        })),
      } as unknown as PDFDocumentProxy;

      const onPageChange = vi.fn();

      render(
        <PdfViewport
          session={session}
          pdfDoc={fakePdfDoc}
          onPageChange={onPageChange}
          onScrollRatioChange={vi.fn()}
          onWheelZoom={vi.fn()}
          onComputedScaleChange={vi.fn()}
          onNavigateToPage={vi.fn()}
        />,
      );

      const scrollContainer = screen.getByLabelText('PDF document viewport');
      expect(Math.abs(scrollContainer.scrollTop - initialPage150ScrollTop)).toBeLessThanOrEqual(2);

      // Resize window narrower (1120 -> 780) and resize sidebar open/wider (780 -> 1360)
      for (const nextW of [780, 928, 1360, 848]) {
        act(() => {
          mockWidth = nextW;
          observedCallback?.([], {} as ResizeObserver);
        });

        const nextScale = computeScaleForZoomMode('fit-width', 1.0, {
          viewportWidth: nextW,
          viewportHeight: 776,
          page: dims[0]!,
        });
        const nextLayout = computeRowLayouts(rows, dims, nextScale, {
          pageGap: 18,
          verticalPadding: 24,
          spreadGap: 16,
        });
        const expectedTop = resolveScrollTopForAnchor(nextLayout.rows, captured);
        expect(Math.abs(scrollContainer.scrollTop - expectedTop)).toBeLessThanOrEqual(3);

        const visible = findVisibleRowRange(nextLayout.rows, scrollContainer.scrollTop, 776, 2);
        expect(visible.renderedPages).toContain(150);
      }

      // Page must never have jumped to a completely different page
      expect(onPageChange).not.toHaveBeenCalled();
    });
  });
});
