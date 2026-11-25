import { describe, expect, it } from 'vitest';
import {
  CSS_UNITS,
  MAX_CANVAS_EDGE_PX,
  computeHiDpiCanvasSize,
  computeScaleForZoomMode,
  stepZoom,
} from '../lib/zoom';

describe('zoom and HiDPI calculations', () => {
  const letterPage = { widthPt: 612, heightPt: 792 };

  it('calculates actual-size, fit-width, and fit-page accurately', () => {
    expect(
      computeScaleForZoomMode('actual-size', 1.5, {
        viewportWidth: 1000,
        viewportHeight: 800,
        page: letterPage,
      }),
    ).toBe(1.0);

    const fitW = computeScaleForZoomMode('fit-width', 1.0, {
      viewportWidth: 1048,
      viewportHeight: 800,
      page: letterPage,
      horizontalPadding: 48,
    });
    expect(fitW).toBeCloseTo(1000 / (612 * CSS_UNITS), 2);

    const fitP = computeScaleForZoomMode('fit-page', 1.0, {
      viewportWidth: 1200,
      viewportHeight: 640,
      page: letterPage,
      verticalPadding: 40,
    });
    expect(fitP).toBeCloseTo(600 / (792 * CSS_UNITS), 2);
  });

  it('accounts for facing two-page spread width in fit-width mode', () => {
    const singleFit = computeScaleForZoomMode('fit-width', 1.0, {
      viewportWidth: 1200,
      viewportHeight: 800,
      page: letterPage,
    });
    const spreadFit = computeScaleForZoomMode('fit-width', 1.0, {
      viewportWidth: 1200,
      viewportHeight: 800,
      page: letterPage,
      secondPage: letterPage,
    });
    expect(spreadFit).toBeLessThan(singleFit * 0.55);
  });

  it('scales backing canvas by devicePixelRatio and clamps within GPU limits', () => {
    const sharp = computeHiDpiCanvasSize(letterPage, 1.0, 2.0);
    expect(sharp.cssWidth).toBe(Math.round(612 * CSS_UNITS));
    expect(sharp.pixelWidth).toBe(sharp.cssWidth * 2);
    expect(sharp.pixelHeight).toBe(sharp.cssHeight * 2);

    const huge = computeHiDpiCanvasSize({ widthPt: 5000, heightPt: 5000 }, 5.0, 2.0);
    expect(huge.pixelWidth).toBeLessThanOrEqual(MAX_CANVAS_EDGE_PX);
    expect(huge.pixelHeight).toBeLessThanOrEqual(MAX_CANVAS_EDGE_PX);
  });

  it('steps zoom incrementally within bounds', () => {
    expect(stepZoom(1.0, 'in')).toBeGreaterThan(1.1);
    expect(stepZoom(1.0, 'out')).toBeLessThan(0.9);
    expect(stepZoom(5.0, 'in')).toBe(5.0);
    expect(stepZoom(0.25, 'out')).toBe(0.25);
  });
});
