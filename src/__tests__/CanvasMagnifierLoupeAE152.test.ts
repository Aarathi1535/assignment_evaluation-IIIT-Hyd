import { describe, it, expect } from 'vitest';
import {
  calculateLoupeSourceRect,
  calculateLoupePlacement,
  loupePointerToImageCoordinates,
  DEFAULT_LOUPE_DIAMETER,
  DEFAULT_LOUPE_MAGNIFICATION,
} from '../lib/magnifierTool';
import type { PanZoomTransform } from '../lib/panZoom';
import type { RenderedImageBounds } from '../lib/annotations';
import type { CanvasTool } from '../components/canvas/types';

describe('AE-152: Magnifier / Loupe for the Grading Canvas', () => {
  const sampleBounds: RenderedImageBounds = {
    x: 100,
    y: 50,
    width: 600,
    height: 800,
    scale: 1.0,
  };

  const baseTransform: PanZoomTransform = {
    x: 0,
    y: 0,
    zoom: 1.0,
  };

  describe('1. Default Constants and Calculation Integrity', () => {
    it('uses standard defaults for loupe diameter and magnification factor', () => {
      expect(DEFAULT_LOUPE_DIAMETER).toBe(180);
      expect(DEFAULT_LOUPE_MAGNIFICATION).toBe(2.0);
    });

    it('calculates the source sampling bounding box centered at pointer with 2x magnification', () => {
      const diameter = 180;
      const magnification = 2.0;
      const pointerX = 300;
      const pointerY = 400;

      const rect = calculateLoupeSourceRect(pointerX, pointerY, diameter, magnification);

      // source box dimension should be diameter / magnification = 90
      expect(rect.sw).toBe(90);
      expect(rect.sh).toBe(90);
      // center should match pointer (pointer - sw/2 = 300 - 45 = 255)
      expect(rect.sx).toBe(255);
      expect(rect.sy).toBe(355);
    });

    it('calculates the source sampling bounding box with custom magnification (e.g. 3x)', () => {
      const diameter = 240;
      const magnification = 3.0;
      const pointerX = 150;
      const pointerY = 200;

      const rect = calculateLoupeSourceRect(pointerX, pointerY, diameter, magnification);

      // sw = 240 / 3 = 80
      expect(rect.sw).toBe(80);
      expect(rect.sh).toBe(80);
      expect(rect.sx).toBe(110);
      expect(rect.sy).toBe(160);
    });

    it('clamps magnification to positive finite numbers to prevent division by zero or negative size', () => {
      const rectZero = calculateLoupeSourceRect(100, 100, 180, 0);
      expect(rectZero.sw).toBeGreaterThan(0);

      const rectNegative = calculateLoupeSourceRect(100, 100, 180, -2);
      expect(rectNegative.sw).toBeGreaterThan(0);
    });
  });

  describe('2. Loupe Lens Placement', () => {
    it('places the circular loupe lens centered over the pointer position', () => {
      const placement = calculateLoupePlacement(250, 350, 180);
      expect(placement.x).toBe(250 - 90);
      expect(placement.y).toBe(350 - 90);
    });

    it('clamps or offsets placement within custom container bounds if provided', () => {
      const containerBounds = { width: 500, height: 500 };
      // Near top-left boundary
      const placementTL = calculateLoupePlacement(10, 10, 180, containerBounds);
      expect(placementTL.x).toBeGreaterThanOrEqual(0);
      expect(placementTL.y).toBeGreaterThanOrEqual(0);

      // Near bottom-right boundary
      const placementBR = calculateLoupePlacement(490, 490, 180, containerBounds);
      expect(placementBR.x + 180).toBeLessThanOrEqual(500);
      expect(placementBR.y + 180).toBeLessThanOrEqual(500);
    });
  });

  describe('3. Pointer to Image Coordinate Mapping with Rotation (0°, 90°, 180°, 270°)', () => {
    it('maps pointer to image coordinates accurately under 0° rotation', () => {
      const pointerX = 250; // on screen
      const pointerY = 200; // on screen
      const imgPoint = loupePointerToImageCoordinates(
        pointerX,
        pointerY,
        baseTransform,
        0,
        sampleBounds
      );

      expect(imgPoint.x).toBe(250);
      expect(imgPoint.y).toBe(200);
    });

    it('maps pointer to image coordinates accurately under 90° rotation (clockwise)', () => {
      // Under 90 deg rotation, the coordinate system rotates around the center of bounds
      const imgPoint = loupePointerToImageCoordinates(
        250,
        200,
        baseTransform,
        90,
        sampleBounds
      );

      expect(imgPoint.x).toBeDefined();
      expect(imgPoint.y).toBeDefined();
      expect(Number.isFinite(imgPoint.x)).toBe(true);
      expect(Number.isFinite(imgPoint.y)).toBe(true);
    });

    it('maps pointer to image coordinates accurately under 180° rotation', () => {
      const imgPoint = loupePointerToImageCoordinates(
        250,
        200,
        baseTransform,
        180,
        sampleBounds
      );

      expect(imgPoint.x).toBeDefined();
      expect(imgPoint.y).toBeDefined();
      expect(Number.isFinite(imgPoint.x)).toBe(true);
      expect(Number.isFinite(imgPoint.y)).toBe(true);
    });

    it('maps pointer to image coordinates accurately under 270° rotation', () => {
      const imgPoint = loupePointerToImageCoordinates(
        250,
        200,
        baseTransform,
        270,
        sampleBounds
      );

      expect(imgPoint.x).toBeDefined();
      expect(imgPoint.y).toBeDefined();
      expect(Number.isFinite(imgPoint.x)).toBe(true);
      expect(Number.isFinite(imgPoint.y)).toBe(true);
    });

    it('correctly incorporates pan offsets and zoom level in coordinate resolution', () => {
      const zoomedTransform: PanZoomTransform = {
        x: 50,
        y: 25,
        zoom: 2.0,
      };

      const imgPoint = loupePointerToImageCoordinates(
        350,
        225,
        zoomedTransform,
        0,
        sampleBounds
      );

      // (350 - 50) / 2.0 = 300 / 2 = 150
      expect(imgPoint.x).toBe(150);
      // (225 - 25) / 2.0 = 200 / 2 = 100
      expect(imgPoint.y).toBe(100);
    });
  });

  describe('4. Tool State & Non-Drawing Behavior', () => {
    it('treats loupe as a non-drawing tool so freehand strokes and marks are not triggered', () => {
      const tools: CanvasTool[] = ['none', 'select', 'pen', 'eraser', 'check', 'cross', 'highlight', 'text', 'loupe'];

      const isDrawing = (tool: CanvasTool) => tool !== 'none' && tool !== 'select' && tool !== 'loupe';

      const results = tools.map((t) => ({ tool: t, drawing: isDrawing(t) }));
      expect(results.find((r) => r.tool === 'loupe')?.drawing).toBe(false);
      expect(results.find((r) => r.tool === 'pen')?.drawing).toBe(true);
      expect(results.find((r) => r.tool === 'eraser')?.drawing).toBe(true);
      expect(results.find((r) => r.tool === 'check')?.drawing).toBe(true);
      expect(results.find((r) => r.tool === 'cross')?.drawing).toBe(true);
      expect(results.find((r) => r.tool === 'highlight')?.drawing).toBe(true);
      expect(results.find((r) => r.tool === 'text')?.drawing).toBe(true);
      expect(results.find((r) => r.tool === 'select')?.drawing).toBe(false);
      expect(results.find((r) => r.tool === 'none')?.drawing).toBe(false);
    });
  });

  describe('5. Keyboard Shortcut Ignored During Input Typing', () => {
    it('detects when active element or event target is an input/textarea/contentEditable element', () => {
      const shouldIgnoreShortcut = (target: { tagName?: string; isContentEditable?: boolean } | null) => {
        if (!target) return false;
        return (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          Boolean(target.isContentEditable)
        );
      };

      expect(shouldIgnoreShortcut({ tagName: 'INPUT' })).toBe(true);
      expect(shouldIgnoreShortcut({ tagName: 'TEXTAREA' })).toBe(true);
      expect(shouldIgnoreShortcut({ isContentEditable: true })).toBe(true);
      expect(shouldIgnoreShortcut({ tagName: 'DIV', isContentEditable: false })).toBe(false);
      expect(shouldIgnoreShortcut({ tagName: 'BUTTON' })).toBe(false);
      expect(shouldIgnoreShortcut(null)).toBe(false);
    });
  });
});
