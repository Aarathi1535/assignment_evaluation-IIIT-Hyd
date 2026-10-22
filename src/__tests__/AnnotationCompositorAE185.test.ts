import { describe, it, expect, beforeAll } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  compositePageAnnotations,
  compositeDocumentPageAnnotations,
} from '../services/AnnotationCompositor';
import type {
  CheckAnnotation,
  CrossAnnotation,
  HighlightAnnotation,
  TextNoteAnnotation,
} from '../lib/stampTool';
import type { FreehandStroke } from '../lib/penTool';
import type {
  SerializedPageAnnotations,
  SerializedAnnotationDocument,
} from '../lib/annotationSerialization';

describe('AE-185: Server-side Annotation Compositor for PDF Export (#252)', () => {
  const WIDTH = 400;
  const HEIGHT = 400;
  let baseImageBuffer: Buffer;

  beforeAll(() => {
    // Generate clean pure white 400x400 source image
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    baseImageBuffer = canvas.toBuffer('image/png');
  });

  // Helper to sample a pixel from an image buffer
  async function getPixelAt(
    buffer: Buffer,
    x: number,
    y: number
  ): Promise<{ r: number; g: number; b: number; a: number }> {
    const img = await loadImage(buffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] };
  }

  // 1. Output dimensions match input dimensions exactly
  it('1. preserves exact natural dimensions and image format options', async () => {
    const pageAnnotations: SerializedPageAnnotations = {
      annotations: [],
      strokes: [],
    };

    // PNG output
    const pngResult = await compositePageAnnotations(baseImageBuffer, pageAnnotations);
    const pngImg = await loadImage(pngResult);
    expect(pngImg.width).toBe(WIDTH);
    expect(pngImg.height).toBe(HEIGHT);
    // PNG magic bytes: 0x89 0x50 0x4E 0x47
    expect(pngResult[0]).toBe(0x89);
    expect(pngResult[1]).toBe(0x50);

    // JPEG output
    const jpegResult = await compositePageAnnotations(baseImageBuffer, pageAnnotations, {
      format: 'jpeg',
      quality: 85,
    });
    const jpegImg = await loadImage(jpegResult);
    expect(jpegImg.width).toBe(WIDTH);
    expect(jpegImg.height).toBe(HEIGHT);
    // JPEG magic bytes: 0xFF 0xD8 0xFF
    expect(jpegResult[0]).toBe(0xff);
    expect(jpegResult[1]).toBe(0xd8);
    expect(jpegResult[2]).toBe(0xff);
  });

  // 2. Source buffer is never mutated
  it('2. does not mutate source buffer or input annotation objects', async () => {
    const sourceCopy = Buffer.from(baseImageBuffer);
    const annotation: CheckAnnotation = {
      id: 'check-1',
      pageKey: 1,
      type: 'check',
      x: 100,
      y: 100,
      size: 30,
      color: '#16a34a',
      createdAt: 1000,
    };
    const stroke: FreehandStroke = {
      id: 'stroke-1',
      pageKey: 1,
      points: [50, 50, 60, 60],
      color: '#e11d48',
      strokeWidth: 4,
      createdAt: 1000,
    };

    const annBefore = JSON.stringify(annotation);
    const strokeBefore = JSON.stringify(stroke);

    const result = await compositePageAnnotations(baseImageBuffer, {
      annotations: [annotation],
      strokes: [stroke],
    });

    expect(baseImageBuffer.equals(sourceCopy)).toBe(true);
    expect(result.equals(baseImageBuffer)).toBe(false);
    expect(JSON.stringify(annotation)).toBe(annBefore);
    expect(JSON.stringify(stroke)).toBe(strokeBefore);
  });

  // 3. Check mark (✓) geometry and placement
  it('3. renders check mark (✓) matching client MarkLayer geometry at exact coordinates', async () => {
    const cx = 100;
    const cy = 100;
    const S = 40;
    const color = '#16a34a'; // Green

    const check: CheckAnnotation = {
      id: 'check-geo',
      pageKey: 1,
      type: 'check',
      x: cx,
      y: cy,
      size: S,
      color,
      createdAt: Date.now(),
    };

    const result = await compositePageAnnotations(baseImageBuffer, {
      annotations: [check],
      strokes: [],
    });

    // Client geometry:
    // P1 = (cx - S * 0.35, cy + S * 0.05) = (86, 102)
    // Vertex = (cx - S * 0.05, cy + S * 0.35) = (98, 114)
    // P3 = (cx + S * 0.45, cy - S * 0.35) = (118, 86)
    const vertexPixel = await getPixelAt(result, cx - S * 0.05, cy + S * 0.35);
    const p3Pixel = await getPixelAt(result, cx + S * 0.45, cy - S * 0.35);

    // Green color has significant green component and lower red component
    expect(vertexPixel.g).toBeGreaterThan(100);
    expect(vertexPixel.r).toBeLessThan(100);
    expect(p3Pixel.g).toBeGreaterThan(100);
    expect(p3Pixel.r).toBeLessThan(100);

    // Far away coordinate remains untouched white
    const distantPixel = await getPixelAt(result, 250, 250);
    expect(distantPixel.r).toBe(255);
    expect(distantPixel.g).toBe(255);
    expect(distantPixel.b).toBe(255);
  });

  // 4. Cross mark (✗) geometry and placement
  it('4. renders cross mark (✗) matching client MarkLayer geometry at exact coordinates', async () => {
    const cx = 200;
    const cy = 200;
    const S = 40;
    const color = '#dc2626'; // Red

    const cross: CrossAnnotation = {
      id: 'cross-geo',
      pageKey: 1,
      type: 'cross',
      x: cx,
      y: cy,
      size: S,
      color,
      createdAt: Date.now(),
    };

    const result = await compositePageAnnotations(baseImageBuffer, {
      annotations: [cross],
      strokes: [],
    });

    // Cross center point (cx, cy) = (200, 200)
    const centerPixel = await getPixelAt(result, cx, cy);
    // Red mark: high red, lower green/blue
    expect(centerPixel.r).toBeGreaterThan(180);
    expect(centerPixel.g).toBeLessThan(100);
    expect(centerPixel.b).toBeLessThan(100);

    // Corner point: (cx - S * 0.35, cy - S * 0.35) = (186, 186)
    const cornerPixel = await getPixelAt(result, cx - S * 0.35, cy - S * 0.35);
    expect(cornerPixel.r).toBeGreaterThan(150);
    expect(cornerPixel.g).toBeLessThan(100);
  });

  // 5. Highlight box opacity and dimensions
  it('5. renders highlight rectangle with transparency and border matching client MarkLayer', async () => {
    const hx = 50;
    const hy = 50;
    const hw = 100;
    const hh = 40;
    const color = '#fde047'; // Yellow
    const opacity = 0.35;

    const highlight: HighlightAnnotation = {
      id: 'hl-1',
      pageKey: 1,
      type: 'highlight',
      x: hx,
      y: hy,
      width: hw,
      height: hh,
      color,
      opacity,
      createdAt: Date.now(),
    };

    const result = await compositePageAnnotations(baseImageBuffer, {
      annotations: [highlight],
      strokes: [],
    });

    // Inside the highlight box (semi-transparent yellow blended on white)
    const insidePixel = await getPixelAt(result, hx + hw / 2, hy + hh / 2);
    // Blended yellow: Red ~254, Green ~244, Blue ~191
    expect(insidePixel.r).toBeGreaterThan(240);
    expect(insidePixel.g).toBeGreaterThan(230);
    expect(insidePixel.b).toBeLessThan(210); // Less blue indicates yellow tint
    expect(insidePixel.b).toBeGreaterThan(150); // But not completely dark

    // Outside the highlight box remains pure white
    const outsidePixel = await getPixelAt(result, hx + hw + 10, hy + hh + 10);
    expect(outsidePixel.r).toBe(255);
    expect(outsidePixel.g).toBe(255);
    expect(outsidePixel.b).toBe(255);
  });

  // 6. Text note annotation
  it('6. renders text note with styled background box and text content', async () => {
    const tx = 60;
    const ty = 60;

    const textNote: TextNoteAnnotation = {
      id: 'text-1',
      pageKey: 1,
      type: 'text',
      x: tx,
      y: ty,
      text: 'Good proof',
      fontSize: 14,
      color: '#0f172a',
      backgroundColor: '#fef9c3',
      borderColor: '#fde047',
      createdAt: Date.now(),
    };

    const result = await compositePageAnnotations(baseImageBuffer, {
      annotations: [textNote],
      strokes: [],
    });

    // Padding is 6px, so (tx + 2, ty + 2) is inside the sticky note background
    const bgPixel = await getPixelAt(result, tx + 3, ty + 3);
    // #fef9c3 = (254, 249, 195)
    expect(bgPixel.r).toBeGreaterThan(245);
    expect(bgPixel.g).toBeGreaterThan(240);
    expect(bgPixel.b).toBeLessThan(215);

    // Coordinate far outside note remains pure white
    const distantPixel = await getPixelAt(result, 300, 300);
    expect(distantPixel.r).toBe(255);
    expect(distantPixel.g).toBe(255);
    expect(distantPixel.b).toBe(255);
  });

  // 7. Freehand pen strokes
  it('7. renders freehand pen stroke segments and single-point dots', async () => {
    const stroke: FreehandStroke = {
      id: 'stroke-multi',
      pageKey: 1,
      points: [100, 100, 150, 100, 200, 150],
      color: '#2563eb', // Blue
      strokeWidth: 6,
      createdAt: Date.now(),
    };

    const dotStroke: FreehandStroke = {
      id: 'stroke-dot',
      pageKey: 1,
      points: [300, 300],
      color: '#dc2626', // Red
      strokeWidth: 8,
      createdAt: Date.now(),
    };

    const result = await compositePageAnnotations(baseImageBuffer, {
      annotations: [],
      strokes: [stroke, dotStroke],
    });

    // On stroke segment: (125, 100) should be blue
    const bluePixel = await getPixelAt(result, 125, 100);
    expect(bluePixel.b).toBeGreaterThan(180);
    expect(bluePixel.r).toBeLessThan(100);

    // On dot center: (300, 300) should be red
    const redPixel = await getPixelAt(result, 300, 300);
    expect(redPixel.r).toBeGreaterThan(180);
    expect(redPixel.b).toBeLessThan(100);
  });

  // 8. Empty annotations and null/undefined handling
  it('8. handles empty, null, or undefined annotations gracefully', async () => {
    const resNull = await compositePageAnnotations(baseImageBuffer, null);
    expect(resNull.length).toBeGreaterThan(0);

    const resUndefined = await compositePageAnnotations(baseImageBuffer, undefined);
    expect(resUndefined.length).toBeGreaterThan(0);

    const resEmpty = await compositePageAnnotations(baseImageBuffer, {
      annotations: [],
      strokes: [],
    });
    expect(resEmpty.length).toBeGreaterThan(0);

    // With no annotations, pixels remain identical to white base image
    const pixel = await getPixelAt(resEmpty, 100, 100);
    expect(pixel.r).toBe(255);
    expect(pixel.g).toBe(255);
    expect(pixel.b).toBe(255);
  });

  // 9. Malformed and unsupported annotation entries are safely skipped
  it('9. safely ignores malformed entries, invalid coordinates, or unsupported mark types', async () => {
    const malformedList: unknown[] = [
      null,
      undefined,
      {},
      { type: 'unsupported_gadget', x: 50, y: 50 },
      { type: 'check', x: NaN, y: 50 },
      { type: 'highlight', x: 50, y: 50, width: -10, height: 20 },
      { type: 'text', x: 50, y: 50, text: '' }, // empty text
    ];

    const malformedStrokes: unknown[] = [
      null,
      {},
      { points: [10] }, // insufficient points
      { points: 'not-an-array' },
    ];

    const result = await compositePageAnnotations(baseImageBuffer, {
      annotations: malformedList as SerializedPageAnnotations['annotations'],
      strokes: malformedStrokes as SerializedPageAnnotations['strokes'],
    });

    expect(result.length).toBeGreaterThan(0);
    // Image remains unchanged white since invalid entries were skipped
    const pixel = await getPixelAt(result, 50, 50);
    expect(pixel.r).toBe(255);
    expect(pixel.g).toBe(255);
    expect(pixel.b).toBe(255);
  });

  // 10. Edge-position annotations (partial clipping at bounds without throwing)
  it('10. handles edge-position annotations at image boundaries safely', async () => {
    const edgeCheck: CheckAnnotation = {
      id: 'edge-check',
      pageKey: 1,
      type: 'check',
      x: 0,
      y: 0,
      size: 30,
      color: '#16a34a',
      createdAt: Date.now(),
    };

    const cornerHighlight: HighlightAnnotation = {
      id: 'corner-hl',
      pageKey: 1,
      type: 'highlight',
      x: WIDTH - 20,
      y: HEIGHT - 20,
      width: 50, // Extends past canvas edge
      height: 50,
      color: '#fde047',
      opacity: 0.5,
      createdAt: Date.now(),
    };

    const edgeStroke: FreehandStroke = {
      id: 'edge-stroke',
      pageKey: 1,
      points: [-10, -10, 50, 50],
      color: '#2563eb',
      strokeWidth: 4,
      createdAt: Date.now(),
    };

    const result = await compositePageAnnotations(baseImageBuffer, {
      annotations: [edgeCheck, cornerHighlight],
      strokes: [edgeStroke],
    });

    const img = await loadImage(result);
    expect(img.width).toBe(WIDTH);
    expect(img.height).toBe(HEIGHT);
  });

  // 11. compositeDocumentPageAnnotations convenience helper
  it('11. composites annotations from a multi-page SerializedAnnotationDocument', async () => {
    const doc: SerializedAnnotationDocument = {
      version: 1,
      pages: {
        'page-1': {
          annotations: [
            {
              id: 'c1',
              pageKey: 'page-1',
              type: 'check',
              x: 100,
              y: 100,
              size: 30,
              color: '#16a34a',
              createdAt: Date.now(),
            },
          ],
          strokes: [],
        },
        'page-2': {
          annotations: [
            {
              id: 'x1',
              pageKey: 'page-2',
              type: 'cross',
              x: 200,
              y: 200,
              size: 30,
              color: '#dc2626',
              createdAt: Date.now(),
            },
          ],
          strokes: [],
        },
      },
    };

    // Composite page-1: should have green check at (100, 100) and no cross at (200, 200)
    const resultPage1 = await compositeDocumentPageAnnotations(baseImageBuffer, doc, 'page-1');
    const pixelPage1Check = await getPixelAt(resultPage1, 100 - 30 * 0.05, 100 + 30 * 0.35);
    expect(pixelPage1Check.g).toBeGreaterThan(100);

    const pixelPage1Blank = await getPixelAt(resultPage1, 200, 200);
    expect(pixelPage1Blank.r).toBe(255);
    expect(pixelPage1Blank.g).toBe(255);
    expect(pixelPage1Blank.b).toBe(255);
  });

  // 12. Input validation for invalid buffers
  it('12. throws on empty or invalid source buffer', async () => {
    await expect(
      compositePageAnnotations(Buffer.alloc(0), { annotations: [], strokes: [] })
    ).rejects.toThrow('sourceImageBuffer is required and cannot be empty');

    await expect(
      compositePageAnnotations(Buffer.from('not-an-image'), { annotations: [], strokes: [] })
    ).rejects.toThrow();
  });
});
