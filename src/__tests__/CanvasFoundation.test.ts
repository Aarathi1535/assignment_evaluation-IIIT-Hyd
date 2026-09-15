import { describe, it, expect } from 'vitest';
import {
  clampNormalized,
  calculateImageFitBounds,
  normalizedToCanvasPoint,
  canvasToNormalizedPoint,
  normalizedToCanvasRect,
  canvasToNormalizedRect,
  positionToNormalizedRect,
  normalizedRectToPosition,
  RenderedImageBounds,
} from '../lib/annotations';
import { SAMPLE_ANSWER_SHEET_DATA_URI, AnswerSheetCanvas } from '../components/canvas/AnswerSheetCanvas';
import { CanvasStage, useCanvasStage } from '../components/canvas/CanvasStage';
import { PageImageLayer } from '../components/canvas/PageImageLayer';

describe('AE-122: Canvas Foundation & Annotation Coordinates', () => {
  describe('1. clampNormalized', () => {
    it('should clamp values between 0 and 1', () => {
      expect(clampNormalized(0.5)).toBe(0.5);
      expect(clampNormalized(-0.2)).toBe(0);
      expect(clampNormalized(1.5)).toBe(1);
      expect(clampNormalized(0)).toBe(0);
      expect(clampNormalized(1)).toBe(1);
      expect(clampNormalized(NaN)).toBe(0);
    });
  });

  describe('2. calculateImageFitBounds', () => {
    it('should calculate contain bounds for a portrait image inside a landscape container', () => {
      // Container: 1000 x 500 (ratio 2.0)
      // Image: 800 x 1000 (ratio 0.8) -> Height limited
      const bounds = calculateImageFitBounds(1000, 500, 800, 1000, 'contain');
      expect(bounds.height).toBe(500);
      expect(bounds.width).toBe(400); // 500 * 0.8
      expect(bounds.x).toBe(300); // (1000 - 400) / 2
      expect(bounds.y).toBe(0);
      expect(bounds.scale).toBe(0.5);
    });

    it('should calculate contain bounds for a landscape image inside a portrait container', () => {
      // Container: 500 x 1000 (ratio 0.5)
      // Image: 1200 x 600 (ratio 2.0) -> Width limited
      const bounds = calculateImageFitBounds(500, 1000, 1200, 600, 'contain');
      expect(bounds.width).toBe(500);
      expect(bounds.height).toBe(250); // 500 / 2.0
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(375); // (1000 - 250) / 2
      expect(bounds.scale).toBeCloseTo(500 / 1200);
    });

    it('should calculate cover bounds correctly', () => {
      // Container: 1000 x 500 (ratio 2.0)
      // Image: 800 x 800 (ratio 1.0) -> Width expanded to 1000
      const bounds = calculateImageFitBounds(1000, 500, 800, 800, 'cover');
      expect(bounds.width).toBe(1000);
      expect(bounds.height).toBe(1000);
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(-250); // (500 - 1000) / 2
    });

    it('should calculate fill bounds correctly', () => {
      const bounds = calculateImageFitBounds(800, 600, 1000, 1000, 'fill');
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(0);
      expect(bounds.width).toBe(800);
      expect(bounds.height).toBe(600);
    });

    it('should calculate natural bounds correctly', () => {
      const bounds = calculateImageFitBounds(1000, 800, 400, 300, 'natural');
      expect(bounds.x).toBe(300); // (1000 - 400) / 2
      expect(bounds.y).toBe(250); // (800 - 300) / 2
      expect(bounds.width).toBe(400);
      expect(bounds.height).toBe(300);
      expect(bounds.scale).toBe(1);
    });

    it('should return safe zero bounds for invalid or zero container dimensions', () => {
      const bounds = calculateImageFitBounds(0, 0, 800, 600);
      expect(bounds.width).toBe(0);
      expect(bounds.height).toBe(0);
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(0);
    });
  });

  describe('3. Coordinate Transformations (Normalized <-> Canvas)', () => {
    const mockBounds: RenderedImageBounds = {
      x: 100,
      y: 50,
      width: 800,
      height: 1000,
      scale: 1,
    };

    it('should convert normalized point to canvas pixels', () => {
      const normPoint = { x: 0.25, y: 0.5 };
      const canvasPt = normalizedToCanvasPoint(normPoint, mockBounds);
      expect(canvasPt.x).toBe(100 + 0.25 * 800); // 300
      expect(canvasPt.y).toBe(50 + 0.5 * 1000); // 550
    });

    it('should convert canvas pixels to normalized point and clamp out-of-bounds', () => {
      const canvasPt = { x: 300, y: 550 };
      const normPt = canvasToNormalizedPoint(canvasPt, mockBounds);
      expect(normPt.x).toBe(0.25);
      expect(normPt.y).toBe(0.5);

      // Outside bounds on the left and above
      const outsidePt = { x: 50, y: 10 };
      const clamped = canvasToNormalizedPoint(outsidePt, mockBounds);
      expect(clamped.x).toBe(0);
      expect(clamped.y).toBe(0);
    });

    it('should convert normalized rect to canvas rect and back', () => {
      const normRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
      const canvasRect = normalizedToCanvasRect(normRect, mockBounds);

      expect(canvasRect.x).toBe(100 + 0.1 * 800); // 180
      expect(canvasRect.y).toBe(50 + 0.2 * 1000); // 250
      expect(canvasRect.width).toBe(0.3 * 800); // 240
      expect(canvasRect.height).toBe(0.4 * 1000); // 400

      const recoveredNorm = canvasToNormalizedRect(canvasRect, mockBounds);
      expect(recoveredNorm.x).toBeCloseTo(0.1);
      expect(recoveredNorm.y).toBeCloseTo(0.2);
      expect(recoveredNorm.width).toBeCloseTo(0.3);
      expect(recoveredNorm.height).toBeCloseTo(0.4);
    });
  });

  describe('4. MongoDB IPosition Alignment', () => {
    it('should convert IPosition to NormalizedRect and vice versa', () => {
      const pos = { x: 0.15, y: 0.25, width: 0.4, height: 0.3 };
      const normRect = positionToNormalizedRect(pos);
      expect(normRect).toEqual({ x: 0.15, y: 0.25, width: 0.4, height: 0.3 });

      const backToPos = normalizedRectToPosition(normRect);
      expect(backToPos).toEqual(pos);
    });

    it('should handle undefined width and height gracefully in IPosition', () => {
      const pointPos = { x: 0.5, y: 0.7 };
      const normRect = positionToNormalizedRect(pointPos);
      expect(normRect).toEqual({ x: 0.5, y: 0.7, width: 0, height: 0 });

      const backToPos = normalizedRectToPosition(normRect);
      expect(backToPos.x).toBe(0.5);
      expect(backToPos.y).toBe(0.7);
      expect(backToPos.width).toBeUndefined();
      expect(backToPos.height).toBeUndefined();
    });
  });

  describe('5. Sample Answer Sheet Data URI', () => {
    it('should provide a valid non-empty SVG data URI', () => {
      expect(SAMPLE_ANSWER_SHEET_DATA_URI).toBeDefined();
      expect(SAMPLE_ANSWER_SHEET_DATA_URI.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
      expect(SAMPLE_ANSWER_SHEET_DATA_URI).toContain('IIIT%20Hyderabad');
    });
  });

  describe('6. Canvas Components Exports & Node Environment Safety', () => {
    it('should export all required canvas components and hooks cleanly', () => {
      expect(CanvasStage).toBeDefined();
      expect(typeof CanvasStage).toBe('function');
      expect(PageImageLayer).toBeDefined();
      expect(typeof PageImageLayer).toBe('function');
      expect(AnswerSheetCanvas).toBeDefined();
      expect(typeof AnswerSheetCanvas).toBe('function');
      expect(useCanvasStage).toBeDefined();
      expect(typeof useCanvasStage).toBe('function');
    });

    it('should verify Konva is importable with expected scene-graph constructors', async () => {
      const KonvaModule = await import('konva');
      const KonvaDefault = KonvaModule.default || KonvaModule;
      expect(KonvaDefault.Stage).toBeDefined();
      expect(KonvaDefault.Layer).toBeDefined();
      expect(KonvaDefault.Group).toBeDefined();
      expect(KonvaDefault.Rect).toBeDefined();
      expect(KonvaDefault.Line).toBeDefined();
      expect(KonvaDefault.Image).toBeDefined();
      expect(KonvaDefault.Text).toBeDefined();
      expect(KonvaDefault.Transformer).toBeDefined();
    });
  });
});
