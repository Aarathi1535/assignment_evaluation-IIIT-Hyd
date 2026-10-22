import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
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
}

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

  const img = await loadImage(sourceImageBuffer);
  const width = img.width;
  const height = img.height;

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid image dimensions: ${width}x${height}`);
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 1. Draw source image at natural dimensions
  ctx.drawImage(img, 0, 0, width, height);

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
 * Renders a single freehand stroke onto the 2D canvas context.
 * Matches PenLayer.tsx:
 * - points: [x0, y0, x1, y1, ...]
 * - lineCap: 'round', lineJoin: 'round'
 * - strokeWidth: stroke.strokeWidth
 * - stroke: stroke.color
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

  // Draw continuous line segments matching Konva.Line default rendering
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) {
    if (typeof pts[i] === 'number' && typeof pts[i + 1] === 'number') {
      ctx.lineTo(pts[i], pts[i + 1]);
    }
  }
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

      // Height calculation: line height is approximately fontSize * 1.2
      const lineHeight = fontSize * 1.2;
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
