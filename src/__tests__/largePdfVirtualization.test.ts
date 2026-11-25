import { describe, expect, it } from 'vitest';
import {
  buildVisibleRowsForMode,
  computeRowLayouts,
  computeScrollOffsetRatio,
  computeScrollTopFromRatio,
  findVisibleRowRange,
} from '../lib/virtualization';
import { buildPageTextDataFromRuns, findMatchesInPageText } from '../lib/searchEngine';
import type { PageDimension } from '../types/viewer';

describe('600-page mixed-dimension PDF stress test', () => {
  const totalPages = 600;
  const mixedDimensions: PageDimension[] = Array.from({ length: totalPages }, (_, idx) =>
    idx >= 500
      ? { widthPt: 792, heightPt: 612 } // Landscape appendix pages
      : { widthPt: 612, heightPt: 792 }, // Standard portrait pages
  );

  it('maintains bounded canvas eviction window and exact scroll ratio roundtrips across 600 pages', () => {
    const rows = buildVisibleRowsForMode(totalPages, 'continuous', true, 1);
    const metrics = computeRowLayouts(rows, mixedDimensions, 1.2);

    expect(metrics.rows).toHaveLength(600);
    expect(metrics.maxRowWidth).toBe(Math.round(792 * (96 / 72) * 1.2));

    // Check several positions throughout the 600-page document
    for (const samplePage of [1, 150, 350, 505, 600]) {
      const targetTop = metrics.rows[samplePage - 1]!.top;
      const visible = findVisibleRowRange(metrics.rows, targetTop, 820, 2);

      expect(visible.renderedPages.length).toBeLessThanOrEqual(7);
      expect(visible.renderedPages).toContain(samplePage);

      const ratio = computeScrollOffsetRatio(targetTop, metrics.totalHeight, 820);
      const restored = computeScrollTopFromRatio(ratio, metrics.totalHeight, 820);
      const maxScroll = Math.max(0, metrics.totalHeight - 820);
      expect(restored).toBeCloseTo(Math.min(targetTop, maxScroll), 1);
    }
  });

  it('indexes and finds search matches cleanly across 600 simulated pages', () => {
    const matches = [];
    for (let p = 1; p <= totalPages; p++) {
      const text = buildPageTextDataFromRuns(p, [
        {
          str: p % 75 === 0 ? `Milestone section ${p} benchmark` : `Routine paragraph ${p}`,
          leftPct: 12,
          topPct: 18,
          widthPct: 50,
          heightPct: 2,
        },
      ]);
      matches.push(...findMatchesInPageText(text, 'benchmark', false));
    }

    expect(matches).toHaveLength(8);
    expect(matches.map((m) => m.pageNumber)).toEqual([75, 150, 225, 300, 375, 450, 525, 600]);
  });
});
