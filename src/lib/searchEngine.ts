import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SearchMatch } from '../types/viewer';

function multiplyTransform(m1: number[], m2: number[]): [number, number, number, number, number, number] {
  const a1 = m1[0] ?? 1;
  const b1 = m1[1] ?? 0;
  const c1 = m1[2] ?? 0;
  const d1 = m1[3] ?? 1;
  const e1 = m1[4] ?? 0;
  const f1 = m1[5] ?? 0;

  const a2 = m2[0] ?? 1;
  const b2 = m2[1] ?? 0;
  const c2 = m2[2] ?? 0;
  const d2 = m2[3] ?? 1;
  const e2 = m2[4] ?? 0;
  const f2 = m2[5] ?? 0;

  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export interface ExtractedTextRun {
  str: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

export interface PageTextData {
  pageNumber: number;
  fullText: string;
  runs: Array<{
    start: number;
    end: number;
    leftPct: number;
    topPct: number;
    widthPct: number;
    heightPct: number;
  }>;
}

/**
 * Pure text search across one extracted page, returning highlight boxes
 * proportional to matched character slices within each text run.
 */
export function findMatchesInPageText(
  pageData: PageTextData,
  query: string,
  caseSensitive: boolean,
): SearchMatch[] {
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return [];

  const haystack = caseSensitive ? pageData.fullText : pageData.fullText.toLowerCase();
  const matches: SearchMatch[] = [];

  let searchFrom = 0;
  let matchIdx = 0;

  while (searchFrom <= haystack.length - needle.length) {
    const foundAt = haystack.indexOf(needle, searchFrom);
    if (foundAt === -1) break;

    const matchEnd = foundAt + needle.length;
    const boxes: SearchMatch['boxes'] = [];

    for (const run of pageData.runs) {
      if (run.end <= foundAt || run.start >= matchEnd) continue;
      const runLen = Math.max(1, run.end - run.start);
      const overlapStart = Math.max(foundAt, run.start) - run.start;
      const overlapEnd = Math.min(matchEnd, run.end) - run.start;

      const startFrac = overlapStart / runLen;
      const spanFrac = Math.max(0.05, (overlapEnd - overlapStart) / runLen);

      boxes.push({
        leftPct: run.leftPct + run.widthPct * startFrac,
        topPct: run.topPct,
        widthPct: run.widthPct * spanFrac,
        heightPct: run.heightPct,
      });
    }

    const snippetStart = Math.max(0, foundAt - 20);
    const snippetEnd = Math.min(pageData.fullText.length, matchEnd + 20);
    const snippet = pageData.fullText.slice(snippetStart, snippetEnd).trim();

    matches.push({
      id: `match-p${pageData.pageNumber}-${matchIdx}`,
      pageNumber: pageData.pageNumber,
      matchIndexOnPage: matchIdx,
      snippet,
      boxes,
    });

    matchIdx += 1;
    searchFrom = foundAt + Math.max(1, needle.length);
  }

  return matches;
}

export function wrapMatchIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : total - 1;
  return (((current + delta) % total) + total) % total;
}

export function buildPageTextDataFromRuns(
  pageNumber: number,
  runs: ExtractedTextRun[],
): PageTextData {
  let fullText = '';
  const mappedRuns: PageTextData['runs'] = [];

  for (const run of runs) {
    if (!run.str) continue;
    const start = fullText.length;
    fullText += run.str;
    const end = fullText.length;
    mappedRuns.push({
      start,
      end,
      leftPct: run.leftPct,
      topPct: run.topPct,
      widthPct: run.widthPct,
      heightPct: run.heightPct,
    });
    fullText += ' ';
  }

  return { pageNumber, fullText, runs: mappedRuns };
}

export async function extractPageTextData(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
): Promise<PageTextData> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  const runs: ExtractedTextRun[] = [];
  for (const item of textContent.items) {
    if (!('str' in item) || !item.str) continue;
    const tx = multiplyTransform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 10;
    const x = tx[4];
    const yTop = tx[5] - fontHeight;
    const width = Math.max(1, item.width);

    runs.push({
      str: item.str,
      leftPct: (x / viewport.width) * 100,
      topPct: (yTop / viewport.height) * 100,
      widthPct: (width / viewport.width) * 100,
      heightPct: (fontHeight / viewport.height) * 100,
    });
  }

  return buildPageTextDataFromRuns(pageNumber, runs);
}
