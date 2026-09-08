/**
 * Freehand Pen Tool Models and Mathematical Utilities (AE-126)
 *
 * Provides pure mathematical utilities for:
 * - Converting screen pointer coordinates to invariant image coordinates under pan/zoom
 * - Pressure-sensitive stroke width mapping with graceful fallbacks
 * - Freehand stroke creation, point appending, and page-isolated retrieval
 */

import type { PanZoomTransform } from './panZoom';

export const DEFAULT_PEN_COLOR = '#e11d48'; // Standard grading red pen
export const DEFAULT_PEN_WIDTH = 3;
export const MIN_PRESSURE_WIDTH_MULTIPLIER = 0.5;
export const MAX_PRESSURE_WIDTH_MULTIPLIER = 1.75;

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface FreehandStroke {
  /** Unique stroke identifier */
  id: string;
  /** Page key (page ID or page index) to which this stroke strictly belongs */
  pageKey: string | number;
  /** Flat array of alternating coordinates [x0, y0, x1, y1, ...] in invariant image space */
  points: number[];
  /** Stroke color hex/rgba */
  color: string;
  /** Stroke width in pixels */
  strokeWidth: number;
  /** Timestamp when the stroke was created */
  createdAt: number;
}

let strokeCounter = 0;

/**
 * Generates a unique stroke ID.
 */
export function generateStrokeId(): string {
  strokeCounter += 1;
  return `stroke_${Date.now()}_${strokeCounter}_${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Maps pointer pressure (0.0 to 1.0) conservatively to an effective stroke width.
 * For devices or events without meaningful pressure, falls back to the default/base stroke width.
 */
export function calculatePressureStrokeWidth(
  baseWidth: number = DEFAULT_PEN_WIDTH,
  pressure?: number
): number {
  if (
    pressure === undefined ||
    pressure === null ||
    typeof pressure !== 'number' ||
    Number.isNaN(pressure) ||
    pressure <= 0 ||
    pressure > 1.0
  ) {
    return baseWidth;
  }

  const multiplier =
    MIN_PRESSURE_WIDTH_MULTIPLIER +
    pressure * (MAX_PRESSURE_WIDTH_MULTIPLIER - MIN_PRESSURE_WIDTH_MULTIPLIER);

  return Math.round(baseWidth * multiplier * 100) / 100;
}

/**
 * Converts physical viewport screen coordinates (e.g. from mouse/touch/stylus)
 * to invariant base image coordinates using the active pan/zoom transform.
 */
export function screenToImageCoordinates(
  screenX: number,
  screenY: number,
  transform: PanZoomTransform
): { x: number; y: number } {
  const zoom = transform.zoom > 0 ? transform.zoom : 1.0;
  return {
    x: (screenX - transform.x) / zoom,
    y: (screenY - transform.y) / zoom,
  };
}

/**
 * Converts invariant base image coordinates back to physical viewport screen coordinates.
 */
export function imageToScreenCoordinates(
  imageX: number,
  imageY: number,
  transform: PanZoomTransform
): { x: number; y: number } {
  const zoom = transform.zoom > 0 ? transform.zoom : 1.0;
  return {
    x: transform.x + imageX * zoom,
    y: transform.y + imageY * zoom,
  };
}

/**
 * Creates a new freehand stroke starting at the given base image point.
 */
export function createStroke(
  pageKey: string | number,
  initialImagePoint: { x: number; y: number },
  options?: {
    color?: string;
    strokeWidth?: number;
    pressure?: number;
    customId?: string;
  }
): FreehandStroke {
  const baseWidth = options?.strokeWidth || DEFAULT_PEN_WIDTH;
  const effectiveWidth = calculatePressureStrokeWidth(baseWidth, options?.pressure);

  return {
    id: options?.customId || generateStrokeId(),
    pageKey,
    points: [initialImagePoint.x, initialImagePoint.y],
    color: options?.color || DEFAULT_PEN_COLOR,
    strokeWidth: effectiveWidth,
    createdAt: Date.now(),
  };
}

/**
 * Appends a new base image point to an existing stroke.
 * Returns a new stroke object (immutable).
 */
export function appendPointToStroke(
  stroke: FreehandStroke,
  nextImagePoint: { x: number; y: number }
): FreehandStroke {
  return {
    ...stroke,
    points: [...stroke.points, nextImagePoint.x, nextImagePoint.y],
  };
}

/**
 * Filters a list of strokes to return only those belonging strictly to a specific pageKey.
 */
export function filterStrokesByPage(
  strokes: FreehandStroke[],
  pageKey: string | number
): FreehandStroke[] {
  if (!strokes || !Array.isArray(strokes) || strokes.length === 0) {
    return [];
  }
  return strokes.filter((s) => String(s.pageKey) === String(pageKey));
}
