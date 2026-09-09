/**
 * Stamp (Check, Cross) & Highlight Annotation Models and Utilities (AE-130)
 *
 * Provides pure mathematical utilities for:
 * - Check stamp (✓) creation and placement in invariant image coordinates
 * - Cross stamp (✗) creation and placement in invariant image coordinates
 * - Highlight box drag-normalization and bounds computation
 * - Page-isolated annotation filtering and ID generation
 */

export type StampType = 'check' | 'cross';

export interface CheckAnnotation {
  id: string;
  pageKey: string | number;
  type: 'check';
  x: number;
  y: number;
  size: number;
  color: string;
  createdAt: number;
}

export interface CrossAnnotation {
  id: string;
  pageKey: string | number;
  type: 'cross';
  x: number;
  y: number;
  size: number;
  color: string;
  createdAt: number;
}

export interface HighlightAnnotation {
  id: string;
  pageKey: string | number;
  type: 'highlight';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
  createdAt: number;
}

export interface TextNoteAnnotation {
  id: string;
  pageKey: string | number;
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  createdAt: number;
}

export type MarkAnnotation =
  | CheckAnnotation
  | CrossAnnotation
  | HighlightAnnotation
  | TextNoteAnnotation;

export const DEFAULT_CHECK_COLOR = '#16a34a'; // Standard green
export const DEFAULT_CROSS_COLOR = '#dc2626'; // Standard red
export const DEFAULT_HIGHLIGHT_COLOR = '#fde047'; // Vibrant highlighter yellow
export const DEFAULT_HIGHLIGHT_OPACITY = 0.35;
export const DEFAULT_STAMP_SIZE = 28; // Invariant image pixels

export const DEFAULT_TEXT_FONT_SIZE = 14; // Invariant font size
export const DEFAULT_TEXT_COLOR = '#0f172a'; // Slate 900
export const DEFAULT_TEXT_BG_COLOR = '#fef9c3'; // Light yellow / sticky note
export const DEFAULT_TEXT_BORDER_COLOR = '#fde047'; // Border yellow

let annotationCounter = 0;

/**
 * Generates a unique annotation ID.
 */
export function generateAnnotationId(prefix: string = 'ann'): string {
  annotationCounter += 1;
  return `${prefix}_${Date.now()}_${annotationCounter}_${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Creates a Check (✓) mark annotation centered at the given invariant image coordinate.
 */
export function createCheckAnnotation(
  pageKey: string | number,
  imagePoint: { x: number; y: number },
  options?: {
    size?: number;
    color?: string;
    customId?: string;
  }
): CheckAnnotation {
  return {
    id: options?.customId || generateAnnotationId('check'),
    pageKey,
    type: 'check',
    x: imagePoint.x,
    y: imagePoint.y,
    size: options?.size || DEFAULT_STAMP_SIZE,
    color: options?.color || DEFAULT_CHECK_COLOR,
    createdAt: Date.now(),
  };
}

/**
 * Creates a Cross (✗) mark annotation centered at the given invariant image coordinate.
 */
export function createCrossAnnotation(
  pageKey: string | number,
  imagePoint: { x: number; y: number },
  options?: {
    size?: number;
    color?: string;
    customId?: string;
  }
): CrossAnnotation {
  return {
    id: options?.customId || generateAnnotationId('cross'),
    pageKey,
    type: 'cross',
    x: imagePoint.x,
    y: imagePoint.y,
    size: options?.size || DEFAULT_STAMP_SIZE,
    color: options?.color || DEFAULT_CROSS_COLOR,
    createdAt: Date.now(),
  };
}

/**
 * Normalizes two arbitrary corner points in image space into a standard rectangle
 * with positive width and height: { x: min(x1, x2), y: min(y1, y2), width, height }.
 */
export function normalizeHighlightRect(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);

  return { x, y, width, height };
}

/**
 * Creates a Highlight rectangle annotation in invariant image space.
 */
export function createHighlightAnnotation(
  pageKey: string | number,
  rect: { x: number; y: number; width: number; height: number },
  options?: {
    color?: string;
    opacity?: number;
    customId?: string;
  }
): HighlightAnnotation {
  return {
    id: options?.customId || generateAnnotationId('highlight'),
    pageKey,
    type: 'highlight',
    x: rect.x,
    y: rect.y,
    width: Math.max(0, rect.width),
    height: Math.max(0, rect.height),
    color: options?.color || DEFAULT_HIGHLIGHT_COLOR,
    opacity: options?.opacity !== undefined ? options.opacity : DEFAULT_HIGHLIGHT_OPACITY,
    createdAt: Date.now(),
  };
}

/**
 * Creates a Text Note annotation in invariant image space.
 */
export function createTextNoteAnnotation(
  pageKey: string | number,
  imagePoint: { x: number; y: number },
  text: string,
  options?: {
    fontSize?: number;
    color?: string;
    backgroundColor?: string;
    borderColor?: string;
    customId?: string;
  }
): TextNoteAnnotation {
  return {
    id: options?.customId || generateAnnotationId('text'),
    pageKey,
    type: 'text',
    x: imagePoint.x,
    y: imagePoint.y,
    text,
    fontSize: options?.fontSize || DEFAULT_TEXT_FONT_SIZE,
    color: options?.color || DEFAULT_TEXT_COLOR,
    backgroundColor: options?.backgroundColor || DEFAULT_TEXT_BG_COLOR,
    borderColor: options?.borderColor || DEFAULT_TEXT_BORDER_COLOR,
    createdAt: Date.now(),
  };
}

/**
 * Filters annotations to return only those belonging strictly to a specific pageKey.
 */
export function filterAnnotationsByPage<T extends MarkAnnotation>(
  annotations: T[],
  pageKey: string | number
): T[] {
  if (!annotations || !Array.isArray(annotations) || annotations.length === 0) {
    return [];
  }
  return annotations.filter((a) => String(a.pageKey) === String(pageKey));
}
