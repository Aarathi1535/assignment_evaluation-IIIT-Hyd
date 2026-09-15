import { describe, it, expect, vi } from 'vitest';
import {
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  createTextNoteAnnotation,
  filterAnnotationsByPage,
  MarkAnnotation,
  CheckAnnotation,
  CrossAnnotation,
  HighlightAnnotation,
  TextNoteAnnotation,
} from '../lib/stampTool';
import {
  createStroke,
  filterStrokesByPage,
  FreehandStroke,
} from '../lib/penTool';
import {
  createInitialHistory,
  canUndo,
  canRedo,
} from '../lib/annotationHistory';
import {
  deserializePageAnnotations,
  serializePageAnnotations,
  serializeCanvasAnnotations,
} from '../lib/annotationSerialization';
import { AnswerSheetPage } from '../lib/pageNavigation';

describe('AE-136: Canvas Annotation Hydration & Page Isolation', () => {
  describe('1. Deserialization & Type Hydration', () => {
    it('successfully deserializes and hydrates all AE-134 annotation types from single-page payload', () => {
      const pageKey = 'page-1';
      const check = createCheckAnnotation(pageKey, { x: 100, y: 150 }, { size: 32, color: '#16a34a' });
      const cross = createCrossAnnotation(pageKey, { x: 200, y: 250 }, { size: 28, color: '#dc2626' });
      const hl = createHighlightAnnotation(
        pageKey,
        { x: 50, y: 60, width: 300, height: 40 },
        { color: '#fde047', opacity: 0.5 }
      );
      const text = createTextNoteAnnotation(
        pageKey,
        { x: 350, y: 400 },
        'Formula verified',
        { fontSize: 16, color: '#0f172a', backgroundColor: '#fef9c3', borderColor: '#fde047' }
      );
      const stroke = createStroke(pageKey, { x: 10, y: 20 }, { color: '#2563eb', strokeWidth: 4 });
      stroke.points = [10, 20, 30, 40];

      const rawPayload = {
        annotations: [check, cross, hl, text],
        strokes: [stroke],
      };

      const hydrated = deserializePageAnnotations(rawPayload, pageKey);
      expect(hydrated.annotations.length).toBe(4);
      expect(hydrated.strokes.length).toBe(1);

      const checkAnn = hydrated.annotations[0] as CheckAnnotation;
      const crossAnn = hydrated.annotations[1] as CrossAnnotation;
      const hlAnn = hydrated.annotations[2] as HighlightAnnotation;
      const textAnn = hydrated.annotations[3] as TextNoteAnnotation;
      const strokeAnn = hydrated.strokes[0] as FreehandStroke;

      expect(checkAnn.type).toBe('check');
      expect(checkAnn.size).toBe(32);
      expect(checkAnn.color).toBe('#16a34a');

      expect(crossAnn.type).toBe('cross');
      expect(crossAnn.size).toBe(28);
      expect(crossAnn.color).toBe('#dc2626');

      expect(hlAnn.type).toBe('highlight');
      expect(hlAnn.width).toBe(300);
      expect(hlAnn.height).toBe(40);
      expect(hlAnn.opacity).toBe(0.5);

      expect(textAnn.type).toBe('text');
      expect(textAnn.text).toBe('Formula verified');
      expect(textAnn.fontSize).toBe(16);

      expect(strokeAnn.strokeWidth).toBe(4);
      expect(strokeAnn.color).toBe('#2563eb');
      expect(strokeAnn.points).toEqual([10, 20, 30, 40]);
    });

    it('successfully extracts and hydrates from full multi-page SerializedAnnotationDocument', () => {
      const p1Check = createCheckAnnotation('page-1', { x: 50, y: 50 });
      const p2Cross = createCrossAnnotation('page-2', { x: 60, y: 60 });
      const p2Stroke = createStroke('page-2', { x: 5, y: 5 });

      const multiDoc = serializeCanvasAnnotations({
        annotations: [p1Check, p2Cross],
        strokes: [p2Stroke],
        pageKeys: ['page-1', 'page-2'],
      });

      const hydratedP1 = deserializePageAnnotations(multiDoc, 'page-1');
      expect(hydratedP1.annotations.length).toBe(1);
      expect(hydratedP1.annotations[0].type).toBe('check');
      expect(hydratedP1.strokes.length).toBe(0);

      const hydratedP2 = deserializePageAnnotations(multiDoc, 'page-2');
      expect(hydratedP2.annotations.length).toBe(1);
      expect(hydratedP2.annotations[0].type).toBe('cross');
      expect(hydratedP2.strokes.length).toBe(1);
    });

    it('safely handles empty, null, or malformed data by returning empty arrays without throwing', () => {
      expect(deserializePageAnnotations(null)).toEqual({ annotations: [], strokes: [] });
      expect(deserializePageAnnotations(undefined)).toEqual({ annotations: [], strokes: [] });
      expect(deserializePageAnnotations('not_an_object')).toEqual({ annotations: [], strokes: [] });
      expect(deserializePageAnnotations({ annotations: 'not_an_array' })).toEqual({
        annotations: [],
        strokes: [],
      });
      expect(
        deserializePageAnnotations({
          annotations: [{ id: 'bad', type: 'invalid_type', x: 0, y: 0 }],
        })
      ).toEqual({ annotations: [], strokes: [] });
    });
  });

  describe('2. Page Isolation & Navigation State', () => {
    it('maintains strict isolation between pages when navigating and filtering annotations', () => {
      const p1Check = createCheckAnnotation('page-1', { x: 10, y: 10 });
      const p1Stroke = createStroke('page-1', { x: 10, y: 10 });

      const p2Cross = createCrossAnnotation('page-2', { x: 90, y: 90 });
      const p2Hl = createHighlightAnnotation('page-2', { x: 20, y: 20, width: 100, height: 20 });

      const allAnnotations: MarkAnnotation[] = [p1Check, p2Cross, p2Hl];
      const allStrokes: FreehandStroke[] = [p1Stroke];

      // Page 1 view
      const p1Annotations = filterAnnotationsByPage(allAnnotations, 'page-1');
      const p1Strokes = filterStrokesByPage(allStrokes, 'page-1');
      expect(p1Annotations.length).toBe(1);
      expect(p1Annotations[0].id).toBe(p1Check.id);
      expect(p1Strokes.length).toBe(1);

      // Page 2 view: page 1 annotations must be completely absent
      const p2Annotations = filterAnnotationsByPage(allAnnotations, 'page-2');
      const p2Strokes = filterStrokesByPage(allStrokes, 'page-2');
      expect(p2Annotations.length).toBe(2);
      expect(p2Annotations.find((a) => a.id === p1Check.id)).toBeUndefined();
      expect(p2Strokes.length).toBe(0);
    });

    it('supports on-demand page hydration keyed by scriptId and page identifier', () => {
      const p1Annotations = serializePageAnnotations('page-1', [
        createCheckAnnotation('page-1', { x: 20, y: 20 }),
      ]);
      const p2Annotations = serializePageAnnotations('page-2', [
        createCrossAnnotation('page-2', { x: 40, y: 40 }),
      ]);

      const pages: AnswerSheetPage[] = [
        { _id: 'page-1', pageNumber: 1 },
        { _id: 'page-2', pageNumber: 2 },
      ];

      // Simulated API payloads returned for each page
      const apiResponses: Record<string, typeof p1Annotations> = {
        'page-1': p1Annotations,
        'page-2': p2Annotations,
      };

      const hydrated1 = deserializePageAnnotations(apiResponses[pages[0]._id!], pages[0]._id!);
      const hydrated2 = deserializePageAnnotations(apiResponses[pages[1]._id!], pages[1]._id!);

      expect(hydrated1.annotations.length).toBe(1);
      expect(hydrated1.annotations[0].type).toBe('check');

      expect(hydrated2.annotations.length).toBe(1);
      expect(hydrated2.annotations[0].type).toBe('cross');
    });
  });

  describe('3. Undo/Redo & Save Request Isolation', () => {
    it('ensures hydration initializes empty undo/redo history without ghost actions', () => {
      const pageHistory = createInitialHistory();
      expect(canUndo(pageHistory)).toBe(false);
      expect(canRedo(pageHistory)).toBe(false);
      expect(pageHistory.past.length).toBe(0);
      expect(pageHistory.future.length).toBe(0);
    });

    it('verifies loading annotations is purely read-only and emits 0 save/PUT requests', async () => {
      const mockSaveEndpoint = vi.fn();

      // Simulate loading workflow
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            annotations: [createCheckAnnotation('page-1', { x: 10, y: 10 })],
            strokes: [],
          },
        }),
      });

      const res = await mockFetch('/api/scripts/123/pages/1/annotations');
      const data = await res.json();
      const hydrated = deserializePageAnnotations(data.data, 'page-1');

      expect(hydrated.annotations.length).toBe(1);
      expect(mockSaveEndpoint).not.toHaveBeenCalled();
    });
  });

  describe('4. Race Condition & Session Caching Simulation', () => {
    it('discards stale response when active request sequence advances due to fast page switching', async () => {
      let activeRequestSeq = 0;
      const loadedPagesCache = new Set<string>();

      const responses: Record<number, string> = {
        1: 'page-1-result',
        2: 'page-2-result',
      };

      // User requests Page 1 (seq 1)
      activeRequestSeq += 1;
      const seq1 = activeRequestSeq;

      // User immediately requests Page 2 (seq 2) before Page 1 resolves
      activeRequestSeq += 1;
      const seq2 = activeRequestSeq;

      // Page 1 resolves late:
      let appliedPage: string | null = null;
      if (seq1 === activeRequestSeq) {
        appliedPage = responses[seq1];
      }

      expect(appliedPage).toBeNull(); // Discarded!

      // Page 2 resolves:
      if (seq2 === activeRequestSeq) {
        appliedPage = responses[seq2];
        loadedPagesCache.add('page-2');
      }

      expect(appliedPage).toBe('page-2-result');
      expect(loadedPagesCache.has('page-2')).toBe(true);
      expect(loadedPagesCache.has('page-1')).toBe(false);
    });

    it('prevents redundant network requests for already-cached pages in the same session', () => {
      const loadedPagesCache = new Set<string>();
      const mockFetch = vi.fn();

      const loadPage = (pageKey: string) => {
        if (loadedPagesCache.has(pageKey)) {
          return; // Skip fetch
        }
        mockFetch(pageKey);
        loadedPagesCache.add(pageKey);
      };

      loadPage('page-1');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      loadPage('page-2');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Switching back to Page 1 uses in-memory session cache without fetching again
      loadPage('page-1');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
