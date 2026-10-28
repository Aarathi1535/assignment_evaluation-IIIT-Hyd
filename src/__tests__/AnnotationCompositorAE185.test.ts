import { describe, it, expect, beforeAll } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  compositePageAnnotations,
  compositeDocumentPageAnnotations,
  MAX_COMPOSITOR_LONG_EDGE,
  MAX_COMPOSITOR_PIXELS,
  MAX_ANNOTATIONS_PER_PAGE,
  MAX_STROKES_PER_PAGE,
  MAX_STROKE_POINTS,
  MAX_TEXT_NOTE_LENGTH,
} from '../services/AnnotationCompositor';
import { calculateImageFitBounds } from '../lib/annotations';
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

  // 13. Coordinate and rendering parity on standard portrait page (1654 x 2339)
  it('13. renders all annotation types with coordinate parity on a portrait page (1654 x 2339)', async () => {
    const pWidth = 1654;
    const pHeight = 2339;
    const pCanvas = createCanvas(pWidth, pHeight);
    const pCtx = pCanvas.getContext('2d');
    pCtx.fillStyle = '#ffffff';
    pCtx.fillRect(0, 0, pWidth, pHeight);
    const portraitBuffer = pCanvas.toBuffer('image/png');

    const check: CheckAnnotation = {
      id: 'p-check',
      pageKey: 1,
      type: 'check',
      x: Math.round(pWidth / 2),
      y: Math.round(pHeight / 2),
      size: 40,
      color: '#16a34a',
      createdAt: Date.now(),
    };

    const cross: CrossAnnotation = {
      id: 'p-cross',
      pageKey: 1,
      type: 'cross',
      x: 80,
      y: 90,
      size: 40,
      color: '#dc2626',
      createdAt: Date.now(),
    };

    const highlight: HighlightAnnotation = {
      id: 'p-hl',
      pageKey: 1,
      type: 'highlight',
      x: 1400,
      y: 2200,
      width: 200,
      height: 50,
      color: '#fde047',
      opacity: 0.5,
      createdAt: Date.now(),
    };

    const note: TextNoteAnnotation = {
      id: 'p-note',
      pageKey: 1,
      type: 'text',
      x: 300,
      y: 500,
      text: 'Portrait text',
      fontSize: 16,
      color: '#0f172a',
      backgroundColor: '#fef08a',
      borderColor: '#ca8a04',
      createdAt: Date.now(),
    };

    const stroke: FreehandStroke = {
      id: 'p-stroke',
      pageKey: 1,
      points: [500, 700, 520, 710, 540, 705, 560, 720],
      color: '#2563eb',
      strokeWidth: 4,
      createdAt: Date.now(),
    };

    const result = await compositePageAnnotations(portraitBuffer, {
      annotations: [check, cross, highlight, note],
      strokes: [stroke],
    });

    const img = await loadImage(result);
    // Explicit assertion: dimensions are strictly preserved and NOT swapped
    expect(img.width).toBe(pWidth);
    expect(img.height).toBe(pHeight);

    // Check vertex probe (center)
    const checkPixel = await getPixelAt(result, pWidth / 2 - 40 * 0.05, pHeight / 2 + 40 * 0.35);
    expect(checkPixel.g).toBeGreaterThan(100);

    // Cross center probe (top-left margin)
    const crossPixel = await getPixelAt(result, 80, 90);
    expect(crossPixel.r).toBeGreaterThan(150);

    // Highlight probe (bottom-right margin)
    const hlPixel = await getPixelAt(result, 1450, 2225);
    expect(hlPixel.b).toBeLessThan(255); // Tinted from pure white
    expect(hlPixel.r).toBeGreaterThan(200);

    // Text card probe (interior)
    const textPixel = await getPixelAt(result, 305, 505);
    expect(textPixel.r).toBeGreaterThan(200);
    expect(textPixel.g).toBeGreaterThan(200);

    // Pen stroke probe
    const strokePixel = await getPixelAt(result, 500, 700);
    expect(strokePixel.b).toBeGreaterThan(150);

    // Distant untouched pixel
    const pristinePixel = await getPixelAt(result, 1000, 200);
    expect(pristinePixel.r).toBe(255);
    expect(pristinePixel.g).toBe(255);
    expect(pristinePixel.b).toBe(255);
  });

  // 14. Coordinate and rendering parity on standard landscape page (2048 x 1448)
  it('14. renders all annotation types with coordinate parity on a landscape page (2048 x 1448)', async () => {
    const lWidth = 2048;
    const lHeight = 1448;
    const lCanvas = createCanvas(lWidth, lHeight);
    const lCtx = lCanvas.getContext('2d');
    lCtx.fillStyle = '#ffffff';
    lCtx.fillRect(0, 0, lWidth, lHeight);
    const landscapeBuffer = lCanvas.toBuffer('image/png');

    const check: CheckAnnotation = {
      id: 'l-check',
      pageKey: 1,
      type: 'check',
      x: Math.round(lWidth / 2),
      y: Math.round(lHeight / 2),
      size: 40,
      color: '#16a34a',
      createdAt: Date.now(),
    };

    const cross: CrossAnnotation = {
      id: 'l-cross',
      pageKey: 1,
      type: 'cross',
      x: 90,
      y: 70,
      size: 40,
      color: '#dc2626',
      createdAt: Date.now(),
    };

    const highlight: HighlightAnnotation = {
      id: 'l-hl',
      pageKey: 1,
      type: 'highlight',
      x: 500,
      y: 300,
      width: 150,
      height: 40,
      color: '#fde047',
      opacity: 0.5,
      createdAt: Date.now(),
    };

    const note: TextNoteAnnotation = {
      id: 'l-note',
      pageKey: 1,
      type: 'text',
      x: 1800,
      y: 1350,
      text: 'Landscape margin',
      fontSize: 14,
      color: '#0f172a',
      backgroundColor: '#fef08a',
      borderColor: '#ca8a04',
      createdAt: Date.now(),
    };

    const stroke: FreehandStroke = {
      id: 'l-stroke',
      pageKey: 1,
      points: [1200, 800, 1220, 810, 1240, 805, 1260, 820],
      color: '#2563eb',
      strokeWidth: 4,
      createdAt: Date.now(),
    };

    const result = await compositePageAnnotations(landscapeBuffer, {
      annotations: [check, cross, highlight, note],
      strokes: [stroke],
    });

    const img = await loadImage(result);
    // Explicit assertion: dimensions are strictly preserved and NOT swapped
    expect(img.width).toBe(lWidth);
    expect(img.height).toBe(lHeight);

    // Check vertex probe (center)
    const checkPixel = await getPixelAt(result, lWidth / 2 - 40 * 0.05, lHeight / 2 + 40 * 0.35);
    expect(checkPixel.g).toBeGreaterThan(100);

    // Cross center probe
    const crossPixel = await getPixelAt(result, 90, 70);
    expect(crossPixel.r).toBeGreaterThan(150);

    // Highlight probe
    const hlPixel = await getPixelAt(result, 550, 320);
    expect(hlPixel.b).toBeLessThan(255);

    // Text card probe near bottom right
    const textPixel = await getPixelAt(result, 1805, 1355);
    expect(textPixel.r).toBeGreaterThan(200);

    // Pen stroke probe
    const strokePixel = await getPixelAt(result, 1200, 800);
    expect(strokePixel.b).toBeGreaterThan(150);
  });

  // 15. Coordinate calculation parity vs viewer computeImageLayout
  it('15. produces 1:1 natural pixel alignment matching viewer layout bounds without offset or scaling', () => {
    // When the container matches natural image dimensions (as in PDF export full page render)
    const portraitBounds = calculateImageFitBounds(1654, 2339, 1654, 2339, 'natural');
    expect(portraitBounds.x).toBe(0);
    expect(portraitBounds.y).toBe(0);
    expect(portraitBounds.width).toBe(1654);
    expect(portraitBounds.height).toBe(2339);
    expect(portraitBounds.scale).toBe(1);

    const landscapeBounds = calculateImageFitBounds(2048, 1448, 2048, 1448, 'natural');
    expect(landscapeBounds.x).toBe(0);
    expect(landscapeBounds.y).toBe(0);
    expect(landscapeBounds.width).toBe(2048);
    expect(landscapeBounds.height).toBe(1448);
    expect(landscapeBounds.scale).toBe(1);
  });

  // 16. AE-179 repair dimension changes
  describe('AE-179 dimension repair handling', () => {
    it('rejects composition when page was repaired to different dimensions than recorded in document', async () => {
      // Document authored for 1654 x 2339
      const repairedPageAnnotations: SerializedPageAnnotations = {
        annotations: [],
        strokes: [],
        naturalWidth: 1654,
        naturalHeight: 2339,
      };

      // Base image is 400x400 (repaired / altered dimensions)
      await expect(
        compositePageAnnotations(baseImageBuffer, repairedPageAnnotations)
      ).rejects.toThrow(
        /Composite dimension mismatch: annotation document was authored for 1654x2339, but image has natural dimensions 400x400/
      );
    });

    it('preserves backward compatibility when naturalWidth/naturalHeight are omitted (legacy annotations)', async () => {
      const legacyAnnotations: SerializedPageAnnotations = {
        annotations: [
          {
            id: 'legacy-1',
            pageKey: 1,
            type: 'check',
            x: 100,
            y: 100,
            size: 30,
            color: '#16a34a',
            createdAt: Date.now(),
          },
        ],
        strokes: [],
      };

      // Legacy documents without dimensions do not throw and render at raw natural-pixel offsets
      const result = await compositePageAnnotations(baseImageBuffer, legacyAnnotations);
      const img = await loadImage(result);
      expect(img.width).toBe(WIDTH);
      expect(img.height).toBe(HEIGHT);
      const pixel = await getPixelAt(result, 100 - 30 * 0.05, 100 + 30 * 0.35);
      expect(pixel.g).toBeGreaterThan(100);
    });
  });

  // 17. Defensive Resource Limits
  describe('Defensive Resource Limits', () => {
    it('rejects image whose decoded long edge exceeds MAX_COMPOSITOR_LONG_EDGE', async () => {
      const mockLoader = async () => ({
        width: MAX_COMPOSITOR_LONG_EDGE + 1,
        height: 1000,
      });

      await expect(
        compositePageAnnotations(
          baseImageBuffer,
          { annotations: [], strokes: [] },
          { _imageLoader: mockLoader }
        )
      ).rejects.toThrow(
        new RegExp(`Image long edge \\(${MAX_COMPOSITOR_LONG_EDGE + 1}px\\) exceeds maximum allowed compositor limit \\(${MAX_COMPOSITOR_LONG_EDGE}px\\)`)
      );
    });

    it('rejects image whose decoded total pixels exceed MAX_COMPOSITOR_PIXELS', async () => {
      const mockLoader = async () => ({
        width: 4096,
        height: 4097, // 4096 * 4097 > 16,777,216
      });

      await expect(
        compositePageAnnotations(
          baseImageBuffer,
          { annotations: [], strokes: [] },
          { _imageLoader: mockLoader }
        )
      ).rejects.toThrow(
        new RegExp(`Image pixel count \\(\\d+px\\) exceeds maximum allowed compositor limit \\(${MAX_COMPOSITOR_PIXELS}px\\)`)
      );
    });

    it('rejects when annotation count exceeds MAX_ANNOTATIONS_PER_PAGE', async () => {
      const oversizedAnnotations: CheckAnnotation[] = Array.from(
        { length: MAX_ANNOTATIONS_PER_PAGE + 1 },
        (_, i) => ({
          id: `check-${i}`,
          pageKey: 1,
          type: 'check' as const,
          x: 100,
          y: 100,
          size: 30,
          color: '#16a34a',
          createdAt: Date.now(),
        })
      );

      await expect(
        compositePageAnnotations(baseImageBuffer, {
          annotations: oversizedAnnotations,
          strokes: [],
        })
      ).rejects.toThrow(
        new RegExp(`Annotation count \\(${MAX_ANNOTATIONS_PER_PAGE + 1}\\) exceeds maximum allowed per page \\(${MAX_ANNOTATIONS_PER_PAGE}\\)`)
      );
    });

    it('rejects when stroke count exceeds MAX_STROKES_PER_PAGE', async () => {
      const oversizedStrokes: FreehandStroke[] = Array.from(
        { length: MAX_STROKES_PER_PAGE + 1 },
        (_, i) => ({
          id: `stroke-${i}`,
          pageKey: 1,
          points: [10, 10, 20, 20],
          color: '#2563eb',
          strokeWidth: 2,
          createdAt: Date.now(),
        })
      );

      await expect(
        compositePageAnnotations(baseImageBuffer, {
          annotations: [],
          strokes: oversizedStrokes,
        })
      ).rejects.toThrow(
        new RegExp(`Stroke count \\(${MAX_STROKES_PER_PAGE + 1}\\) exceeds maximum allowed per page \\(${MAX_STROKES_PER_PAGE}\\)`)
      );
    });

    it('rejects when a stroke has more points than MAX_STROKE_POINTS', async () => {
      const hugeStroke: FreehandStroke = {
        id: 'stroke-overflow',
        pageKey: 1,
        points: new Array(MAX_STROKE_POINTS + 2).fill(10),
        color: '#2563eb',
        strokeWidth: 2,
        createdAt: Date.now(),
      };

      await expect(
        compositePageAnnotations(baseImageBuffer, {
          annotations: [],
          strokes: [hugeStroke],
        })
      ).rejects.toThrow(
        new RegExp(`Stroke stroke-overflow has ${MAX_STROKE_POINTS + 2} points, exceeding maximum allowed points \\(${MAX_STROKE_POINTS}\\)`)
      );
    });

    it('rejects when a text note exceeds MAX_TEXT_NOTE_LENGTH', async () => {
      const hugeNote: TextNoteAnnotation = {
        id: 'note-overflow',
        pageKey: 1,
        type: 'text',
        x: 50,
        y: 50,
        text: 'A'.repeat(MAX_TEXT_NOTE_LENGTH + 1),
        createdAt: Date.now(),
      };

      await expect(
        compositePageAnnotations(baseImageBuffer, {
          annotations: [hugeNote],
          strokes: [],
        })
      ).rejects.toThrow(
        new RegExp(`Text annotation note-overflow exceeds maximum allowed length of ${MAX_TEXT_NOTE_LENGTH} characters`)
      );
    });
  });

  // 18. Pen smoothing with Cardinal Spline tension: 0.2
  it('18. renders pen strokes smoothly using cardinal spline tension (0.2)', async () => {
    // 4 points forming a zigzag curve
    const stroke: FreehandStroke = {
      id: 'spline-stroke',
      pageKey: 1,
      points: [50, 100, 100, 50, 150, 150, 200, 100],
      color: '#2563eb',
      strokeWidth: 8,
      createdAt: Date.now(),
    };

    const result = await compositePageAnnotations(baseImageBuffer, {
      annotations: [],
      strokes: [stroke],
    });

    // Check that start and end points receive stroke color
    const startPixel = await getPixelAt(result, 50, 100);
    expect(startPixel.b).toBeGreaterThan(150);

    const endPixel = await getPixelAt(result, 200, 100);
    expect(endPixel.b).toBeGreaterThan(150);

    // Check intermediate vertex
    const midPixel = await getPixelAt(result, 100, 50);
    expect(midPixel.b).toBeGreaterThan(150);

    // Far pixel remains white
    const blank = await getPixelAt(result, 300, 300);
    expect(blank.r).toBe(255);
    expect(blank.g).toBe(255);
    expect(blank.b).toBe(255);
  });

  // 19. Multiline text note line-height parity (lineHeight = fontSize)
  it('19. adheres to lineHeight = fontSize (Konva default) in multiline text note cards', async () => {
    const fontSize = 14;
    const note: TextNoteAnnotation = {
      id: 'multiline-note',
      pageKey: 1,
      type: 'text',
      x: 100,
      y: 100,
      text: 'Line 1\nLine 2\nLine 3',
      fontSize,
      color: '#0f172a',
      backgroundColor: '#fef08a', // Yellow card
      borderColor: '#ca8a04',
      createdAt: Date.now(),
    };

    const result = await compositePageAnnotations(baseImageBuffer, {
      annotations: [note],
      strokes: [],
    });

    // With padding = 6:
    // With lineHeight = fontSize (14): cardHeight = 3 * 14 + 12 = 54px. Card extends from y=100 to y=154.
    // If the old fontSize * 1.2 had been used: cardHeight = 3 * 16.8 + 12 = 62.4px, extending to y=162.4.

    // Sample inside card at y = 150 (4px inside bottom boundary) -> should have card background color
    const insidePixel = await getPixelAt(result, 115, 150);
    expect(insidePixel.r).toBeGreaterThan(200);
    expect(insidePixel.g).toBeGreaterThan(200);
    expect(insidePixel.b).toBeLessThan(200); // Yellow card tint

    // Sample outside card at y = 158 (outside card with lineHeight = 14, but would be inside with old 1.2 multiplier)
    const outsidePixel = await getPixelAt(result, 115, 158);
    expect(outsidePixel.r).toBe(255);
    expect(outsidePixel.g).toBe(255);
    expect(outsidePixel.b).toBe(255);
  });
});
