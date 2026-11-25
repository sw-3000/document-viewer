import { describe, expect, it } from 'vitest';
import {
  buildAllTwoPageSpreads,
  buildVisibleRowsForMode,
  computeRowLayouts,
  findSpreadForPage,
  findVisibleRowRange,
} from '../lib/virtualization';
import type { PageDimension } from '../types/viewer';

describe('virtualization engine', () => {
  it('virtualizes a 1,000-page document to visible rows plus 2-page buffer only', () => {
    const totalPages = 1000;
    const dims: PageDimension[] = Array.from({ length: totalPages }, () => ({
      widthPt: 612,
      heightPt: 792,
    }));

    const rows = buildVisibleRowsForMode(totalPages, 'continuous', true, 1);
    expect(rows).toHaveLength(1000);

    const metrics = computeRowLayouts(rows, dims, 1.0);
    expect(metrics.totalHeight).toBeGreaterThan(1_000_000);

    // Scroll to roughly the middle of the 1,000-page book
    const midScroll = metrics.rows[499]!.top;
    const visible = findVisibleRowRange(metrics.rows, midScroll, 800, 2);

    expect(visible.primaryPage).toBe(500);
    // Viewport 800px holds ~1-2 pages of 1056px height + 2 above + 2 below => <= 6 pages total
    expect(visible.renderedPages.length).toBeLessThanOrEqual(7);
    expect(visible.renderedPages).toContain(498);
    expect(visible.renderedPages).toContain(500);
    expect(visible.renderedPages).toContain(502);
    expect(visible.renderedPages).not.toContain(1);
    expect(visible.renderedPages).not.toContain(1000);
  });

  it('builds facing spreads cleanly with and without cover-page offset', () => {
    expect(buildAllTwoPageSpreads(5, true)).toEqual([[1], [2, 3], [4, 5]]);
    expect(buildAllTwoPageSpreads(5, false)).toEqual([[1, 2], [3, 4], [5]]);

    const withCover = findSpreadForPage(4, 5, true);
    expect(withCover.spreadIndex).toBe(2);
    expect(withCover.spreads[withCover.spreadIndex]).toEqual([4, 5]);

    const withoutCover = findSpreadForPage(4, 5, false);
    expect(withoutCover.spreadIndex).toBe(1);
    expect(withoutCover.spreads[withoutCover.spreadIndex]).toEqual([3, 4]);
  });

  it('returns discrete single-page or two-page rows in non-continuous modes', () => {
    expect(buildVisibleRowsForMode(20, 'single', true, 7)).toEqual([
      { rowIndex: 0, pages: [7] },
    ]);
    expect(buildVisibleRowsForMode(20, 'two-page', true, 7)).toEqual([
      { rowIndex: 0, pages: [6, 7] },
    ]);
    expect(buildVisibleRowsForMode(20, 'two-page', true, 1)).toEqual([
      { rowIndex: 0, pages: [1] },
    ]);
  });
});
