import { createCanvas, loadImage, Image, type SKRSContext2D } from '@napi-rs/canvas';
import type {
  CheckAnnotation,
  CrossAnnotation,
  HighlightAnnotation,
  TextNoteAnnotation,
  MarkAnnotation,
} from '../lib/stampTool';
import type { FreehandStroke } from '../lib/penTool';
import type {
  SerializedPageAnnotations,
  SerializedAnnotationDocument,
} from '../lib/annotationSerialization';
import {
  DEFAULT_CHECK_COLOR,
  DEFAULT_CROSS_COLOR,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_HIGHLIGHT_OPACITY,
  DEFAULT_STAMP_SIZE,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_BG_COLOR,
  DEFAULT_TEXT_BORDER_COLOR,
} from '../lib/stampTool';

export type SupportedImageOutputFormat = 'png' | 'jpeg';

export interface CompositeAnnotationsOptions {
  /** Output format: 'png' (default) or 'jpeg' */
  format?: SupportedImageOutputFormat;
  /** JPEG quality between 1 and 100 (default: 90) when format is 'jpeg' */
  quality?: number;
  /**
   * Optional image loader override for testing/mocking without allocating huge buffers.
   * @internal
   */
  _imageLoader?: (buffer: Buffer) => Promise<Image | { width: number; height: number }>;
}

/**
 * Defensive resource bounds for the server-side annotation compositor.
 * Protects against memory exhaustion and oversized attacker-controlled payloads.
 */
export const MAX_COMPOSITOR_LONG_EDGE = 4096;
export const MAX_COMPOSITOR_PIXELS = 4096 * 4096; // 16,777,216 pixels
export const MAX_ANNOTATIONS_PER_PAGE = 500;
export const MAX_STROKES_PER_PAGE = 500;
export const MAX_STROKE_POINTS = 10000;
export const MAX_TEXT_NOTE_LENGTH = 2000;

/**
 * Server-side annotation compositor (AE-185 for AE-187 PDF export).
 * Composes serialized vector annotations and freehand strokes directly onto a base page image.
 *
 * Requirements:
 * - Natural image dimensions are preserved exactly.
 * - Annotations are rendered in invariant natural pixel coordinates.
 * - Z-order:
 *   1. Base page image
 *   2. Freehand strokes (rendered in order)
 *   3. Mark annotations (checks, crosses, highlights, text notes in array order)
 * - Returns a new Buffer without mutating source inputs or stored objects.
 */
export async function compositePageAnnotations(
  sourceImageBuffer: Buffer,
  pageAnnotations: SerializedPageAnnotations | null | undefined,
  options?: CompositeAnnotationsOptions
): Promise<Buffer> {
  if (!sourceImageBuffer || sourceImageBuffer.length === 0) {
    throw new Error('sourceImageBuffer is required and cannot be empty');
  }

  const loader = options?._imageLoader || loadImage;
  const img = await loader(sourceImageBuffer);
  const width = img.width;
  const height = img.height;

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid image dimensions: ${width}x${height}`);
  }

  // Guard against oversized decoded images before canvas allocation
  const longEdge = Math.max(width, height);
  const totalPixels = width * height;
  if (totalPixels > MAX_COMPOSITOR_PIXELS) {
    throw new Error(
      `Image pixel count (${totalPixels}px) exceeds maximum allowed compositor limit (${MAX_COMPOSITOR_PIXELS}px)`
    );
  }
  if (longEdge > MAX_COMPOSITOR_LONG_EDGE) {
    throw new Error(
      `Image long edge (${longEdge}px) exceeds maximum allowed compositor limit (${MAX_COMPOSITOR_LONG_EDGE}px)`
    );
  }

  if (pageAnnotations) {
    // Validate source natural dimensions if provided: fail closed on mismatch
    if (
      typeof pageAnnotations.naturalWidth === 'number' &&
      typeof pageAnnotations.naturalHeight === 'number' &&
      pageAnnotations.naturalWidth > 0 &&
      pageAnnotations.naturalHeight > 0
    ) {
      if (pageAnnotations.naturalWidth !== width || pageAnnotations.naturalHeight !== height) {
        throw new Error(
          `Composite dimension mismatch: annotation document was authored for ${pageAnnotations.naturalWidth}x${pageAnnotations.naturalHeight}, but image has natural dimensions ${width}x${height}`
        );
      }
    }

    // Defensive input count guards
    if (Array.isArray(pageAnnotations.annotations)) {
      if (pageAnnotations.annotations.length > MAX_ANNOTATIONS_PER_PAGE) {
        throw new Error(
          `Annotation count (${pageAnnotations.annotations.length}) exceeds maximum allowed per page (${MAX_ANNOTATIONS_PER_PAGE})`
        );
      }
      for (const ann of pageAnnotations.annotations) {
        if (ann && typeof ann === 'object' && ann.type === 'text') {
          const text = (ann as TextNoteAnnotation).text;
          if (typeof text === 'string' && text.length > MAX_TEXT_NOTE_LENGTH) {
            const annId = ann.id ? `Text annotation ${ann.id}` : 'Text annotation';
            throw new Error(
              `${annId} exceeds maximum allowed length of ${MAX_TEXT_NOTE_LENGTH} characters`
            );
          }
        }
      }
    }

    if (Array.isArray(pageAnnotations.strokes)) {
      if (pageAnnotations.strokes.length > MAX_STROKES_PER_PAGE) {
        throw new Error(
          `Stroke count (${pageAnnotations.strokes.length}) exceeds maximum allowed per page (${MAX_STROKES_PER_PAGE})`
        );
      }
      for (const stroke of pageAnnotations.strokes) {
        if (stroke && Array.isArray(stroke.points) && stroke.points.length > MAX_STROKE_POINTS) {
          const strokeId = stroke.id ? `Stroke ${stroke.id}` : 'Stroke';
          throw new Error(
            `${strokeId} has ${stroke.points.length} points, exceeding maximum allowed points (${MAX_STROKE_POINTS})`
          );
        }
      }
    }
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 1. Draw source image at natural dimensions
  ctx.drawImage(img as unknown as Image, 0, 0, width, height);

  if (pageAnnotations) {
    // 2. Render freehand pen strokes
    if (Array.isArray(pageAnnotations.strokes)) {
      for (const stroke of pageAnnotations.strokes) {
        renderFreehandStroke(ctx, stroke);
      }
    }

    // 3. Render mark annotations (checks, crosses, highlights, text notes)
    if (Array.isArray(pageAnnotations.annotations)) {
      for (const annotation of pageAnnotations.annotations) {
        renderMarkAnnotation(ctx, annotation);
      }
    }
  }

  const format = options?.format || 'png';
  if (format === 'jpeg') {
    const quality = options?.quality !== undefined ? options.quality : 90;
    return canvas.toBuffer('image/jpeg', quality);
  }

  return canvas.toBuffer('image/png');
}

/**
 * Convenience helper to composite a specific page from a complete SerializedAnnotationDocument.
 */
export async function compositeDocumentPageAnnotations(
  sourceImageBuffer: Buffer,
  document: SerializedAnnotationDocument | null | undefined,
  pageKey: string | number,
  options?: CompositeAnnotationsOptions
): Promise<Buffer> {
  const pageAnnotations = document?.pages?.[String(pageKey)] || null;
  return compositePageAnnotations(sourceImageBuffer, pageAnnotations, options);
}

/**
 * Calculates control points for a tension-smoothed curve segment.
 * Matches Konva.Line tension calculation.
 */
function getControlPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number
): [number, number, number, number] {
  const d01 = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
  const d12 = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const dSum = d01 + d12;
  if (dSum === 0) {
    return [x1, y1, x1, y1];
  }
  const fa = (t * d01) / dSum;
  const fb = (t * d12) / dSum;
  return [
    x1 - fa * (x2 - x0),
    y1 - fa * (y2 - y0),
    x1 + fb * (x2 - x0),
    y1 + fb * (y2 - y0),
  ];
}

/**
 * Expands line points into Bezier control points using Konva's cardinal spline algorithm.
 */
function expandPoints(p: number[], tension: number): number[] {
  const len = p.length;
  const allPoints: number[] = [];
  for (let n = 2; n < len - 2; n += 2) {
    const cp = getControlPoints(
      p[n - 2],
      p[n - 1],
      p[n],
      p[n + 1],
      p[n + 2],
      p[n + 3],
      tension
    );
    if (Number.isNaN(cp[0])) {
      continue;
    }
    allPoints.push(cp[0], cp[1], p[n], p[n + 1], cp[2], cp[3]);
  }
  return allPoints;
}

/**
 * Renders a single freehand stroke onto the 2D canvas context.
 * Matches PenLayer.tsx:
 * - points: [x0, y0, x1, y1, ...]
 * - lineCap: 'round', lineJoin: 'round'
 * - strokeWidth: stroke.strokeWidth
 * - stroke: stroke.color
 * - tension: 0.2 (cardinal spline smoothing matching Konva.Line)
 */
function renderFreehandStroke(
  ctx: SKRSContext2D,
  stroke: FreehandStroke
): void {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) {
    return;
  }

  const pts = stroke.points;
  const color = stroke.color || '#e11d48';
  const strokeWidth =
    typeof stroke.strokeWidth === 'number' && stroke.strokeWidth > 0
      ? stroke.strokeWidth
      : 3;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pts.length === 2) {
    // Single point / dot
    ctx.beginPath();
    ctx.arc(pts[0], pts[1], strokeWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    return;
  }

  if (pts.length === 4) {
    // Two points: simple straight line segment
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    ctx.lineTo(pts[2], pts[3]);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // 3 or more points: smooth using cardinal spline with tension: 0.2 (matching Konva PenLayer)
  const tension = 0.2;
  const tp = expandPoints(pts, tension);
  const len = tp.length;
  let n = 4;

  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  // Initial quadratic curve from first point through first control point
  ctx.quadraticCurveTo(tp[0], tp[1], tp[2], tp[3]);
  while (n < len - 2) {
    const cp1x = tp[n++];
    const cp1y = tp[n++];
    const cp2x = tp[n++];
    const cp2y = tp[n++];
    const x = tp[n++];
    const y = tp[n++];
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
  }
  // Terminal quadratic curve to final point
  ctx.quadraticCurveTo(
    tp[len - 2],
    tp[len - 1],
    pts[pts.length - 2],
    pts[pts.length - 1]
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * Renders a single mark annotation (check, cross, highlight, text) onto the canvas context.
 * Matches MarkLayer.tsx geometry, colors, and styling exactly.
 */
function renderMarkAnnotation(
  ctx: SKRSContext2D,
  annotation: MarkAnnotation
): void {
  if (!annotation || typeof annotation !== 'object') {
    return;
  }

  const x = Number(annotation.x);
  const y = Number(annotation.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  ctx.save();
  ctx.translate(x, y);

  switch (annotation.type) {
    case 'check': {
      const check = annotation as CheckAnnotation;
      const S = check.size || DEFAULT_STAMP_SIZE;
      const color = check.color || DEFAULT_CHECK_COLOR;

      // Konva check line points: [-S * 0.35, S * 0.05, -S * 0.05, S * 0.35, S * 0.45, -S * 0.35]
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(-S * 0.35, S * 0.05);
      ctx.lineTo(-S * 0.05, S * 0.35);
      ctx.lineTo(S * 0.45, -S * 0.35);
      ctx.stroke();
      break;
    }

    case 'cross': {
      const cross = annotation as CrossAnnotation;
      const S = cross.size || DEFAULT_STAMP_SIZE;
      const color = cross.color || DEFAULT_CROSS_COLOR;

      // Konva cross path: M -S*0.35 -S*0.35 L S*0.35 S*0.35 M S*0.35 -S*0.35 L -S*0.35 S*0.35
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(-S * 0.35, -S * 0.35);
      ctx.lineTo(S * 0.35, S * 0.35);
      ctx.moveTo(S * 0.35, -S * 0.35);
      ctx.lineTo(-S * 0.35, S * 0.35);
      ctx.stroke();
      break;
    }

    case 'highlight': {
      const hl = annotation as HighlightAnnotation;
      const width = Number(hl.width);
      const height = Number(hl.height);

      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        break;
      }

      const color = hl.color || DEFAULT_HIGHLIGHT_COLOR;
      const opacity =
        typeof hl.opacity === 'number' && Number.isFinite(hl.opacity)
          ? hl.opacity
          : DEFAULT_HIGHLIGHT_OPACITY;

      // Konva highlight-rect:
      // x: 0, y: 0, width, height, fill: color, opacity, stroke: '#ca8a04', strokeWidth: 1, cornerRadius: 2
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(0, 0, width, height, 2);
      ctx.fill();

      // Border stroke at 100% opacity matching Konva layer
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = '#ca8a04';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }

    case 'text': {
      const note = annotation as TextNoteAnnotation;
      const text = typeof note.text === 'string' ? note.text : '';
      if (!text) {
        break;
      }

      const fontSize =
        typeof note.fontSize === 'number' && note.fontSize > 0
          ? note.fontSize
          : DEFAULT_TEXT_FONT_SIZE;
      const fontColor = note.color || DEFAULT_TEXT_COLOR;
      const bgColor = note.backgroundColor || DEFAULT_TEXT_BG_COLOR;
      const borderColor = note.borderColor || DEFAULT_TEXT_BORDER_COLOR;
      const padding = 6;

      ctx.font = `${fontSize}px sans-serif`;

      // Measure text for background rectangle dimensions
      const lines = text.split('\n');
      let maxLineWidth = 0;
      for (const line of lines) {
        const measured = ctx.measureText(line).width;
        if (measured > maxLineWidth) {
          maxLineWidth = measured;
        }
      }

      // Height calculation: line height is fontSize (matching Konva.Text default lineHeight: 1 in MarkLayer.tsx)
      const lineHeight = fontSize;
      const contentHeight = lines.length * lineHeight;
      const totalWidth = maxLineWidth + padding * 2;
      const totalHeight = contentHeight + padding * 2;

      // Draw background sticky note box
      ctx.fillStyle = bgColor;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;

      // Subtle shadow matching Konva layer
      ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      ctx.beginPath();
      ctx.roundRect(0, 0, totalWidth, totalHeight, 4);
      ctx.fill();
      ctx.stroke();

      // Reset shadow before drawing text
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Draw text content with padding
      ctx.fillStyle = fontColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], padding, padding + i * lineHeight);
      }
      break;
    }

    default:
      // Unknown or unsupported annotation types are safely skipped
      break;
  }

  ctx.restore();
}
