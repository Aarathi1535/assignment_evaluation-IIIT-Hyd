import { describe, it, expect } from 'vitest';
import {
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  normalizeHighlightRect,
  filterAnnotationsByPage,
  DEFAULT_CHECK_COLOR,
  DEFAULT_CROSS_COLOR,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_STAMP_SIZE,
  MarkAnnotation,
} from '../lib/stampTool';
import {
  screenToImageCoordinates,
  imageToScreenCoordinates,
  createStroke,
  FreehandStroke,
} from '../lib/penTool';
import {
  createInitialHistory,
  recordAddStroke,
  recordAddAnnotation,
  recordEraseAnnotations,
  applyUndo,
  applyRedo,
  canUndo,
  canRedo,
} from '../lib/annotationHistory';
import type { PanZoomTransform } from '../lib/panZoom';
import type { CanvasTool } from '../components/canvas/types';

describe('AE-130: Check (✓), Cross (✗), and Highlight Tools', () => {
  describe('1. Check Stamp Annotation Creation & Invariant Coordinates', () => {
    it('creates a check stamp annotation with proper defaults and coordinates', () => {
      const check = createCheckAnnotation('page-1', { x: 150, y: 250 });

      expect(check.id).toBeDefined();
      expect(check.pageKey).toBe('page-1');
      expect(check.type).toBe('check');
      expect(check.x).toBe(150);
      expect(check.y).toBe(250);
      expect(check.size).toBe(DEFAULT_STAMP_SIZE);
      expect(check.color).toBe(DEFAULT_CHECK_COLOR);
      expect(check.createdAt).toBeGreaterThan(0);
    });

    it('allows custom size, color, and ID for check stamps', () => {
      const check = createCheckAnnotation(
        'page-1',
        { x: 100, y: 100 },
        { size: 40, color: '#059669', customId: 'custom-check-1' }
      );

      expect(check.id).toBe('custom-check-1');
      expect(check.size).toBe(40);
      expect(check.color).toBe('#059669');
    });
  });

  describe('2. Cross Stamp Annotation Creation & Invariant Coordinates', () => {
    it('creates a cross stamp annotation with proper defaults and coordinates', () => {
      const cross = createCrossAnnotation('page-1', { x: 300, y: 400 });

      expect(cross.id).toBeDefined();
      expect(cross.pageKey).toBe('page-1');
      expect(cross.type).toBe('cross');
      expect(cross.x).toBe(300);
      expect(cross.y).toBe(400);
      expect(cross.size).toBe(DEFAULT_STAMP_SIZE);
      expect(cross.color).toBe(DEFAULT_CROSS_COLOR);
      expect(cross.createdAt).toBeGreaterThan(0);
    });

    it('allows custom size, color, and ID for cross stamps', () => {
      const cross = createCrossAnnotation(
        'page-1',
        { x: 200, y: 200 },
        { size: 36, color: '#b91c1c', customId: 'custom-cross-1' }
      );

      expect(cross.id).toBe('custom-cross-1');
      expect(cross.size).toBe(36);
      expect(cross.color).toBe('#b91c1c');
    });
  });

  describe('3. Highlight Rectangle Creation & Bounds Normalization', () => {
    it('normalizes dragged points regardless of drag direction', () => {
      // Drag top-left to bottom-right
      const r1 = normalizeHighlightRect({ x: 50, y: 60 }, { x: 150, y: 180 });
      expect(r1).toEqual({ x: 50, y: 60, width: 100, height: 120 });

      // Drag bottom-right to top-left
      const r2 = normalizeHighlightRect({ x: 150, y: 180 }, { x: 50, y: 60 });
      expect(r2).toEqual({ x: 50, y: 60, width: 100, height: 120 });

      // Drag top-right to bottom-left
      const r3 = normalizeHighlightRect({ x: 150, y: 60 }, { x: 50, y: 180 });
      expect(r3).toEqual({ x: 50, y: 60, width: 100, height: 120 });
    });

    it('creates a highlight annotation with invariant image bounds and defaults', () => {
      const rect = normalizeHighlightRect({ x: 40, y: 80 }, { x: 240, y: 120 });
      const highlight = createHighlightAnnotation('page-1', rect);

      expect(highlight.id).toBeDefined();
      expect(highlight.pageKey).toBe('page-1');
      expect(highlight.type).toBe('highlight');
      expect(highlight.x).toBe(40);
      expect(highlight.y).toBe(80);
      expect(highlight.width).toBe(200);
      expect(highlight.height).toBe(40);
      expect(highlight.color).toBe(DEFAULT_HIGHLIGHT_COLOR);
      expect(highlight.opacity).toBe(0.35);
      expect(highlight.createdAt).toBeGreaterThan(0);
    });

    it('supports custom highlight color and opacity', () => {
      const rect = { x: 10, y: 20, width: 100, height: 50 };
      const highlight = createHighlightAnnotation('page-1', rect, {
        color: '#67e8f9',
        opacity: 0.5,
        customId: 'custom-hl-1',
      });

      expect(highlight.id).toBe('custom-hl-1');
      expect(highlight.color).toBe('#67e8f9');
      expect(highlight.opacity).toBe(0.5);
    });
  });

  describe('4. Coordinate Transformations & Pan/Zoom Alignment', () => {
    it('accurately maps screen clicks to base image coordinates under pan and zoom', () => {
      const transform: PanZoomTransform = {
        x: 100,
        y: 50,
        zoom: 2.0,
      };

      // Screen click at (300, 250)
      const imagePoint = screenToImageCoordinates(300, 250, transform);
      // (300 - 100) / 2 = 100, (250 - 50) / 2 = 100
      expect(imagePoint).toEqual({ x: 100, y: 100 });

      // Storing stamp at (100, 100) and rendering at new transform:
      const newTransform: PanZoomTransform = {
        x: 200,
        y: 150,
        zoom: 3.0,
      };
      const renderedScreenPos = imageToScreenCoordinates(imagePoint.x, imagePoint.y, newTransform);
      // 200 + 100 * 3 = 500, 150 + 100 * 3 = 450
      expect(renderedScreenPos).toEqual({ x: 500, y: 450 });
    });

    it('stores highlight rectangle in invariant image coordinates under pan/zoom', () => {
      const transform: PanZoomTransform = { x: 50, y: 100, zoom: 1.5 };

      // Screen drag from (200, 250) to (350, 400)
      const p1 = screenToImageCoordinates(200, 250, transform); // (100, 100)
      const p2 = screenToImageCoordinates(350, 400, transform); // (200, 200)

      const rect = normalizeHighlightRect(p1, p2);
      const highlight = createHighlightAnnotation('page-1', rect);

      expect(highlight.x).toBe(100);
      expect(highlight.y).toBe(100);
      expect(highlight.width).toBe(100);
      expect(highlight.height).toBe(100);
    });
  });

  describe('5. Page Isolation for Marks & Annotations', () => {
    it('filters annotations strictly by pageKey without leaking across pages', () => {
      const checkP1 = createCheckAnnotation('page-1', { x: 50, y: 50 });
      const crossP1 = createCrossAnnotation('page-1', { x: 80, y: 80 });
      const hlP2 = createHighlightAnnotation('page-2', { x: 10, y: 10, width: 50, height: 20 });
      const checkP3 = createCheckAnnotation('page-3', { x: 100, y: 100 });

      const allAnnotations: MarkAnnotation[] = [checkP1, crossP1, hlP2, checkP3];

      const p1Annotations = filterAnnotationsByPage(allAnnotations, 'page-1');
      expect(p1Annotations.map((a) => a.id)).toEqual([checkP1.id, crossP1.id]);

      const p2Annotations = filterAnnotationsByPage(allAnnotations, 'page-2');
      expect(p2Annotations.map((a) => a.id)).toEqual([hlP2.id]);

      const p3Annotations = filterAnnotationsByPage(allAnnotations, 'page-3');
      expect(p3Annotations.map((a) => a.id)).toEqual([checkP3.id]);

      const p4Annotations = filterAnnotationsByPage(allAnnotations, 'page-4');
      expect(p4Annotations).toEqual([]);
    });
  });

  describe('6. Undo / Redo Actions for Check, Cross, and Highlight', () => {
    it('records and undoes a check mark placement', () => {
      let history = createInitialHistory();
      let annotations: MarkAnnotation[] = [];

      const check = createCheckAnnotation('page-1', { x: 60, y: 60 });
      annotations = [...annotations, check];
      history = recordAddAnnotation(history, check);

      expect(canUndo(history)).toBe(true);
      expect(canRedo(history)).toBe(false);

      // Undo check
      const undoRes = applyUndo(history, [], annotations);
      history = undoRes.history;
      annotations = undoRes.annotations;

      expect(annotations).toEqual([]);
      expect(canUndo(history)).toBe(false);
      expect(canRedo(history)).toBe(true);

      // Redo check
      const redoRes = applyRedo(history, [], annotations);
      history = redoRes.history;
      annotations = redoRes.annotations;

      expect(annotations.length).toBe(1);
      expect(annotations[0].id).toBe(check.id);
      expect(canUndo(history)).toBe(true);
    });

    it('records and undoes a cross mark placement', () => {
      let history = createInitialHistory();
      let annotations: MarkAnnotation[] = [];

      const cross = createCrossAnnotation('page-1', { x: 90, y: 90 });
      annotations = [...annotations, cross];
      history = recordAddAnnotation(history, cross);

      // Undo cross
      const undoRes = applyUndo(history, [], annotations);
      history = undoRes.history;
      annotations = undoRes.annotations;

      expect(annotations).toEqual([]);
      expect(canRedo(history)).toBe(true);

      // Redo cross
      const redoRes = applyRedo(history, [], annotations);
      history = redoRes.history;
      annotations = redoRes.annotations;

      expect(annotations.length).toBe(1);
      expect(annotations[0].id).toBe(cross.id);
    });

    it('records and undoes a highlight rectangle placement', () => {
      let history = createInitialHistory();
      let annotations: MarkAnnotation[] = [];

      const hl = createHighlightAnnotation('page-1', { x: 20, y: 30, width: 100, height: 40 });
      annotations = [...annotations, hl];
      history = recordAddAnnotation(history, hl);

      // Undo highlight
      const undoRes = applyUndo(history, [], annotations);
      history = undoRes.history;
      annotations = undoRes.annotations;

      expect(annotations).toEqual([]);
      expect(canRedo(history)).toBe(true);

      // Redo highlight
      const redoRes = applyRedo(history, [], annotations);
      history = redoRes.history;
      annotations = redoRes.annotations;

      expect(annotations.length).toBe(1);
      expect(annotations[0].id).toBe(hl.id);
    });

    it('interleaves strokes and mark annotations in unified chronological undo/redo stack', () => {
      let history = createInitialHistory();
      let strokes: FreehandStroke[] = [];
      let annotations: MarkAnnotation[] = [];

      // 1. Add pen stroke
      const stroke1 = createStroke('page-1', { x: 10, y: 10 });
      strokes = [...strokes, stroke1];
      history = recordAddStroke(history, stroke1);

      // 2. Add check stamp
      const check1 = createCheckAnnotation('page-1', { x: 50, y: 50 });
      annotations = [...annotations, check1];
      history = recordAddAnnotation(history, check1);

      // 3. Add highlight box
      const hl1 = createHighlightAnnotation('page-1', { x: 80, y: 80, width: 40, height: 20 });
      annotations = [...annotations, hl1];
      history = recordAddAnnotation(history, hl1);

      expect(strokes.length).toBe(1);
      expect(annotations.length).toBe(2);

      // Undo 1: Reverts highlight box
      const undo1 = applyUndo(history, strokes, annotations);
      history = undo1.history;
      strokes = undo1.strokes;
      annotations = undo1.annotations;
      expect(annotations.map((a) => a.id)).toEqual([check1.id]);
      expect(strokes.length).toBe(1);

      // Undo 2: Reverts check stamp
      const undo2 = applyUndo(history, strokes, annotations);
      history = undo2.history;
      strokes = undo2.strokes;
      annotations = undo2.annotations;
      expect(annotations).toEqual([]);
      expect(strokes.length).toBe(1);

      // Undo 3: Reverts pen stroke
      const undo3 = applyUndo(history, strokes, annotations);
      history = undo3.history;
      strokes = undo3.strokes;
      annotations = undo3.annotations;
      expect(strokes).toEqual([]);
      expect(annotations).toEqual([]);

      // Redo 1: Restores pen stroke
      const redo1 = applyRedo(history, strokes, annotations);
      history = redo1.history;
      strokes = redo1.strokes;
      annotations = redo1.annotations;
      expect(strokes.map((s) => s.id)).toEqual([stroke1.id]);
      expect(annotations).toEqual([]);

      // Redo 2: Restores check stamp
      const redo2 = applyRedo(history, strokes, annotations);
      history = redo2.history;
      strokes = redo2.strokes;
      annotations = redo2.annotations;
      expect(annotations.map((a) => a.id)).toEqual([check1.id]);

      // Redo 3: Restores highlight box
      const redo3 = applyRedo(history, strokes, annotations);
      history = redo3.history;
      strokes = redo3.strokes;
      annotations = redo3.annotations;
      expect(annotations.map((a) => a.id)).toEqual([check1.id, hl1.id]);
    });

    it('erases and restores annotations with index preservation', () => {
      let history = createInitialHistory();

      const a1 = createCheckAnnotation('page-1', { x: 10, y: 10 });
      const a2 = createCrossAnnotation('page-1', { x: 20, y: 20 });
      const a3 = createHighlightAnnotation('page-1', { x: 30, y: 30, width: 20, height: 20 });

      let annotations: MarkAnnotation[] = [a1, a2, a3];

      // Erase a2 (middle annotation)
      history = recordEraseAnnotations(history, [a2], annotations);
      annotations = annotations.filter((a) => a.id !== a2.id);

      expect(annotations.map((a) => a.id)).toEqual([a1.id, a3.id]);

      // Undo erase
      const undoRes = applyUndo(history, [], annotations);
      history = undoRes.history;
      annotations = undoRes.annotations;

      expect(annotations.map((a) => a.id)).toEqual([a1.id, a2.id, a3.id]);
    });
  });

  describe('7. Tool Mode Switching & Interaction', () => {
    it('supports all required canvas tools', () => {
      const validTools: CanvasTool[] = ['none', 'pen', 'check', 'cross', 'highlight', 'eraser'];
      expect(validTools.length).toBe(6);

      // Verify mutual exclusivity
      const selectTool = (current: CanvasTool, next: CanvasTool): CanvasTool => {
        return current === next ? 'none' : next;
      };

      expect(selectTool('none', 'check')).toBe('check');
      expect(selectTool('check', 'check')).toBe('none');
      expect(selectTool('check', 'cross')).toBe('cross');
      expect(selectTool('cross', 'highlight')).toBe('highlight');
      expect(selectTool('highlight', 'pen')).toBe('pen');
      expect(selectTool('pen', 'eraser')).toBe('eraser');
    });
  });
});
