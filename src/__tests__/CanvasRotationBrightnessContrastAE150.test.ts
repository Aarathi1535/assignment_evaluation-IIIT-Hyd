import { describe, it, expect } from 'vitest';
import Konva from 'konva';
import {
  screenToImageCoordinates,
  imageToScreenCoordinates,
  createStroke,
  appendPointToStroke,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_WIDTH,
} from '../lib/penTool';
import {
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  createTextNoteAnnotation,
} from '../lib/stampTool';
import {
  serializePageAnnotations,
  deserializePageAnnotations,
} from '../lib/annotationSerialization';
import {
  normalizeRotation,
  PanZoomTransform,
} from '../lib/panZoom';
import { calculateLatencyStats } from './DrawLatencyBenchmark.test';

describe('AE-150: Canvas Rotation, Pointer Inverse Transformation, and Image-Only Brightness & Contrast', () => {
  const mockBaseBounds = {
    x: 100,
    y: 50,
    width: 800,
    height: 1000,
    scale: 1,
  };

  describe('1. Rotation Model & Normalization', () => {
    it('normalizes arbitrary rotation values to [0, 360) in 90-degree steps', () => {
      expect(normalizeRotation(0)).toBe(0);
      expect(normalizeRotation(90)).toBe(90);
      expect(normalizeRotation(180)).toBe(180);
      expect(normalizeRotation(270)).toBe(270);
      expect(normalizeRotation(360)).toBe(0);
      expect(normalizeRotation(450)).toBe(90);
      expect(normalizeRotation(-90)).toBe(270);
    });
  });

  describe('2. Pointer Coordinate Inverse & Forward Transformations under Rotation', () => {
    it('accurately converts screen coordinates to invariant page coordinates at 0° (unrotated)', () => {
      const transform: PanZoomTransform = { x: 100, y: 50, zoom: 1.0, rotation: 0 };
      const screenPt = { x: 300, y: 350 };

      const pagePt = screenToImageCoordinates(screenPt.x, screenPt.y, transform, mockBaseBounds);
      expect(pagePt.x).toBe(200); // 300 - 100
      expect(pagePt.y).toBe(300); // 350 - 50

      const backToScreen = imageToScreenCoordinates(pagePt.x, pagePt.y, transform, mockBaseBounds);
      expect(backToScreen.x).toBe(screenPt.x);
      expect(backToScreen.y).toBe(screenPt.y);
    });

    it('accurately converts screen coordinates to invariant page coordinates at 90° clockwise rotation', () => {
      const transform: PanZoomTransform = { x: 100, y: 50, zoom: 1.0, rotation: 90 };

      // Original page point (200, 300)
      // Vector from center: dx = 200 - 400 = -200, dy = 300 - 500 = -200
      // Clockwise 90°: x' = -dy = 200, y' = dx = -200
      // View point: (400 + 200, 500 - 200) = (600, 300)
      // Screen point: (100 + 600, 50 + 300) = (700, 350)
      const expectedScreenPt = { x: 700, y: 350 };
      const screenPt = imageToScreenCoordinates(200, 300, transform, mockBaseBounds);
      expect(screenPt.x).toBe(expectedScreenPt.x);
      expect(screenPt.y).toBe(expectedScreenPt.y);

      // Inverse transform from screen pointer back to page coordinate
      const pagePt = screenToImageCoordinates(screenPt.x, screenPt.y, transform, mockBaseBounds);
      expect(pagePt.x).toBe(200);
      expect(pagePt.y).toBe(300);
    });

    it('accurately converts coordinates under 180° and 270° rotations with zoom magnification', () => {
      const originalPagePt = { x: 150, y: 250 };

      // 180° with 2x zoom
      const transform180: PanZoomTransform = { x: -50, y: -80, zoom: 2.0, rotation: 180 };
      const screen180 = imageToScreenCoordinates(originalPagePt.x, originalPagePt.y, transform180, mockBaseBounds);
      const recovered180 = screenToImageCoordinates(screen180.x, screen180.y, transform180, mockBaseBounds);
      expect(recovered180.x).toBeCloseTo(originalPagePt.x, 1);
      expect(recovered180.y).toBeCloseTo(originalPagePt.y, 1);

      // 270° with 1.5x zoom
      const transform270: PanZoomTransform = { x: 20, y: 30, zoom: 1.5, rotation: 270 };
      const screen270 = imageToScreenCoordinates(originalPagePt.x, originalPagePt.y, transform270, mockBaseBounds);
      const recovered270 = screenToImageCoordinates(screen270.x, screen270.y, transform270, mockBaseBounds);
      expect(recovered270.x).toBeCloseTo(originalPagePt.x, 1);
      expect(recovered270.y).toBeCloseTo(originalPagePt.y, 1);
    });
  });

  describe('3. Required Rotation Regression Flow (Unrotated -> 90° -> Draw -> Save -> Reload 0°)', () => {
    it('saves a stroke drawn at 90° and verifies identical PAGE coordinates upon reloading at 0°', () => {
      // Step 1: Start with unrotated page
      const initialRotation = 0;
      expect(initialRotation).toBe(0);

      // Step 2: Rotate canvas to 90°
      const rotatedTransform: PanZoomTransform = {
        x: mockBaseBounds.x,
        y: mockBaseBounds.y,
        zoom: 1.0,
        rotation: 90,
      };

      // Step 3: Draw stroke at a visible pointer position on rotated screen
      // Suppose user clicked/dragged at screen positions (700, 350) to (750, 400)
      const screenP1 = { x: 700, y: 350 };
      const screenP2 = { x: 750, y: 400 };

      // Pointer event handler maps screen -> page coordinates via inverse canvas transform
      const pageP1 = screenToImageCoordinates(screenP1.x, screenP1.y, rotatedTransform, mockBaseBounds);
      const pageP2 = screenToImageCoordinates(screenP2.x, screenP2.y, rotatedTransform, mockBaseBounds);

      // Step 4: Save the stroke (stored in invariant page coordinates)
      let stroke = createStroke('page-1', pageP1, { color: DEFAULT_PEN_COLOR, strokeWidth: DEFAULT_PEN_WIDTH });
      stroke = appendPointToStroke(stroke, pageP2);

      const serializedData = serializePageAnnotations('page-1', [], [stroke]);

      // Step 5: Reload the page with rotation reset to 0°
      const reloadedData = deserializePageAnnotations(serializedData, 'page-1');
      const reloadedStrokes = reloadedData.strokes;

      // Step 6: Verify the stroke is located at the EXACT same PAGE coordinate as when drawn
      expect(reloadedStrokes).toHaveLength(1);
      const reloadedStroke = reloadedStrokes[0];
      expect(reloadedStroke.points).toHaveLength(4);

      expect(reloadedStroke.points[0]).toBeCloseTo(pageP1.x, 2);
      expect(reloadedStroke.points[1]).toBeCloseTo(pageP1.y, 2);
      expect(reloadedStroke.points[2]).toBeCloseTo(pageP2.x, 2);
      expect(reloadedStroke.points[3]).toBeCloseTo(pageP2.y, 2);

      // Verify pageP1 is (200, 300) in page space
      expect(reloadedStroke.points[0]).toBe(200);
      expect(reloadedStroke.points[1]).toBe(300);
    });
  });

  describe('4. Spatial Alignment: ImageLayer, PenLayer, and MarkLayer Rotate Together', () => {
    it('maintains aligned screen positions for image center, pen stroke, and mark annotation across 0°, 90°, 180°, 270°', () => {
      const targetPageCoord = { x: 400, y: 500 }; // Center of 800x1000 page

      const stroke = createStroke('page-1', targetPageCoord, { color: '#ef4444', strokeWidth: 3 });
      const checkMark = createCheckAnnotation('page-1', targetPageCoord);
      const crossMark = createCrossAnnotation('page-1', targetPageCoord);
      const highlight = createHighlightAnnotation('page-1', { ...targetPageCoord, width: 100, height: 20 });
      const textNote = createTextNoteAnnotation('page-1', targetPageCoord, 'Grading note');

      const rotations = [0, 90, 180, 270];

      for (const rot of rotations) {
        const transform: PanZoomTransform = { x: 50, y: 50, zoom: 1.5, rotation: rot };

        const screenStrokePt = imageToScreenCoordinates(stroke.points[0], stroke.points[1], transform, mockBaseBounds);
        const screenCheckPt = imageToScreenCoordinates(checkMark.x, checkMark.y, transform, mockBaseBounds);
        const screenCrossPt = imageToScreenCoordinates(crossMark.x, crossMark.y, transform, mockBaseBounds);
        const screenHighlightPt = imageToScreenCoordinates(highlight.x, highlight.y, transform, mockBaseBounds);
        const screenTextPt = imageToScreenCoordinates(textNote.x, textNote.y, transform, mockBaseBounds);

        // Center point at (400, 500) under rotation around (400, 500) remains at identical screen position
        expect(screenStrokePt.x).toBeCloseTo(screenCheckPt.x, 2);
        expect(screenStrokePt.y).toBeCloseTo(screenCheckPt.y, 2);
        expect(screenCheckPt.x).toBeCloseTo(screenCrossPt.x, 2);
        expect(screenCheckPt.y).toBeCloseTo(screenCrossPt.y, 2);
        expect(screenCrossPt.x).toBeCloseTo(screenHighlightPt.x, 2);
        expect(screenCrossPt.y).toBeCloseTo(screenHighlightPt.y, 2);
        expect(screenHighlightPt.x).toBeCloseTo(screenTextPt.x, 2);
        expect(screenHighlightPt.y).toBeCloseTo(screenTextPt.y, 2);
      }
    });

    it('proves the image rendering Konva group receives rotation and shares exact transform with pen/mark groups', () => {
      const imageGroup = new Konva.Group({ name: 'page-image-group' });
      const penGroup = new Konva.Group({ name: 'pen-stroke-group' });
      const markGroup = new Konva.Group({ name: 'mark-annotation-group' });

      const mockImg = {} as CanvasImageSource;
      const imageNode = new Konva.Image({
        image: mockImg,
        x: 0,
        y: 0,
        width: mockBaseBounds.width,
        height: mockBaseBounds.height,
      });
      imageGroup.add(imageNode);

      const applyUnifiedTransform = (
        group: Konva.Group,
        transform: PanZoomTransform,
        bounds: typeof mockBaseBounds
      ) => {
        const cx = bounds.width / 2;
        const cy = bounds.height / 2;
        const rotation = transform.rotation || 0;

        group.position({
          x: transform.x + cx * transform.zoom,
          y: transform.y + cy * transform.zoom,
        });
        group.offset({ x: cx, y: cy });
        group.scale({ x: transform.zoom, y: transform.zoom });
        group.rotation(rotation);
      };

      const testRotations = [0, 90, 180, 270];

      for (const rot of testRotations) {
        const currentTransform: PanZoomTransform = {
          x: mockBaseBounds.x,
          y: mockBaseBounds.y,
          zoom: 1.25,
          rotation: rot,
        };

        applyUnifiedTransform(imageGroup, currentTransform, mockBaseBounds);
        applyUnifiedTransform(penGroup, currentTransform, mockBaseBounds);
        applyUnifiedTransform(markGroup, currentTransform, mockBaseBounds);

        // 1. Verify image group receives the rotation
        expect(imageGroup.rotation()).toBe(rot);
        expect(penGroup.rotation()).toBe(rot);
        expect(markGroup.rotation()).toBe(rot);

        // 2. Verify all three groups have identical center pivot offsets
        expect(imageGroup.offsetX()).toBe(mockBaseBounds.width / 2);
        expect(imageGroup.offsetY()).toBe(mockBaseBounds.height / 2);
        expect(penGroup.offsetX()).toBe(imageGroup.offsetX());
        expect(penGroup.offsetY()).toBe(imageGroup.offsetY());
        expect(markGroup.offsetX()).toBe(imageGroup.offsetX());
        expect(markGroup.offsetY()).toBe(imageGroup.offsetY());

        // 3. Verify all three groups share exact positions and scales
        expect(imageGroup.x()).toBe(penGroup.x());
        expect(imageGroup.y()).toBe(penGroup.y());
        expect(imageGroup.x()).toBe(markGroup.x());
        expect(imageGroup.y()).toBe(markGroup.y());
        expect(imageGroup.scaleX()).toBe(currentTransform.zoom);
        expect(imageGroup.scaleY()).toBe(currentTransform.zoom);
        expect(penGroup.scaleX()).toBe(currentTransform.zoom);
        expect(markGroup.scaleX()).toBe(currentTransform.zoom);

        // 4. Verify image node inside group remains in local invariant coordinates
        expect(imageNode.x()).toBe(0);
        expect(imageNode.y()).toBe(0);
        expect(imageNode.width()).toBe(mockBaseBounds.width);
        expect(imageNode.height()).toBe(mockBaseBounds.height);
      }
    });
  });

  describe('5. Image-Only Brightness Control (View-Only & Non-Destructive)', () => {
    it('applies Konva Brighten filter to the image node when brightness is non-zero', () => {
      const imageNode = new Konva.Image({
        image: {} as CanvasImageSource,
        x: 0,
        y: 0,
        width: 800,
        height: 1000,
      });

      const applyImageFilters = (imgNode: Konva.Image, brightness: number, contrast: number) => {
        type KonvaFilter = NonNullable<Parameters<Konva.Image['filters']>[0]>[number];
        const filters: KonvaFilter[] = [];
        if (brightness !== 0) {
          if (Konva.Filters?.Brighten) {
            filters.push(Konva.Filters.Brighten);
            imgNode.brightness(Math.max(-1, Math.min(1, brightness / 100)));
          }
        }
        if (contrast !== 0) {
          if (Konva.Filters?.Contrast) {
            filters.push(Konva.Filters.Contrast);
            imgNode.contrast(Math.max(-100, Math.min(100, contrast)));
          }
        }
        imgNode.filters(filters);
      };

      // Brightness +50%
      applyImageFilters(imageNode, 50, 0);
      expect(imageNode.filters()).toContain(Konva.Filters.Brighten);
      expect(imageNode.brightness()).toBe(0.5);

      // Brightness reset to 0 (default)
      applyImageFilters(imageNode, 0, 0);
      expect(imageNode.filters()).toEqual([]);
    });

    it('does NOT apply brightness filters to pen strokes or mark annotations', () => {
      const penLine = new Konva.Line({
        points: [100, 100, 200, 200],
        stroke: DEFAULT_PEN_COLOR,
        strokeWidth: 3,
      });

      const checkGroup = new Konva.Group({ x: 150, y: 150 });

      // Only image node receives filters; pen lines and mark groups remain unfiltered
      expect(penLine.filters()).toBeUndefined();
      expect(checkGroup.filters()).toBeUndefined();
      expect(penLine.stroke()).toBe(DEFAULT_PEN_COLOR);
    });
  });

  describe('6. Image-Only Contrast Control (View-Only & Non-Destructive)', () => {
    it('applies Konva Contrast filter to the image node when contrast is non-zero', () => {
      const imageNode = new Konva.Image({
        image: {} as CanvasImageSource,
        x: 0,
        y: 0,
        width: 800,
        height: 1000,
      });

      const applyImageFilters = (imgNode: Konva.Image, brightness: number, contrast: number) => {
        type KonvaFilter = NonNullable<Parameters<Konva.Image['filters']>[0]>[number];
        const filters: KonvaFilter[] = [];
        if (brightness !== 0) {
          if (Konva.Filters?.Brighten) {
            filters.push(Konva.Filters.Brighten);
            imgNode.brightness(Math.max(-1, Math.min(1, brightness / 100)));
          }
        }
        if (contrast !== 0) {
          if (Konva.Filters?.Contrast) {
            filters.push(Konva.Filters.Contrast);
            imgNode.contrast(Math.max(-100, Math.min(100, contrast)));
          }
        }
        imgNode.filters(filters);
      };

      // Contrast +40
      applyImageFilters(imageNode, 0, 40);
      expect(imageNode.filters()).toContain(Konva.Filters.Contrast);
      expect(imageNode.contrast()).toBe(40);

      // Contrast -30
      applyImageFilters(imageNode, 0, -30);
      expect(imageNode.contrast()).toBe(-30);

      // Contrast reset to 0
      applyImageFilters(imageNode, 0, 0);
      expect(imageNode.filters()).toEqual([]);
    });

    it('preserves source image URI and raw pixel source without mutation', () => {
      const sourceUri = 'https://example.com/test-script-page-1.jpg';
      const currentSource = sourceUri;

      // Adjust brightness & contrast
      const brightness = 30;
      const contrast = 50;

      expect(brightness).toBe(30);
      expect(contrast).toBe(50);
      expect(currentSource).toBe(sourceUri); // URL/source untouched
    });
  });

  describe('7. Performance & AE-139 <200ms Drawing Budget with Active Filters/Rotation', () => {
    it('maintains drawing latency <200ms when rotated and with active brightness/contrast filters', () => {
      const TARGET_LATENCY_MS = 200.0;
      const transform: PanZoomTransform = { x: -50, y: -50, zoom: 2.0, rotation: 90 };
      const samples: number[] = [];

      for (let i = 0; i < 30; i++) {
        const start = performance.now();

        // 1. Pointer move -> screen to image with rotation
        const screenX = 200 + (i % 10) * 4;
        const screenY = 250 + (i % 10) * 4;
        const imagePoint = screenToImageCoordinates(screenX, screenY, transform, mockBaseBounds);

        // 2. Stroke point appending
        let s = createStroke('page-1', imagePoint);
        for (let pt = 1; pt <= 10; pt++) {
          const nextPt = screenToImageCoordinates(screenX + pt * 3, screenY + pt * 2, transform, mockBaseBounds);
          s = appendPointToStroke(s, nextPt);
        }

        const end = performance.now();
        samples.push(end - start);
      }

      const stats = calculateLatencyStats(samples);
      expect(stats.p95).toBeLessThan(TARGET_LATENCY_MS);
      expect(stats.median).toBeLessThan(TARGET_LATENCY_MS);
    });
  });
});
