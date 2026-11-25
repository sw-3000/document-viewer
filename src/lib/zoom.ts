import type { PageDimension, ZoomMode } from '../types/viewer';

/** PDF points are 72 DPI; CSS pixels are 96 DPI. */
export const CSS_UNITS = 96 / 72;

export const MIN_ZOOM_SCALE = 0.25;
export const MAX_ZOOM_SCALE = 5.0;
export const MAX_CANVAS_EDGE_PX = 16384;
export const SCROLLBAR_GUTTER_PX = 12;

export const ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0] as const;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1.0;
  return Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, Math.round(scale * 1000) / 1000));
}

/**
 * Floors scale to 3 decimal places for fit-to-width / fit-to-page so rounding
 * never overshoots available viewport pixels and triggers scrollbar feedback loops.
 */
export function floorScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1.0;
  return Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, Math.floor(scale * 1000) / 1000));
}

export function stepZoom(currentScale: number, direction: 'in' | 'out'): number {
  const factor = direction === 'in' ? 1.15 : 1 / 1.15;
  return clampScale(currentScale * factor);
}

export function formatZoomPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export interface ViewportFitInput {
  viewportWidth: number;
  viewportHeight: number;
  page: PageDimension;
  secondPage?: PageDimension;
  horizontalPadding?: number;
  verticalPadding?: number;
  spreadGap?: number;
}

/**
 * Computes logical CSS zoom scale (relative to 100% = 96/72 CSS px per PDF pt)
 * for Fit Width, Fit Page, or Actual Size.
 */
export function computeScaleForZoomMode(
  mode: ZoomMode,
  customScale: number,
  input: ViewportFitInput,
): number {
  if (mode === 'actual-size') return 1.0;
  if (mode === 'custom') return clampScale(customScale);

  const hPad = input.horizontalPadding ?? 48 + SCROLLBAR_GUTTER_PX;
  const vPad = input.verticalPadding ?? 40 + SCROLLBAR_GUTTER_PX;
  const gap = input.spreadGap ?? 16;

  const availW = Math.max(120, input.viewportWidth - hPad);
  const availH = Math.max(120, input.viewportHeight - vPad);

  const combinedWidthPt = input.secondPage
    ? input.page.widthPt + input.secondPage.widthPt
    : input.page.widthPt;
  const effectiveAvailW = input.secondPage ? Math.max(120, availW - gap) : availW;

  const maxHeightPt = input.secondPage
    ? Math.max(input.page.heightPt, input.secondPage.heightPt)
    : input.page.heightPt;

  const widthScale = effectiveAvailW / (combinedWidthPt * CSS_UNITS);
  if (mode === 'fit-width') {
    return floorScale(widthScale);
  }

  const heightScale = availH / (maxHeightPt * CSS_UNITS);
  return floorScale(Math.min(widthScale, heightScale));
}

export interface HiDpiCanvasSize {
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  renderScale: number;
}

/**
 * Calculates crisp HiDPI backing canvas dimensions while clamping physical pixels
 * safely under Chromium/WebView2 GPU texture limits.
 */
export function computeHiDpiCanvasSize(
  page: PageDimension,
  scale: number,
  devicePixelRatio: number,
): HiDpiCanvasSize {
  const safeDpr = Math.max(1, Math.min(4, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
  const cssWidth = Math.max(1, Math.round(page.widthPt * CSS_UNITS * scale));
  const cssHeight = Math.max(1, Math.round(page.heightPt * CSS_UNITS * scale));

  let pixelWidth = Math.max(1, Math.round(cssWidth * safeDpr));
  let pixelHeight = Math.max(1, Math.round(cssHeight * safeDpr));

  const maxEdge = Math.max(pixelWidth, pixelHeight);
  let effectiveDpr = safeDpr;
  if (maxEdge > MAX_CANVAS_EDGE_PX) {
    const downscale = MAX_CANVAS_EDGE_PX / maxEdge;
    pixelWidth = Math.max(1, Math.floor(pixelWidth * downscale));
    pixelHeight = Math.max(1, Math.floor(pixelHeight * downscale));
    effectiveDpr = safeDpr * downscale;
  }

  return {
    cssWidth,
    cssHeight,
    pixelWidth,
    pixelHeight,
    renderScale: scale * CSS_UNITS * effectiveDpr,
  };
}
