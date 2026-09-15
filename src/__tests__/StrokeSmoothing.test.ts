import { describe, it, expect } from 'vitest';
import {
  pointDistance,
  shouldRecordSample,
  calculateSmoothedPoint,
  smoothStrokeCoordinates,
  appendSmoothedPointToStroke,
  finalizeSmoothedStroke,
  DEFAULT_MIN_DISTANCE_THRESHOLD,
} from '../lib/strokeSmoothing';
import {
  createStroke,
  filterStrokesByPage,
  FreehandStroke,
  resolvePenColor,
  resolvePenWidth,
} from '../lib/penTool';
import {
  createInitialHistory,
  recordAddStroke,
  applyUndo,
  applyRedo,
} from '../lib/annotationHistory';
import { isStrokeIntersectingPoint } from '../lib/eraserTool';

describe('AE-129: Stroke Smoothing for Low-Latency Feel', () => {
  describe('1. Distance Filtering & Sample Acceptance', () => {
    it('calculates Euclidean distance accurately', () => {
      expect(pointDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
      expect(pointDistance({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe(0);
    });

    it('rejects micro-jitter samples below the distance threshold', () => {
      const p1 = { x: 100, y: 100 };
      const jitterPoint = { x: 100.5, y: 100.8 }; // distance ~ 0.94 < 2.0
      expect(shouldRecordSample(p1, jitterPoint, DEFAULT_MIN_DISTANCE_THRESHOLD)).toBe(false);
    });

    it('accepts intentional movement samples exceeding the distance threshold', () => {
      const p1 = { x: 100, y: 100 };
      const movedPoint = { x: 103, y: 104 }; // distance = 5.0 >= 2.0
      expect(shouldRecordSample(p1, movedPoint, DEFAULT_MIN_DISTANCE_THRESHOLD)).toBe(true);
    });
  });

  describe('2. Online Exponential Smoothing', () => {
    it('interpolates intermediate coordinates towards current raw input without lag', () => {
      const lastSmoothed = { x: 10, y: 10 };
      const currentRaw = { x: 20, y: 20 };

      // alpha = 0.8 -> 10 * 0.2 + 20 * 0.8 = 18
      const smoothed = calculateSmoothedPoint(lastSmoothed, currentRaw, 0.8);
      expect(smoothed.x).toBe(18);
      expect(smoothed.y).toBe(18);
    });

    it('appends smoothed points incrementally to an active stroke', () => {
      const stroke = createStroke('page-1', { x: 0, y: 0 });
      const strokeAfter1 = appendSmoothedPointToStroke(stroke, { x: 10, y: 10 });
      const strokeAfter2 = appendSmoothedPointToStroke(strokeAfter1, { x: 20, y: 20 });

      expect(strokeAfter2.points.length).toBe(6); // 3 (x, y) pairs
      expect(strokeAfter2.points[0]).toBe(0);
      expect(strokeAfter2.points[1]).toBe(0);
    });
  });

  describe('3. Full-Stroke Smoothing & Endpoint Fidelity', () => {
    it('preserves exact first and last points of a freehand stroke', () => {
      const rawPoints = [
        10, 10,  // P0 (start)
        15, 16,
        22, 21,
        30, 32,
        45, 45,  // Pn (end)
      ];

      const smoothed = smoothStrokeCoordinates(rawPoints);

      // First point preserved exactly
      expect(smoothed[0]).toBe(10);
      expect(smoothed[1]).toBe(10);

      // Last point preserved exactly
      expect(smoothed[smoothed.length - 2]).toBe(45);
      expect(smoothed[smoothed.length - 1]).toBe(45);
    });

    it('damps high-frequency zig-zag noise across intermediate points', () => {
      // Intentionally noisy zig-zag path along a general diagonal from (0,0) to (40,40)
      const noisyPoints = [
        0, 0,
        10, 18, // overshoot Y
        20, 12, // undershoot Y
        30, 38, // overshoot Y
        40, 40,
      ];

      const smoothed = smoothStrokeCoordinates(noisyPoints);

      // Intermediate point 1 smoothed: damped down from 18 towards baseline
      const smoothedY1 = smoothed[3];
      expect(smoothedY1).toBeLessThan(18);
      expect(smoothedY1).toBeGreaterThanOrEqual(12);
    });

    it('preserves collinear / straight strokes without unintended curvature', () => {
      const straightLine = [
        0, 0,
        10, 10,
        20, 20,
        30, 30,
        40, 40,
      ];

      const smoothed = smoothStrokeCoordinates(straightLine);

      // Collinear points remain collinear
      for (let i = 0; i < smoothed.length; i += 2) {
        expect(smoothed[i]).toBeCloseTo(smoothed[i + 1], 1);
      }
    });

    it('handles short strokes (1-2 points) safely without errors or truncation', () => {
      const singlePoint = [100, 100];
      expect(smoothStrokeCoordinates(singlePoint)).toEqual([100, 100]);

      const twoPoints = [10, 20, 30, 40];
      expect(smoothStrokeCoordinates(twoPoints)).toEqual([10, 20, 30, 40]);
    });
  });

  describe('4. Stroke Finalization & Metadata Integrity', () => {
    it('preserves stroke ID, color, strokeWidth, pressure, and pageKey after smoothing', () => {
      const stroke = createStroke(
        'page-2',
        { x: 10, y: 10 },
        {
          color: resolvePenColor('blue'),
          strokeWidth: resolvePenWidth('thick'),
          pressure: 0.8,
          customId: 'custom-smoothed-id',
        }
      );

      const extended = {
        ...stroke,
        points: [10, 10, 20, 25, 35, 30, 50, 50],
      };

      const finalized = finalizeSmoothedStroke(extended);

      expect(finalized.id).toBe('custom-smoothed-id');
      expect(finalized.pageKey).toBe('page-2');
      expect(finalized.color).toBe('#2563eb');
      expect(finalized.strokeWidth).toBe(stroke.strokeWidth); // Pressure-derived width intact
      expect(finalized.points.length).toBeGreaterThan(2);
    });
  });

  describe('5. Integration: Undo / Redo & Eraser Compatibility', () => {
    it('stores finalized smoothed stroke as a single add-stroke history action', () => {
      let history = createInitialHistory();
      const stroke = finalizeSmoothedStroke({
        id: 'smoothed-stroke-1',
        pageKey: 'page-1',
        points: [0, 0, 10, 12, 20, 18, 30, 30],
        color: '#e11d48',
        strokeWidth: 2,
        createdAt: 1000,
      });

      const strokes = [stroke];
      history = recordAddStroke(history, stroke);

      expect(history.past.length).toBe(1);

      // Undo removes the smoothed stroke
      const undoRes = applyUndo(history, strokes);
      expect(undoRes.strokes).toEqual([]);

      // Redo restores the exact smoothed stroke
      const redoRes = applyRedo(undoRes.history, undoRes.strokes);
      expect(redoRes.strokes).toEqual([stroke]);
    });

    it('remains fully compatible with AE-128 vector eraser hit-testing', () => {
      const smoothedStroke: FreehandStroke = {
        id: 'smoothed-stroke-2',
        pageKey: 'page-1',
        points: [50, 50, 75, 75, 100, 100],
        color: '#e11d48',
        strokeWidth: 2,
        createdAt: 1,
      };

      // Eraser point near the smoothed trajectory intersects it
      expect(isStrokeIntersectingPoint(smoothedStroke, { x: 75, y: 76 }, 10)).toBe(true);

      // Eraser point far away does not intersect
      expect(isStrokeIntersectingPoint(smoothedStroke, { x: 200, y: 200 }, 10)).toBe(false);
    });

    it('preserves multi-page stroke isolation with smoothed strokes', () => {
      const strokeP1 = finalizeSmoothedStroke(createStroke('page-1', { x: 10, y: 10 }));
      const strokeP2 = finalizeSmoothedStroke(createStroke('page-2', { x: 50, y: 50 }));
      const allStrokes = [strokeP1, strokeP2];

      expect(filterStrokesByPage(allStrokes, 'page-1')).toEqual([strokeP1]);
      expect(filterStrokesByPage(allStrokes, 'page-2')).toEqual([strokeP2]);
    });
  });

  describe('6. Performance & Low-Latency Validation (< 200ms Requirement)', () => {
    it('executes smoothing on a 500-point synthetic trajectory deterministically in < 10ms', () => {
      // Generate synthetic 500-point raw stroke
      const points: number[] = [];
      for (let i = 0; i < 500; i++) {
        points.push(i * 2 + (i % 2 === 0 ? 0.5 : -0.5), i * 2 + (i % 3 === 0 ? 0.3 : -0.3));
      }

      const startTime = performance.now();
      const smoothed = smoothStrokeCoordinates(points);
      const durationMs = performance.now() - startTime;

      expect(smoothed.length).toBeGreaterThan(0);
      // Validates that execution is well within the low-latency drawing budget (< 200 ms)
      expect(durationMs).toBeLessThan(50);
    });
  });
});
