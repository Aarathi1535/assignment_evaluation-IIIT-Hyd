/**
 * Eraser Tool Hit-Testing & Mathematical Utilities (AE-128)
 *
 * Provides pure mathematical utilities for:
 * - Calculating distance from a point to a 2D line segment
 * - Detecting collision between an eraser point/circle and a FreehandStroke in invariant image space
 * - Finding intersecting strokes to be erased
 */

import type { FreehandStroke } from './penTool';

export const DEFAULT_ERASER_RADIUS = 12; // Base radius in invariant image coordinates

/**
 * Calculates the shortest squared distance from point (px, py) to line segment (x1, y1) -> (x2, y2).
 */
export function distanceSquaredToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) {
    const dx = px - x1;
    const dy = py - y1;
    return dx * dx + dy * dy;
  }

  // Projection scalar t of point p onto line segment
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * (x2 - x1);
  const projY = y1 + t * (y2 - y1);

  const dx = px - projX;
  const dy = py - projY;
  return dx * dx + dy * dy;
}

/**
 * Determines whether an eraser point (with radius) intersects a given FreehandStroke.
 */
export function isStrokeIntersectingPoint(
  stroke: FreehandStroke,
  eraserPoint: { x: number; y: number },
  eraserRadius: number = DEFAULT_ERASER_RADIUS
): boolean {
  const points = stroke.points;
  if (!points || points.length < 2) return false;

  const effectiveRadius = eraserRadius + (stroke.strokeWidth || 2) / 2;
  const radiusSquared = effectiveRadius * effectiveRadius;

  // Single point stroke
  if (points.length === 2) {
    const dx = eraserPoint.x - points[0];
    const dy = eraserPoint.y - points[1];
    return dx * dx + dy * dy <= radiusSquared;
  }

  // Iterate over consecutive line segments
  for (let i = 0; i < points.length - 2; i += 2) {
    const distSq = distanceSquaredToSegment(
      eraserPoint.x,
      eraserPoint.y,
      points[i],
      points[i + 1],
      points[i + 2],
      points[i + 3]
    );

    if (distSq <= radiusSquared) {
      return true;
    }
  }

  return false;
}

/**
 * Finds all strokes in a list that intersect the given eraser point.
 */
export function findIntersectingStrokes(
  strokes: FreehandStroke[],
  eraserPoint: { x: number; y: number },
  eraserRadius: number = DEFAULT_ERASER_RADIUS
): FreehandStroke[] {
  if (!strokes || strokes.length === 0) return [];
  return strokes.filter((stroke) =>
    isStrokeIntersectingPoint(stroke, eraserPoint, eraserRadius)
  );
}
