import { describe, it, expect } from 'vitest';
import {
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  createTextNoteAnnotation,
  CheckAnnotation,
  CrossAnnotation,
  HighlightAnnotation,
  TextNoteAnnotation,
} from '../lib/stampTool';
import {
  createStroke,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_WIDTH,
} from '../lib/penTool';
import {
  ANNOTATION_FORMAT_VERSION,
  ANNOTATION_FORMAT_SCHEMA,
  serializePageAnnotations,
  serializeCanvasAnnotations,
  serializeToVectorJson,
  validateAnnotationDocument,
  deserializeAnnotationDocument,
  extractPageAnnotations,
  cloneMarkAnnotation,
  cloneFreehandStroke,
} from '../lib/annotationSerialization';

describe('AE-134: Vector JSON Annotation Serialization', () => {
  const samplePage1 = 'page-1';
  const samplePage2 = 'page-2';

  describe('1. Check Annotation Serialization', () => {
    it('serializes a Check (✓) stamp preserving all required properties and invariant coordinates', () => {
      const check = createCheckAnnotation(samplePage1, { x: 150, y: 320 }, { size: 32, color: '#16a34a' });
      const serialized = serializePageAnnotations(samplePage1, [check]);

      expect(serialized.annotations.length).toBe(1);
      const ann = serialized.annotations[0] as CheckAnnotation;
      expect(ann.id).toBe(check.id);
      expect(ann.pageKey).toBe(samplePage1);
      expect(ann.type).toBe('check');
      expect(ann.x).toBe(150);
      expect(ann.y).toBe(320);
      expect(ann.size).toBe(32);
      expect(ann.color).toBe('#16a34a');
      expect(typeof ann.createdAt).toBe('number');
    });
  });

  describe('2. Cross Annotation Serialization', () => {
    it('serializes a Cross (✗) stamp preserving all required properties and invariant coordinates', () => {
      const cross = createCrossAnnotation(samplePage1, { x: 280, y: 410 }, { size: 24, color: '#dc2626' });
      const serialized = serializePageAnnotations(samplePage1, [cross]);

      expect(serialized.annotations.length).toBe(1);
      const ann = serialized.annotations[0] as CrossAnnotation;
      expect(ann.id).toBe(cross.id);
      expect(ann.pageKey).toBe(samplePage1);
      expect(ann.type).toBe('cross');
      expect(ann.x).toBe(280);
      expect(ann.y).toBe(410);
      expect(ann.size).toBe(24);
      expect(ann.color).toBe('#dc2626');
      expect(typeof ann.createdAt).toBe('number');
    });
  });

  describe('3. Highlight Annotation Serialization', () => {
    it('serializes a Highlight rectangle preserving geometry, color, opacity, and invariant coordinates', () => {
      const hl = createHighlightAnnotation(
        samplePage1,
        { x: 100, y: 200, width: 250, height: 45 },
        { color: '#fde047', opacity: 0.4 }
      );
      const serialized = serializePageAnnotations(samplePage1, [hl]);

      expect(serialized.annotations.length).toBe(1);
      const ann = serialized.annotations[0] as HighlightAnnotation;
      expect(ann.id).toBe(hl.id);
      expect(ann.pageKey).toBe(samplePage1);
      expect(ann.type).toBe('highlight');
      expect(ann.x).toBe(100);
      expect(ann.y).toBe(200);
      expect(ann.width).toBe(250);
      expect(ann.height).toBe(45);
      expect(ann.color).toBe('#fde047');
      expect(ann.opacity).toBe(0.4);
      expect(typeof ann.createdAt).toBe('number');
    });
  });

  describe('4. Text Note Annotation Serialization', () => {
    it('serializes a Text Note preserving text content, font size, background, border, and position', () => {
      const note = createTextNoteAnnotation(
        samplePage1,
        { x: 300, y: 150 },
        'Please check time complexity calculation in step 2',
        {
          fontSize: 16,
          color: '#0f172a',
          backgroundColor: '#fef9c3',
          borderColor: '#fde047',
        }
      );
      const serialized = serializePageAnnotations(samplePage1, [note]);

      expect(serialized.annotations.length).toBe(1);
      const ann = serialized.annotations[0] as TextNoteAnnotation;
      expect(ann.id).toBe(note.id);
      expect(ann.pageKey).toBe(samplePage1);
      expect(ann.type).toBe('text');
      expect(ann.x).toBe(300);
      expect(ann.y).toBe(150);
      expect(ann.text).toBe('Please check time complexity calculation in step 2');
      expect(ann.fontSize).toBe(16);
      expect(ann.color).toBe('#0f172a');
      expect(ann.backgroundColor).toBe('#fef9c3');
      expect(ann.borderColor).toBe('#fde047');
      expect(typeof ann.createdAt).toBe('number');
    });
  });

  describe('5. Freehand Pen Stroke Serialization', () => {
    it('serializes freehand pen strokes preserving point array, color, and strokeWidth', () => {
      const stroke = createStroke(samplePage1, { x: 50, y: 60 }, { color: '#2563eb', strokeWidth: 4 });
      stroke.points = [50, 60, 55, 65, 60, 70, 65, 75];

      const serialized = serializePageAnnotations(samplePage1, [], [stroke]);

      expect(serialized.strokes.length).toBe(1);
      const s = serialized.strokes[0];
      expect(s.id).toBe(stroke.id);
      expect(s.pageKey).toBe(samplePage1);
      expect(s.points).toEqual([50, 60, 55, 65, 60, 70, 65, 75]);
      expect(s.color).toBe('#2563eb');
      expect(s.strokeWidth).toBe(4);
      expect(typeof s.createdAt).toBe('number');
    });
  });

  describe('6. Multiple Annotations Serialization', () => {
    it('serializes a heterogeneous collection of marks and strokes in exact array order', () => {
      const check = createCheckAnnotation(samplePage1, { x: 10, y: 10 });
      const hl = createHighlightAnnotation(samplePage1, { x: 20, y: 20, width: 80, height: 30 });
      const cross = createCrossAnnotation(samplePage1, { x: 30, y: 30 });
      const text = createTextNoteAnnotation(samplePage1, { x: 40, y: 40 }, 'Note A');
      const stroke = createStroke(samplePage1, { x: 5, y: 5 }, { color: DEFAULT_PEN_COLOR, strokeWidth: DEFAULT_PEN_WIDTH });

      const annotations = [check, hl, cross, text];
      const strokes = [stroke];

      const serialized = serializePageAnnotations(samplePage1, annotations, strokes);

      expect(serialized.annotations.length).toBe(4);
      expect(serialized.annotations[0].id).toBe(check.id);
      expect(serialized.annotations[1].id).toBe(hl.id);
      expect(serialized.annotations[2].id).toBe(cross.id);
      expect(serialized.annotations[3].id).toBe(text.id);
      expect(serialized.strokes.length).toBe(1);
      expect(serialized.strokes[0].id).toBe(stroke.id);
    });
  });

  describe('7. Multi-Page Separation & Grouping', () => {
    it('groups annotations and strokes strictly by pageKey in the serialized document', () => {
      const checkP1 = createCheckAnnotation(samplePage1, { x: 100, y: 100 });
      const strokeP1 = createStroke(samplePage1, { x: 110, y: 110 });
      const crossP2 = createCrossAnnotation(samplePage2, { x: 200, y: 200 });
      const textP2 = createTextNoteAnnotation(samplePage2, { x: 220, y: 220 }, 'P2 note');

      const allAnnotations = [checkP1, crossP2, textP2];
      const allStrokes = [strokeP1];

      const doc = serializeCanvasAnnotations({
        annotations: allAnnotations,
        strokes: allStrokes,
        pageKeys: [samplePage1, samplePage2],
      });

      expect(doc.version).toBe(ANNOTATION_FORMAT_VERSION);
      expect(doc.schema).toBe(ANNOTATION_FORMAT_SCHEMA);
      expect(Object.keys(doc.pages)).toEqual([samplePage1, samplePage2]);

      expect(doc.pages[samplePage1].annotations.length).toBe(1);
      expect(doc.pages[samplePage1].annotations[0].id).toBe(checkP1.id);
      expect(doc.pages[samplePage1].strokes.length).toBe(1);
      expect(doc.pages[samplePage1].strokes[0].id).toBe(strokeP1.id);

      expect(doc.pages[samplePage2].annotations.length).toBe(2);
      expect(doc.pages[samplePage2].annotations[0].id).toBe(crossP2.id);
      expect(doc.pages[samplePage2].annotations[1].id).toBe(textP2.id);
      expect(doc.pages[samplePage2].strokes.length).toBe(0);

      expect(doc.metadata?.totalAnnotations).toBe(3);
      expect(doc.metadata?.totalStrokes).toBe(1);
    });

    it('extracts page annotations accurately with extractPageAnnotations helper', () => {
      const check = createCheckAnnotation(samplePage1, { x: 50, y: 50 });
      const doc = serializeCanvasAnnotations({ annotations: [check] });

      const p1Data = extractPageAnnotations(doc, samplePage1);
      expect(p1Data.annotations.length).toBe(1);
      expect(p1Data.annotations[0].id).toBe(check.id);

      const nonExistent = extractPageAnnotations(doc, 'page-999');
      expect(nonExistent.annotations).toEqual([]);
      expect(nonExistent.strokes).toEqual([]);
    });
  });

  describe('8. Invariant Image/Base Coordinates Preservation', () => {
    it('preserves invariant image coordinates irrespective of screen/stage viewport transform', () => {
      const check = createCheckAnnotation(samplePage1, { x: 512.75, y: 1024.5 });
      const serialized = serializePageAnnotations(samplePage1, [check]);

      expect(serialized.annotations[0].x).toBe(512.75);
      expect(serialized.annotations[0].y).toBe(1024.5);
    });
  });

  describe('9. Rendering-Critical Properties Preservation', () => {
    it('retains all visual and styling tokens necessary for faithful canvas re-render', () => {
      const note = createTextNoteAnnotation(
        samplePage1,
        { x: 100, y: 200 },
        'Custom note text',
        {
          fontSize: 18,
          color: '#1e293b',
          backgroundColor: '#e0f2fe',
          borderColor: '#38bdf8',
        }
      );
      const cloned = cloneMarkAnnotation(note) as TextNoteAnnotation;

      expect(cloned.fontSize).toBe(18);
      expect(cloned.color).toBe('#1e293b');
      expect(cloned.backgroundColor).toBe('#e0f2fe');
      expect(cloned.borderColor).toBe('#38bdf8');
    });

    it('clones FreehandStroke preserving strokeWidth, color, and points array immutably', () => {
      const stroke = createStroke(samplePage1, { x: 10, y: 10 }, { color: '#2563eb', strokeWidth: 5 });
      stroke.points = [10, 10, 20, 20];
      const cloned = cloneFreehandStroke(stroke);

      expect(cloned.id).toBe(stroke.id);
      expect(cloned.points).toEqual([10, 10, 20, 20]);
      expect(cloned.color).toBe('#2563eb');
      expect(cloned.strokeWidth).toBe(5);

      // Verify points array is cloned, not referenced
      cloned.points.push(30, 30);
      expect(stroke.points).toEqual([10, 10, 20, 20]);
    });
  });

  describe('10. UI & Transient State Exclusion', () => {
    it('does not include transient UI states such as selectedAnnotationId, activeTool, zoom, or pan', () => {
      const check = createCheckAnnotation(samplePage1, { x: 50, y: 50 });
      const doc = serializeCanvasAnnotations({ annotations: [check] });
      const jsonStr = serializeToVectorJson(doc);
      const parsed = JSON.parse(jsonStr);

      expect(parsed).not.toHaveProperty('selectedAnnotationId');
      expect(parsed).not.toHaveProperty('activeTool');
      expect(parsed).not.toHaveProperty('zoom');
      expect(parsed).not.toHaveProperty('pan');
      expect(parsed).not.toHaveProperty('isOverlayVisible');
      expect(parsed).not.toHaveProperty('activeTextEditor');
    });
  });

  describe('11. Deterministic Serialization Output', () => {
    it('produces identical JSON output across repeated runs for identical annotation states', () => {
      const check = createCheckAnnotation(samplePage1, { x: 100, y: 100 }, { customId: 'fixed_id_1' });
      const cross = createCrossAnnotation(samplePage1, { x: 200, y: 200 }, { customId: 'fixed_id_2' });
      check.createdAt = 1715000000000;
      cross.createdAt = 1715000005000;

      const run1 = serializeToVectorJson({ annotations: [check, cross] });
      const run2 = serializeToVectorJson({ annotations: [check, cross] });

      expect(run1).toBe(run2);
    });
  });

  describe('12. Immutability & Non-Mutation of Source State', () => {
    it('does not mutate or alter the original annotation objects during serialization', () => {
      const originalStroke = createStroke(samplePage1, { x: 10, y: 10 }, { color: '#e11d48', strokeWidth: 3 });
      const originalPointsSnapshot = [...originalStroke.points];

      const doc = serializeCanvasAnnotations({ strokes: [originalStroke] });
      doc.pages[samplePage1].strokes[0].points.push(999, 999);

      expect(originalStroke.points).toEqual(originalPointsSnapshot);
    });
  });

  describe('13. Valid JSON Verification', () => {
    it('produces valid JSON that can be round-tripped with JSON.parse without loss', () => {
      const check = createCheckAnnotation(samplePage1, { x: 45, y: 80 });
      const hl = createHighlightAnnotation(samplePage1, { x: 10, y: 20, width: 100, height: 40 });
      const stroke = createStroke(samplePage1, { x: 30, y: 30 });

      const jsonString = serializeToVectorJson({ annotations: [check, hl], strokes: [stroke] });
      expect(() => JSON.parse(jsonString)).not.toThrow();

      const parsed = JSON.parse(jsonString);
      expect(parsed.version).toBe(ANNOTATION_FORMAT_VERSION);
      expect(parsed.pages[samplePage1].annotations.length).toBe(2);
      expect(parsed.pages[samplePage1].strokes.length).toBe(1);
    });
  });

  describe('14. Validation & Safe Rejection of Malformed Inputs', () => {
    it('validates a well-formed document successfully', () => {
      const check = createCheckAnnotation(samplePage1, { x: 50, y: 50 });
      const doc = serializeCanvasAnnotations({ annotations: [check] });
      const validation = validateAnnotationDocument(doc);

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
      expect(validation.document).toBeDefined();
    });

    it('safely rejects invalid inputs without throwing exceptions', () => {
      const res1 = validateAnnotationDocument(null);
      expect(res1.valid).toBe(false);
      expect(res1.errors.length).toBeGreaterThan(0);

      const res2 = validateAnnotationDocument({ version: 'one', pages: {} });
      expect(res2.valid).toBe(false);

      const res3 = validateAnnotationDocument({
        version: 1,
        pages: {
          'p1': {
            annotations: [{ id: 'bad', type: 'unknown_type', x: 'invalid', y: 10 }],
          },
        },
      });
      expect(res3.valid).toBe(false);
      expect(res3.errors.some((e) => e.includes('unsupported type'))).toBe(true);
    });

    it('safely deserializes JSON strings with deserializeAnnotationDocument', () => {
      const validJson = serializeToVectorJson({
        annotations: [createCheckAnnotation(samplePage1, { x: 10, y: 10 })],
      });
      const result = deserializeAnnotationDocument(validJson);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const invalidJson = '{ not valid json ';
      const errorResult = deserializeAnnotationDocument(invalidJson);
      expect(errorResult.success).toBe(false);
      expect(errorResult.error).toContain('JSON parse error');
    });
  });

  describe('15. Empty Pages & Empty Annotations Handling', () => {
    it('handles empty canvas states and empty pages gracefully', () => {
      const emptyDoc = serializeCanvasAnnotations({ pageKeys: [samplePage1, samplePage2] });

      expect(emptyDoc.pages[samplePage1]).toEqual({ annotations: [], strokes: [] });
      expect(emptyDoc.pages[samplePage2]).toEqual({ annotations: [], strokes: [] });
      expect(emptyDoc.metadata?.totalAnnotations).toBe(0);
      expect(emptyDoc.metadata?.totalStrokes).toBe(0);

      const jsonStr = serializeToVectorJson(emptyDoc);
      const validation = validateAnnotationDocument(JSON.parse(jsonStr));
      expect(validation.valid).toBe(true);
    });
  });

  describe('16. Source Image Separation (PRD FR-4.2)', () => {
    it('contains strictly vector metadata and never bakes source image data URIs or pixels', () => {
      const check = createCheckAnnotation(samplePage1, { x: 100, y: 100 });
      const stroke = createStroke(samplePage1, { x: 100, y: 100 });

      const doc = serializeCanvasAnnotations({ annotations: [check], strokes: [stroke] });
      const json = serializeToVectorJson(doc);

      expect(json).not.toContain('data:image');
      expect(json).not.toContain('<svg');
      expect(json).not.toContain('base64');
      expect(json).not.toContain('src');
    });
  });
});
