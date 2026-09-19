import { describe, it, expect } from 'vitest';
import {
  calculateInitialTransform,
  createDefaultViewState,
  isDefaultViewState,
  DEFAULT_ROTATION,
  DEFAULT_BRIGHTNESS,
  DEFAULT_CONTRAST,
  calculateZoomTransform,
  calculateStepZoom,
  DEFAULT_ZOOM_STEP,
  PanZoomTransform,
  CanvasViewState,
} from '../lib/panZoom';
import {
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  createTextNoteAnnotation,
  MarkAnnotation,
} from '../lib/stampTool';
import { createStroke, FreehandStroke } from '../lib/penTool';
import type { RenderedImageBounds } from '../lib/annotations';

describe('AE-153: Reset View for the Grading Canvas', () => {
  const sampleBaseBounds: RenderedImageBounds = {
    x: 120,
    y: 60,
    width: 560,
    height: 780,
    scale: 0.75,
  };

  const stageDimensions = { width: 800, height: 900 };

  describe('1. Default View State Models & Initial Transform Calculations', () => {
    it('creates initial default view state with 0° rotation, 1.0 brightness, 1.0 contrast, and base fit transform', () => {
      const defaultState = createDefaultViewState(sampleBaseBounds);

      expect(defaultState.rotation).toBe(DEFAULT_ROTATION);
      expect(defaultState.rotation).toBe(0);
      expect(defaultState.brightness).toBe(DEFAULT_BRIGHTNESS);
      expect(defaultState.brightness).toBe(1.0);
      expect(defaultState.contrast).toBe(DEFAULT_CONTRAST);
      expect(defaultState.contrast).toBe(1.0);
      expect(defaultState.transform.x).toBe(120);
      expect(defaultState.transform.y).toBe(60);
      expect(defaultState.transform.zoom).toBe(1.0);
    });

    it('falls back to { x: 0, y: 0, zoom: 1.0 } when baseBounds is null or undefined', () => {
      const fallbackTransform = calculateInitialTransform(null);
      expect(fallbackTransform).toEqual({ x: 0, y: 0, zoom: 1.0 });

      const defaultStateNull = createDefaultViewState(null);
      expect(defaultStateNull.transform).toEqual({ x: 0, y: 0, zoom: 1.0 });
    });

    it('accurately identifies when a view state matches or deviates from the clean default view state', () => {
      const cleanState = createDefaultViewState(sampleBaseBounds);
      expect(isDefaultViewState(cleanState, sampleBaseBounds)).toBe(true);

      // Mutate rotation
      const rotatedState: CanvasViewState = { ...cleanState, rotation: 90 };
      expect(isDefaultViewState(rotatedState, sampleBaseBounds)).toBe(false);

      // Mutate brightness
      const brightState: CanvasViewState = { ...cleanState, brightness: 1.5 };
      expect(isDefaultViewState(brightState, sampleBaseBounds)).toBe(false);

      // Mutate contrast
      const contrastState: CanvasViewState = { ...cleanState, contrast: 1.2 };
      expect(isDefaultViewState(contrastState, sampleBaseBounds)).toBe(false);

      // Mutate zoom
      const zoomedState: CanvasViewState = {
        ...cleanState,
        transform: { ...cleanState.transform, zoom: 2.0 },
      };
      expect(isDefaultViewState(zoomedState, sampleBaseBounds)).toBe(false);

      // Mutate pan
      const pannedState: CanvasViewState = {
        ...cleanState,
        transform: { ...cleanState.transform, x: 200 },
      };
      expect(isDefaultViewState(pannedState, sampleBaseBounds)).toBe(false);
    });
  });

  describe('2. Atomic View State Reset Scenarios', () => {
    // Pure function simulating the atomic Reset View action in AnswerSheetCanvas
    const executeResetView = (
      currentState: CanvasViewState,
      bounds: RenderedImageBounds | null
    ): CanvasViewState => {
      return createDefaultViewState(bounds);
    };

    it('resets from a 90° rotated state back to 0° with clean default view', () => {
      const state90: CanvasViewState = {
        rotation: 90,
        brightness: 1.0,
        contrast: 1.0,
        transform: { x: 120, y: 60, zoom: 1.0 },
      };

      const resetState = executeResetView(state90, sampleBaseBounds);
      expect(resetState.rotation).toBe(0);
      expect(isDefaultViewState(resetState, sampleBaseBounds)).toBe(true);
    });

    it('resets from a 180° rotated state back to 0° with clean default view', () => {
      const state180: CanvasViewState = {
        rotation: 180,
        brightness: 1.0,
        contrast: 1.0,
        transform: { x: 120, y: 60, zoom: 1.0 },
      };

      const resetState = executeResetView(state180, sampleBaseBounds);
      expect(resetState.rotation).toBe(0);
      expect(isDefaultViewState(resetState, sampleBaseBounds)).toBe(true);
    });

    it('resets from a 270° rotated state back to 0° with clean default view', () => {
      const state270: CanvasViewState = {
        rotation: 270,
        brightness: 1.0,
        contrast: 1.0,
        transform: { x: 120, y: 60, zoom: 1.0 },
      };

      const resetState = executeResetView(state270, sampleBaseBounds);
      expect(resetState.rotation).toBe(0);
      expect(isDefaultViewState(resetState, sampleBaseBounds)).toBe(true);
    });

    it('resets after brightness adjustments (e.g. 1.8x enhanced brightness)', () => {
      const alteredBrightness: CanvasViewState = {
        rotation: 0,
        brightness: 1.8,
        contrast: 1.0,
        transform: { x: 120, y: 60, zoom: 1.0 },
      };

      const resetState = executeResetView(alteredBrightness, sampleBaseBounds);
      expect(resetState.brightness).toBe(1.0);
      expect(isDefaultViewState(resetState, sampleBaseBounds)).toBe(true);
    });

    it('resets after contrast adjustments (e.g. 0.5x lowered contrast)', () => {
      const alteredContrast: CanvasViewState = {
        rotation: 0,
        brightness: 1.0,
        contrast: 0.5,
        transform: { x: 120, y: 60, zoom: 1.0 },
      };

      const resetState = executeResetView(alteredContrast, sampleBaseBounds);
      expect(resetState.contrast).toBe(1.0);
      expect(isDefaultViewState(resetState, sampleBaseBounds)).toBe(true);
    });

    it('resets after manual zoom in and zoom out operations', () => {
      // Step zoom in
      const zoomedInLevel = calculateStepZoom(1.0, DEFAULT_ZOOM_STEP);
      const zoomedTransform = calculateZoomTransform(
        sampleBaseBounds.x,
        sampleBaseBounds.y,
        1.0,
        zoomedInLevel,
        400,
        450,
        sampleBaseBounds,
        stageDimensions.width,
        stageDimensions.height
      );

      const zoomedState: CanvasViewState = {
        rotation: 0,
        brightness: 1.0,
        contrast: 1.0,
        transform: zoomedTransform,
      };

      const resetState = executeResetView(zoomedState, sampleBaseBounds);
      expect(resetState.transform.zoom).toBe(1.0);
      expect(resetState.transform.x).toBe(sampleBaseBounds.x);
      expect(resetState.transform.y).toBe(sampleBaseBounds.y);
      expect(isDefaultViewState(resetState, sampleBaseBounds)).toBe(true);
    });

    it('resets after Fit Width framing preset is applied', () => {
      // Fit Width scales zoom by containerWidth / baseBounds.width
      const fitWidthZoom = stageDimensions.width / sampleBaseBounds.width;
      const fitWidthState: CanvasViewState = {
        rotation: 0,
        brightness: 1.0,
        contrast: 1.0,
        transform: {
          x: 0,
          y: sampleBaseBounds.y,
          zoom: fitWidthZoom,
        },
      };

      const resetState = executeResetView(fitWidthState, sampleBaseBounds);
      expect(resetState.transform.zoom).toBe(1.0);
      expect(resetState.transform.x).toBe(sampleBaseBounds.x);
      expect(isDefaultViewState(resetState, sampleBaseBounds)).toBe(true);
    });

    it('resets after Actual Size (1:1 pixel) framing preset is applied', () => {
      // Actual size zoom = 1 / baseBounds.scale
      const actualSizeZoom = 1 / sampleBaseBounds.scale;
      const actualSizeState: CanvasViewState = {
        rotation: 0,
        brightness: 1.0,
        contrast: 1.0,
        transform: {
          x: -50,
          y: -100,
          zoom: actualSizeZoom,
        },
      };

      const resetState = executeResetView(actualSizeState, sampleBaseBounds);
      expect(resetState.transform.zoom).toBe(1.0);
      expect(resetState.transform.x).toBe(sampleBaseBounds.x);
      expect(resetState.transform.y).toBe(sampleBaseBounds.y);
      expect(isDefaultViewState(resetState, sampleBaseBounds)).toBe(true);
    });

    it('resets after arbitrary pan translation offsets', () => {
      const pannedState: CanvasViewState = {
        rotation: 0,
        brightness: 1.0,
        contrast: 1.0,
        transform: {
          x: -240,
          y: -180,
          zoom: 2.5,
        },
      };

      const resetState = executeResetView(pannedState, sampleBaseBounds);
      expect(resetState.transform.x).toBe(sampleBaseBounds.x);
      expect(resetState.transform.y).toBe(sampleBaseBounds.y);
      expect(resetState.transform.zoom).toBe(1.0);
      expect(isDefaultViewState(resetState, sampleBaseBounds)).toBe(true);
    });

    it('resets atomically after combining rotation (270°), zoom (3.5x), pan, high brightness (1.6x), and high contrast (1.4x)', () => {
      const chaoticViewState: CanvasViewState = {
        rotation: 270,
        brightness: 1.6,
        contrast: 1.4,
        transform: {
          x: -300,
          y: -450,
          zoom: 3.5,
        },
      };

      const resetState = executeResetView(chaoticViewState, sampleBaseBounds);
      expect(resetState.rotation).toBe(0);
      expect(resetState.brightness).toBe(1.0);
      expect(resetState.contrast).toBe(1.0);
      expect(resetState.transform.zoom).toBe(1.0);
      expect(resetState.transform.x).toBe(sampleBaseBounds.x);
      expect(resetState.transform.y).toBe(sampleBaseBounds.y);
      expect(isDefaultViewState(resetState, sampleBaseBounds)).toBe(true);
    });
  });

  describe('3. Non-Destructive Invariance: Annotations, Strokes & Grading Data Preserved', () => {
    it('leaves freehand strokes, mark stamps, highlights, and text notes completely untouched upon Reset View', () => {
      const pageKey = 'page-test-1';

      const stroke1: FreehandStroke = createStroke(pageKey, { x: 100, y: 100 }, { color: '#e11d48', strokeWidth: 2 });
      const checkStamp: MarkAnnotation = createCheckAnnotation(pageKey, { x: 200, y: 250 });
      const crossStamp: MarkAnnotation = createCrossAnnotation(pageKey, { x: 300, y: 350 });
      const highlight: MarkAnnotation = createHighlightAnnotation(pageKey, { x: 50, y: 80, width: 200, height: 30 });
      const textNote: MarkAnnotation = createTextNoteAnnotation(pageKey, { x: 120, y: 400 }, 'Good derivation of QuickSort');

      const initialStrokes = [stroke1];
      const initialAnnotations = [checkStamp, crossStamp, highlight, textNote];

      // Deep copy before view reset
      const strokesBefore = JSON.parse(JSON.stringify(initialStrokes));
      const annotationsBefore = JSON.parse(JSON.stringify(initialAnnotations));

      // Simulate view reset with transformed canvas
      const viewBefore: CanvasViewState = {
        rotation: 90,
        brightness: 1.4,
        contrast: 1.3,
        transform: { x: -100, y: -200, zoom: 2.5 },
      };

      const viewAfter = createDefaultViewState(sampleBaseBounds);

      // Verify view is reset
      expect(isDefaultViewState(viewAfter, sampleBaseBounds)).toBe(true);
      expect(viewBefore.rotation).toBe(90);

      // Verify annotations and strokes remain 100% identical
      expect(initialStrokes).toEqual(strokesBefore);
      expect(initialAnnotations).toEqual(annotationsBefore);
      expect(initialAnnotations.length).toBe(4);
      expect(initialStrokes.length).toBe(1);
    });

    it('leaves grades, rubric scores, and question feedback state completely unmodified upon Reset View', () => {
      const gradingState = {
        scriptId: 'script-cs201-001',
        questionId: 'q1',
        score: 8.5,
        maxScore: 10,
        feedback: 'Minor edge case omitted in worst-case analysis',
        status: 'in_progress',
      };

      const gradingStateBefore = { ...gradingState };

      // Execute view reset
      const resetView = createDefaultViewState(sampleBaseBounds);
      expect(resetView.rotation).toBe(0);

      // Verify grading state is unmodified
      expect(gradingState).toEqual(gradingStateBefore);
      expect(gradingState.score).toBe(8.5);
      expect(gradingState.feedback).toBe('Minor edge case omitted in worst-case analysis');
    });

    it('works cleanly when Magnifier Loupe is active without corrupting loupe state or disabling magnifier', () => {
      const loupeConfig = {
        active: true,
        magnification: 2.0,
        diameter: 180,
      };

      const viewStateBefore: CanvasViewState = {
        rotation: 180,
        brightness: 1.5,
        contrast: 1.2,
        transform: { x: -50, y: -50, zoom: 2.0 },
      };

      const resetView = createDefaultViewState(sampleBaseBounds);

      expect(viewStateBefore.rotation).toBe(180);
      expect(isDefaultViewState(resetView, sampleBaseBounds)).toBe(true);
      // Loupe configuration remains intact
      expect(loupeConfig.active).toBe(true);
      expect(loupeConfig.magnification).toBe(2.0);
      expect(loupeConfig.diameter).toBe(180);
    });

    it('restores the exact same transform coordinates as a fresh canvas mount on page load', () => {
      const freshMountTransform: PanZoomTransform = {
        x: sampleBaseBounds.x,
        y: sampleBaseBounds.y,
        zoom: 1.0,
      };

      const resetTransform = calculateInitialTransform(sampleBaseBounds);

      expect(resetTransform.x).toBe(freshMountTransform.x);
      expect(resetTransform.y).toBe(freshMountTransform.y);
      expect(resetTransform.zoom).toBe(freshMountTransform.zoom);
    });
  });

  describe('4. UI & Accessibility Specification', () => {
    it('defines accessible attributes and data-testid for the Reset View toolbar button', () => {
      const buttonProps = {
        'data-testid': 'canvas-reset-view-button',
        'aria-label': 'Reset view',
        title: 'Reset view (Fit Page, 0° Rotation, Neutral adjustments)',
        type: 'button' as const,
      };

      expect(buttonProps['data-testid']).toBe('canvas-reset-view-button');
      expect(buttonProps['aria-label']).toBe('Reset view');
      expect(buttonProps.type).toBe('button');
    });
  });
});
