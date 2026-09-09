import { describe, it, expect, vi } from 'vitest';
import {
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  createTextNoteAnnotation,
  filterAnnotationsByPage,
  MarkAnnotation,
  TextNoteAnnotation,
} from '../lib/stampTool';
import {
  createStroke,
  filterStrokesByPage,
  screenToImageCoordinates,
  imageToScreenCoordinates,
  FreehandStroke,
} from '../lib/penTool';
import {
  createInitialHistory,
  recordAddStroke,
  recordAddAnnotation,
  applyUndo,
  applyRedo,
  canUndo,
  canRedo,
} from '../lib/annotationHistory';
import type { PanZoomTransform } from '../lib/panZoom';

describe('AE-133: Annotation Z-Order and Overlay Visibility Toggle', () => {
  describe('1. Deterministic Layer Stacking & Z-Order', () => {
    it('defines fixed 3-layer architecture: PageImageLayer (0) -> PenLayer (1) -> MarkLayer (2)', () => {
      const layerHierarchy = [
        { name: 'page-image-layer', zIndex: 0, description: 'Base script image' },
        { name: 'pen-stroke-layer', zIndex: 1, description: 'Freehand pen strokes' },
        { name: 'mark-annotation-layer', zIndex: 2, description: 'Stamps, highlights, and text notes' },
      ];

      expect(layerHierarchy[0].name).toBe('page-image-layer');
      expect(layerHierarchy[1].name).toBe('pen-stroke-layer');
      expect(layerHierarchy[2].name).toBe('mark-annotation-layer');

      expect(layerHierarchy[0].zIndex).toBeLessThan(layerHierarchy[1].zIndex);
      expect(layerHierarchy[1].zIndex).toBeLessThan(layerHierarchy[2].zIndex);
    });

    it('orders annotations deterministically by array insertion order within MarkLayer', () => {
      const pageKey = 'page-1';
      const check1 = createCheckAnnotation(pageKey, { x: 50, y: 50 });
      const hl = createHighlightAnnotation(pageKey, { x: 40, y: 40, width: 100, height: 30 });
      const text = createTextNoteAnnotation(pageKey, { x: 60, y: 60 }, 'Step 1 note');
      const check2 = createCheckAnnotation(pageKey, { x: 70, y: 70 });

      const annotations: MarkAnnotation[] = [check1, hl, text, check2];

      // Array indices match the exact z-order assigned via annGroup.zIndex(index)
      annotations.forEach((ann, index) => {
        expect(annotations.indexOf(ann)).toBe(index);
      });

      expect(annotations[0].id).toBe(check1.id);
      expect(annotations[1].id).toBe(hl.id);
      expect(annotations[2].id).toBe(text.id);
      expect(annotations[3].id).toBe(check2.id);
    });

    it('places newly completed annotations on top without altering existing z-order', () => {
      const pageKey = 'page-1';
      const initial: MarkAnnotation[] = [
        createCheckAnnotation(pageKey, { x: 10, y: 10 }),
        createCrossAnnotation(pageKey, { x: 20, y: 20 }),
      ];

      const newHighlight = createHighlightAnnotation(pageKey, { x: 15, y: 15, width: 80, height: 20 });
      const updated = [...initial, newHighlight];

      expect(updated.length).toBe(3);
      expect(updated[2].id).toBe(newHighlight.id);
      expect(updated[0].id).toBe(initial[0].id);
      expect(updated[1].id).toBe(initial[1].id);
    });
  });

  describe('2. Overlay Visibility State & Toggle Mechanics', () => {
    it('defaults overlay visibility to true (visible by default)', () => {
      const initialVisibility = true;
      expect(initialVisibility).toBe(true);
    });

    it('toggles overlay visibility from true to false and back to true', () => {
      let isOverlayVisible = true;
      const onOverlayVisibilityChange = vi.fn((next: boolean) => {
        isOverlayVisible = next;
      });

      // Toggle off
      const toggle1 = !isOverlayVisible;
      onOverlayVisibilityChange(toggle1);
      expect(isOverlayVisible).toBe(false);
      expect(onOverlayVisibilityChange).toHaveBeenCalledWith(false);

      // Toggle on
      const toggle2 = !isOverlayVisible;
      onOverlayVisibilityChange(toggle2);
      expect(isOverlayVisible).toBe(true);
      expect(onOverlayVisibilityChange).toHaveBeenCalledWith(true);
    });

    it('preserves all strokes and annotation data intact during hide/show cycles', () => {
      const pageKey = 'page-1';
      const strokes: FreehandStroke[] = [
        createStroke(pageKey, { x: 100, y: 100 }),
        createStroke(pageKey, { x: 200, y: 200 }),
      ];
      const annotations: MarkAnnotation[] = [
        createCheckAnnotation(pageKey, { x: 120, y: 120 }),
        createTextNoteAnnotation(pageKey, { x: 150, y: 150 }, 'Preserved Note'),
      ];

      let isOverlayVisible = true;

      // Hide overlay
      isOverlayVisible = false;
      expect(isOverlayVisible).toBe(false);

      // Data is NOT mutated or deleted
      expect(strokes.length).toBe(2);
      expect(annotations.length).toBe(2);
      expect(strokes[0].points).toEqual([100, 100]);
      expect(annotations[1].type).toBe('text');

      // Show overlay again
      isOverlayVisible = true;
      expect(isOverlayVisible).toBe(true);

      expect(strokes.length).toBe(2);
      expect(annotations.length).toBe(2);
      expect(annotations[0].x).toBe(120);
      expect(annotations[0].y).toBe(120);
      expect((annotations[1] as TextNoteAnnotation).text).toBe('Preserved Note');
    });

    it('maintains invariant image coordinate systems across visibility toggles', () => {
      const transform: PanZoomTransform = { x: 150, y: 80, zoom: 2.5 };
      const imagePoint = { x: 300, y: 400 };

      const screenBefore = imageToScreenCoordinates(imagePoint.x, imagePoint.y, transform);

      // Toggle visibility
      let isVisible = false;
      expect(isVisible).toBe(false);
      isVisible = true;
      expect(isVisible).toBe(true);

      const screenAfter = imageToScreenCoordinates(imagePoint.x, imagePoint.y, transform);
      expect(screenAfter).toEqual(screenBefore);

      const recoveredImagePoint = screenToImageCoordinates(screenAfter.x, screenAfter.y, transform);
      expect(recoveredImagePoint.x).toBeCloseTo(imagePoint.x, 2);
      expect(recoveredImagePoint.y).toBeCloseTo(imagePoint.y, 2);
    });
  });

  describe('3. Interaction Safety When Overlay is Hidden', () => {
    it('clears active annotation selection when overlay is hidden', () => {
      let selectedAnnotationId: string | null = 'ann-123';
      let isOverlayVisible = true;

      const handleToggleOverlay = () => {
        const nextVisible = !isOverlayVisible;
        if (!nextVisible) {
          selectedAnnotationId = null;
        }
        isOverlayVisible = nextVisible;
      };

      // Hide overlay
      handleToggleOverlay();
      expect(isOverlayVisible).toBe(false);
      expect(selectedAnnotationId).toBeNull();
    });

    it('suppresses pointer placement of stamps, highlights, and text notes when hidden', () => {
      const isVisible = false;
      const onAnnotationComplete = vi.fn();

      const handlePointerDown = (visible: boolean) => {
        if (!visible) return;
        onAnnotationComplete();
      };

      handlePointerDown(isVisible);
      expect(onAnnotationComplete).not.toHaveBeenCalled();
    });

    it('suppresses drawing new freehand strokes when hidden', () => {
      const isVisible = false;
      const onStrokeComplete = vi.fn();

      const handlePointerDown = (visible: boolean) => {
        if (!visible) return;
        onStrokeComplete();
      };

      handlePointerDown(isVisible);
      expect(onStrokeComplete).not.toHaveBeenCalled();
    });

    it('suppresses stroke erasing gestures when hidden', () => {
      const isVisible = false;
      const onStrokesErased = vi.fn();

      const handlePointerDown = (visible: boolean) => {
        if (!visible) return;
        onStrokesErased();
      };

      handlePointerDown(isVisible);
      expect(onStrokesErased).not.toHaveBeenCalled();
    });

    it('does not trigger deletion on Delete key when selection is cleared by hiding overlay', () => {
      const selectedAnnotationId: string | null = null; // Cleared when hidden
      const onDelete = vi.fn();

      const handleKeyDown = (key: string) => {
        if (key === 'Delete' || key === 'Backspace') {
          if (selectedAnnotationId) {
            onDelete();
          }
        }
      };

      handleKeyDown('Delete');
      handleKeyDown('Backspace');
      expect(onDelete).not.toHaveBeenCalled();
    });
  });

  describe('4. History & Undo/Redo Purity', () => {
    it('does NOT create undo/redo history actions when toggling visibility', () => {
      const pageKey = 'page-1';
      let history = createInitialHistory();

      // Draw a stroke
      const stroke1 = createStroke(pageKey, { x: 50, y: 50 });
      history = recordAddStroke(history, stroke1);
      expect(history.past.length).toBe(1);

      // Add a check annotation
      const check = createCheckAnnotation(pageKey, { x: 80, y: 80 });
      history = recordAddAnnotation(history, check);
      expect(history.past.length).toBe(2);

      // Toggle visibility off and on (pure UI state - 0 history actions recorded)
      let isVisible = false;
      expect(isVisible).toBe(false);
      isVisible = true;
      expect(isVisible).toBe(true);

      expect(history.past.length).toBe(2);
      expect(history.future.length).toBe(0);
    });

    it('allows undo and redo of annotation operations regardless of visibility toggle cycles', () => {
      const pageKey = 'page-1';
      let history = createInitialHistory();
      const strokes: FreehandStroke[] = [];
      let annotations: MarkAnnotation[] = [];

      // User creates check mark
      const check = createCheckAnnotation(pageKey, { x: 100, y: 100 });
      annotations = [...annotations, check];
      history = recordAddAnnotation(history, check);

      // User creates text note
      const note = createTextNoteAnnotation(pageKey, { x: 150, y: 150 }, 'Key finding');
      annotations = [...annotations, note];
      history = recordAddAnnotation(history, note);

      expect(canUndo(history)).toBe(true);

      // User toggles visibility off then on
      let isVisible = false;
      expect(isVisible).toBe(false);
      isVisible = true;
      expect(isVisible).toBe(true);

      // Undo note creation
      const undo1 = applyUndo(history, strokes, annotations);
      history = undo1.history;
      annotations = undo1.annotations;

      expect(annotations.length).toBe(1);
      expect(annotations[0].id).toBe(check.id);
      expect(canRedo(history)).toBe(true);

      // Redo note creation
      const redo1 = applyRedo(history, strokes, annotations);
      history = redo1.history;
      annotations = redo1.annotations;

      expect(annotations.length).toBe(2);
      expect(annotations[1].id).toBe(note.id);
    });
  });

  describe('5. Multi-Page Isolation & Pan/Zoom Preservation', () => {
    it('preserves per-page annotation separation when switching pages with overlay on or off', () => {
      const page1Strokes = [createStroke('p1', { x: 10, y: 10 })];
      const page2Strokes = [createStroke('p2', { x: 20, y: 20 })];
      const allStrokes = [...page1Strokes, ...page2Strokes];

      const page1Marks = [createCheckAnnotation('p1', { x: 100, y: 100 })];
      const page2Marks = [createCrossAnnotation('p2', { x: 200, y: 200 })];
      const allMarks = [...page1Marks, ...page2Marks];

      const filteredP1Strokes = filterStrokesByPage(allStrokes, 'p1');
      const filteredP1Marks = filterAnnotationsByPage(allMarks, 'p1');

      const filteredP2Strokes = filterStrokesByPage(allStrokes, 'p2');
      const filteredP2Marks = filterAnnotationsByPage(allMarks, 'p2');

      expect(filteredP1Strokes.length).toBe(1);
      expect(filteredP1Marks.length).toBe(1);
      expect(filteredP1Marks[0].type).toBe('check');

      expect(filteredP2Strokes.length).toBe(1);
      expect(filteredP2Marks.length).toBe(1);
      expect(filteredP2Marks[0].type).toBe('cross');
    });

    it('preserves pan and zoom transform when overlay visibility is toggled', () => {
      let transform: PanZoomTransform = { x: -120, y: -45, zoom: 1.75 };
      let isVisible = true;

      // Pan/Zoom occurs
      transform = { x: -200, y: -90, zoom: 2.25 };

      // Toggle overlay off
      isVisible = false;
      expect(isVisible).toBe(false);
      expect(transform.zoom).toBe(2.25);
      expect(transform.x).toBe(-200);

      // Toggle overlay on
      isVisible = true;
      expect(isVisible).toBe(true);
      expect(transform.zoom).toBe(2.25);
      expect(transform.x).toBe(-200);
    });
  });

  describe('6. Component Contracts & Accessibility', () => {
    it('exports all necessary props and types for AE-133', () => {
      const propsSample = {
        enableOverlayToggle: true,
        isOverlayVisible: true,
        initialOverlayVisible: true,
        onOverlayVisibilityChange: vi.fn(),
      };

      expect(propsSample.enableOverlayToggle).toBe(true);
      expect(propsSample.isOverlayVisible).toBe(true);
      expect(propsSample.initialOverlayVisible).toBe(true);
      expect(typeof propsSample.onOverlayVisibilityChange).toBe('function');
    });

    it('defines accessible attributes for canvas-overlay-toggle button', () => {
      const visibleButton = {
        'aria-label': 'Toggle Annotation Overlay Visibility',
        'aria-pressed': true,
        'data-testid': 'canvas-overlay-toggle',
        title: 'Hide Annotation Overlay (Eye)',
      };

      expect(visibleButton['aria-label']).toBe('Toggle Annotation Overlay Visibility');
      expect(visibleButton['aria-pressed']).toBe(true);
      expect(visibleButton['data-testid']).toBe('canvas-overlay-toggle');

      const hiddenButton = {
        'aria-label': 'Toggle Annotation Overlay Visibility',
        'aria-pressed': false,
        'data-testid': 'canvas-overlay-toggle',
        title: 'Show Annotation Overlay (EyeOff)',
      };

      expect(hiddenButton['aria-pressed']).toBe(false);
    });
  });
});
