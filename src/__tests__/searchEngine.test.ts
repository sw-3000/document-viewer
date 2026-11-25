import { describe, expect, it } from 'vitest';
import {
  buildPageTextDataFromRuns,
  findMatchesInPageText,
  wrapMatchIndex,
} from '../lib/searchEngine';

describe('searchEngine', () => {
  it('finds case-insensitive and case-sensitive matches with bounding boxes', () => {
    const pageData = buildPageTextDataFromRuns(3, [
      { str: 'Tauri', leftPct: 10, topPct: 10, widthPct: 10, heightPct: 2 },
      { str: 'PDF reader', leftPct: 22, topPct: 10, widthPct: 20, heightPct: 2 },
      { str: 'tauri fast', leftPct: 10, topPct: 15, widthPct: 20, heightPct: 2 },
    ]);

    const insensitive = findMatchesInPageText(pageData, 'tauri', false);
    expect(insensitive).toHaveLength(2);
    expect(insensitive[0]!.pageNumber).toBe(3);
    expect(insensitive[0]!.boxes).toHaveLength(1);
    expect(insensitive[0]!.boxes[0]!.leftPct).toBeCloseTo(10, 4);

    const sensitive = findMatchesInPageText(pageData, 'Tauri', true);
    expect(sensitive).toHaveLength(1);
    expect(sensitive[0]!.matchIndexOnPage).toBe(0);
  });

  it('produces multi-run highlight boxes when a query spans adjacent runs', () => {
    const pageData = buildPageTextDataFromRuns(1, [
      { str: 'Document', leftPct: 10, topPct: 20, widthPct: 16, heightPct: 2 },
      { str: 'Viewer', leftPct: 28, topPct: 20, widthPct: 12, heightPct: 2 },
    ]);

    const matches = findMatchesInPageText(pageData, 'Document Viewer', false);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.boxes).toHaveLength(2);
  });

  it('wraps match indices cleanly forward and backward', () => {
    expect(wrapMatchIndex(-1, 1, 5)).toBe(0);
    expect(wrapMatchIndex(-1, -1, 5)).toBe(4);
    expect(wrapMatchIndex(4, 1, 5)).toBe(0);
    expect(wrapMatchIndex(0, -1, 5)).toBe(4);
    expect(wrapMatchIndex(0, 1, 0)).toBe(-1);
  });
});
