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
  /** View rotation in degrees (0, 90, 180, 270) */
  rotation?: number;
}

/**
 * Normalizes rotation degrees to [0, 360) range in increments of 90 degrees.
 */
export function normalizeRotation(degrees: number = 0): number {
  const normalized = ((Math.round(degrees) % 360) + 360) % 360;
  return normalized;
}

export interface CanvasViewState {
  /** Rotation in degrees (0, 90, 180, 270) */
  rotation: number;
  /** Image brightness factor (default 1.0) */
  brightness: number;
  /** Image contrast factor (default 1.0) */
  contrast: number;
  /** Viewport pan and zoom transform */
  transform: PanZoomTransform;
}

export const MIN_ZOOM_LEVEL = 1.0; // 100% / fit-to-viewport
export const MAX_ZOOM_LEVEL = 4.0; // 400% maximum magnification
export const DEFAULT_ZOOM_STEP = 0.25; // 25% step per click/increment
export const DEFAULT_ROTATION = 0; // 0 degrees
export const DEFAULT_BRIGHTNESS = 1.0; // 1.0 = neutral/normal
export const DEFAULT_CONTRAST = 1.0; // 1.0 = neutral/normal

/**
 * Calculates the initial/default fit transform for a loaded page image.
 */
export function calculateInitialTransform(
  baseBounds?: RenderedImageBounds | null
): PanZoomTransform {
  if (baseBounds && typeof baseBounds.x === 'number' && typeof baseBounds.y === 'number') {
    return {
      x: baseBounds.x,
      y: baseBounds.y,
      zoom: 1.0,
    };
  }
  return {
    x: 0,
    y: 0,
    zoom: 1.0,
  };
}

/**
 * Generates the clean default view state for a canvas page.
 */
export function createDefaultViewState(
  baseBounds?: RenderedImageBounds | null
): CanvasViewState {
  return {
    rotation: DEFAULT_ROTATION,
    brightness: DEFAULT_BRIGHTNESS,
    contrast: DEFAULT_CONTRAST,
    transform: calculateInitialTransform(baseBounds),
  };
}

/**
 * Checks whether the current view state matches the clean default viewing state.
 */
export function isDefaultViewState(
  viewState: CanvasViewState,
  baseBounds?: RenderedImageBounds | null
): boolean {
  const initialTransform = calculateInitialTransform(baseBounds);
  return (
    viewState.rotation === DEFAULT_ROTATION &&
    Math.abs(viewState.brightness - DEFAULT_BRIGHTNESS) < 0.001 &&
    Math.abs(viewState.contrast - DEFAULT_CONTRAST) < 0.001 &&
    Math.abs(viewState.transform.zoom - initialTransform.zoom) < 0.001 &&
    Math.abs(viewState.transform.x - initialTransform.x) < 0.5 &&
    Math.abs(viewState.transform.y - initialTransform.y) < 0.5
  );
}

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

/**
 * Calculates the zoom factor needed to fit the page width to the container viewport width.
 * Accounts for page rotation (0°, 90°, 180°, 270°). (AE-151)
 *
 * @param containerWidth Container viewport width in display pixels
 * @param baseBounds Rendered image bounds at 1.0x fit
 * @param rotation Rotation in degrees (e.g. 0, 90, 180, 270)
 * @param minZoom Minimum allowable zoom
 * @param maxZoom Maximum allowable zoom
 */
export function calculateFitWidthZoom(
  containerWidth: number,
  baseBounds: RenderedImageBounds,
  rotation = 0,
  minZoom = MIN_ZOOM_LEVEL,
  maxZoom = MAX_ZOOM_LEVEL
): number {
  if (containerWidth <= 0 || !baseBounds || baseBounds.width <= 0 || baseBounds.height <= 0) {
    return minZoom;
  }

  const normalizedRotation = ((Math.round(rotation) % 360) + 360) % 360;
  const isRotated90or270 = normalizedRotation === 90 || normalizedRotation === 270;
  const visualBaseWidth = isRotated90or270 ? baseBounds.height : baseBounds.width;

  if (visualBaseWidth <= 0) return minZoom;

  const rawZoom = containerWidth / visualBaseWidth;
  return Math.max(minZoom, Math.min(maxZoom, rawZoom));
}

export interface ActualSizeResult {
  /** Effective clamped zoom value to apply to the canvas */
  targetZoom: number;
  /** Whether the true actual-size zoom exceeded maxZoom or fell below minZoom and had to be clamped */
  isClamped: boolean;
  /** The unconstrained mathematical 1:1 actual-size zoom (1 / fitScale) */
  trueActualZoom: number;
}

/**
 * Calculates the actual-size (1:1 pixel mapping) zoom according to the FIT-RELATIVE zoom model. (AE-151)
 * In this model, true actual size is achieved when:
 *   displayScale = fitScale * interactiveZoom = 1.0
 *   => interactiveZoom = 1 / fitScale
 *
 * @param fitScale The base-fit scale applied from natural image pixels to canvas display pixels (baseBounds.scale)
 * @param minZoom Minimum allowable zoom
 * @param maxZoom Maximum allowable zoom
 */
export function calculateActualSizeZoom(
  fitScale: number,
  minZoom = MIN_ZOOM_LEVEL,
  maxZoom = MAX_ZOOM_LEVEL
): ActualSizeResult {
  if (fitScale <= 0) {
    return {
      targetZoom: minZoom,
      isClamped: false,
      trueActualZoom: minZoom,
    };
  }

  const trueActualZoom = 1 / fitScale;
  const targetZoom = Math.max(minZoom, Math.min(maxZoom, trueActualZoom));
  const isClamped = trueActualZoom > maxZoom || trueActualZoom < minZoom;

  return {
    targetZoom,
    isClamped,
    trueActualZoom,
  };
}

/**
 * Calculates a complete pan/zoom transform for Fit Width. (AE-151)
 * Positions the page horizontally fitting the container and aligns the top (y = 0)
 * if the fitted page is taller than the viewport, or centers it vertically if shorter.
 */
export function calculateFitWidthTransform(
  containerWidth: number,
  containerHeight: number,
  baseBounds: RenderedImageBounds,
  rotation = 0,
  minZoom = MIN_ZOOM_LEVEL,
  maxZoom = MAX_ZOOM_LEVEL
): PanZoomTransform {
  const zoom = calculateFitWidthZoom(containerWidth, baseBounds, rotation, minZoom, maxZoom);

  if (containerWidth <= 0 || containerHeight <= 0 || !baseBounds || baseBounds.width <= 0) {
    return { x: 0, y: 0, zoom };
  }

  const renderW = baseBounds.width * zoom;
  const renderH = baseBounds.height * zoom;

  const bounds = calculatePanBounds(containerWidth, containerHeight, renderW, renderH);

  // For fit-width:
  // x: 0 (or centered if renderW <= containerWidth)
  // y: 0 (top-aligned for document reading) clamped to valid pan bounds
  const targetX = renderW <= containerWidth ? (containerWidth - renderW) / 2 : 0;
  const targetY = renderH <= containerHeight ? (containerHeight - renderH) / 2 : 0;

  const clamped = clampPanPosition(targetX, targetY, bounds);

  return {
    x: clamped.x,
    y: clamped.y,
    zoom,
  };
}

/**
 * Calculates a complete pan/zoom transform for Actual Size (1:1 pixel mapping). (AE-151)
 * Centers the image horizontally and aligns top (or centered if fits) within pan bounds.
 */
export function calculateActualSizeTransform(
  containerWidth: number,
  containerHeight: number,
  baseBounds: RenderedImageBounds,
  fitScale: number,
  minZoom = MIN_ZOOM_LEVEL,
  maxZoom = MAX_ZOOM_LEVEL
): PanZoomTransform & { isClamped: boolean; trueActualZoom: number } {
  const { targetZoom, isClamped, trueActualZoom } = calculateActualSizeZoom(fitScale, minZoom, maxZoom);

  if (containerWidth <= 0 || containerHeight <= 0 || !baseBounds || baseBounds.width <= 0) {
    return { x: 0, y: 0, zoom: targetZoom, isClamped, trueActualZoom };
  }

  const renderW = baseBounds.width * targetZoom;
  const renderH = baseBounds.height * targetZoom;

  const bounds = calculatePanBounds(containerWidth, containerHeight, renderW, renderH);

  const targetX = renderW <= containerWidth ? (containerWidth - renderW) / 2 : (containerWidth - renderW) / 2;
  const targetY = renderH <= containerHeight ? (containerHeight - renderH) / 2 : 0;

  const clamped = clampPanPosition(targetX, targetY, bounds);

  return {
    x: clamped.x,
    y: clamped.y,
    zoom: targetZoom,
    isClamped,
    trueActualZoom,
  };
}
