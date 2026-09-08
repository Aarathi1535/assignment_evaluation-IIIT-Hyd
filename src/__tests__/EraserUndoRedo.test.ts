import { describe, it, expect } from 'vitest';
import {
  distanceSquaredToSegment,
  isStrokeIntersectingPoint,
  findIntersectingStrokes,
  DEFAULT_ERASER_RADIUS,
} from '../lib/eraserTool';
import {
  createInitialHistory,
  recordAddStroke,
  recordEraseStrokes,
  applyUndo,
  applyRedo,
  canUndo,
  canRedo,
  PageHistory,
} from '../lib/annotationHistory';
import {
  createStroke,
  filterStrokesByPage,
  FreehandStroke,
  resolvePenColor,
  resolvePenWidth,
} from '../lib/penTool';

describe('AE-128: Eraser Tool & Undo/Redo Action Architecture', () => {
  describe('1. Eraser Tool Distance & Hit-Testing', () => {
    it('calculates the squared distance from a point to a 2D line segment', () => {
      // Point directly on segment (10, 20) -> (30, 20) at (20, 20)
      expect(distanceSquaredToSegment(20, 20, 10, 20, 30, 20)).toBe(0);

      // Point perpendicular to midpoint: (20, 25) to (10, 20)->(30, 20) is 5 units away -> 25
      expect(distanceSquaredToSegment(20, 25, 10, 20, 30, 20)).toBe(25);

      // Point beyond end of segment: (35, 20) to (10, 20)->(30, 20) is 5 units away -> 25
      expect(distanceSquaredToSegment(35, 20, 10, 20, 30, 20)).toBe(25);

      // Zero-length segment (point to point)
      expect(distanceSquaredToSegment(15, 20, 10, 20, 10, 20)).toBe(25);
    });

    it('detects intersection between eraser point and a multi-segment stroke', () => {
      const stroke: FreehandStroke = {
        id: 'stroke-1',
        pageKey: 'page-1',
        points: [100, 100, 150, 150, 200, 200],
        color: '#e11d48',
        strokeWidth: 2,
        createdAt: 1,
      };

      // Point directly on the line segment (125, 125)
      expect(isStrokeIntersectingPoint(stroke, { x: 125, y: 125 }, DEFAULT_ERASER_RADIUS)).toBe(true);

      // Point within eraser radius (radius = 12, distance ~ 5)
      expect(isStrokeIntersectingPoint(stroke, { x: 125, y: 130 }, 12)).toBe(true);

      // Point far outside eraser radius
      expect(isStrokeIntersectingPoint(stroke, { x: 300, y: 300 }, DEFAULT_ERASER_RADIUS)).toBe(false);
    });

    it('filters intersecting strokes accurately while preserving non-colliding strokes', () => {
      const strokeA: FreehandStroke = {
        id: 's-A',
        pageKey: 'page-1',
        points: [50, 50, 60, 60],
        color: '#e11d48',
        strokeWidth: 2,
        createdAt: 1,
      };
      const strokeB: FreehandStroke = {
        id: 's-B',
        pageKey: 'page-1',
        points: [200, 200, 220, 220],
        color: '#2563eb',
        strokeWidth: 5,
        createdAt: 2,
      };

      const hitsNearA = findIntersectingStrokes([strokeA, strokeB], { x: 52, y: 52 }, 10);
      expect(hitsNearA.map((s) => s.id)).toEqual(['s-A']);

      const hitsNearB = findIntersectingStrokes([strokeA, strokeB], { x: 210, y: 210 }, 10);
      expect(hitsNearB.map((s) => s.id)).toEqual(['s-B']);

      const hitsInEmptySpace = findIntersectingStrokes([strokeA, strokeB], { x: 500, y: 500 }, 10);
      expect(hitsInEmptySpace).toEqual([]);
    });
  });

  describe('2. Undo / Redo: Adding Strokes', () => {
    it('manages initial undo/redo availability correctly', () => {
      const history = createInitialHistory();
      expect(canUndo(history)).toBe(false);
      expect(canRedo(history)).toBe(false);
    });

    it('records an add-stroke action and enables undo', () => {
      let history = createInitialHistory();
      const stroke1 = createStroke('page-1', { x: 10, y: 10 });

      history = recordAddStroke(history, stroke1);
      expect(canUndo(history)).toBe(true);
      expect(canRedo(history)).toBe(false);
      expect(history.past.length).toBe(1);
    });

    it('undoes adding a stroke, restoring previous state and enabling redo', () => {
      let history = createInitialHistory();
      let strokes: FreehandStroke[] = [];

      const stroke1 = createStroke('page-1', { x: 10, y: 10 });
      strokes = [...strokes, stroke1];
      history = recordAddStroke(history, stroke1);

      // Perform Undo
      const undoResult = applyUndo(history, strokes);
      history = undoResult.history;
      strokes = undoResult.strokes;

      expect(strokes).toEqual([]);
      expect(canUndo(history)).toBe(false);
      expect(canRedo(history)).toBe(true);

      // Perform Redo
      const redoResult = applyRedo(history, strokes);
      history = redoResult.history;
      strokes = redoResult.strokes;

      expect(strokes.length).toBe(1);
      expect(strokes[0].id).toBe(stroke1.id);
      expect(canUndo(history)).toBe(true);
      expect(canRedo(history)).toBe(false);
    });
  });

  describe('3. Undo / Redo: Erasing Strokes with Ordering & Style Preservation', () => {
    it('records an erase-strokes action and undoes it, restoring original order and style', () => {
      let history = createInitialHistory();

      const stroke1 = createStroke(
        'page-1',
        { x: 10, y: 10 },
        { color: resolvePenColor('red'), strokeWidth: resolvePenWidth('thin') }
      );
      const stroke2 = createStroke(
        'page-1',
        { x: 50, y: 50 },
        { color: resolvePenColor('blue'), strokeWidth: resolvePenWidth('thick') }
      );
      const stroke3 = createStroke(
        'page-1',
        { x: 90, y: 90 },
        { color: resolvePenColor('green'), strokeWidth: resolvePenWidth('thin') }
      );

      let strokes: FreehandStroke[] = [stroke1, stroke2, stroke3];

      // Erase stroke2 (the middle stroke)
      history = recordEraseStrokes(history, [stroke2], strokes);
      strokes = strokes.filter((s) => s.id !== stroke2.id);

      expect(strokes.map((s) => s.id)).toEqual([stroke1.id, stroke3.id]);
      expect(canUndo(history)).toBe(true);

      // Undo the erase
      const undoResult = applyUndo(history, strokes);
      history = undoResult.history;
      strokes = undoResult.strokes;

      // Verify stroke2 was reinserted in its exact middle position with style intact
      expect(strokes.map((s) => s.id)).toEqual([stroke1.id, stroke2.id, stroke3.id]);
      expect(strokes[1].color).toBe('#2563eb'); // Blue
      expect(strokes[1].strokeWidth).toBe(5); // Thick

      // Redo the erase
      const redoResult = applyRedo(history, strokes);
      history = redoResult.history;
      strokes = redoResult.strokes;

      expect(strokes.map((s) => s.id)).toEqual([stroke1.id, stroke3.id]);
    });

    it('erases and restores multiple strokes in a single gesture', () => {
      let history = createInitialHistory();

      const s1 = createStroke('page-1', { x: 10, y: 10 });
      const s2 = createStroke('page-1', { x: 20, y: 20 });
      const s3 = createStroke('page-1', { x: 30, y: 30 });
      let strokes = [s1, s2, s3];

      // Multi-erase in one swipe: s1 and s2
      history = recordEraseStrokes(history, [s1, s2], strokes);
      strokes = [s3];

      const undoResult = applyUndo(history, strokes);
      expect(undoResult.strokes.map((s) => s.id)).toEqual([s1.id, s2.id, s3.id]);
    });
  });

  describe('4. Redo Stack Invalidation on New Action', () => {
    it('clears redo stack when a new stroke is drawn after an undo', () => {
      let history = createInitialHistory();
      let strokes: FreehandStroke[] = [];

      const strokeA = createStroke('page-1', { x: 10, y: 10 });
      strokes = [...strokes, strokeA];
      history = recordAddStroke(history, strokeA);

      // Undo strokeA -> redo available
      const undoRes = applyUndo(history, strokes);
      history = undoRes.history;
      strokes = undoRes.strokes;
      expect(canRedo(history)).toBe(true);

      // Now user draws a new strokeB instead of redoing
      const strokeB = createStroke('page-1', { x: 50, y: 50 });
      strokes = [...strokes, strokeB];
      history = recordAddStroke(history, strokeB);

      // Redo stack must be cleared
      expect(canRedo(history)).toBe(false);
      expect(history.future).toEqual([]);
      expect(canUndo(history)).toBe(true);
    });
  });

  describe('5. Page-Aware History Isolation', () => {
    it('strictly isolates undo/redo histories and stroke actions per page', () => {
      const pageHistories: Record<string, PageHistory> = {
        'page-1': createInitialHistory(),
        'page-2': createInitialHistory(),
      };

      let allStrokes: FreehandStroke[] = [];

      // 1. Draw on Page 1
      const strokeP1 = createStroke('page-1', { x: 15, y: 15 });
      allStrokes = [...allStrokes, strokeP1];
      pageHistories['page-1'] = recordAddStroke(pageHistories['page-1'], strokeP1);

      // 2. Navigate to Page 2 & Draw
      const strokeP2 = createStroke('page-2', { x: 80, y: 80 });
      allStrokes = [...allStrokes, strokeP2];
      pageHistories['page-2'] = recordAddStroke(pageHistories['page-2'], strokeP2);

      // Page 2 has undo available, Page 1 still has undo available
      expect(canUndo(pageHistories['page-1'])).toBe(true);
      expect(canUndo(pageHistories['page-2'])).toBe(true);

      // 3. Undo on Page 2
      const page2Strokes = filterStrokesByPage(allStrokes, 'page-2');
      const undoP2 = applyUndo(pageHistories['page-2'], page2Strokes);
      pageHistories['page-2'] = undoP2.history;

      const otherStrokes = allStrokes.filter((s) => String(s.pageKey) !== 'page-2');
      allStrokes = [...otherStrokes, ...undoP2.strokes];

      // Page 2 strokes are gone, Page 1 stroke remains intact
      expect(filterStrokesByPage(allStrokes, 'page-2')).toEqual([]);
      expect(filterStrokesByPage(allStrokes, 'page-1').length).toBe(1);
      expect(canUndo(pageHistories['page-1'])).toBe(true);
      expect(canUndo(pageHistories['page-2'])).toBe(false);
      expect(canRedo(pageHistories['page-2'])).toBe(true);
    });
  });

  describe('6. Keyboard Shortcut Routing Logic', () => {
    it('recognizes standard Ctrl+Z, Ctrl+Shift+Z, Cmd+Z, and Ctrl+Y key events', () => {
      const isUndoEvent = (e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; key: string }) => {
        const isCtrlOrCmd = Boolean(e.ctrlKey || e.metaKey);
        return isCtrlOrCmd && e.key.toLowerCase() === 'z' && !e.shiftKey;
      };

      const isRedoEvent = (e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; key: string }) => {
        const isCtrlOrCmd = Boolean(e.ctrlKey || e.metaKey);
        return isCtrlOrCmd && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y');
      };

      expect(isUndoEvent({ ctrlKey: true, key: 'z' })).toBe(true);
      expect(isUndoEvent({ metaKey: true, key: 'Z' })).toBe(true);
      expect(isUndoEvent({ ctrlKey: true, shiftKey: true, key: 'z' })).toBe(false);

      expect(isRedoEvent({ ctrlKey: true, shiftKey: true, key: 'z' })).toBe(true);
      expect(isRedoEvent({ metaKey: true, shiftKey: true, key: 'Z' })).toBe(true);
      expect(isRedoEvent({ ctrlKey: true, key: 'y' })).toBe(true);
      expect(isRedoEvent({ metaKey: true, key: 'Y' })).toBe(true);
      expect(isRedoEvent({ ctrlKey: false, key: 'y' })).toBe(false);
    });
  });
});
