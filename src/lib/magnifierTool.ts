/**
 * Magnifier / Loupe Mathematical Models and Coordinate Utilities (AE-152)
 *
 * Provides pure mathematical utilities for:
 * - Computing loupe source slice bounding boxes from pointer coordinates
 * - Positioning and clamping the loupe lens within canvas container boundaries
 * - Transforming pointer coordinates to invariant image space under 0°, 90°, 180°, 270° rotation
 */

import type { PanZoomTransform } from './panZoom';
import type { CanvasPoint, RenderedImageBounds } from './annotations';

export interface LoupeSourceRect {
  /** Top-left X coordinate of the source slice on the rendered stage canvas */
  sx: number;
  /** Top-left Y coordinate of the source slice on the rendered stage canvas */
  sy: number;
  /** Width of the source slice on the rendered stage canvas */
  sw: number;
  /** Height of the source slice on the rendered stage canvas */
  sh: number;
}

export interface LoupePlacement {
  /** Left CSS coordinate in pixels */
  x: number;
  /** Top CSS coordinate in pixels */
  y: number;
  /** Center X coordinate of the loupe lens */
  centerX: number;
  /** Center Y coordinate of the loupe lens */
  centerY: number;
}

export const DEFAULT_LOUPE_DIAMETER = 180; // 180px diameter lens
export const DEFAULT_LOUPE_MAGNIFICATION = 2.0; // 2.0x magnification

/**
 * Calculates the bounding box of the source canvas region to sample for the loupe.
 *
 * @param pointerX Pointer X coordinate in stage pixels
 * @param pointerY Pointer Y coordinate in stage pixels
 * @param diameter Diameter of the loupe lens in display pixels
 * @param magnification Magnification multiplier (e.g. 2.0 = 2x)
 */
export function calculateLoupeSourceRect(
  pointerX: number,
  pointerY: number,
  diameter = DEFAULT_LOUPE_DIAMETER,
  magnification = DEFAULT_LOUPE_MAGNIFICATION
): LoupeSourceRect {
  const safeMagnification = Math.max(1.0, magnification);
  const sw = diameter / safeMagnification;
  const sh = diameter / safeMagnification;
  const sx = pointerX - sw / 2;
  const sy = pointerY - sh / 2;

  return { sx, sy, sw, sh };
}

/**
 * Calculates the DOM placement of the loupe lens, centered over the pointer.
 * Optionally clamps position within container boundaries.
 *
 * @param pointerX Pointer X coordinate in container pixels
 * @param pointerY Pointer Y coordinate in container pixels
 * @param diameter Diameter of the loupe lens in display pixels
 * @param containerBounds Optional width/height of container to keep loupe within view
 */
export function calculateLoupePlacement(
  pointerX: number,
  pointerY: number,
  diameter = DEFAULT_LOUPE_DIAMETER,
  containerBounds?: { width: number; height: number }
): LoupePlacement {
  const radius = diameter / 2;
  let x = pointerX - radius;
  let y = pointerY - radius;

  if (containerBounds) {
    if (containerBounds.width >= diameter) {
      x = Math.max(0, Math.min(containerBounds.width - diameter, x));
    }
    if (containerBounds.height >= diameter) {
      y = Math.max(0, Math.min(containerBounds.height - diameter, y));
    }
  }

  return {
    x,
    y,
    centerX: pointerX,
    centerY: pointerY,
  };
}

/**
 * Maps a screen pointer coordinate to invariant image space under current pan, zoom, and rotation.
 * Ensures the loupe's center point corresponds to the exact invariant image coordinate.
 *
 * @param pointerX Screen X coordinate
 * @param pointerY Screen Y coordinate
 * @param transform Current pan and zoom transform
 * @param rotation Rotation in degrees (0, 90, 180, 270)
 * @param baseBounds Base fit rendered image bounds
 */
export function loupePointerToImageCoordinates(
  pointerX: number,
  pointerY: number,
  transform: PanZoomTransform,
  rotation = 0,
  baseBounds: RenderedImageBounds
): CanvasPoint {
  const zoom = transform.zoom || 1.0;
  if (baseBounds.width <= 0 || baseBounds.height <= 0 || zoom <= 0) {
    return { x: 0, y: 0 };
  }

  // 1. Remove pan offset and unscale interactive zoom
  const unpannedX = (pointerX - transform.x) / zoom;
  const unpannedY = (pointerY - transform.y) / zoom;

  // 2. Account for rotation if rotated around base center
  const normalizedRotation = ((Math.round(rotation) % 360) + 360) % 360;

  if (normalizedRotation === 0) {
    return { x: unpannedX, y: unpannedY };
  }

  const cx = baseBounds.width / 2;
  const cy = baseBounds.height / 2;
  const dx = unpannedX - cx;
  const dy = unpannedY - cy;

  const rad = (-normalizedRotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rotatedX = cx + (dx * cos - dy * sin);
  const rotatedY = cy + (dx * sin + dy * cos);

  return {
    x: Math.round(rotatedX * 100) / 100,
    y: Math.round(rotatedY * 100) / 100,
  };
}
