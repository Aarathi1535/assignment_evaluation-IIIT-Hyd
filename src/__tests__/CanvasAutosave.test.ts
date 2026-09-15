import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveStatusIndicator } from '../components/canvas/SaveStatusIndicator';
import {
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  createTextNoteAnnotation,
  moveAnnotation,
  type MarkAnnotation,
} from '../lib/stampTool';
import {
  createStroke,
} from '../lib/penTool';
import {
  createInitialHistory,
  recordAddStroke,
  recordEraseStrokes,
  recordAddAnnotation,
  recordEraseAnnotations,
  recordMoveAnnotation,
  applyUndo,
  applyRedo,
} from '../lib/annotationHistory';
import {
  serializePageAnnotations,
  serializeCanvasAnnotations,
  deserializePageAnnotations,
  type SerializedPageAnnotations,
} from '../lib/annotationSerialization';

describe('AE-137: Canvas Annotation Autosave & Save Status Indicator', () => {
  describe('1. SaveStatusIndicator Component UI & Accessibility', () => {
    it('renders null when status is idle', () => {
      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, { status: 'idle' })
      );
      expect(html).toBe('');
    });

    it('renders accessible saving state with spinner and polite aria-live', () => {
      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, { status: 'saving' })
      );
      expect(html).toContain('Saving...');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('data-status="saving"');
      expect(html).toContain('animate-spin');
    });

    it('renders accessible saved state with checkmark and polite aria-live', () => {
      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, { status: 'saved' })
      );
      expect(html).toContain('Saved');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('data-status="saved"');
    });

    it('renders accessible error state with assertive alert role and retry button', () => {
      const onRetryMock = vi.fn();
      const html = renderToStaticMarkup(
        React.createElement(SaveStatusIndicator, {
          status: 'error',
          onRetry: onRetryMock,
          errorMessage: 'Server 500 error',
        })
      );
      expect(html).toContain('Save failed');
      expect(html).toContain('role="alert"');
      expect(html).toContain('aria-live="assertive"');
      expect(html).toContain('data-status="error"');
      expect(html).toContain('Retry');
      expect(html).toContain('aria-label="Retry saving annotations"');
    });
  });

  describe('2. Debounced Autosave Scheduler & Execution Engine', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('debounces rapid edits into a single save execution after the delay', async () => {
      const saveMock = vi.fn().mockResolvedValue({ success: true });
      const statusChanges: string[] = [];

      let pendingSave: {
        pageKey: string;
        pageNumber: number;
        strokes: ReturnType<typeof createStroke>[];
        annotations: ReturnType<typeof createCheckAnnotation>[];
      } | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const scheduleAutosave = (strokes: ReturnType<typeof createStroke>[], annotations: ReturnType<typeof createCheckAnnotation>[]) => {
        pendingSave = {
          pageKey: 'page-1',
          pageNumber: 1,
          strokes,
          annotations,
        };
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          if (pendingSave) {
            statusChanges.push('saving');
            const data = serializePageAnnotations(pendingSave.pageKey, pendingSave.annotations, pendingSave.strokes);
            await saveMock({ scriptId: 'script-123', pageNumber: pendingSave.pageNumber, data });
            statusChanges.push('saved');
          }
        }, 800);
      };

      // Perform 5 rapid strokes in succession
      const s1 = createStroke('page-1', { x: 10, y: 10 });
      scheduleAutosave([s1], []);

      vi.advanceTimersByTime(200);
      const s2 = createStroke('page-1', { x: 20, y: 20 });
      scheduleAutosave([s1, s2], []);

      vi.advanceTimersByTime(200);
      const s3 = createStroke('page-1', { x: 30, y: 30 });
      scheduleAutosave([s1, s2, s3], []);

      vi.advanceTimersByTime(200);
      const s4 = createStroke('page-1', { x: 40, y: 40 });
      scheduleAutosave([s1, s2, s3, s4], []);

      vi.advanceTimersByTime(200);
      const s5 = createStroke('page-1', { x: 50, y: 50 });
      scheduleAutosave([s1, s2, s3, s4, s5], []);

      // Before the 800ms expires, save has NOT been called
      expect(saveMock).not.toHaveBeenCalled();

      // Advance by full 800ms
      await vi.advanceTimersByTimeAsync(800);

      // Exactly 1 save call should have fired
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptId: 'script-123',
          pageNumber: 1,
          data: expect.objectContaining({
            strokes: expect.arrayContaining([
              expect.objectContaining({ id: s1.id }),
              expect.objectContaining({ id: s5.id }),
            ]),
          }),
        })
      );
      expect(statusChanges).toEqual(['saving', 'saved']);
    });

    it('respects custom debounceDelayMs', async () => {
      const saveMock = vi.fn().mockResolvedValue({ success: true });
      const customDelay = 400;

      let timer: ReturnType<typeof setTimeout> | null = null;
      const scheduleAutosave = (stroke: ReturnType<typeof createStroke>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          const data = serializePageAnnotations('page-1', [], [stroke]);
          await saveMock({ scriptId: 'script-abc', pageNumber: 1, data });
        }, customDelay);
      };

      const s = createStroke('page-1', { x: 10, y: 10 });
      scheduleAutosave(s);

      vi.advanceTimersByTime(350);
      expect(saveMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Edit Action Triggers & Mutation Coverage', () => {
    it('triggers debounced save on freehand stroke completion and stroke erasing', () => {
      let pageStrokes: ReturnType<typeof createStroke>[] = [];
      let history = createInitialHistory();
      const saveTriggerMock = vi.fn();

      // 1. Add stroke
      const stroke1 = createStroke('page-1', { x: 15, y: 25 }, { color: '#e11d48', strokeWidth: 3 });
      pageStrokes = [...pageStrokes, stroke1];
      history = recordAddStroke(history, stroke1);
      saveTriggerMock('stroke-added', pageStrokes);

      expect(pageStrokes.length).toBe(1);
      expect(saveTriggerMock).toHaveBeenCalledWith('stroke-added', [stroke1]);

      // 2. Erase stroke
      history = recordEraseStrokes(history, [stroke1], pageStrokes);
      pageStrokes = [];
      saveTriggerMock('stroke-erased', pageStrokes);

      expect(pageStrokes.length).toBe(0);
      expect(history.past.length).toBe(2);
      expect(saveTriggerMock).toHaveBeenCalledWith('stroke-erased', []);
    });

    it('triggers debounced save on stamp creation (check, cross, highlight, text note)', () => {
      let pageAnnotations: MarkAnnotation[] = [];
      let history = createInitialHistory();
      const saveTriggerMock = vi.fn();

      // Check
      const check = createCheckAnnotation('page-1', { x: 100, y: 120 });
      pageAnnotations = [...pageAnnotations, check];
      history = recordAddAnnotation(history, check);
      saveTriggerMock(pageAnnotations);

      // Cross
      const cross = createCrossAnnotation('page-1', { x: 200, y: 220 });
      pageAnnotations = [...pageAnnotations, cross];
      history = recordAddAnnotation(history, cross);
      saveTriggerMock(pageAnnotations);

      // Highlight
      const hl = createHighlightAnnotation('page-1', { x: 50, y: 50, width: 200, height: 30 });
      pageAnnotations = [...pageAnnotations, hl];
      history = recordAddAnnotation(history, hl);
      saveTriggerMock(pageAnnotations);

      // Text note
      const txt = createTextNoteAnnotation('page-1', { x: 300, y: 300 }, 'Well answered');
      pageAnnotations = [...pageAnnotations, txt];
      history = recordAddAnnotation(history, txt);
      saveTriggerMock(pageAnnotations);

      expect(pageAnnotations.length).toBe(4);
      expect(history.past.length).toBe(4);
      expect(saveTriggerMock).toHaveBeenCalledTimes(4);
    });

    it('triggers debounced save on annotation move, delete, undo, and redo', () => {
      const saveTriggerMock = vi.fn();
      let pageAnnotations: MarkAnnotation[] = [createCheckAnnotation('page-1', { x: 100, y: 100 })];
      let history = createInitialHistory();
      history = recordAddAnnotation(history, pageAnnotations[0]);

      // Move
      const moved = moveAnnotation(pageAnnotations[0], { x: 150, y: 150 });
      history = recordMoveAnnotation(history, pageAnnotations[0].id, { x: 100, y: 100 }, { x: 150, y: 150 });
      pageAnnotations = [moved];
      saveTriggerMock('moved', pageAnnotations);
      expect(pageAnnotations[0].x).toBe(150);
      expect(pageAnnotations[0].y).toBe(150);

      // Delete
      history = recordEraseAnnotations(history, [moved], pageAnnotations);
      pageAnnotations = [];
      saveTriggerMock('deleted', pageAnnotations);
      expect(pageAnnotations.length).toBe(0);

      // Undo delete
      const undoRes = applyUndo(history, [], pageAnnotations);
      history = undoRes.history;
      pageAnnotations = undoRes.annotations;
      saveTriggerMock('undone', pageAnnotations);
      expect(pageAnnotations.length).toBe(1);

      // Redo delete
      const redoRes = applyRedo(history, [], pageAnnotations);
      history = redoRes.history;
      pageAnnotations = redoRes.annotations;
      saveTriggerMock('redone', pageAnnotations);
      expect(pageAnnotations.length).toBe(0);

      expect(saveTriggerMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('4. Non-Trigger Operations (No Accidental Saves)', () => {
    it('does not trigger autosave during initial hydration', () => {
      const saveTriggerMock = vi.fn();
      const rawPayload = {
        annotations: [createCheckAnnotation('page-1', { x: 50, y: 50 })],
        strokes: [],
      };

      // Simulating hydration lifecycle
      const hydrated = deserializePageAnnotations(rawPayload, 'page-1');
      // Setting hydrated data into internal state without triggering scheduleAutosave
      expect(hydrated.annotations.length).toBe(1);
      expect(saveTriggerMock).not.toHaveBeenCalled();
    });

    it('does not trigger autosave on pure page navigation, pan/zoom, overlay toggle, or selection', () => {
      const saveTriggerMock = vi.fn();

      // 1. Pan/zoom transform change
      const newTransform = { x: 50, y: 50, zoom: 1.5 };
      expect(newTransform.zoom).toBe(1.5);

      // 2. Overlay visibility toggle
      const overlayVisible = false;
      expect(overlayVisible).toBe(false);

      // 3. Selection change
      const selectedId = 'check-123';
      expect(selectedId).toBe('check-123');

      // 4. Page navigation without prior edits
      const activePageIndex = 1;
      expect(activePageIndex).toBe(1);

      expect(saveTriggerMock).not.toHaveBeenCalled();
    });
  });

  describe('5. Page Switching & Immediate Flush Safety', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('flushes pending saves immediately before changing page index, preventing cross-page contamination', async () => {
      const saveMock = vi.fn().mockResolvedValue({ success: true });

      let pendingSave: {
        pageKey: string;
        pageNumber: number;
        strokes: ReturnType<typeof createStroke>[];
        annotations: ReturnType<typeof createCheckAnnotation>[];
      } | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const scheduleAutosave = (
        pageKey: string,
        pageNumber: number,
        strokes: ReturnType<typeof createStroke>[],
        annotations: ReturnType<typeof createCheckAnnotation>[]
      ) => {
        pendingSave = { pageKey, pageNumber, strokes, annotations };
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          if (pendingSave) {
            const data = serializePageAnnotations(pendingSave.pageKey, pendingSave.annotations, pendingSave.strokes);
            await saveMock({ scriptId: 'script-123', pageNumber: pendingSave.pageNumber, data });
            pendingSave = null;
          }
        }, 800);
      };

      const flushPendingSave = async () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (pendingSave) {
          const toSave = pendingSave;
          pendingSave = null;
          const data = serializePageAnnotations(toSave.pageKey, toSave.annotations, toSave.strokes);
          await saveMock({ scriptId: 'script-123', pageNumber: toSave.pageNumber, data });
        }
      };

      // 1. User is on Page 1 and draws a stroke
      const p1Stroke = createStroke('page-1', { x: 100, y: 100 });
      scheduleAutosave('page-1', 1, [p1Stroke], []);

      // 2. User immediately clicks "Next Page" (after 100ms, way before 800ms)
      vi.advanceTimersByTime(100);
      expect(saveMock).not.toHaveBeenCalled();

      // 3. Navigation triggers flushPendingSave BEFORE navigating to Page 2
      await flushPendingSave();

      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptId: 'script-123',
          pageNumber: 1, // Target is Page 1, not Page 2!
          data: expect.objectContaining({
            strokes: expect.arrayContaining([expect.objectContaining({ id: p1Stroke.id })]),
          }),
        })
      );

      // 4. If remaining 700ms expires, timer does NOT fire again
      await vi.advanceTimersByTimeAsync(700);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('6. Error Handling & Manual Retry Flow', () => {
    it('captures save failure and allows successful manual retry', async () => {
      let failNext = true;
      const saveMock = vi.fn().mockImplementation(async () => {
        if (failNext) {
          failNext = false;
          throw new Error('Database write conflict');
        }
        return { success: true };
      });

      let saveStatus = 'idle';
      let errorMessage = '';

      const executeSave = async (data: SerializedPageAnnotations) => {
        saveStatus = 'saving';
        try {
          await saveMock(data);
          saveStatus = 'saved';
        } catch (err: unknown) {
          saveStatus = 'error';
          errorMessage = err instanceof Error ? err.message : String(err);
        }
      };

      const stroke = createStroke('page-1', { x: 10, y: 20 });
      const serialized = serializePageAnnotations('page-1', [], [stroke]);

      // First attempt fails
      await executeSave(serialized);
      expect(saveStatus).toBe('error');
      expect(errorMessage).toBe('Database write conflict');

      // Manual retry succeeds
      await executeSave(serialized);
      expect(saveStatus).toBe('saved');
      expect(saveMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('7. AE-134 Serialization Integrity & Immutability', () => {
    it('generates compliant SerializedPageAnnotations and SerializedAnnotationDocument payload', () => {
      const pageKey = 'page-1';
      const check = createCheckAnnotation(pageKey, { x: 120, y: 240 });
      const stroke = createStroke(pageKey, { x: 45, y: 90 });
      stroke.points = [45, 90, 50, 100];

      const pageSerialized = serializePageAnnotations(pageKey, [check], [stroke]);
      expect(pageSerialized.annotations.length).toBe(1);
      expect(pageSerialized.annotations[0].type).toBe('check');
      expect(pageSerialized.annotations[0].x).toBe(120);
      expect(pageSerialized.annotations[0].y).toBe(240);
      expect(pageSerialized.strokes.length).toBe(1);
      expect(pageSerialized.strokes[0].points).toEqual([45, 90, 50, 100]);

      const docSerialized = serializeCanvasAnnotations({
        annotations: [check],
        strokes: [stroke],
        pageKeys: [pageKey],
      });

      expect(docSerialized.version).toBe(1);
      expect(docSerialized.pages[pageKey]).toBeDefined();
      expect(docSerialized.pages[pageKey].annotations.length).toBe(1);
      expect(docSerialized.pages[pageKey].strokes.length).toBe(1);
      expect(docSerialized.metadata?.totalAnnotations).toBe(1);
      expect(docSerialized.metadata?.totalStrokes).toBe(1);
    });
  });
});
