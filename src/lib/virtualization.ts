import type { PageDimension, ViewMode } from '../types/viewer';
import { CSS_UNITS } from './zoom';

export interface PageRow {
  rowIndex: number;
  pages: number[];
}

export interface RowLayout {
  rowIndex: number;
  pages: number[];
  top: number;
  height: number;
  width: number;
}

export interface LayoutMetrics {
  rows: RowLayout[];
  totalHeight: number;
  maxRowWidth: number;
}

export interface VisibleRange {
  startRow: number;
  endRow: number;
  primaryPage: number;
  renderedPages: number[];
}

export interface LayoutOptions {
  pageGap?: number;
  verticalPadding?: number;
  spreadGap?: number;
}

/**
 * Generates page rows (spreads) for the active view mode.
 * In continuous mode, every page is one row.
 * In single mode, only the active page is shown.
 * In two-page mode, only the active spread is shown (supporting cover-page offset).
 */
export function buildAllTwoPageSpreads(totalPages: number, coverOffset: boolean): number[][] {
  if (totalPages <= 0) return [];
  const spreads: number[][] = [];
  let page = 1;
  if (coverOffset) {
    spreads.push([1]);
    page = 2;
  }
  while (page <= totalPages) {
    if (page + 1 <= totalPages) {
      spreads.push([page, page + 1]);
      page += 2;
    } else {
      spreads.push([page]);
      page += 1;
    }
  }
  return spreads;
}

export function findSpreadForPage(
  pageNumber: number,
  totalPages: number,
  coverOffset: boolean,
): { spreadIndex: number; spreads: number[][] } {
  const spreads = buildAllTwoPageSpreads(totalPages, coverOffset);
  if (spreads.length === 0) return { spreadIndex: 0, spreads };
  const clamped = Math.min(Math.max(1, pageNumber), totalPages);
  const idx = spreads.findIndex((pair) => pair.includes(clamped));
  return { spreadIndex: idx >= 0 ? idx : 0, spreads };
}

export function buildVisibleRowsForMode(
  totalPages: number,
  viewMode: ViewMode,
  coverOffset: boolean,
  currentPage: number,
): PageRow[] {
  if (totalPages <= 0) return [];
  const clampedPage = Math.min(Math.max(1, currentPage), totalPages);

  if (viewMode === 'continuous') {
    const rows: PageRow[] = new Array(totalPages);
    for (let i = 0; i < totalPages; i++) {
      rows[i] = { rowIndex: i, pages: [i + 1] };
    }
    return rows;
  }

  if (viewMode === 'single') {
    return [{ rowIndex: 0, pages: [clampedPage] }];
  }

  const { spreadIndex, spreads } = findSpreadForPage(clampedPage, totalPages, coverOffset);
  const activeSpread = spreads[spreadIndex] ?? [clampedPage];
  return [{ rowIndex: 0, pages: activeSpread }];
}

export function computeRowLayouts(
  rows: PageRow[],
  pageDimensions: PageDimension[],
  scale: number,
  options: LayoutOptions = {},
): LayoutMetrics {
  const pageGap = options.pageGap ?? 18;
  const verticalPadding = options.verticalPadding ?? 24;
  const spreadGap = options.spreadGap ?? 16;

  const fallbackDim: PageDimension = pageDimensions[0] ?? { widthPt: 612, heightPt: 792 };
  const layouts: RowLayout[] = new Array(rows.length);

  let y = verticalPadding;
  let maxRowWidth = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let width = 0;
    let height = 0;

    for (let j = 0; j < row.pages.length; j++) {
      const pNum = row.pages[j]!;
      const dim = pageDimensions[pNum - 1] ?? fallbackDim;
      const wPx = Math.round(dim.widthPt * CSS_UNITS * scale);
      const hPx = Math.round(dim.heightPt * CSS_UNITS * scale);
      width += wPx;
      if (j > 0) width += spreadGap;
      if (hPx > height) height = hPx;
    }

    layouts[i] = {
      rowIndex: row.rowIndex,
      pages: row.pages,
      top: y,
      height,
      width,
    };

    if (width > maxRowWidth) maxRowWidth = width;
    y += height + (i < rows.length - 1 ? pageGap : 0);
  }

  const totalHeight = rows.length > 0 ? y + verticalPadding : 0;
  return { rows: layouts, totalHeight, maxRowWidth };
}

/**
 * Binary-searches row offsets in O(log N) and returns only the rows intersecting
 * the viewport plus `bufferRows` lookahead above and below.
 */
export function findVisibleRowRange(
  layouts: RowLayout[],
  scrollTop: number,
  viewportHeight: number,
  bufferRows = 2,
): VisibleRange {
  if (layouts.length === 0) {
    return { startRow: 0, endRow: -1, primaryPage: 1, renderedPages: [] };
  }

  const viewBottom = scrollTop + Math.max(1, viewportHeight);

  // Find first row whose bottom >= scrollTop
  let lo = 0;
  let hi = layouts.length - 1;
  let firstVisible = layouts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const row = layouts[mid]!;
    if (row.top + row.height >= scrollTop) {
      firstVisible = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  // Find last row whose top <= viewBottom
  lo = firstVisible;
  hi = layouts.length - 1;
  let lastVisible = firstVisible;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const row = layouts[mid]!;
    if (row.top <= viewBottom) {
      lastVisible = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // Primary page: row whose center is closest to viewport midpoint (or first intersecting >= 40%)
  const viewMid = scrollTop + viewportHeight * 0.4;
  let primaryRow = firstVisible;
  for (let i = firstVisible; i <= lastVisible; i++) {
    const row = layouts[i]!;
    if (row.top <= viewMid && row.top + row.height >= viewMid) {
      primaryRow = i;
      break;
    }
    if (row.top > viewMid) {
      primaryRow = i;
      break;
    }
  }

  const startRow = Math.max(0, firstVisible - bufferRows);
  const endRow = Math.min(layouts.length - 1, lastVisible + bufferRows);

  const renderedPages: number[] = [];
  for (let i = startRow; i <= endRow; i++) {
    renderedPages.push(...layouts[i]!.pages);
  }

  const primaryPage = layouts[primaryRow]?.pages[0] ?? 1;
  return { startRow, endRow, primaryPage, renderedPages };
}

export function computeScrollOffsetRatio(
  scrollTop: number,
  totalHeight: number,
  viewportHeight: number,
): number {
  const maxScroll = Math.max(1, totalHeight - viewportHeight);
  return Math.min(1, Math.max(0, scrollTop / maxScroll));
}

export function computeScrollTopFromRatio(
  ratio: number,
  totalHeight: number,
  viewportHeight: number,
): number {
  const maxScroll = Math.max(0, totalHeight - viewportHeight);
  const clamped = Math.min(1, Math.max(0, ratio));
  return clamped * maxScroll;
}

export interface ScrollAnchor {
  pageNumber: number;
  /** Fractional offset from row.top relative to row.height */
  offsetWithinRow: number;
}

/**
 * Captures a scale-independent reading anchor `(pageNumber, offsetWithinRow)`
 * for the topmost row intersecting `scrollTop` so window/sidebar resizes
 * keep the exact same page and relative line in view.
 */
export function captureScrollAnchor(
  layouts: RowLayout[],
  scrollTop: number,
): ScrollAnchor | null {
  if (layouts.length === 0) return null;

  let lo = 0;
  let hi = layouts.length - 1;
  let targetIdx = layouts.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const row = layouts[mid]!;
    if (row.top + row.height >= scrollTop) {
      targetIdx = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  const row = layouts[targetIdx]!;
  const rawFraction = (scrollTop - row.top) / Math.max(1, row.height);
  const offsetWithinRow = Math.min(1.5, Math.max(-0.5, rawFraction));

  return {
    pageNumber: row.pages[0] ?? 1,
    offsetWithinRow,
  };
}

/**
 * Resolves a captured `ScrollAnchor` back to a pixel `scrollTop` in a newly
 * computed layout (after zoom or viewport resize).
 */
export function resolveScrollTopForAnchor(
  layouts: RowLayout[],
  anchor: ScrollAnchor,
): number {
  if (layouts.length === 0) return 0;

  const direct = layouts[anchor.pageNumber - 1];
  const row =
    direct && direct.pages.includes(anchor.pageNumber)
      ? direct
      : layouts.find((r) => r.pages.includes(anchor.pageNumber)) ?? layouts[0]!;

  return Math.max(0, Math.round(row.top + anchor.offsetWithinRow * row.height));
}
