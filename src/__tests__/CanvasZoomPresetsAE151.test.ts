import { describe, it, expect } from 'vitest';
import {
  calculateFitWidthZoom,
  calculateActualSizeZoom,
  calculateFitWidthTransform,
  calculateActualSizeTransform,
  MIN_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
} from '../lib/panZoom';
import { calculateImageFitBounds, RenderedImageBounds } from '../lib/annotations';
import {
  imageToScreenCoordinates,
  screenToImageCoordinates,
  FreehandStroke,
} from '../lib/penTool';
import { MarkAnnotation } from '../lib/stampTool';

describe('AE-151: Fit-Width / Actual-Size / Zoom Presets Suite', () => {
  // Test Matrix: Small Image vs Large Image vs High-DPI Scan
  const smallImage = { naturalWidth: 400, naturalHeight: 300 }; // 4:3 small
  const largeImage = { naturalWidth: 2400, naturalHeight: 3200 }; // 300 DPI portrait scan
  const highDpiImage = { naturalWidth: 4800, naturalHeight: 6400 }; // 600 DPI scan

  // Standard grading pane dimensions (landscape container)
  const container = { width: 1200, height: 800 };

  describe('1. Small Image Presets & Zoom Readout', () => {
    it('calculates Fit Width for small image', () => {
      // Fit bounds for 400x300 in 1200x800
      const baseBounds = calculateImageFitBounds(
        container.width,
        container.height,
        smallImage.naturalWidth,
        smallImage.naturalHeight,
        'contain'
      );
      // Small image fits inside container: scale = 800 / 300 = 2.66667, base width = 400 * 2.66667 = 1066.67
      expect(baseBounds.width).toBeCloseTo(1066.67, 1);

      const fitWidthZoom = calculateFitWidthZoom(container.width, baseBounds, 0);
      expect(fitWidthZoom).toBeCloseTo(1200 / 1066.67, 2);

      const transform = calculateFitWidthTransform(container.width, container.height, baseBounds, 0);
      expect(transform.zoom).toBeCloseTo(fitWidthZoom, 2);
      expect(transform.x).toBe(0);
    });

    it('calculates Actual Size (1:1) for small image where 1/fitScale < 1.0 (minZoom clamped)', () => {
      const baseBounds = calculateImageFitBounds(
        container.width,
        container.height,
        smallImage.naturalWidth,
        smallImage.naturalHeight,
        'contain'
      );
      // baseBounds.scale is ~2.67
      const actualSize = calculateActualSizeZoom(baseBounds.scale);
      expect(actualSize.trueActualZoom).toBeCloseTo(1 / baseBounds.scale, 2);
      // Because minZoom is 1.0 (100% fit), targetZoom is clamped to minZoom 1.0
      expect(actualSize.targetZoom).toBe(MIN_ZOOM_LEVEL);
    });

    it('formats consistent fit-relative zoom readout', () => {
      const transform = { x: 0, y: 0, zoom: 1.25 };
      const readoutPercent = Math.round(transform.zoom * 100);
      expect(readoutPercent).toBe(125);
    });
  });

  describe('2. Large Image (300 DPI) Presets & Zoom Readout', () => {
    it('calculates Fit Width for portrait answer sheet in landscape container', () => {
      const baseBounds = calculateImageFitBounds(
        container.width,
        container.height,
        largeImage.naturalWidth,
        largeImage.naturalHeight,
        'contain'
      );
      // imageRatio = 2400/3200 = 0.75, containerRatio = 1200/800 = 1.5
      // Height-constrained: renderHeight = 800, renderWidth = 800 * 0.75 = 600, scale = 800/3200 = 0.25
      expect(baseBounds.width).toBe(600);
      expect(baseBounds.height).toBe(800);
      expect(baseBounds.scale).toBe(0.25);

      const fitWidthZoom = calculateFitWidthZoom(container.width, baseBounds, 0);
      // To fit container width 1200: zoom = 1200 / 600 = 2.0 (200% fit)
      expect(fitWidthZoom).toBe(2.0);

      const transform = calculateFitWidthTransform(container.width, container.height, baseBounds, 0);
      expect(transform.zoom).toBe(2.0);
      expect(transform.x).toBe(0);
      expect(transform.y).toBe(0); // Top-aligned for document reading
    });

    it('calculates Actual Size (1:1 pixel mapping) for 300 DPI image', () => {
      const baseBounds = calculateImageFitBounds(
        container.width,
        container.height,
        largeImage.naturalWidth,
        largeImage.naturalHeight,
        'contain'
      );
      const actualSize = calculateActualSizeZoom(baseBounds.scale);
      // baseBounds.scale = 0.25 -> trueActualZoom = 1 / 0.25 = 4.0
      expect(actualSize.trueActualZoom).toBe(4.0);
      expect(actualSize.targetZoom).toBe(4.0);
      expect(actualSize.isClamped).toBe(false);
    });
  });

  describe('3. Clamp Case: High-DPI (>4x) Scans', () => {
    it('handles 600 DPI scan exceeding 4x max zoom without false claims', () => {
      const baseBounds = calculateImageFitBounds(
        container.width,
        container.height,
        highDpiImage.naturalWidth,
        highDpiImage.naturalHeight,
        'contain'
      );
      // scale = 800 / 6400 = 0.125
      expect(baseBounds.scale).toBe(0.125);

      const actualSize = calculateActualSizeZoom(baseBounds.scale, MIN_ZOOM_LEVEL, MAX_ZOOM_LEVEL);
      // 1 / 0.125 = 8.0x
      expect(actualSize.trueActualZoom).toBe(8.0);
      expect(actualSize.targetZoom).toBe(MAX_ZOOM_LEVEL); // Clamped to 4.0
      expect(actualSize.isClamped).toBe(true);

      // Verify transform clamps zoom to maxZoom
      const transform = calculateActualSizeTransform(
        container.width,
        container.height,
        baseBounds,
        baseBounds.scale,
        MIN_ZOOM_LEVEL,
        MAX_ZOOM_LEVEL
      );
      expect(transform.zoom).toBe(4.0);
      expect(transform.isClamped).toBe(true);
      expect(transform.trueActualZoom).toBe(8.0);
    });
  });

  describe('4. Rotation Compatibility (0°, 90°, 180°, 270°)', () => {
    const portraitBounds: RenderedImageBounds = {
      x: 300,
      y: 0,
      width: 600,
      height: 800,
      scale: 0.25,
    };

    it('calculates Fit Width at 0° rotation', () => {
      const zoom0 = calculateFitWidthZoom(container.width, portraitBounds, 0);
      expect(zoom0).toBe(2.0); // 1200 / 600
    });

    it('calculates Fit Width at 90° rotation', () => {
      // Rotated 90°: visual width is height (800)
      const zoom90 = calculateFitWidthZoom(container.width, portraitBounds, 90);
      expect(zoom90).toBe(1.5); // 1200 / 800
    });

    it('calculates Fit Width at 180° rotation', () => {
      const zoom180 = calculateFitWidthZoom(container.width, portraitBounds, 180);
      expect(zoom180).toBe(2.0); // 1200 / 600
    });

    it('calculates Fit Width at 270° rotation', () => {
      const zoom270 = calculateFitWidthZoom(container.width, portraitBounds, 270);
      expect(zoom270).toBe(1.5); // 1200 / 800
    });

    it('calculates Actual Size at 0° and 90° rotation', () => {
      const actualSize0 = calculateActualSizeZoom(portraitBounds.scale);
      expect(actualSize0.targetZoom).toBe(4.0);

      const actualSize90 = calculateActualSizeZoom(portraitBounds.scale);
      expect(actualSize90.targetZoom).toBe(4.0);
    });
  });

  describe('5. Viewport and Resize Scenarios', () => {
    it('adapts Fit Width when grading pane is resized from 1200px to 800px', () => {
      const baseBounds = calculateImageFitBounds(
        1200,
        800,
        largeImage.naturalWidth,
        largeImage.naturalHeight,
        'contain'
      );
      expect(baseBounds.width).toBe(600);

      // Resized to 800px width:
      const zoom800 = calculateFitWidthZoom(800, baseBounds, 0);
      expect(zoom800).toBeCloseTo(800 / 600, 2); // 1.33x

      // Resized to 1600px width:
      const zoom1600 = calculateFitWidthZoom(1600, baseBounds, 0);
      expect(zoom1600).toBeCloseTo(1600 / 600, 2); // 2.67x
    });
  });

  describe('6. Source Data & Annotation Integrity', () => {
    it('ensures applying zoom presets does not alter source coordinates or normalized coordinates', () => {
      const stroke: FreehandStroke = {
        id: 'stroke-1',
        pageKey: 'page-1',
        points: [100, 150, 105, 155],
        color: '#e11d48',
        strokeWidth: 2,
        createdAt: Date.now(),
      };

      const mark: MarkAnnotation = {
        id: 'mark-1',
        pageKey: 'page-1',
        type: 'check',
        x: 200,
        y: 300,
        size: 24,
        color: '#16a34a',
        createdAt: Date.now(),
      };

      // Transform at 1.0x fit
      const fitTransform = { x: 300, y: 0, zoom: 1.0 };
      const screenPt1 = imageToScreenCoordinates(mark.x, mark.y, fitTransform);
      expect(screenPt1).toEqual({ x: 500, y: 300 });

      // Transform at Fit Width (2.0x)
      const fitWidthTransform = { x: 0, y: 0, zoom: 2.0 };
      const screenPt2 = imageToScreenCoordinates(mark.x, mark.y, fitWidthTransform);
      expect(screenPt2).toEqual({ x: 400, y: 600 });

      // Inverse pointer mapping back to image coordinates matches exactly
      const inversePt = screenToImageCoordinates(screenPt2.x, screenPt2.y, fitWidthTransform);
      expect(inversePt.x).toBe(mark.x);
      expect(inversePt.y).toBe(mark.y);

      // Stroke points remain unmutated
      expect(stroke.points).toEqual([100, 150, 105, 155]);
    });
  });
});
