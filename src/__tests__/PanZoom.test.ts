import { describe, it, expect } from 'vitest';
import {
  calculatePanBounds,
  clampPanPosition,
  calculateZoomTransform,
  calculateStepZoom,
  calculatePinchMetrics,
  calculateFitWidthZoom,
  calculateActualSizeZoom,
  calculateFitWidthTransform,
  calculateActualSizeTransform,
  MIN_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
} from '../lib/panZoom';
import type { RenderedImageBounds } from '../lib/annotations';

describe('AE-124: Pan & Zoom Models & Calculations', () => {
  describe('1. Zoom Limits & Stepping', () => {
    it('enforces min zoom of 100% (1.0x) and max zoom of at least 400% (4.0x)', () => {
      expect(MIN_ZOOM_LEVEL).toBe(1.0);
      expect(MAX_ZOOM_LEVEL).toBeGreaterThanOrEqual(4.0);
    });

    it('calculates stepped zoom up to max zoom', () => {
      expect(calculateStepZoom(1.0, 0.25)).toBe(1.25);
      expect(calculateStepZoom(3.75, 0.25)).toBe(4.0);
      expect(calculateStepZoom(4.0, 0.25)).toBe(4.0); // Clamped at max
    });

    it('calculates stepped zoom down to min zoom', () => {
      expect(calculateStepZoom(1.5, -0.25)).toBe(1.25);
      expect(calculateStepZoom(1.0, -0.25)).toBe(1.0); // Clamped at min
    });
  });

  describe('2. Pan Bounds Calculation', () => {
    it('centers image strictly when rendered size is smaller than container in both dimensions', () => {
      // Container: 1000 x 800
      // Rendered: 600 x 800 (contained portrait)
      const bounds = calculatePanBounds(1000, 800, 600, 800);
      expect(bounds.minX).toBe(200);
      expect(bounds.maxX).toBe(200);
      expect(bounds.minY).toBe(0);
      expect(bounds.maxY).toBe(0);
    });

    it('allows horizontal panning when rendered width exceeds container width', () => {
      // Container: 1000 x 800
      // Rendered at 2x zoom: 1200 x 1600
      const bounds = calculatePanBounds(1000, 800, 1200, 1600);
      expect(bounds.minX).toBe(-200); // 1000 - 1200
      expect(bounds.maxX).toBe(0);
      expect(bounds.minY).toBe(-800); // 800 - 1600
      expect(bounds.maxY).toBe(0);
    });

    it('allows 400% zoom pan across entire page scan', () => {
      // Container: 1000 x 800
      // Rendered at 4x zoom: 2400 x 3200
      const bounds = calculatePanBounds(1000, 800, 2400, 3200);
      expect(bounds.minX).toBe(-1400); // 1000 - 2400
      expect(bounds.maxX).toBe(0);
      expect(bounds.minY).toBe(-2400); // 800 - 3200
      expect(bounds.maxY).toBe(0);
    });
  });

  describe('3. Clamping Pan Position', () => {
    const bounds = { minX: -500, maxX: 0, minY: -800, maxY: 0 };

    it('retains position within valid bounds', () => {
      expect(clampPanPosition(-250, -400, bounds)).toEqual({ x: -250, y: -400 });
    });

    it('clamps out-of-bounds positions on all sides', () => {
      // Exceeds left/top
      expect(clampPanPosition(100, 50, bounds)).toEqual({ x: 0, y: 0 });
      // Exceeds right/bottom
      expect(clampPanPosition(-600, -900, bounds)).toEqual({ x: -500, y: -800 });
    });
  });

  describe('4. Pointer-Anchored Zoom Transform', () => {
    const baseBounds: RenderedImageBounds = {
      x: 200,
      y: 0,
      width: 600,
      height: 800,
      scale: 1,
    };
    const containerW = 1000;
    const containerH = 800;

    it('keeps pointer location invariant when zooming into center', () => {
      const pointerX = 500;
      const pointerY = 400;

      const result = calculateZoomTransform(
        200, // currentX (fit centered)
        0, // currentY
        1.0, // currentZoom
        2.0, // targetZoom
        pointerX,
        pointerY,
        baseBounds,
        containerW,
        containerH
      );

      expect(result.zoom).toBe(2.0);

      // Rendered size at 2x: 1200 x 1600
      // Pointer was at center of image -> image should be centered around (500, 400)
      // Left = 500 - 0.5 * 1200 = -100
      // Top = 400 - 0.5 * 1600 = -400
      expect(result.x).toBe(-100);
      expect(result.y).toBe(-400);
    });

    it('keeps pointer location invariant when zooming into top-left corner of image', () => {
      const pointerX = 200; // Top-left of the image on screen
      const pointerY = 0;

      const result = calculateZoomTransform(
        200,
        0,
        1.0,
        2.0,
        pointerX,
        pointerY,
        baseBounds,
        containerW,
        containerH
      );

      expect(result.zoom).toBe(2.0);
      // Top-left corner remains at (0, 0) due to bounds clamp [maxX = 0, maxY = 0]
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('enforces min and max zoom limits during zoom calculation', () => {
      const resultMin = calculateZoomTransform(
        200,
        0,
        1.0,
        0.5, // Below min zoom
        500,
        400,
        baseBounds,
        containerW,
        containerH
      );
      expect(resultMin.zoom).toBe(1.0);

      const resultMax = calculateZoomTransform(
        200,
        0,
        1.0,
        8.0, // Above max zoom
        500,
        400,
        baseBounds,
        containerW,
        containerH
      );
      expect(resultMax.zoom).toBe(4.0);
    });
  });

  describe('5. Multi-Touch Pinch Metrics', () => {
    it('calculates pinch distance and center point correctly', () => {
      const touch1 = { clientX: 100, clientY: 200 };
      const touch2 = { clientX: 400, clientY: 600 };

      const metrics = calculatePinchMetrics(touch1, touch2);

      // dx = 300, dy = 400 -> distance = 500
      expect(metrics.distance).toBe(500);
      // center = ((100+400)/2, (200+600)/2) = (250, 400)
      expect(metrics.centerX).toBe(250);
      expect(metrics.centerY).toBe(400);
    });
  });

  describe('6. AE-151: Fit-Width Zoom & Transform Calculations', () => {
    // Portrait answer sheet (600 x 800) in landscape container (1200 x 800)
    // At 1.0x fit: baseBounds width = 600, height = 800, x = 300, y = 0
    const portraitBaseBounds: RenderedImageBounds = {
      x: 300,
      y: 0,
      width: 600,
      height: 800,
      scale: 0.5,
    };
    const containerW = 1200;
    const containerH = 800;

    it('calculates fit-width zoom for portrait page in landscape grading pane', () => {
      const zoom = calculateFitWidthZoom(containerW, portraitBaseBounds, 0);
      // To fit width 1200 with base width 600: zoom = 1200 / 600 = 2.0
      expect(zoom).toBe(2.0);
    });

    it('positions page top at y=0 for reading when fitted page height exceeds viewport', () => {
      const transform = calculateFitWidthTransform(containerW, containerH, portraitBaseBounds, 0);
      expect(transform.zoom).toBe(2.0);
      // Rendered width = 600 * 2.0 = 1200 (fits exactly -> x = 0)
      // Rendered height = 800 * 2.0 = 1600 (exceeds container height 800 -> top-aligned y = 0)
      expect(transform.x).toBe(0);
      expect(transform.y).toBe(0);
    });

    it('accounts for 90° rotation in fit-width calculation', () => {
      // Rotated 90°: visual width becomes base height (800)
      // Required zoom = 1200 / 800 = 1.5
      const zoom90 = calculateFitWidthZoom(containerW, portraitBaseBounds, 90);
      expect(zoom90).toBe(1.5);

      const zoom270 = calculateFitWidthZoom(containerW, portraitBaseBounds, 270);
      expect(zoom270).toBe(1.5);

      const zoom180 = calculateFitWidthZoom(containerW, portraitBaseBounds, 180);
      expect(zoom180).toBe(2.0);
    });

    it('clamps fit-width zoom between minZoom and maxZoom', () => {
      // Extremely wide container requiring 10x zoom
      const highZoom = calculateFitWidthZoom(10000, portraitBaseBounds, 0);
      expect(highZoom).toBe(4.0); // Clamped at maxZoom

      // Extremely narrow container where image is already wider
      const wideBounds: RenderedImageBounds = {
        x: 0,
        y: 100,
        width: 1200,
        height: 600,
        scale: 1.0,
      };
      const lowZoom = calculateFitWidthZoom(600, wideBounds, 0);
      expect(lowZoom).toBe(1.0); // Clamped at minZoom
    });
  });

  describe('7. AE-151: Actual-Size Zoom & Clamp Calculations', () => {
    it('calculates true actual-size zoom as 1 / fitScale for standard resolution image', () => {
      // 300 DPI scan fitted with scale 0.5 (rendered at 50% on fit)
      // Actual size requires 1 / 0.5 = 2.0x zoom
      const result = calculateActualSizeZoom(0.5);
      expect(result.trueActualZoom).toBe(2.0);
      expect(result.targetZoom).toBe(2.0);
      expect(result.isClamped).toBe(false);
    });

    it('detects and handles high-resolution scan (>4x) clamp case honestly', () => {
      // 600 DPI scan fitted with scale 0.1 (rendered at 10% on fit)
      // True actual size requires 1 / 0.1 = 10.0x zoom
      const result = calculateActualSizeZoom(0.1, 1.0, 4.0);
      expect(result.trueActualZoom).toBe(10.0);
      expect(result.targetZoom).toBe(4.0); // Clamped to maxZoom 4.0
      expect(result.isClamped).toBe(true); // Flag indicates clamped state
    });

    it('calculates actual-size transform centered within container bounds', () => {
      const baseBounds: RenderedImageBounds = {
        x: 100,
        y: 0,
        width: 600,
        height: 800,
        scale: 0.5,
      };
      const containerW = 800;
      const containerH = 600;

      const transform = calculateActualSizeTransform(containerW, containerH, baseBounds, 0.5);
      expect(transform.zoom).toBe(2.0);
      expect(transform.isClamped).toBe(false);
      expect(transform.trueActualZoom).toBe(2.0);
      // Rendered width at 2.0x = 1200, container width = 800 -> clamped between -400 and 0
      // Rendered height at 2.0x = 1600, container height = 600 -> top-aligned y = 0
      expect(transform.x).toBeGreaterThanOrEqual(-400);
      expect(transform.x).toBeLessThanOrEqual(0);
      expect(transform.y).toBe(0);
    });
  });
});
