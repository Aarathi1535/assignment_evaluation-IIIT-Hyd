import { describe, it, expect } from 'vitest';
import {
  calculatePanBounds,
  clampPanPosition,
  calculateZoomTransform,
  calculateStepZoom,
  calculatePinchMetrics,
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
});
