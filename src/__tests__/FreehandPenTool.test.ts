import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_WIDTH,
  MIN_PRESSURE_WIDTH_MULTIPLIER,
  MAX_PRESSURE_WIDTH_MULTIPLIER,
  generateStrokeId,
  calculatePressureStrokeWidth,
  screenToImageCoordinates,
  imageToScreenCoordinates,
  createStroke,
  appendPointToStroke,
  filterStrokesByPage,
  FreehandStroke,
} from '../lib/penTool';
import type { PanZoomTransform } from '../lib/panZoom';

describe('AE-126: Freehand Pen Tool Models & Utilities', () => {
  describe('1. Default Pen Style & Configuration', () => {
    it('provides standard default pen color and stroke width', () => {
      expect(DEFAULT_PEN_COLOR).toBe('#e11d48');
      expect(DEFAULT_PEN_WIDTH).toBe(3);
    });

    it('generates unique stroke identifiers', () => {
      const id1 = generateStrokeId();
      const id2 = generateStrokeId();
      const id3 = generateStrokeId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1.startsWith('stroke_')).toBe(true);
    });
  });

  describe('2. Pressure Sensitivity & Width Calculation', () => {
    it('falls back to base stroke width when pressure is missing, zero, negative, or invalid', () => {
      expect(calculatePressureStrokeWidth(3, undefined)).toBe(3);
      expect(calculatePressureStrokeWidth(3, null as unknown as number)).toBe(3);
      expect(calculatePressureStrokeWidth(3, 0)).toBe(3);
      expect(calculatePressureStrokeWidth(3, -0.5)).toBe(3);
      expect(calculatePressureStrokeWidth(3, 1.5)).toBe(3); // > 1.0 invalid
      expect(calculatePressureStrokeWidth(3, NaN)).toBe(3);
    });

    it('maps valid pressure (0.1 to 1.0) conservatively to stroke width', () => {
      // At minimum pressure (e.g. 0.01) -> multiplier ~ 0.5 -> 3 * 0.5 = 1.5
      const minP = calculatePressureStrokeWidth(3, 0.01);
      expect(minP).toBeGreaterThanOrEqual(3 * MIN_PRESSURE_WIDTH_MULTIPLIER);

      // At half pressure (0.5) -> multiplier 0.5 + 0.5 * 1.25 = 1.125 -> 3 * 1.125 = 3.38
      const midP = calculatePressureStrokeWidth(3, 0.5);
      expect(midP).toBeCloseTo(3.38, 1);

      // At full pressure (1.0) -> multiplier 1.75 -> 3 * 1.75 = 5.25
      const maxP = calculatePressureStrokeWidth(3, 1.0);
      expect(maxP).toBe(3 * MAX_PRESSURE_WIDTH_MULTIPLIER);
    });

    it('scales proportionally with custom base width', () => {
      expect(calculatePressureStrokeWidth(6, 1.0)).toBe(6 * MAX_PRESSURE_WIDTH_MULTIPLIER);
      expect(calculatePressureStrokeWidth(6, 0)).toBe(6);
    });
  });

  describe('3. Stroke Lifecycle: Create, Append Points, and Finalize', () => {
    it('creates a new stroke starting with an initial image point', () => {
      const stroke = createStroke('page-1', { x: 120, y: 340 });

      expect(stroke.id).toBeDefined();
      expect(stroke.pageKey).toBe('page-1');
      expect(stroke.points).toEqual([120, 340]);
      expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
      expect(stroke.strokeWidth).toBe(DEFAULT_PEN_WIDTH);
      expect(stroke.createdAt).toBeGreaterThan(0);
    });

    it('applies custom color, stroke width, and pressure during stroke creation', () => {
      const stroke = createStroke(
        'page-1',
        { x: 50, y: 75 },
        {
          color: '#2563eb',
          strokeWidth: 4,
          pressure: 1.0,
          customId: 'custom-stroke-1',
        }
      );

      expect(stroke.id).toBe('custom-stroke-1');
      expect(stroke.color).toBe('#2563eb');
      expect(stroke.strokeWidth).toBe(4 * MAX_PRESSURE_WIDTH_MULTIPLIER);
      expect(stroke.points).toEqual([50, 75]);
    });

    it('appends subsequent points immutably to an ongoing stroke', () => {
      const stroke0 = createStroke('page-1', { x: 10, y: 20 });
      const stroke1 = appendPointToStroke(stroke0, { x: 15, y: 25 });
      const stroke2 = appendPointToStroke(stroke1, { x: 20, y: 30 });

      expect(stroke0.points).toEqual([10, 20]);
      expect(stroke1.points).toEqual([10, 20, 15, 25]);
      expect(stroke2.points).toEqual([10, 20, 15, 25, 20, 30]);
    });

    it('handles multiple independent strokes', () => {
      const s1 = createStroke('page-1', { x: 0, y: 0 });
      const s2 = createStroke('page-1', { x: 100, y: 100 });

      expect(s1.id).not.toBe(s2.id);
      expect(s1.points).toEqual([0, 0]);
      expect(s2.points).toEqual([100, 100]);
    });
  });

  describe('4. Coordinate Transformation Invariance under Pan & Zoom', () => {
    it('converts screen coordinates to image coordinates at default fit scale (1.0x, centered)', () => {
      const transform: PanZoomTransform = { x: 100, y: 50, zoom: 1.0 };
      const screenPoint = { x: 250, y: 175 };

      const imagePoint = screenToImageCoordinates(screenPoint.x, screenPoint.y, transform);
      expect(imagePoint.x).toBe(150); // 250 - 100
      expect(imagePoint.y).toBe(125); // 175 - 50

      const backToScreen = imageToScreenCoordinates(imagePoint.x, imagePoint.y, transform);
      expect(backToScreen.x).toBe(screenPoint.x);
      expect(backToScreen.y).toBe(screenPoint.y);
    });

    it('converts screen coordinates accurately under magnification (e.g. 2.0x and 4.0x zoom)', () => {
      const transform2x: PanZoomTransform = { x: -200, y: -300, zoom: 2.0 };
      const screenPoint = { x: 400, y: 500 };

      // Screen to Image: (400 - (-200)) / 2 = 300, (500 - (-300)) / 2 = 400
      const imagePoint2x = screenToImageCoordinates(screenPoint.x, screenPoint.y, transform2x);
      expect(imagePoint2x.x).toBe(300);
      expect(imagePoint2x.y).toBe(400);

      const transform4x: PanZoomTransform = { x: -600, y: -800, zoom: 4.0 };
      const screenPoint4x = { x: 600, y: 800 };
      // (600 - (-600)) / 4 = 300, (800 - (-800)) / 4 = 400
      const imagePoint4x = screenToImageCoordinates(screenPoint4x.x, screenPoint4x.y, transform4x);
      expect(imagePoint4x.x).toBe(300);
      expect(imagePoint4x.y).toBe(400);
    });

    it('verifies that a stroke drawn at an image coordinate remains fixed on the scan when zoom/pan changes', () => {
      const invariantImageFeature = { x: 350, y: 450 };

      // 1. Initial fit state (100% zoom, centered)
      const transformFit: PanZoomTransform = { x: 100, y: 50, zoom: 1.0 };
      const screenAtFit = imageToScreenCoordinates(
        invariantImageFeature.x,
        invariantImageFeature.y,
        transformFit
      );
      expect(screenAtFit).toEqual({ x: 450, y: 500 });

      // 2. TA zooms in to 2.5x and pans
      const transformZoomed: PanZoomTransform = { x: -250, y: -400, zoom: 2.5 };
      const screenAtZoomed = imageToScreenCoordinates(
        invariantImageFeature.x,
        invariantImageFeature.y,
        transformZoomed
      );
      // -250 + 350 * 2.5 = 625, -400 + 450 * 2.5 = 725
      expect(screenAtZoomed).toEqual({ x: 625, y: 725 });

      // 3. User clicks on that exact screen coordinate (625, 725) in zoomed view
      const projectedImagePoint = screenToImageCoordinates(625, 725, transformZoomed);
      expect(projectedImagePoint).toEqual(invariantImageFeature);
    });
  });

  describe('5. Multi-Page In-Memory Stroke Isolation', () => {
    const allStrokes: FreehandStroke[] = [
      { id: 's1', pageKey: 'page-1', points: [10, 20, 30, 40], color: '#e11d48', strokeWidth: 3, createdAt: 1 },
      { id: 's2', pageKey: 'page-1', points: [50, 60, 70, 80], color: '#e11d48', strokeWidth: 3, createdAt: 2 },
      { id: 's3', pageKey: 'page-2', points: [100, 100, 110, 110], color: '#e11d48', strokeWidth: 3, createdAt: 3 },
      { id: 's4', pageKey: 'page-3', points: [200, 200], color: '#e11d48', strokeWidth: 3, createdAt: 4 },
    ];

    it('filters strokes strictly by pageKey with zero cross-page leakage', () => {
      const page1Strokes = filterStrokesByPage(allStrokes, 'page-1');
      expect(page1Strokes.map((s) => s.id)).toEqual(['s1', 's2']);

      const page2Strokes = filterStrokesByPage(allStrokes, 'page-2');
      expect(page2Strokes.map((s) => s.id)).toEqual(['s3']);

      const page3Strokes = filterStrokesByPage(allStrokes, 'page-3');
      expect(page3Strokes.map((s) => s.id)).toEqual(['s4']);

      const page4Strokes = filterStrokesByPage(allStrokes, 'page-4');
      expect(page4Strokes).toEqual([]);
    });

    it('handles numeric page indices as page keys consistently', () => {
      const numericStrokes: FreehandStroke[] = [
        { id: 's-idx-0', pageKey: 0, points: [10, 20], color: '#e11d48', strokeWidth: 3, createdAt: 1 },
        { id: 's-idx-1', pageKey: 1, points: [30, 40], color: '#e11d48', strokeWidth: 3, createdAt: 2 },
      ];

      expect(filterStrokesByPage(numericStrokes, 0).map((s) => s.id)).toEqual(['s-idx-0']);
      expect(filterStrokesByPage(numericStrokes, '0').map((s) => s.id)).toEqual(['s-idx-0']);
      expect(filterStrokesByPage(numericStrokes, 1).map((s) => s.id)).toEqual(['s-idx-1']);
    });

    it('returns empty array safely when strokes array is empty, null, or undefined', () => {
      expect(filterStrokesByPage([], 'page-1')).toEqual([]);
      expect(filterStrokesByPage(null as unknown as FreehandStroke[], 'page-1')).toEqual([]);
      expect(filterStrokesByPage(undefined as unknown as FreehandStroke[], 'page-1')).toEqual([]);
    });

    it('simulates page navigation: drawing on Page 1, navigating to Page 2, and returning to Page 1', () => {
      let sessionStrokes: FreehandStroke[] = [];

      // 1. On Page 1: draw stroke A
      const strokeA = createStroke('page-1', { x: 10, y: 10 });
      sessionStrokes = [...sessionStrokes, strokeA];

      expect(filterStrokesByPage(sessionStrokes, 'page-1').length).toBe(1);
      expect(filterStrokesByPage(sessionStrokes, 'page-2').length).toBe(0);

      // 2. Navigate to Page 2: draw stroke B
      const strokeB = createStroke('page-2', { x: 50, y: 50 });
      sessionStrokes = [...sessionStrokes, strokeB];

      expect(filterStrokesByPage(sessionStrokes, 'page-2').length).toBe(1);
      expect(filterStrokesByPage(sessionStrokes, 'page-2')[0].id).toBe(strokeB.id);

      // 3. Return to Page 1: stroke A is intact, stroke B is not present on Page 1
      const restoredPage1 = filterStrokesByPage(sessionStrokes, 'page-1');
      expect(restoredPage1.length).toBe(1);
      expect(restoredPage1[0].id).toBe(strokeA.id);
    });
  });
});
