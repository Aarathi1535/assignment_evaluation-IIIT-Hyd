/**
 * Vector JSON Serialization & Validation for Canvas Annotations (AE-134)
 *
 * Provides pure, deterministic vector JSON serialization and lightweight validation
 * for answer-sheet annotations (checks, crosses, highlights, text notes) and freehand pen strokes,
 * organized strictly per page.
 *
 * Requirements:
 * - Deterministic, invariant base image coordinates (zoom/pan agnostic)
 * - Source image separation (source pixels/snapshots are never serialized - PRD FR-4.2)
 * - No transient UI state (selection, active tool, zoom, overlay visibility, editor focus)
 * - Pure functions with non-mutating deep serialization
 * - Safe validation and parsing helpers ready for AE-136 canvas reconstruction
 */

import type {
  CheckAnnotation,
  CrossAnnotation,
  HighlightAnnotation,
  TextNoteAnnotation,
  MarkAnnotation,
} from './stampTool';
import type { FreehandStroke } from './penTool';
import { filterAnnotationsByPage } from './stampTool';
import { filterStrokesByPage } from './penTool';

export const ANNOTATION_FORMAT_VERSION = 1;
export const ANNOTATION_FORMAT_SCHEMA = 'urn:ae:vector-annotations:v1';

/**
 * Serialized vector annotations and pen strokes for a single page.
 */
export interface SerializedPageAnnotations {
  annotations: MarkAnnotation[];
  strokes: FreehandStroke[];
}

/**
 * Optional metadata included in the serialized document.
 */
export interface AnnotationDocumentMetadata {
  totalAnnotations?: number;
  totalStrokes?: number;
  exportedAt?: string;
  [key: string]: unknown;
}

/**
 * Complete vector JSON document representing annotations and strokes across all pages.
 */
export interface SerializedAnnotationDocument {
  version: number;
  schema?: string;
  pages: Record<string, SerializedPageAnnotations>;
  metadata?: AnnotationDocumentMetadata;
}

/**
 * Options for serializing full canvas state.
 */
export interface SerializeCanvasOptions {
  annotations?: MarkAnnotation[];
  strokes?: FreehandStroke[];
  pageKeys?: (string | number)[];
  metadata?: Record<string, unknown>;
}

/**
 * Result of validating an annotation document structure.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  document?: SerializedAnnotationDocument;
}

/**
 * Result of deserializing and parsing an annotation JSON string or raw object.
 */
export interface DeserializationResult {
  success: boolean;
  data?: SerializedAnnotationDocument;
  error?: string;
  errors?: string[];
}

/**
 * Deep clones a single MarkAnnotation, sanitizing and preserving all rendering-critical properties.
 */
export function cloneMarkAnnotation(annotation: MarkAnnotation): MarkAnnotation {
  const base = {
    id: String(annotation.id),
    pageKey: typeof annotation.pageKey === 'number' ? annotation.pageKey : String(annotation.pageKey),
    type: annotation.type,
    x: Number(annotation.x),
    y: Number(annotation.y),
    createdAt: Number(annotation.createdAt || Date.now()),
  };

  if (annotation.type === 'check') {
    const check = annotation as CheckAnnotation;
    return {
      ...base,
      type: 'check',
      size: Number(check.size),
      color: String(check.color),
    };
  }

  if (annotation.type === 'cross') {
    const cross = annotation as CrossAnnotation;
    return {
      ...base,
      type: 'cross',
      size: Number(cross.size),
      color: String(cross.color),
    };
  }

  if (annotation.type === 'highlight') {
    const hl = annotation as HighlightAnnotation;
    return {
      ...base,
      type: 'highlight',
      width: Number(hl.width),
      height: Number(hl.height),
      color: String(hl.color),
      opacity: Number(hl.opacity),
    };
  }

  if (annotation.type === 'text') {
    const note = annotation as TextNoteAnnotation;
    const res: TextNoteAnnotation = {
      ...base,
      type: 'text',
      text: String(note.text ?? ''),
    };
    if (note.fontSize !== undefined) res.fontSize = Number(note.fontSize);
    if (note.color !== undefined) res.color = String(note.color);
    if (note.backgroundColor !== undefined) res.backgroundColor = String(note.backgroundColor);
    if (note.borderColor !== undefined) res.borderColor = String(note.borderColor);
    return res;
  }

  return annotation;
}

/**
 * Deep clones a single FreehandStroke, sanitizing and preserving all stroke points and styling.
 */
export function cloneFreehandStroke(stroke: FreehandStroke): FreehandStroke {
  return {
    id: String(stroke.id),
    pageKey: typeof stroke.pageKey === 'number' ? stroke.pageKey : String(stroke.pageKey),
    points: Array.isArray(stroke.points) ? stroke.points.map((p) => Number(p)) : [],
    color: String(stroke.color),
    strokeWidth: Number(stroke.strokeWidth),
    createdAt: Number(stroke.createdAt || Date.now()),
  };
}

/**
 * Serializes annotations and strokes belonging strictly to a single page.
 */
export function serializePageAnnotations(
  pageKey: string | number,
  annotations: MarkAnnotation[] = [],
  strokes: FreehandStroke[] = []
): SerializedPageAnnotations {
  const pageAnnotations = filterAnnotationsByPage(annotations, pageKey);
  const pageStrokes = filterStrokesByPage(strokes, pageKey);

  return {
    annotations: pageAnnotations.map(cloneMarkAnnotation),
    strokes: pageStrokes.map(cloneFreehandStroke),
  };
}

/**
 * Serializes multi-page canvas annotations and strokes into a standardized, deterministic document.
 */
export function serializeCanvasAnnotations(
  options: SerializeCanvasOptions = {}
): SerializedAnnotationDocument {
  const allAnnotations = options.annotations || [];
  const allStrokes = options.strokes || [];

  // Determine all distinct page keys deterministically
  const explicitKeys = options.pageKeys ? options.pageKeys.map((k) => String(k)) : [];
  const annotationKeys = allAnnotations.map((a) => String(a.pageKey));
  const strokeKeys = allStrokes.map((s) => String(s.pageKey));

  const uniqueKeySet = new Set<string>([...explicitKeys, ...annotationKeys, ...strokeKeys]);
  const sortedKeys = Array.from(uniqueKeySet).sort((a, b) => {
    // If explicit keys were passed, preserve explicit order first
    if (explicitKeys.length > 0) {
      const idxA = explicitKeys.indexOf(a);
      const idxB = explicitKeys.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
    }
    // Numerical sort fallback if keys are numbers, otherwise alphabetical
    const numA = Number(a);
    const numB = Number(b);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      return numA - numB;
    }
    return a.localeCompare(b);
  });

  const pages: Record<string, SerializedPageAnnotations> = {};
  let totalAnnotations = 0;
  let totalStrokes = 0;

  for (const pageKey of sortedKeys) {
    const pageData = serializePageAnnotations(pageKey, allAnnotations, allStrokes);
    pages[pageKey] = pageData;
    totalAnnotations += pageData.annotations.length;
    totalStrokes += pageData.strokes.length;
  }

  const document: SerializedAnnotationDocument = {
    version: ANNOTATION_FORMAT_VERSION,
    schema: ANNOTATION_FORMAT_SCHEMA,
    pages,
    metadata: {
      totalAnnotations,
      totalStrokes,
      ...(options.metadata ? JSON.parse(JSON.stringify(options.metadata)) : {}),
    },
  };

  return document;
}

/**
 * Serializes canvas state or document into a formatted, deterministic vector JSON string.
 */
export function serializeToVectorJson(
  input: SerializeCanvasOptions | SerializedAnnotationDocument,
  indent: number = 2
): string {
  const document =
    'version' in input && 'pages' in input && typeof input.version === 'number'
      ? (input as SerializedAnnotationDocument)
      : serializeCanvasAnnotations(input as SerializeCanvasOptions);

  return JSON.stringify(document, null, indent);
}

/**
 * Validates a MarkAnnotation object against required fields and valid coordinate numbers.
 */
function validateMarkAnnotation(ann: unknown, index: number, pageKey: string): string[] {
  const errors: string[] = [];
  if (!ann || typeof ann !== 'object') {
    errors.push(`Page "${pageKey}", annotation at index ${index} must be an object`);
    return errors;
  }

  const a = ann as Record<string, unknown>;

  if (typeof a.id !== 'string' || !a.id.trim()) {
    errors.push(`Page "${pageKey}", annotation at index ${index} is missing a valid "id"`);
  }

  if (typeof a.x !== 'number' || !Number.isFinite(a.x)) {
    errors.push(`Page "${pageKey}", annotation at index ${index} must have finite numeric coordinate "x"`);
  }

  if (typeof a.y !== 'number' || !Number.isFinite(a.y)) {
    errors.push(`Page "${pageKey}", annotation at index ${index} must have finite numeric coordinate "y"`);
  }

  const validTypes = ['check', 'cross', 'highlight', 'text'];
  if (!validTypes.includes(a.type as string)) {
    errors.push(
      `Page "${pageKey}", annotation at index ${index} has unsupported type "${a.type}". Supported: ${validTypes.join(', ')}`
    );
    return errors;
  }

  if (a.type === 'check' || a.type === 'cross') {
    if (typeof a.size !== 'number' || !Number.isFinite(a.size) || a.size <= 0) {
      errors.push(`Page "${pageKey}", ${a.type} annotation at index ${index} must have a positive numeric "size"`);
    }
    if (typeof a.color !== 'string' || !a.color.trim()) {
      errors.push(`Page "${pageKey}", ${a.type} annotation at index ${index} must have a valid "color" string`);
    }
  } else if (a.type === 'highlight') {
    if (typeof a.width !== 'number' || !Number.isFinite(a.width) || a.width < 0) {
      errors.push(`Page "${pageKey}", highlight annotation at index ${index} must have a non-negative numeric "width"`);
    }
    if (typeof a.height !== 'number' || !Number.isFinite(a.height) || a.height < 0) {
      errors.push(`Page "${pageKey}", highlight annotation at index ${index} must have a non-negative numeric "height"`);
    }
    if (typeof a.color !== 'string' || !a.color.trim()) {
      errors.push(`Page "${pageKey}", highlight annotation at index ${index} must have a valid "color" string`);
    }
    if (a.opacity !== undefined && (typeof a.opacity !== 'number' || !Number.isFinite(a.opacity) || a.opacity < 0 || a.opacity > 1)) {
      errors.push(`Page "${pageKey}", highlight annotation at index ${index} "opacity" must be between 0 and 1`);
    }
  } else if (a.type === 'text') {
    if (typeof a.text !== 'string') {
      errors.push(`Page "${pageKey}", text annotation at index ${index} must have a "text" string`);
    }
    if (a.fontSize !== undefined && (typeof a.fontSize !== 'number' || !Number.isFinite(a.fontSize) || a.fontSize <= 0)) {
      errors.push(`Page "${pageKey}", text annotation at index ${index} "fontSize" must be a positive number`);
    }
  }

  return errors;
}

/**
 * Validates a FreehandStroke object against required fields and valid coordinate points.
 */
function validateFreehandStroke(stroke: unknown, index: number, pageKey: string): string[] {
  const errors: string[] = [];
  if (!stroke || typeof stroke !== 'object') {
    errors.push(`Page "${pageKey}", stroke at index ${index} must be an object`);
    return errors;
  }

  const s = stroke as Record<string, unknown>;

  if (typeof s.id !== 'string' || !s.id.trim()) {
    errors.push(`Page "${pageKey}", stroke at index ${index} is missing a valid "id"`);
  }

  if (!Array.isArray(s.points) || s.points.length < 2 || s.points.length % 2 !== 0) {
    errors.push(
      `Page "${pageKey}", stroke at index ${index} "points" must be an array of even length >= 2 (alternating [x0, y0, ...])`
    );
  } else {
    for (let i = 0; i < s.points.length; i++) {
      if (typeof s.points[i] !== 'number' || !Number.isFinite(s.points[i])) {
        errors.push(`Page "${pageKey}", stroke at index ${index} point coordinate at index ${i} is not a finite number`);
        break;
      }
    }
  }

  if (typeof s.color !== 'string' || !s.color.trim()) {
    errors.push(`Page "${pageKey}", stroke at index ${index} must have a valid "color" string`);
  }

  if (typeof s.strokeWidth !== 'number' || !Number.isFinite(s.strokeWidth) || s.strokeWidth <= 0) {
    errors.push(`Page "${pageKey}", stroke at index ${index} must have a positive numeric "strokeWidth"`);
  }

  return errors;
}

/**
 * Validates an unknown input against the SerializedAnnotationDocument structure.
 * Returns non-throwing structured validation results with detailed error messages.
 */
export function validateAnnotationDocument(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: ['Serialized annotation document must be a non-null object'],
    };
  }

  const doc = input as Record<string, unknown>;

  if (typeof doc.version !== 'number' || !Number.isInteger(doc.version) || doc.version < 1) {
    errors.push(`Invalid or missing document "version": expected positive integer, received ${doc.version}`);
  }

  if (!doc.pages || typeof doc.pages !== 'object' || Array.isArray(doc.pages)) {
    errors.push('Document "pages" field must be a valid object keyed by page identity');
    return { valid: false, errors };
  }

  const pages = doc.pages as Record<string, unknown>;

  for (const [pageKey, pageContent] of Object.entries(pages)) {
    if (!pageContent || typeof pageContent !== 'object' || Array.isArray(pageContent)) {
      errors.push(`Page entry for "${pageKey}" must be an object containing "annotations" and "strokes"`);
      continue;
    }

    const pageObj = pageContent as Record<string, unknown>;

    if (pageObj.annotations !== undefined) {
      if (!Array.isArray(pageObj.annotations)) {
        errors.push(`Page "${pageKey}" "annotations" must be an array`);
      } else {
        pageObj.annotations.forEach((ann, idx) => {
          errors.push(...validateMarkAnnotation(ann, idx, pageKey));
        });
      }
    }

    if (pageObj.strokes !== undefined) {
      if (!Array.isArray(pageObj.strokes)) {
        errors.push(`Page "${pageKey}" "strokes" must be an array`);
      } else {
        pageObj.strokes.forEach((stroke, idx) => {
          errors.push(...validateFreehandStroke(stroke, idx, pageKey));
        });
      }
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    document: valid ? (input as SerializedAnnotationDocument) : undefined,
  };
}

/**
 * Safely parses and validates a vector JSON string or object.
 * Ready for AE-136 canvas reconstruction without throwing unhandled exceptions.
 */
export function deserializeAnnotationDocument(jsonOrObject: string | unknown): DeserializationResult {
  let parsed: unknown;

  if (typeof jsonOrObject === 'string') {
    try {
      parsed = JSON.parse(jsonOrObject);
    } catch (err) {
      return {
        success: false,
        error: `JSON parse error: ${(err as Error).message}`,
        errors: [`JSON parse error: ${(err as Error).message}`],
      };
    }
  } else {
    parsed = jsonOrObject;
  }

  const validation = validateAnnotationDocument(parsed);

  if (!validation.valid) {
    return {
      success: false,
      error: `Validation failed: ${validation.errors.join('; ')}`,
      errors: validation.errors,
    };
  }

  return {
    success: true,
    data: validation.document,
  };
}

/**
 * Safely extracts annotations and strokes for a specific pageKey from a document.
 */
export function extractPageAnnotations(
  doc: SerializedAnnotationDocument | null | undefined,
  pageKey: string | number
): { annotations: MarkAnnotation[]; strokes: FreehandStroke[] } {
  if (!doc || !doc.pages) {
    return { annotations: [], strokes: [] };
  }

  const page = doc.pages[String(pageKey)];
  if (!page) {
    return { annotations: [], strokes: [] };
  }

  return {
    annotations: Array.isArray(page.annotations) ? page.annotations.map(cloneMarkAnnotation) : [],
    strokes: Array.isArray(page.strokes) ? page.strokes.map(cloneFreehandStroke) : [],
  };
}

/**
 * Safely deserializes unknown single-page or multi-page payload into a normalized
 * { annotations: MarkAnnotation[]; strokes: FreehandStroke[] } without throwing.
 */
export function deserializePageAnnotations(
  payload: unknown,
  pageKey: string | number = 'page-1'
): { annotations: MarkAnnotation[]; strokes: FreehandStroke[] } {
  if (!payload || typeof payload !== 'object') {
    return { annotations: [], strokes: [] };
  }

  const raw = payload as Record<string, unknown>;

  // Case A: Full SerializedAnnotationDocument
  if (typeof raw.version === 'number' && raw.pages && typeof raw.pages === 'object') {
    const res = deserializeAnnotationDocument(raw);
    if (!res.success || !res.data) {
      return { annotations: [], strokes: [] };
    }
    const extracted = extractPageAnnotations(res.data, pageKey);
    if (extracted.annotations.length > 0 || extracted.strokes.length > 0) {
      return extracted;
    }
    // Fallback to first available page if specific key wasn't matched
    const firstPageKey = Object.keys(res.data.pages)[0];
    return firstPageKey ? extractPageAnnotations(res.data, firstPageKey) : { annotations: [], strokes: [] };
  }

  // Case B: Single-page payload `{ annotations?: [...], strokes?: [...] }`
  const singlePageDoc: SerializedAnnotationDocument = {
    version: ANNOTATION_FORMAT_VERSION,
    pages: {
      [String(pageKey)]: {
        annotations: (Array.isArray(raw.annotations) ? raw.annotations : []) as MarkAnnotation[],
        strokes: (Array.isArray(raw.strokes) ? raw.strokes : []) as FreehandStroke[],
      },
    },
  };

  const res = deserializeAnnotationDocument(singlePageDoc);
  if (!res.success || !res.data) {
    return { annotations: [], strokes: [] };
  }

  return extractPageAnnotations(res.data, pageKey);
}
