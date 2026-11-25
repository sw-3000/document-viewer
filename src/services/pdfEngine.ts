import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { OutlineNode, PageDimension, PdfLinkAnnotation } from '../types/viewer';

export type PdfLoadErrorKind = 'need-password' | 'incorrect-password' | 'invalid-pdf' | 'unknown';

export class PdfLoadError extends Error {
  readonly kind: PdfLoadErrorKind;

  constructor(kind: PdfLoadErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'PdfLoadError';
  }
}

export interface LoadedPdfHandle {
  pdfDoc: PDFDocumentProxy;
  numPages: number;
  initialDimensions: PageDimension[];
  outline: OutlineNode[];
  dispose: () => Promise<void>;
}

/**
 * Loads a PDF document completely offline using bundled local cmaps, standard fonts,
 * ICC profiles, and WASM decoders. Transfers `data` to the PDF.js worker.
 */
export async function loadPdfDocument(
  bytes: ArrayBuffer,
  password?: string,
): Promise<LoadedPdfHandle> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    password,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    iccUrl: '/pdfjs/iccs/',
    wasmUrl: '/pdfjs/wasm/',
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });

  let pdfDoc: PDFDocumentProxy;
  try {
    pdfDoc = await loadingTask.promise;
  } catch (err: unknown) {
    const e = err as { name?: string; code?: number; message?: string };
    if (e?.name === 'PasswordException') {
      if (e.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD) {
        throw new PdfLoadError('incorrect-password', 'Incorrect password. Please try again.');
      }
      throw new PdfLoadError('need-password', 'This PDF document is password protected.');
    }
    if (e?.name === 'InvalidPDFException' || e?.name === 'FormatError') {
      throw new PdfLoadError(
        'invalid-pdf',
        'This file appears to be corrupted or is not a valid PDF document.',
      );
    }
    throw new PdfLoadError('unknown', e?.message ?? 'Failed to open PDF document.');
  }

  const numPages = pdfDoc.numPages;
  const firstDim = await getPageIntrinsicDimension(pdfDoc, 1);
  const initialDimensions: PageDimension[] = Array.from({ length: numPages }, () => ({
    ...firstDim,
  }));

  const outline = await extractPdfOutline(pdfDoc);

  return {
    pdfDoc,
    numPages,
    initialDimensions,
    outline,
    dispose: async () => {
      try {
        await pdfDoc.destroy();
      } catch {
        // Ignore cleanup errors on already-destroyed proxy
      }
    },
  };
}

export async function getPageIntrinsicDimension(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
): Promise<PageDimension> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return {
    widthPt: viewport.width,
    heightPt: viewport.height,
  };
}

/**
 * Incrementally fetches true page dimensions for mixed-size PDFs in background
 * chunks so initial document opening stays instantaneous and scrolling remains smooth.
 */
export function backfillPageDimensions(
  pdfDoc: PDFDocumentProxy,
  totalPages: number,
  onBatch: (updates: Array<{ pageNumber: number; dim: PageDimension }>) => void,
  signal: AbortSignal,
): void {
  const BATCH_SIZE = 20;
  let nextPage = 2;

  const scheduleNext = () => {
    if (signal.aborted || nextPage > totalPages) return;
    const run = () => {
      void processBatch();
    };
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 250 });
    } else {
      setTimeout(run, 16);
    }
  };

  const processBatch = async () => {
    if (signal.aborted || nextPage > totalPages) return;
    const updates: Array<{ pageNumber: number; dim: PageDimension }> = [];
    const end = Math.min(totalPages, nextPage + BATCH_SIZE - 1);

    for (let p = nextPage; p <= end; p++) {
      if (signal.aborted) return;
      try {
        const dim = await getPageIntrinsicDimension(pdfDoc, p);
        updates.push({ pageNumber: p, dim });
      } catch {
        // Stop if document was destroyed mid-scan
        return;
      }
    }

    nextPage = end + 1;
    if (!signal.aborted && updates.length > 0) {
      onBatch(updates);
      scheduleNext();
    }
  };

  scheduleNext();
}

type RawOutlineItem = Awaited<ReturnType<PDFDocumentProxy['getOutline']>> extends Array<infer T>
  ? T
  : never;

async function resolveDestination(
  pdfDoc: PDFDocumentProxy,
  dest: string | unknown[] | null | undefined,
): Promise<{ pageNumber: number | null; topPt: number | null }> {
  if (!dest) return { pageNumber: null, topPt: null };
  try {
    const resolved =
      typeof dest === 'string' ? await pdfDoc.getDestination(dest) : dest;
    if (!Array.isArray(resolved) || resolved.length === 0) {
      return { pageNumber: null, topPt: null };
    }
    const ref = resolved[0];
    if (!ref || typeof ref !== 'object') {
      return { pageNumber: null, topPt: null };
    }
    const pageIndex = await pdfDoc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
    let topPt: number | null = null;
    const mode = resolved[1] as { name?: string } | undefined;
    if (mode?.name === 'XYZ' && typeof resolved[3] === 'number') {
      topPt = resolved[3];
    }
    return { pageNumber: pageIndex + 1, topPt };
  } catch {
    return { pageNumber: null, topPt: null };
  }
}

export async function extractPdfOutline(pdfDoc: PDFDocumentProxy): Promise<OutlineNode[]> {
  let rawOutline: RawOutlineItem[] | null = null;
  try {
    rawOutline = await pdfDoc.getOutline();
  } catch {
    return [];
  }
  if (!rawOutline || rawOutline.length === 0) return [];

  let counter = 0;
  const convert = async (items: RawOutlineItem[]): Promise<OutlineNode[]> => {
    const nodes: OutlineNode[] = [];
    for (const item of items) {
      counter += 1;
      const { pageNumber, topPt } = await resolveDestination(pdfDoc, item.dest);
      const children = item.items?.length ? await convert(item.items) : [];
      nodes.push({
        id: `toc-${counter}`,
        title: item.title?.trim() || 'Untitled Section',
        destPage: pageNumber,
        destTopPt: topPt,
        children,
      });
    }
    return nodes;
  };

  return convert(rawOutline);
}

export async function extractPageLinks(
  pdfDoc: PDFDocumentProxy,
  page: PDFPageProxy,
): Promise<PdfLinkAnnotation[]> {
  try {
    const annotations = await page.getAnnotations({ intent: 'display' });
    const viewport = page.getViewport({ scale: 1 });
    const links: PdfLinkAnnotation[] = [];

    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i] as {
        subtype?: string;
        rect?: [number, number, number, number];
        dest?: string | unknown[];
        url?: string;
      };
      if (ann.subtype !== 'Link' || !ann.rect) continue;
      const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle(ann.rect);
      const left = Math.min(vx1, vx2);
      const top = Math.min(vy1, vy2);
      const width = Math.abs(vx2 - vx1);
      const height = Math.abs(vy2 - vy1);
      if (width <= 0 || height <= 0) continue;

      let destPage: number | null = null;
      let destTopPt: number | null = null;
      if (ann.dest) {
        const resolved = await resolveDestination(pdfDoc, ann.dest);
        destPage = resolved.pageNumber;
        destTopPt = resolved.topPt;
      }

      if (destPage !== null || ann.url) {
        links.push({
          id: `link-${page.pageNumber}-${i}`,
          leftPct: (left / viewport.width) * 100,
          topPct: (top / viewport.height) * 100,
          widthPct: (width / viewport.width) * 100,
          heightPct: (height / viewport.height) * 100,
          destPage,
          destTopPt,
          url: ann.url ?? null,
        });
      }
    }
    return links;
  } catch {
    return [];
  }
}
