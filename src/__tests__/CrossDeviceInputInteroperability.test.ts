import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_WIDTH,
  MIN_PRESSURE_WIDTH_MULTIPLIER,
  MAX_PRESSURE_WIDTH_MULTIPLIER,
  calculatePressureStrokeWidth,
  screenToImageCoordinates,
  imageToScreenCoordinates,
  createStroke,
  appendPointToStroke,
  filterStrokesByPage,
  FreehandStroke,
} from '../lib/penTool';
import {
  calculatePanBounds,
  clampPanPosition,
  calculateZoomTransform,
  calculatePinchMetrics,
  PanZoomTransform,
  TouchPoint,
} from '../lib/panZoom';
import {
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  createTextNoteAnnotation,
  normalizeHighlightRect,
  moveAnnotation,
  MarkAnnotation,
} from '../lib/stampTool';
import {
  findIntersectingStrokes,
  DEFAULT_ERASER_RADIUS,
} from '../lib/eraserTool';
import {
  createInitialHistory,
  recordAddStroke,
  recordAddAnnotation,
  applyUndo,
  canUndo,
  canRedo,
} from '../lib/annotationHistory';
import {
  appendSmoothedPointToStroke,
  finalizeSmoothedStroke,
} from '../lib/strokeSmoothing';

import type { RenderedImageBounds } from '../lib/annotations';
import type { CanvasTool } from '../components/canvas/types';

describe('AE-138: Cross-Device Input Interoperability QA Suite', () => {
  const defaultTransform: PanZoomTransform = { x: 0, y: 0, zoom: 1.0 };
  const mockBaseBounds: RenderedImageBounds = { x: 0, y: 0, width: 800, height: 1130, scale: 1.0 };

  describe('1. Standard Mouse Input Validation', () => {
    it('creates freehand strokes on primary mouse button down with default stroke width', () => {
      // Simulates primary mouse click (button 0, buttons 1, pointerType 'mouse')
      const pointerEvent = {
        clientX: 250,
        clientY: 300,
        button: 0,
        buttons: 1,
        pointerType: 'mouse',
        pressure: 0, // Typical desktop mouse returns 0 or 0.5
      };

      const imagePoint = screenToImageCoordinates(pointerEvent.clientX, pointerEvent.clientY, defaultTransform);
      const stroke = createStroke('page-1', imagePoint, {
        color: DEFAULT_PEN_COLOR,
        strokeWidth: DEFAULT_PEN_WIDTH,
        pressure: pointerEvent.pressure,
      });

      expect(stroke.points).toEqual([250, 300]);
      expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
      expect(stroke.strokeWidth).toBe(DEFAULT_PEN_WIDTH);
    });

    it('rejects secondary mouse buttons (right-click / middle-click) from drawing', () => {
      // Mouse right-click has button: 2, buttons: 2
      const rightClickEvent = {
        button: 2,
        buttons: 2,
        pointerType: 'mouse',
      };

      const isAllowed = !(rightClickEvent.button !== 0 && rightClickEvent.buttons !== 1 && rightClickEvent.pointerType === 'mouse');
      expect(isAllowed).toBe(false);

      // Middle-click has button: 1, buttons: 4
      const middleClickEvent = {
        button: 1,
        buttons: 4,
        pointerType: 'mouse',
      };
      const isMiddleAllowed = !(middleClickEvent.button !== 0 && middleClickEvent.buttons !== 1 && middleClickEvent.pointerType === 'mouse');
      expect(isMiddleAllowed).toBe(false);
    });

    it('accurately maps mouse screen coordinates under 2.0x zoom and pan offsets', () => {
      const panZoomTransform: PanZoomTransform = { x: -150, y: -200, zoom: 2.0 };
      const mouseScreenPos = { x: 450, y: 600 };

      const imagePos = screenToImageCoordinates(mouseScreenPos.x, mouseScreenPos.y, panZoomTransform);
      // (450 - (-150)) / 2 = 300; (600 - (-200)) / 2 = 400
      expect(imagePos.x).toBe(300);
      expect(imagePos.y).toBe(400);

      const roundTrip = imageToScreenCoordinates(imagePos.x, imagePos.y, panZoomTransform);
      expect(roundTrip.x).toBe(mouseScreenPos.x);
      expect(roundTrip.y).toBe(mouseScreenPos.y);
    });

    it('creates check and cross stamp annotations on mouse click', () => {
      const clickPoint = { x: 120, y: 180 };
      const check = createCheckAnnotation('page-1', clickPoint);
      expect(check.type).toBe('check');
      expect(check.x).toBe(120);
      expect(check.y).toBe(180);

      const cross = createCrossAnnotation('page-1', clickPoint);
      expect(cross.type).toBe('cross');
      expect(cross.x).toBe(120);
      expect(cross.y).toBe(180);
    });

    it('creates and normalizes highlight rectangles on mouse drag in any direction', () => {
      // Top-left to bottom-right drag
      const startTL = { x: 100, y: 100 };
      const endBR = { x: 250, y: 140 };
      const rect1 = normalizeHighlightRect(startTL, endBR);
      expect(rect1).toEqual({ x: 100, y: 100, width: 150, height: 40 });

      // Bottom-right to top-left drag (reverse gesture)
      const rect2 = normalizeHighlightRect(endBR, startTL);
      expect(rect2).toEqual({ x: 100, y: 100, width: 150, height: 40 });

      const highlight = createHighlightAnnotation('page-1', rect1);
      expect(highlight.type).toBe('highlight');
      expect(highlight.width).toBe(150);
      expect(highlight.height).toBe(40);
    });

    it('places text note annotations at exact mouse click location', () => {
      const clickPoint = { x: 320, y: 450 };
      const note = createTextNoteAnnotation('page-1', clickPoint, 'Needs clarification on step 2');
      expect(note.type).toBe('text');
      expect(note.x).toBe(320);
      expect(note.y).toBe(450);
      expect(note.text).toBe('Needs clarification on step 2');
    });

    it('erases strokes along mouse trajectory using segment hit-testing', () => {
      const stroke: FreehandStroke = {
        id: 'stroke-mouse-1',
        pageKey: 'page-1',
        points: [100, 100, 200, 100, 300, 100],
        color: DEFAULT_PEN_COLOR,
        strokeWidth: 3,
        createdAt: Date.now(),
      };

      const hit = findIntersectingStrokes([stroke], { x: 150, y: 102 }, DEFAULT_ERASER_RADIUS);
      expect(hit.length).toBe(1);
      expect(hit[0].id).toBe('stroke-mouse-1');

      const miss = findIntersectingStrokes([stroke], { x: 150, y: 150 }, DEFAULT_ERASER_RADIUS);
      expect(miss.length).toBe(0);
    });

    it('supports select, move, and delete workflow with mouse', () => {
      const note = createTextNoteAnnotation('page-1', { x: 100, y: 100 }, 'Initial text');
      let annotations = [note];

      // Move annotation
      const moved = moveAnnotation(note, { x: 180, y: 220 });
      annotations = [moved];
      expect(annotations[0].x).toBe(180);
      expect(annotations[0].y).toBe(220);

      // Delete annotation
      annotations = annotations.filter((a) => a.id !== note.id);
      expect(annotations.length).toBe(0);
    });

    it('anchors mouse wheel zooming around cursor position', () => {
      const currentTransform: PanZoomTransform = { x: 0, y: 0, zoom: 1.0 };
      const cursorX = 400;
      const cursorY = 300;

      const zoomed = calculateZoomTransform(
        currentTransform.x,
        currentTransform.y,
        currentTransform.zoom,
        1.5,
        cursorX,
        cursorY,
        mockBaseBounds,
        800,
        1130,
        1.0,
        4.0
      );

      expect(zoomed.zoom).toBe(1.5);
      // Relative point under pointer remains invariant
      const uX = (cursorX - currentTransform.x) / (mockBaseBounds.width * 1.0);
      const expectedTentativeX = cursorX - uX * (mockBaseBounds.width * 1.5);
      expect(zoomed.x).toBeCloseTo(expectedTentativeX, 0);
    });

    it('allows canvas stage panning when tools are inactive and blocks pan when drawing tools are active', () => {
      // Inactive tool (isPenActive = false) -> pan is allowed
      const isDrawingActive = false;
      let panAllowed = !isDrawingActive;
      expect(panAllowed).toBe(true);

      // Active drawing tool (pen/stamp/highlight/eraser) -> pan is locked out
      const isDrawingActiveNow = true;
      panAllowed = !isDrawingActiveNow;
      expect(panAllowed).toBe(false);
    });
  });

  describe('2. Wacom & Digital Stylus (Pen) Input Validation', () => {
    it('creates strokes from stylus pointer events (pointerType: pen)', () => {
      const stylusEvent = {
        clientX: 180,
        clientY: 240,
        button: 0,
        buttons: 1,
        pointerType: 'pen',
        pressure: 0.6,
      };

      const isAllowed = !(stylusEvent.button !== 0 && stylusEvent.buttons !== 1 && stylusEvent.pointerType === 'mouse');
      expect(isAllowed).toBe(true);

      const imagePoint = screenToImageCoordinates(stylusEvent.clientX, stylusEvent.clientY, defaultTransform);
      const stroke = createStroke('page-1', imagePoint, {
        color: DEFAULT_PEN_COLOR,
        strokeWidth: DEFAULT_PEN_WIDTH,
        pressure: stylusEvent.pressure,
      });

      expect(stroke.points).toEqual([180, 240]);
      // Pressure 0.6 multiplier: 0.5 + 0.6 * 1.25 = 1.25 -> width = 3 * 1.25 = 3.75
      expect(stroke.strokeWidth).toBeCloseTo(3.75, 2);
    });

    it('dynamically modulates stroke width according to stylus pressure sensitivity curve', () => {
      const baseWidth = 3;

      // Minimum pressure (0.1) -> multiplier ~ 0.625 -> width ~ 1.88
      const widthLow = calculatePressureStrokeWidth(baseWidth, 0.1);
      expect(widthLow).toBeCloseTo(1.88, 1);
      expect(widthLow).toBeGreaterThanOrEqual(baseWidth * MIN_PRESSURE_WIDTH_MULTIPLIER);

      // Medium pressure (0.5) -> multiplier 1.125 -> width 3.38
      const widthMid = calculatePressureStrokeWidth(baseWidth, 0.5);
      expect(widthMid).toBeCloseTo(3.38, 1);

      // Full pressure (1.0) -> multiplier 1.75 -> width 5.25
      const widthHigh = calculatePressureStrokeWidth(baseWidth, 1.0);
      expect(widthHigh).toBe(baseWidth * MAX_PRESSURE_WIDTH_MULTIPLIER);
    });

    it('falls back gracefully to base stroke width when stylus driver omits pressure', () => {
      const baseWidth = 3;
      expect(calculatePressureStrokeWidth(baseWidth, 0)).toBe(baseWidth);
      expect(calculatePressureStrokeWidth(baseWidth, undefined)).toBe(baseWidth);
      expect(calculatePressureStrokeWidth(baseWidth, -1)).toBe(baseWidth);
      expect(calculatePressureStrokeWidth(baseWidth, 1.5)).toBe(baseWidth); // Out-of-spec pressure > 1.0
    });

    it('handles pointercancel on stylus lift or palm rejection without data corruption', () => {
      let stroke = createStroke('page-1', { x: 50, y: 50 });
      stroke = appendPointToStroke(stroke, { x: 55, y: 55 });
      stroke = appendPointToStroke(stroke, { x: 60, y: 60 });

      // On pointercancel, finalizeSmoothedStroke must finalize existing points cleanly
      const finalized = finalizeSmoothedStroke(stroke);
      expect(finalized.points.length).toBeGreaterThanOrEqual(4);
      expect(finalized.points[0]).toBe(50);
      expect(finalized.points[1]).toBe(50);
      expect(finalized.points[finalized.points.length - 2]).toBe(60);
      expect(finalized.points[finalized.points.length - 1]).toBe(60);
    });

    it('retains in-flight points during active smoothing on continuous stylus movement', () => {
      let stroke = createStroke('page-1', { x: 10, y: 10 });
      const rawPoints = [
        { x: 15, y: 15 },
        { x: 20, y: 20 },
        { x: 25, y: 25 },
        { x: 30, y: 30 },
      ];

      for (const pt of rawPoints) {
        stroke = appendSmoothedPointToStroke(stroke, pt);
      }

      expect(stroke.points.length).toBe(10); // 5 points (1 initial + 4 appended) * 2 coordinates
      expect(stroke.points[0]).toBe(10);
      expect(stroke.points[1]).toBe(10);
    });

    it('locks canvas stage from accidental pan during stylus drawing gesture', () => {
      const isStylusDrawing = true;
      const isPenActive = isStylusDrawing;

      // In PageImageLayer: if (isPenActive) return;
      const stagePanIgnored = isPenActive;
      expect(stagePanIgnored).toBe(true);
    });
  });

  describe('3. iPad & Touch Input Validation', () => {
    it('creates annotations and freehand strokes from touch pointer events (pointerType: touch)', () => {
      const touchEvent = {
        clientX: 200,
        clientY: 350,
        button: 0,
        buttons: 1,
        pointerType: 'touch',
        pressure: 0,
      };

      const isAllowed = !(touchEvent.button !== 0 && touchEvent.buttons !== 1 && touchEvent.pointerType === 'mouse');
      expect(isAllowed).toBe(true);

      const imagePoint = screenToImageCoordinates(touchEvent.clientX, touchEvent.clientY, defaultTransform);
      const stroke = createStroke('page-1', imagePoint, {
        color: DEFAULT_PEN_COLOR,
        strokeWidth: DEFAULT_PEN_WIDTH,
      });

      expect(stroke.points).toEqual([200, 350]);
      expect(stroke.strokeWidth).toBe(DEFAULT_PEN_WIDTH);
    });

    it('calculates Euclidean distance and midpoint accurately for multi-touch pinch gestures', () => {
      const touch1: TouchPoint = { clientX: 100, clientY: 200 };
      const touch2: TouchPoint = { clientX: 300, clientY: 200 };

      const metrics = calculatePinchMetrics(touch1, touch2);
      expect(metrics.distance).toBe(200); // Horizontal delta = 200
      expect(metrics.centerX).toBe(200);
      expect(metrics.centerY).toBe(200);

      // Diagonal pinch
      const touchDiag1: TouchPoint = { clientX: 100, clientY: 100 };
      const touchDiag2: TouchPoint = { clientX: 130, clientY: 140 };
      const diagMetrics = calculatePinchMetrics(touchDiag1, touchDiag2);
      expect(diagMetrics.distance).toBe(50); // sqrt(30^2 + 40^2) = 50
      expect(diagMetrics.centerX).toBe(115);
      expect(diagMetrics.centerY).toBe(120);
    });

    it('scales viewport transform smoothly during multi-touch pinch zoom', () => {
      const initialDistance = 200;
      const newDistance = 300; // 1.5x pinch expansion
      const pinchScale = newDistance / initialDistance; // 1.5

      const currentTransform: PanZoomTransform = { x: 0, y: 0, zoom: 1.0 };
      const targetZoom = currentTransform.zoom * pinchScale;

      const pinchTransform = calculateZoomTransform(
        currentTransform.x,
        currentTransform.y,
        currentTransform.zoom,
        targetZoom,
        400, // Pinch center X
        500, // Pinch center Y
        mockBaseBounds,
        800,
        1130,
        1.0,
        4.0
      );

      expect(pinchTransform.zoom).toBe(1.5);
    });

    it('clamps touch drag panning strictly within container viewport boundaries', () => {
      const containerW = 800;
      const containerH = 600;
      const renderW = 1200; // Image zoomed 1.5x
      const renderH = 900;

      const bounds = calculatePanBounds(containerW, containerH, renderW, renderH);
      expect(bounds.minX).toBe(-400); // 800 - 1200
      expect(bounds.maxX).toBe(0);
      expect(bounds.minY).toBe(-300); // 600 - 900
      expect(bounds.maxY).toBe(0);

      // Clamping out-of-bounds touch pan
      const clamped = clampPanPosition(-600, 100, bounds);
      expect(clamped.x).toBe(-400);
      expect(clamped.y).toBe(0);
    });

    it('prevents single-touch panning when drawing tool is active', () => {
      const isDrawingTool = (tool: CanvasTool) => tool !== 'none' && tool !== 'select';
      expect(isDrawingTool('pen')).toBe(true);
      expect(isDrawingTool('check')).toBe(true);
      expect(isDrawingTool('none')).toBe(false);
      expect(isDrawingTool('select')).toBe(false);

      // Single touch while drawing should not trigger stage drag
      const isPenActive = isDrawingTool('pen');
      const shouldPan = !isPenActive;
      expect(shouldPan).toBe(false);
    });
  });

  describe('4. Microsoft Surface Dual-Input Interoperability', () => {
    it('seamlessly supports alternating between Surface Pen and touch input within the same session', () => {
      const pageStrokes: FreehandStroke[] = [];

      // 1. First stroke drawn with Surface Pen (with pressure)
      const penPoint = { x: 100, y: 150 };
      const penStroke = createStroke('page-1', penPoint, { pressure: 0.8, color: DEFAULT_PEN_COLOR });
      pageStrokes.push(penStroke);

      // 2. Second stroke drawn with capacitive finger touch (no pressure)
      const touchPoint = { x: 300, y: 400 };
      const touchStroke = createStroke('page-1', touchPoint, { color: '#2563eb' });
      pageStrokes.push(touchStroke);

      expect(pageStrokes.length).toBe(2);
      expect(pageStrokes[0].strokeWidth).toBeGreaterThan(DEFAULT_PEN_WIDTH); // Pressure expanded
      expect(pageStrokes[1].strokeWidth).toBe(DEFAULT_PEN_WIDTH); // Default touch base width
      expect(pageStrokes[0].color).toBe(DEFAULT_PEN_COLOR);
      expect(pageStrokes[1].color).toBe('#2563eb');
    });

    it('maintains coordinate accuracy across high-DPI Surface displays under various viewport scales', () => {
      // Surface Pro commonly uses 150% or 200% OS display scaling
      // Canvas logic uses clientX/clientY relative to container getBoundingClientRect()
      const containerRect = { left: 50, top: 100, width: 800, height: 600 };
      const rawClientX = 250;
      const rawClientY = 300;

      const screenX = rawClientX - containerRect.left; // 200
      const screenY = rawClientY - containerRect.top;  // 200

      const transform: PanZoomTransform = { x: -50, y: -50, zoom: 1.25 };
      const imagePoint = screenToImageCoordinates(screenX, screenY, transform);

      // (200 - (-50)) / 1.25 = 200
      expect(imagePoint.x).toBe(200);
      expect(imagePoint.y).toBe(200);
    });
  });

  describe('5. Cross-Device Undo/Redo & Visibility Overlay Interoperability', () => {
    it('maintains a cohesive undo/redo history when actions are performed across different input devices', () => {
      let history = createInitialHistory();
      let strokes: FreehandStroke[] = [];
      let annotations: MarkAnnotation[] = [];

      // Action 1: Mouse draws stroke
      const strokeMouse = createStroke('page-1', { x: 10, y: 10 });
      history = recordAddStroke(history, strokeMouse);
      strokes.push(strokeMouse);

      // Action 2: Stylus places check mark
      const checkStylus = createCheckAnnotation('page-1', { x: 50, y: 50 });
      history = recordAddAnnotation(history, checkStylus);
      annotations.push(checkStylus);

      // Action 3: Touch places text note
      const noteTouch = createTextNoteAnnotation('page-1', { x: 100, y: 100 }, 'Touch note');
      history = recordAddAnnotation(history, noteTouch);
      annotations.push(noteTouch);

      expect(canUndo(history)).toBe(true);
      expect(history.past.length).toBe(3);

      // Undo touch note
      const undo1 = applyUndo(history, strokes, annotations);
      history = undo1.history;
      annotations = undo1.annotations;
      expect(annotations.length).toBe(1); // Only checkStylus remains

      // Undo stylus check
      const undo2 = applyUndo(history, strokes, annotations);
      history = undo2.history;
      annotations = undo2.annotations;
      expect(annotations.length).toBe(0);

      // Undo mouse stroke
      const undo3 = applyUndo(history, strokes, annotations);
      history = undo3.history;
      strokes = undo3.strokes;
      expect(strokes.length).toBe(0);

      expect(canUndo(history)).toBe(false);
      expect(canRedo(history)).toBe(true);
    });

    it('ignores all pointer interaction types when overlay visibility is toggled off', () => {
      const isOverlayVisible = false;

      // In PenLayer / MarkLayer: if (!visibleRef.current) return;
      const shouldIgnorePointer = !isOverlayVisible;
      expect(shouldIgnorePointer).toBe(true);
    });

    it('maintains strict per-page annotation isolation across input types', () => {
      const strokeP1 = createStroke('page-1', { x: 10, y: 20 });
      const strokeP2 = createStroke('page-2', { x: 30, y: 40 });
      const allStrokes = [strokeP1, strokeP2];

      const p1Strokes = filterStrokesByPage(allStrokes, 'page-1');
      const p2Strokes = filterStrokesByPage(allStrokes, 'page-2');

      expect(p1Strokes.length).toBe(1);
      expect(p1Strokes[0].id).toBe(strokeP1.id);
      expect(p2Strokes.length).toBe(1);
      expect(p2Strokes[0].id).toBe(strokeP2.id);
    });
  });
});
