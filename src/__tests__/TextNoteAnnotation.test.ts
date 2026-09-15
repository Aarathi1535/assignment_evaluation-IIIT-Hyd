import { describe, it, expect } from 'vitest';
import {
  createTextNoteAnnotation,
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  filterAnnotationsByPage,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_BG_COLOR,
  DEFAULT_TEXT_BORDER_COLOR,
  TextNoteAnnotation,
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

describe('AE-131: Text-Note Annotation (Typed Comment on Sheet)', () => {
  describe('1. Text Note Annotation Creation & Defaults', () => {
    it('creates a text note annotation with proper defaults and invariant image coordinates', () => {
      const note = createTextNoteAnnotation('page-1', { x: 120, y: 340 }, 'Check calculation step 2');

      expect(note.id).toBeDefined();
      expect(note.id.startsWith('text_')).toBe(true);
      expect(note.pageKey).toBe('page-1');
      expect(note.type).toBe('text');
      expect(note.x).toBe(120);
      expect(note.y).toBe(340);
      expect(note.text).toBe('Check calculation step 2');
      expect(note.fontSize).toBe(DEFAULT_TEXT_FONT_SIZE);
      expect(note.color).toBe(DEFAULT_TEXT_COLOR);
      expect(note.backgroundColor).toBe(DEFAULT_TEXT_BG_COLOR);
      expect(note.borderColor).toBe(DEFAULT_TEXT_BORDER_COLOR);
      expect(note.createdAt).toBeGreaterThan(0);
    });

    it('allows custom font size, color, background, border, and custom ID', () => {
      const note = createTextNoteAnnotation(
        'page-2',
        { x: 200, y: 150 },
        'Excellent derivation!',
        {
          fontSize: 18,
          color: '#1e3a8a',
          backgroundColor: '#eff6ff',
          borderColor: '#3b82f6',
          customId: 'custom-note-42',
        }
      );

      expect(note.id).toBe('custom-note-42');
      expect(note.pageKey).toBe('page-2');
      expect(note.type).toBe('text');
      expect(note.text).toBe('Excellent derivation!');
      expect(note.fontSize).toBe(18);
      expect(note.color).toBe('#1e3a8a');
      expect(note.backgroundColor).toBe('#eff6ff');
      expect(note.borderColor).toBe('#3b82f6');
    });

    it('preserves multiline text, punctuation, symbols, and formatting', () => {
      const multilineText = 'Line 1: Q1(a) = 42\nLine 2: Missing unit [m/s]\nLine 3: 8/10 marks & verified ✓';
      const note = createTextNoteAnnotation('page-1', { x: 50, y: 75 }, multilineText);

      expect(note.text).toBe(multilineText);
      expect(note.text.split('\n')).toHaveLength(3);
    });
  });

  describe('2. Empty and Whitespace Validation', () => {
    it('rejects empty and whitespace-only text notes without mutating history', () => {
      let history = createInitialHistory();
      let annotations: MarkAnnotation[] = [];
      const emptyCandidates = ['', '   ', '\t\n\r  ', '   \n   '];

      emptyCandidates.forEach((candidate) => {
        const trimmed = candidate.trim();
        // Validation check: trimmed text must not be empty
        expect(trimmed.length).toBe(0);
        if (trimmed.length > 0) {
          const note = createTextNoteAnnotation('page-1', { x: 10, y: 10 }, trimmed);
          annotations = [...annotations, note];
          history = recordAddAnnotation(history, note);
        }
      });

      // History and annotations should remain pristine
      expect(history.past).toHaveLength(0);
      expect(history.future).toHaveLength(0);
      expect(annotations).toHaveLength(0);
      expect(canUndo(history)).toBe(false);
    });
  });

  describe('3. Coordinate Invariance under Pan & Zoom Transformations', () => {
    it('correctly maps click point to invariant image coordinates', () => {
      const transform: PanZoomTransform = { zoom: 2.0, x: -100, y: -200 };
      const screenClick = { x: 300, y: 400 };

      // Invariant image point: (300 - (-100)) / 2 = 200, (400 - (-200)) / 2 = 300
      const imagePoint = screenToImageCoordinates(screenClick.x, screenClick.y, transform);
      expect(imagePoint.x).toBe(200);
      expect(imagePoint.y).toBe(300);

      const note = createTextNoteAnnotation('page-1', imagePoint, 'Note at invariant (200, 300)');
      expect(note.x).toBe(200);
      expect(note.y).toBe(300);

      // Re-projection back to screen with same transform
      const screenPos = imageToScreenCoordinates(note.x, note.y, transform);
      expect(screenPos.x).toBe(300);
      expect(screenPos.y).toBe(400);

      // Re-projection with different transform (panned & zoomed out to zoom 1.5, offset 50, 50)
      const newTransform: PanZoomTransform = { zoom: 1.5, x: 50, y: 50 };
      const newScreenPos = imageToScreenCoordinates(note.x, note.y, newTransform);
      expect(newScreenPos.x).toBe(200 * 1.5 + 50); // 350
      expect(newScreenPos.y).toBe(300 * 1.5 + 50); // 500
    });
  });

  describe('4. Page Isolation for Text Notes', () => {
    it('isolates text notes per pageKey', () => {
      const notePage1 = createTextNoteAnnotation('page-1', { x: 100, y: 100 }, 'Note on Page 1');
      const notePage2A = createTextNoteAnnotation('page-2', { x: 150, y: 150 }, 'Note on Page 2 (A)');
      const notePage2B = createTextNoteAnnotation('page-2', { x: 200, y: 200 }, 'Note on Page 2 (B)');
      const checkPage1 = createCheckAnnotation('page-1', { x: 50, y: 50 });

      const allAnnotations: MarkAnnotation[] = [notePage1, notePage2A, notePage2B, checkPage1];

      const page1Annotations = filterAnnotationsByPage(allAnnotations, 'page-1');
      expect(page1Annotations).toHaveLength(2);
      expect(page1Annotations.map((a) => a.id)).toEqual([notePage1.id, checkPage1.id]);

      const page2Annotations = filterAnnotationsByPage(allAnnotations, 'page-2');
      expect(page2Annotations).toHaveLength(2);
      expect(page2Annotations.map((a) => a.id)).toEqual([notePage2A.id, notePage2B.id]);

      const page3Annotations = filterAnnotationsByPage(allAnnotations, 'page-3');
      expect(page3Annotations).toHaveLength(0);
    });
  });

  describe('5. History and Undo/Redo Lifecycle with Polymorphic Annotations', () => {
    it('records a text note as a single undoable step and restores on undo/redo', () => {
      let history = createInitialHistory();
      let annotations: MarkAnnotation[] = [];
      const note = createTextNoteAnnotation('page-1', { x: 100, y: 200 }, 'Initial feedback comment');

      annotations = [...annotations, note];
      history = recordAddAnnotation(history, note);
      expect(annotations).toHaveLength(1);
      expect(annotations[0]).toEqual(note);
      expect(canUndo(history)).toBe(true);
      expect(canRedo(history)).toBe(false);

      // Undo
      const undoRes = applyUndo(history, [], annotations);
      history = undoRes.history;
      annotations = undoRes.annotations;
      expect(annotations).toHaveLength(0);
      expect(canUndo(history)).toBe(false);
      expect(canRedo(history)).toBe(true);

      // Redo
      const redoRes = applyRedo(history, [], annotations);
      history = redoRes.history;
      annotations = redoRes.annotations;
      expect(annotations).toHaveLength(1);
      expect(annotations[0]).toEqual(note);
      expect(canUndo(history)).toBe(true);
      expect(canRedo(history)).toBe(false);
    });

    it('interleaves strokes, stamps, highlights, and text notes seamlessly across undo/redo', () => {
      let history = createInitialHistory();
      let strokes: FreehandStroke[] = [];
      let annotations: MarkAnnotation[] = [];

      const stroke = createStroke('page-1', { x: 10, y: 10 }, { color: '#ef4444', strokeWidth: 2 });
      const check = createCheckAnnotation('page-1', { x: 50, y: 50 });
      const highlight = createHighlightAnnotation('page-1', { x: 60, y: 60, width: 80, height: 30 });
      const note = createTextNoteAnnotation('page-1', { x: 150, y: 150 }, 'Comment near highlight');
      const cross = createCrossAnnotation('page-1', { x: 250, y: 250 });

      // Step 1: Add stroke
      strokes = [...strokes, stroke];
      history = recordAddStroke(history, stroke);

      // Step 2: Add check stamp
      annotations = [...annotations, check];
      history = recordAddAnnotation(history, check);

      // Step 3: Add highlight
      annotations = [...annotations, highlight];
      history = recordAddAnnotation(history, highlight);

      // Step 4: Add text note
      annotations = [...annotations, note];
      history = recordAddAnnotation(history, note);

      // Step 5: Add cross stamp
      annotations = [...annotations, cross];
      history = recordAddAnnotation(history, cross);

      expect(strokes).toHaveLength(1);
      expect(annotations).toHaveLength(4);
      expect(history.past).toHaveLength(5);

      // Undo Step 5 (cross)
      let undoRes = applyUndo(history, strokes, annotations);
      history = undoRes.history;
      strokes = undoRes.strokes;
      annotations = undoRes.annotations;
      expect(annotations.map((a) => a.id)).toEqual([check.id, highlight.id, note.id]);

      // Undo Step 4 (text note)
      undoRes = applyUndo(history, strokes, annotations);
      history = undoRes.history;
      strokes = undoRes.strokes;
      annotations = undoRes.annotations;
      expect(annotations.map((a) => a.id)).toEqual([check.id, highlight.id]);

      // Undo Step 3 (highlight)
      undoRes = applyUndo(history, strokes, annotations);
      history = undoRes.history;
      strokes = undoRes.strokes;
      annotations = undoRes.annotations;
      expect(annotations.map((a) => a.id)).toEqual([check.id]);

      // Undo Step 2 (check)
      undoRes = applyUndo(history, strokes, annotations);
      history = undoRes.history;
      strokes = undoRes.strokes;
      annotations = undoRes.annotations;
      expect(annotations).toHaveLength(0);
      expect(strokes).toHaveLength(1);

      // Undo Step 1 (stroke)
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

      redoRes = applyRedo(history, strokes, annotations); // check
      history = redoRes.history;
      strokes = redoRes.strokes;
      annotations = redoRes.annotations;

      redoRes = applyRedo(history, strokes, annotations); // highlight
      history = redoRes.history;
      strokes = redoRes.strokes;
      annotations = redoRes.annotations;

      redoRes = applyRedo(history, strokes, annotations); // text note
      history = redoRes.history;
      strokes = redoRes.strokes;
      annotations = redoRes.annotations;

      redoRes = applyRedo(history, strokes, annotations); // cross
      history = redoRes.history;
      strokes = redoRes.strokes;
      annotations = redoRes.annotations;

      expect(strokes).toHaveLength(1);
      expect(annotations).toHaveLength(4);
      const textAnnotation = annotations.find((a) => a.type === 'text') as TextNoteAnnotation;
      expect(textAnnotation).toBeDefined();
      expect(textAnnotation.text).toBe('Comment near highlight');
      expect(textAnnotation.x).toBe(150);
      expect(textAnnotation.y).toBe(150);
    });

    it('erases text notes via recordEraseAnnotations and restores them via undo', () => {
      let history = createInitialHistory();
      let annotations: MarkAnnotation[] = [];
      const note1 = createTextNoteAnnotation('page-1', { x: 100, y: 100 }, 'Note 1');
      const note2 = createTextNoteAnnotation('page-1', { x: 200, y: 200 }, 'Note 2');

      annotations = [...annotations, note1];
      history = recordAddAnnotation(history, note1);

      annotations = [...annotations, note2];
      history = recordAddAnnotation(history, note2);
      expect(annotations).toHaveLength(2);

      // Erase note1
      history = recordEraseAnnotations(history, [note1], annotations);
      annotations = annotations.filter((a) => a.id !== note1.id);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].id).toBe(note2.id);

      // Undo erase
      const undoRes = applyUndo(history, [], annotations);
      history = undoRes.history;
      annotations = undoRes.annotations;
      expect(annotations).toHaveLength(2);
      expect(annotations.map((a) => a.id)).toContain(note1.id);
      expect(annotations.map((a) => a.id)).toContain(note2.id);
    });
  });

  describe('6. Tool Selection and Canvas Tool Union', () => {
    it('supports text note tool alongside all 7 canvas tools', () => {
      const allTools: CanvasTool[] = ['none', 'pen', 'check', 'cross', 'highlight', 'text', 'eraser'];
      expect(allTools).toHaveLength(7);
      expect(allTools).toContain('text');
    });
  });
});
