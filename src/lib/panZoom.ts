/**
 * Pan & Zoom Mathematical Models and Coordinate Utilities (AE-124)
 *
 * Pure functions for viewport-bounded panning, pointer-anchored zooming,
 * pinch-to-zoom geometry, and base-fit scale vs interactive-zoom scaling.
 */

import type { CanvasPoint, RenderedImageBounds } from './annotations';

export interface PanBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PanZoomTransform {
  /** X offset in display pixels */
  x: number;
  /** Y offset in display pixels */
  y: number;
  /** Interactive zoom multiplier (1.0 = 100% / fit scale) */
  zoom: number;
}

export const MIN_ZOOM_LEVEL = 1.0; // 100% / fit-to-viewport
export const MAX_ZOOM_LEVEL = 4.0; // 400% maximum magnification
export const DEFAULT_ZOOM_STEP = 0.25; // 25% step per click/increment

/**
 * Calculates allowable pan boundaries for an image within a container viewport.
 *
 * Rules:
 * - If rendered dimension <= container dimension:
 *   Image is strictly centered in that dimension (min = max = centered coordinate).
 * - If rendered dimension > container dimension:
 *   min = container - rendered (right/bottom edge touches container boundary).
 *   max = 0 (left/top edge touches container boundary).
 */
export function calculatePanBounds(
  containerWidth: number,
  containerHeight: number,
  renderedWidth: number,
  renderedHeight: number
): PanBounds {
  let minX: number;
  let maxX: number;
  let minY: number;
  let maxY: number;

  if (renderedWidth <= containerWidth) {
    const centerX = (containerWidth - renderedWidth) / 2;
    minX = centerX;
    maxX = centerX;
  } else {
    minX = containerWidth - renderedWidth;
    maxX = 0;
  }

  if (renderedHeight <= containerHeight) {
    const centerY = (containerHeight - renderedHeight) / 2;
    minY = centerY;
    maxY = centerY;
  } else {
    minY = containerHeight - renderedHeight;
    maxY = 0;
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Clamps a proposed (x, y) pan position to the allowable pan bounds.
 */
export function clampPanPosition(x: number, y: number, bounds: PanBounds): CanvasPoint {
  const clampedX = Math.max(bounds.minX, Math.min(bounds.maxX, x));
  const clampedY = Math.max(bounds.minY, Math.min(bounds.maxY, y));
  return { x: clampedX, y: clampedY };
}

/**
 * Calculates a new pan/zoom transform anchored around a specific pointer coordinate (e.g. mouse cursor or pinch center).
 *
 * Ensures that the point on the image directly under the pointer remains at the exact same
 * screen coordinate after zooming, subject to viewport pan bounds.
 */
export function calculateZoomTransform(
  currentX: number,
  currentY: number,
  currentZoom: number,
  targetZoom: number,
  pointerX: number,
  pointerY: number,
  baseBounds: RenderedImageBounds,
  containerWidth: number,
  containerHeight: number,
  minZoom = MIN_ZOOM_LEVEL,
  maxZoom = MAX_ZOOM_LEVEL
): PanZoomTransform {
  const clampedZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom));

  if (baseBounds.width <= 0 || baseBounds.height <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { x: currentX, y: currentY, zoom: clampedZoom };
  }

  // Current rendered dimensions
  const currentW = baseBounds.width * currentZoom;
  const currentH = baseBounds.height * currentZoom;

  // Relative coordinate on image under pointer (normalized [0, 1])
  const uX = currentW > 0 ? (pointerX - currentX) / currentW : 0.5;
  const uY = currentH > 0 ? (pointerY - currentY) / currentH : 0.5;

  // New rendered dimensions at target zoom
  const newW = baseBounds.width * clampedZoom;
  const newH = baseBounds.height * clampedZoom;

  // Tentative top-left position to keep (pointerX, pointerY) invariant
  const tentativeX = pointerX - uX * newW;
  const tentativeY = pointerY - uY * newH;

  // Apply pan bounds clamp
  const bounds = calculatePanBounds(containerWidth, containerHeight, newW, newH);
  const clampedPos = clampPanPosition(tentativeX, tentativeY, bounds);

  return {
    x: clampedPos.x,
    y: clampedPos.y,
    zoom: clampedZoom,
  };
}

/**
 * Calculates stepped zoom (e.g. for Zoom In / Zoom Out buttons).
 */
export function calculateStepZoom(
  currentZoom: number,
  delta: number,
  minZoom = MIN_ZOOM_LEVEL,
  maxZoom = MAX_ZOOM_LEVEL
): number {
  const next = Math.round((currentZoom + delta) * 100) / 100;
  return Math.max(minZoom, Math.min(maxZoom, next));
}

export interface TouchPoint {
  clientX: number;
  clientY: number;
}

export interface PinchMetrics {
  distance: number;
  centerX: number;
  centerY: number;
}

/**
 * Calculates Euclidean distance and midpoint between two touch points.
 */
export function calculatePinchMetrics(touch1: TouchPoint, touch2: TouchPoint): PinchMetrics {
  const dx = touch2.clientX - touch1.clientX;
  const dy = touch2.clientY - touch1.clientY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const centerX = (touch1.clientX + touch2.clientX) / 2;
  const centerY = (touch1.clientY + touch2.clientY) / 2;
  return { distance, centerX, centerY };
}
