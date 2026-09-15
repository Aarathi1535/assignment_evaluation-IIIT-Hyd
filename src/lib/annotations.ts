/**
 * Annotation & Canvas Coordinate Normalization Utilities (AE-122)
 *
 * Provides pure mathematical utilities for transforming coordinates between:
 * - Normalized viewport space ([0, 1] relative to image dimensions)
 * - Canvas display pixels (accounting for container bounds, aspect ratio, and centering)
 * - MongoDB IPosition schema definitions
 *
 * NOTE: Contains ONLY mathematical transformations and type definitions.
 * Annotation persistence, grading business logic, drawing tools, and CRUD operations belong to AE-123+.
 */

import { IPosition } from '@/models/Annotation';

/**
 * Normalized 2D coordinate point within [0, 1] relative to page image dimensions.
 */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/**
 * Canvas coordinate point in physical display pixels.
 */
export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * Normalized rectangle within [0, 1] relative to page image dimensions.
 */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Canvas display rectangle in physical pixels.
 */
export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Image display bounds and scaling metrics within the canvas viewport.
 */
export interface RenderedImageBounds {
  /** X offset of the image inside the canvas stage */
  x: number;
  /** Y offset of the image inside the canvas stage */
  y: number;
  /** Rendered width on canvas in display pixels */
  width: number;
  /** Rendered height on canvas in display pixels */
  height: number;
  /** Scale factor applied from natural image dimensions to rendered dimensions */
  scale: number;
}

export type ImageFitMode = 'contain' | 'cover' | 'fill' | 'natural';

/**
 * Clamps a numeric value to the [0, 1] normalized interval.
 */
export function clampNormalized(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Calculates rendered dimensions and centered offset for an image inside a container.
 */
export function calculateImageFitBounds(
  containerWidth: number,
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  fitMode: ImageFitMode = 'contain'
): RenderedImageBounds {
  if (containerWidth <= 0 || containerHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0, scale: 1 };
  }

  if (fitMode === 'natural') {
    return {
      x: Math.max(0, (containerWidth - naturalWidth) / 2),
      y: Math.max(0, (containerHeight - naturalHeight) / 2),
      width: naturalWidth,
      height: naturalHeight,
      scale: 1,
    };
  }

  if (fitMode === 'fill') {
    return {
      x: 0,
      y: 0,
      width: containerWidth,
      height: containerHeight,
      scale: containerWidth / naturalWidth,
    };
  }

  const containerRatio = containerWidth / containerHeight;
  const imageRatio = naturalWidth / naturalHeight;

  let renderWidth: number;
  let renderHeight: number;
  let scale: number;

  if (fitMode === 'contain') {
    if (imageRatio > containerRatio) {
      renderWidth = containerWidth;
      renderHeight = containerWidth / imageRatio;
      scale = containerWidth / naturalWidth;
    } else {
      renderHeight = containerHeight;
      renderWidth = containerHeight * imageRatio;
      scale = containerHeight / naturalHeight;
    }
  } else {
    // 'cover'
    if (imageRatio > containerRatio) {
      renderHeight = containerHeight;
      renderWidth = containerHeight * imageRatio;
      scale = containerHeight / naturalHeight;
    } else {
      renderWidth = containerWidth;
      renderHeight = containerWidth / imageRatio;
      scale = containerWidth / naturalWidth;
    }
  }

  const x = (containerWidth - renderWidth) / 2;
  const y = (containerHeight - renderHeight) / 2;

  return {
    x,
    y,
    width: renderWidth,
    height: renderHeight,
    scale,
  };
}

/**
 * Converts a normalized coordinate point [0, 1] to canvas pixel coordinates.
 */
export function normalizedToCanvasPoint(
  norm: NormalizedPoint,
  bounds: RenderedImageBounds
): CanvasPoint {
  return {
    x: bounds.x + norm.x * bounds.width,
    y: bounds.y + norm.y * bounds.height,
  };
}

/**
 * Converts a canvas pixel coordinate to a normalized point [0, 1] relative to the image.
 */
export function canvasToNormalizedPoint(
  point: CanvasPoint,
  bounds: RenderedImageBounds
): NormalizedPoint {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: clampNormalized((point.x - bounds.x) / bounds.width),
    y: clampNormalized((point.y - bounds.y) / bounds.height),
  };
}

/**
 * Converts a normalized rectangle [0, 1] to canvas pixel bounds.
 */
export function normalizedToCanvasRect(
  normRect: NormalizedRect,
  bounds: RenderedImageBounds
): CanvasRect {
  return {
    x: bounds.x + normRect.x * bounds.width,
    y: bounds.y + normRect.y * bounds.height,
    width: normRect.width * bounds.width,
    height: normRect.height * bounds.height,
  };
}

/**
 * Converts a canvas display rect to a normalized rectangle [0, 1].
 */
export function canvasToNormalizedRect(
  canvasRect: CanvasRect,
  bounds: RenderedImageBounds
): NormalizedRect {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: clampNormalized((canvasRect.x - bounds.x) / bounds.width),
    y: clampNormalized((canvasRect.y - bounds.y) / bounds.height),
    width: Math.max(0, Math.min(1, canvasRect.width / bounds.width)),
    height: Math.max(0, Math.min(1, canvasRect.height / bounds.height)),
  };
}

/**
 * Converts an IPosition database record into a normalized rectangle.
 */
export function positionToNormalizedRect(position: IPosition): NormalizedRect {
  return {
    x: clampNormalized(position.x),
    y: clampNormalized(position.y),
    width: position.width !== undefined ? clampNormalized(position.width) : 0,
    height: position.height !== undefined ? clampNormalized(position.height) : 0,
  };
}

/**
 * Converts a NormalizedRect into an IPosition object for persistence in MongoDB.
 */
export function normalizedRectToPosition(rect: NormalizedRect): IPosition {
  return {
    x: clampNormalized(rect.x),
    y: clampNormalized(rect.y),
    width: rect.width > 0 ? clampNormalized(rect.width) : undefined,
    height: rect.height > 0 ? clampNormalized(rect.height) : undefined,
  };
}
