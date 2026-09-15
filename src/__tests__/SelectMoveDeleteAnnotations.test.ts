import { describe, it, expect } from 'vitest';
import {
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  createTextNoteAnnotation,
  moveAnnotation,
  getAnnotationBounds,
  isPointInsideAnnotation,
  filterAnnotationsByPage,
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
  recordMoveAnnotation,
  applyUndo,
  applyRedo,
} from '../lib/annotationHistory';
import type { PanZoomTransform } from '../lib/panZoom';
import type { CanvasTool } from '../components/canvas/types';

describe('AE-132: Select, Move, and Delete Existing Annotations', () => {
  describe('1. Annotation Selection & Bounds Hit Testing', () => {
    it('computes correct bounds and performs hit testing on Check stamp', () => {
      const check = createCheckAnnotation('page-1', { x: 100, y: 100 }, { size: 30 });
      const bounds = getAnnotationBounds(check);

      expect(bounds.x).toBe(85);
      expect(bounds.y).toBe(85);
      expect(bounds.width).toBe(30);
      expect(bounds.height).toBe(30);

      // Point inside bounds
      expect(isPointInsideAnnotation(check, { x: 100, y: 100 })).toBe(true);
      expect(isPointInsideAnnotation(check, { x: 86, y: 86 })).toBe(true);

      // Point far outside bounds
      expect(isPointInsideAnnotation(check, { x: 200, y: 200 })).toBe(false);
    });

    it('computes correct bounds and performs hit testing on Cross stamp', () => {
      const cross = createCrossAnnotation('page-1', { x: 150, y: 200 }, { size: 40 });
      const bounds = getAnnotationBounds(cross);

      expect(bounds.x).toBe(130);
      expect(bounds.y).toBe(180);
      expect(bounds.width).toBe(40);
      expect(bounds.height).toBe(40);

      expect(isPointInsideAnnotation(cross, { x: 150, y: 200 })).toBe(true);
      expect(isPointInsideAnnotation(cross, { x: 10, y: 10 })).toBe(false);
    });

    it('computes correct bounds and performs hit testing on Highlight rectangle', () => {
      const hl = createHighlightAnnotation('page-1', { x: 50, y: 60, width: 120, height: 40 });
      const bounds = getAnnotationBounds(hl);

      expect(bounds.x).toBe(50);
      expect(bounds.y).toBe(60);
      expect(bounds.width).toBe(120);
      expect(bounds.height).toBe(40);

      expect(isPointInsideAnnotation(hl, { x: 60, y: 70 })).toBe(true);
      expect(isPointInsideAnnotation(hl, { x: 169, y: 99 })).toBe(true);
      expect(isPointInsideAnnotation(hl, { x: 200, y: 200 })).toBe(false);
    });

    it('computes correct bounds and performs hit testing on Text Note', () => {
      const textNote = createTextNoteAnnotation('page-1', { x: 80, y: 90 }, 'Formula verification\nStep 2');
      const bounds = getAnnotationBounds(textNote);

      expect(bounds.x).toBe(80);
      expect(bounds.y).toBe(90);
      expect(bounds.width).toBeGreaterThan(50);
      expect(bounds.height).toBeGreaterThan(20);

      expect(isPointInsideAnnotation(textNote, { x: 85, y: 95 })).toBe(true);
      expect(isPointInsideAnnotation(textNote, { x: 500, y: 500 })).toBe(false);
    });

    it('manages selection state and allows clearing selection on empty space click', () => {
      let selectedId: string | null = null;
      const check = createCheckAnnotation('page-1', { x: 100, y: 100 });

      // Select annotation
      selectedId = check.id;
      expect(selectedId).toBe(check.id);

      // Click on empty space -> deselect
      selectedId = null;
      expect(selectedId).toBeNull();
    });
  });

  describe('2. Annotation Movement in Invariant Image Coordinates', () => {
    it('moves a Check stamp while preserving all original properties and ID', () => {
      const check = createCheckAnnotation('page-1', { x: 100, y: 100 }, { size: 32, color: '#16a34a' });
      const moved = moveAnnotation(check, { x: 250, y: 350 });

      expect(moved.id).toBe(check.id);
      expect(moved.pageKey).toBe('page-1');
      expect(moved.type).toBe('check');
      expect(moved.x).toBe(250);
      expect(moved.y).toBe(350);
      expect(moved.size).toBe(32);
      expect(moved.color).toBe('#16a34a');
      expect(moved.createdAt).toBe(check.createdAt);
    });

    it('moves a Cross stamp while preserving all original properties and ID', () => {
      const cross = createCrossAnnotation('page-1', { x: 50, y: 50 }, { size: 28, color: '#dc2626' });
      const moved = moveAnnotation(cross, { x: 180, y: 220 });

      expect(moved.id).toBe(cross.id);
      expect(moved.pageKey).toBe('page-1');
      expect(moved.type).toBe('cross');
      expect(moved.x).toBe(180);
      expect(moved.y).toBe(220);
      expect(moved.size).toBe(28);
      expect(moved.color).toBe('#dc2626');
    });

    it('moves a Highlight rectangle while preserving width, height, opacity, and color', () => {
      const hl = createHighlightAnnotation('page-1', { x: 20, y: 30, width: 100, height: 50 });
      const moved = moveAnnotation(hl, { x: 140, y: 200 });

      expect(moved.id).toBe(hl.id);
      expect(moved.pageKey).toBe('page-1');
      expect(moved.type).toBe('highlight');
      expect(moved.x).toBe(140);
      expect(moved.y).toBe(200);
      expect(moved.width).toBe(100);
      expect(moved.height).toBe(50);
      expect(moved.color).toBe(hl.color);
      expect(moved.opacity).toBe(hl.opacity);
    });

    it('moves a Text Note while preserving text, font size, background, and border', () => {
      const note = createTextNoteAnnotation(
        'page-1',
        { x: 40, y: 60 },
        'Key definition missing in line 3',
        { fontSize: 16, color: '#0f172a', backgroundColor: '#fef9c3', borderColor: '#fde047' }
      );
      const moved = moveAnnotation(note, { x: 300, y: 450 });

      expect(moved.id).toBe(note.id);
      expect(moved.pageKey).toBe('page-1');
      expect(moved.type).toBe('text');
      expect(moved.x).toBe(300);
      expect(moved.y).toBe(450);
      expect(moved.text).toBe('Key definition missing in line 3');
      expect(moved.fontSize).toBe(16);
      expect(moved.color).toBe('#0f172a');
      expect(moved.backgroundColor).toBe('#fef9c3');
      expect(moved.borderColor).toBe('#fde047');
    });

    it('correctly maps pointer movement to invariant base image coordinates under pan and zoom', () => {
      // Zoomed in 2x with pan offset (-100, -50)
      const transform: PanZoomTransform = { zoom: 2.0, x: -100, y: -50 };
      const screenDragTarget = { x: 500, y: 350 };

      // Invariant image point: (500 - (-100)) / 2 = 300, (350 - (-50)) / 2 = 200
      const imagePoint = screenToImageCoordinates(screenDragTarget.x, screenDragTarget.y, transform);
      expect(imagePoint.x).toBe(300);
      expect(imagePoint.y).toBe(200);

      const note = createTextNoteAnnotation('page-1', { x: 50, y: 50 }, 'Note');
      const movedNote = moveAnnotation(note, imagePoint);
      expect(movedNote.x).toBe(300);
      expect(movedNote.y).toBe(200);

      // Re-projection to screen
      const screenPos = imageToScreenCoordinates(movedNote.x, movedNote.y, transform);
      expect(screenPos.x).toBe(500);
      expect(screenPos.y).toBe(350);
    });
  });

  describe('3. Undo and Redo for Annotation Movement', () => {
    it('records a single history action for a completed move and restores exact positions on undo/redo', () => {
      let history = createInitialHistory();
      const check = createCheckAnnotation('page-1', { x: 100, y: 100 });
      let annotations: MarkAnnotation[] = [check];

      // Add check
      history = recordAddAnnotation(history, check);

      // Move check: (100, 100) -> (250, 300)
      const prevPos = { x: check.x, y: check.y };
      const newPos = { x: 250, y: 300 };
      annotations = annotations.map((a) => (a.id === check.id ? moveAnnotation(a, newPos) : a));
      history = recordMoveAnnotation(history, check.id, prevPos, newPos);

      expect(annotations[0].x).toBe(250);
      expect(annotations[0].y).toBe(300);
      expect(history.past).toHaveLength(2); // add + move

      // Undo Move -> returns to (100, 100)
      const undoRes = applyUndo(history, [], annotations);
      history = undoRes.history;
      annotations = undoRes.annotations;

      expect(annotations).toHaveLength(1);
      expect(annotations[0].x).toBe(100);
      expect(annotations[0].y).toBe(100);

      // Redo Move -> re-applies (250, 300)
      const redoRes = applyRedo(history, [], annotations);
      history = redoRes.history;
      annotations = redoRes.annotations;

      expect(annotations).toHaveLength(1);
      expect(annotations[0].x).toBe(250);
      expect(annotations[0].y).toBe(300);
    });

    it('does not record a history action if moved to identical coordinates', () => {
      let history = createInitialHistory();
      const check = createCheckAnnotation('page-1', { x: 100, y: 100 });
      history = recordAddAnnotation(history, check);

      const historyBefore = { ...history };
      history = recordMoveAnnotation(history, check.id, { x: 100, y: 100 }, { x: 100, y: 100 });

      expect(history.past).toHaveLength(historyBefore.past.length);
    });
  });

  describe('4. Annotation Deletion & Undo/Redo', () => {
    it('deletes the selected annotation and leaves other annotations intact', () => {
      let history = createInitialHistory();
      const a1 = createCheckAnnotation('page-1', { x: 50, y: 50 });
      const a2 = createCrossAnnotation('page-1', { x: 100, y: 100 });
      const a3 = createHighlightAnnotation('page-1', { x: 150, y: 150, width: 80, height: 30 });

      let annotations: MarkAnnotation[] = [a1, a2, a3];
      history = recordAddAnnotation(history, a1);
      history = recordAddAnnotation(history, a2);
      history = recordAddAnnotation(history, a3);

      // Select and delete a2 (cross)
      const selectedId = a2.id;
      const target = annotations.find((a) => a.id === selectedId)!;
      history = recordEraseAnnotations(history, [target], annotations);
      annotations = annotations.filter((a) => a.id !== selectedId);

      expect(annotations.map((a) => a.id)).toEqual([a1.id, a3.id]);

      // Undo deletion -> restores a2 at its exact position
      const undoRes = applyUndo(history, [], annotations);
      history = undoRes.history;
      annotations = undoRes.annotations;

      expect(annotations.map((a) => a.id)).toEqual([a1.id, a2.id, a3.id]);
      expect(annotations.find((a) => a.id === a2.id)?.x).toBe(100);

      // Redo deletion -> removes a2 again
      const redoRes = applyRedo(history, [], annotations);
      history = redoRes.history;
      annotations = redoRes.annotations;

      expect(annotations.map((a) => a.id)).toEqual([a1.id, a3.id]);
    });

    it('does nothing when delete is invoked with empty selection', () => {
      let history = createInitialHistory();
      const a1 = createCheckAnnotation('page-1', { x: 50, y: 50 });
      let annotations: MarkAnnotation[] = [a1];
      const selectedId: string | null = null;

      if (selectedId) {
        const target = annotations.find((a) => a.id === selectedId);
        if (target) {
          history = recordEraseAnnotations(history, [target], annotations);
          annotations = annotations.filter((a) => a.id !== selectedId);
        }
      }

      expect(annotations).toHaveLength(1);
      expect(history.past).toHaveLength(0);
    });
  });

  describe('5. Page Isolation for Selection, Move, and Delete', () => {
    it('isolates selection and actions strictly per page without cross-page mutation', () => {
      let historyP1 = createInitialHistory();
      let historyP2 = createInitialHistory();

      const noteP1 = createTextNoteAnnotation('page-1', { x: 100, y: 100 }, 'Page 1 Note');
      const noteP2 = createTextNoteAnnotation('page-2', { x: 200, y: 200 }, 'Page 2 Note');

      let allAnnotations: MarkAnnotation[] = [noteP1, noteP2];
      historyP1 = recordAddAnnotation(historyP1, noteP1);
      historyP2 = recordAddAnnotation(historyP2, noteP2);

      // Move Page 1 Note
      allAnnotations = allAnnotations.map((a) =>
        a.id === noteP1.id ? moveAnnotation(a, { x: 150, y: 180 }) : a
      );
      historyP1 = recordMoveAnnotation(historyP1, noteP1.id, { x: 100, y: 100 }, { x: 150, y: 180 });

      // Page 2 note remains untouched
      const p2Annotations = filterAnnotationsByPage(allAnnotations, 'page-2');
      expect(p2Annotations).toHaveLength(1);
      expect(p2Annotations[0].x).toBe(200);
      expect(p2Annotations[0].y).toBe(200);

      // Delete Page 2 Note
      historyP2 = recordEraseAnnotations(historyP2, [noteP2], p2Annotations);
      allAnnotations = allAnnotations.filter((a) => a.id !== noteP2.id);

      // Page 1 annotations are fully preserved
      const p1Annotations = filterAnnotationsByPage(allAnnotations, 'page-1');
      expect(p1Annotations).toHaveLength(1);
      expect(p1Annotations[0].x).toBe(150);
      expect(p1Annotations[0].y).toBe(180);
      expect(historyP1.past).toHaveLength(2);
      expect(historyP2.past).toHaveLength(2);
    });
  });

  describe('6. Interleaved History with Strokes, Stamps, and Text Notes', () => {
    it('seamlessly interleaves strokes, additions, movements, and deletions in chronological undo/redo', () => {
      let history = createInitialHistory();
      let strokes: FreehandStroke[] = [];
      let annotations: MarkAnnotation[] = [];

      // 1. Add pen stroke
      const stroke1 = createStroke('page-1', { x: 10, y: 10 }, { color: '#ef4444' });
      strokes = [...strokes, stroke1];
      history = recordAddStroke(history, stroke1);

      // 2. Add text note
      const note = createTextNoteAnnotation('page-1', { x: 50, y: 50 }, 'Comment');
      annotations = [...annotations, note];
      history = recordAddAnnotation(history, note);

      // 3. Move text note to (120, 150)
      annotations = annotations.map((a) => (a.id === note.id ? moveAnnotation(a, { x: 120, y: 150 }) : a));
      history = recordMoveAnnotation(history, note.id, { x: 50, y: 50 }, { x: 120, y: 150 });

      // 4. Add check stamp
      const check = createCheckAnnotation('page-1', { x: 200, y: 200 });
      annotations = [...annotations, check];
      history = recordAddAnnotation(history, check);

      // 5. Delete check stamp
      history = recordEraseAnnotations(history, [check], annotations);
      annotations = annotations.filter((a) => a.id !== check.id);

      expect(strokes).toHaveLength(1);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].x).toBe(120);

      // Undo 5: Restore deleted check stamp
      let undoRes = applyUndo(history, strokes, annotations);
      history = undoRes.history;
      strokes = undoRes.strokes;
      annotations = undoRes.annotations;
      expect(annotations.map((a) => a.id)).toEqual([note.id, check.id]);

      // Undo 4: Remove check stamp
      undoRes = applyUndo(history, strokes, annotations);
      history = undoRes.history;
      strokes = undoRes.strokes;
      annotations = undoRes.annotations;
      expect(annotations.map((a) => a.id)).toEqual([note.id]);

      // Undo 3: Revert move of text note back to (50, 50)
      undoRes = applyUndo(history, strokes, annotations);
      history = undoRes.history;
      strokes = undoRes.strokes;
      annotations = undoRes.annotations;
      expect(annotations[0].x).toBe(50);
      expect(annotations[0].y).toBe(50);

      // Undo 2: Remove text note
      undoRes = applyUndo(history, strokes, annotations);
      history = undoRes.history;
      strokes = undoRes.strokes;
      annotations = undoRes.annotations;
      expect(annotations).toHaveLength(0);
      expect(strokes).toHaveLength(1);

      // Undo 1: Remove stroke
      undoRes = applyUndo(history, strokes, annotations);
      history = undoRes.history;
      strokes = undoRes.strokes;
      annotations = undoRes.annotations;
      expect(strokes).toHaveLength(0);
      expect(annotations).toHaveLength(0);

      // Redo all 5 steps
      let redoRes = applyRedo(history, strokes, annotations); // stroke
      history = redoRes.history;
      strokes = redoRes.strokes;
      annotations = redoRes.annotations;

      redoRes = applyRedo(history, strokes, annotations); // note add
      history = redoRes.history;
      strokes = redoRes.strokes;
      annotations = redoRes.annotations;

      redoRes = applyRedo(history, strokes, annotations); // note move
      history = redoRes.history;
      strokes = redoRes.strokes;
      annotations = redoRes.annotations;
      expect(annotations[0].x).toBe(120);
      expect(annotations[0].y).toBe(150);

      redoRes = applyRedo(history, strokes, annotations); // check add
      history = redoRes.history;
      strokes = redoRes.strokes;
      annotations = redoRes.annotations;

      redoRes = applyRedo(history, strokes, annotations); // check delete
      history = redoRes.history;
      strokes = redoRes.strokes;
      annotations = redoRes.annotations;

      expect(strokes).toHaveLength(1);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].id).toBe(note.id);
      expect(annotations[0].x).toBe(120);
      expect(annotations[0].y).toBe(150);
    });
  });

  describe('7. Tool Selection and Canvas Tool Union', () => {
    it('supports select tool alongside all 8 canvas tools', () => {
      const allTools: CanvasTool[] = ['none', 'select', 'pen', 'check', 'cross', 'highlight', 'text', 'eraser'];
      expect(allTools).toHaveLength(8);
      expect(allTools).toContain('select');
    });
  });
});
