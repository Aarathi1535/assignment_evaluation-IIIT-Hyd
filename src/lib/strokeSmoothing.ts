/**
 * Stroke Smoothing & Jitter Reduction Utilities (AE-129)
 *
 * Provides lightweight, low-latency client-side algorithms for:
 * - Filtering out micro-jitter samples during live pointer events
 * - Online exponential smoothing during active drawing (< 5ms computation)
 * - Exact start and end point preservation
 * - Invariant image-space smoothing compatible with pan/zoom and vector hit-testing
 */

import type { FreehandStroke } from './penTool';

export const DEFAULT_SMOOTHING_ALPHA = 0.8; // Exponential moving average weight (0.0 to 1.0)
export const DEFAULT_MIN_DISTANCE_THRESHOLD = 2.0; // Min distance (px in image space) to record a new sample

export interface SmoothingOptions {
  /** Smoothing interpolation weight (default: 0.8) */
  smoothingAlpha?: number;
  /** Minimum pixel distance in invariant space to accept a sample (default: 2.0px) */
  minDistanceThreshold?: number;
}

/**
 * Calculates Euclidean distance between two points in invariant image space.
 */
export function pointDistance(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Determines whether a new pointer sample is far enough from the previous point to warrant recording.
 * Filters out static hover jitter and redundant duplicate coordinates.
 */
export function shouldRecordSample(
  lastPoint: { x: number; y: number },
  newPoint: { x: number; y: number },
  minDistance: number = DEFAULT_MIN_DISTANCE_THRESHOLD
): boolean {
  return pointDistance(lastPoint, newPoint) >= minDistance;
}

/**
 * Calculates an online smoothed point between the last smoothed position and current raw input.
 * Preserves responsiveness while damping high-frequency jitter.
 */
export function calculateSmoothedPoint(
  lastSmoothed: { x: number; y: number },
  currentRaw: { x: number; y: number },
  alpha: number = DEFAULT_SMOOTHING_ALPHA
): { x: number; y: number } {
  const safeAlpha = Math.max(0.1, Math.min(1.0, alpha));
  return {
    x: Math.round((lastSmoothed.x * (1 - safeAlpha) + currentRaw.x * safeAlpha) * 100) / 100,
    y: Math.round((lastSmoothed.y * (1 - safeAlpha) + currentRaw.y * safeAlpha) * 100) / 100,
  };
}

/**
 * Performs full-stroke smoothing on a flat coordinate array [x0, y0, x1, y1, ...].
 * - Preserves the exact first point (x0, y0) and exact final point (xn, yn).
 * - Damps intermediate noisy zig-zag samples.
 * - Handles short strokes (1-2 points) safely without distortion.
 */
export function smoothStrokeCoordinates(
  flatPoints: number[],
  options?: SmoothingOptions
): number[] {
  if (!flatPoints || flatPoints.length <= 4) {
    return flatPoints ? [...flatPoints] : [];
  }

  const minDistance = options?.minDistanceThreshold ?? DEFAULT_MIN_DISTANCE_THRESHOLD;

  const numPoints = flatPoints.length / 2;
  const rawPoints: { x: number; y: number }[] = [];

  for (let i = 0; i < flatPoints.length; i += 2) {
    rawPoints.push({ x: flatPoints[i], y: flatPoints[i + 1] });
  }

  // 1. Distance filtering
  const filtered: { x: number; y: number }[] = [rawPoints[0]];
  for (let i = 1; i < numPoints - 1; i++) {
    const prev = filtered[filtered.length - 1];
    const curr = rawPoints[i];
    if (shouldRecordSample(prev, curr, minDistance)) {
      filtered.push(curr);
    }
  }
  // Always include the exact final point
  const lastRaw = rawPoints[numPoints - 1];
  if (filtered.length === 1 || shouldRecordSample(filtered[filtered.length - 1], lastRaw, minDistance * 0.5)) {
    filtered.push(lastRaw);
  } else {
    // Replace last filtered with exact last raw
    filtered[filtered.length - 1] = lastRaw;
  }

  if (filtered.length <= 2) {
    return filtered.flatMap((p) => [p.x, p.y]);
  }

  // 2. Interior Weighted Moving Average (Chaikin / EMA hybrid)
  const smoothed: { x: number; y: number }[] = [filtered[0]];

  for (let i = 1; i < filtered.length - 1; i++) {
    const prev = smoothed[i - 1];
    const curr = filtered[i];
    const next = filtered[i + 1];

    // Centered smoothing kernel: 0.25 * prev + 0.5 * curr + 0.25 * next
    const smoothedX = 0.25 * prev.x + 0.5 * curr.x + 0.25 * next.x;
    const smoothedY = 0.25 * prev.y + 0.5 * curr.y + 0.25 * next.y;

    smoothed.push({
      x: Math.round(smoothedX * 100) / 100,
      y: Math.round(smoothedY * 100) / 100,
    });
  }

  // Pin exact endpoint
  smoothed.push(filtered[filtered.length - 1]);

  return smoothed.flatMap((p) => [p.x, p.y]);
}

/**
 * Appends a point to an active FreehandStroke using online smoothing.
 */
export function appendSmoothedPointToStroke(
  stroke: FreehandStroke,
  nextRawPoint: { x: number; y: number },
  options?: SmoothingOptions
): FreehandStroke {
  const points = stroke.points;
  if (points.length < 2) {
    return {
      ...stroke,
      points: [nextRawPoint.x, nextRawPoint.y],
    };
  }

  const lastX = points[points.length - 2];
  const lastY = points[points.length - 1];
  const lastPoint = { x: lastX, y: lastY };

  const minDistance = options?.minDistanceThreshold ?? DEFAULT_MIN_DISTANCE_THRESHOLD;
  if (!shouldRecordSample(lastPoint, nextRawPoint, minDistance)) {
    return stroke; // Skip micro-jitter
  }

  const alpha = options?.smoothingAlpha ?? DEFAULT_SMOOTHING_ALPHA;
  const smoothedPoint = calculateSmoothedPoint(lastPoint, nextRawPoint, alpha);

  return {
    ...stroke,
    points: [...points, smoothedPoint.x, smoothedPoint.y],
  };
}

/**
 * Finalizes a FreehandStroke on pointerup by applying full-stroke smoothing.
 */
export function finalizeSmoothedStroke(
  stroke: FreehandStroke,
  options?: SmoothingOptions
): FreehandStroke {
  return {
    ...stroke,
    points: smoothStrokeCoordinates(stroke.points, options),
  };
}
