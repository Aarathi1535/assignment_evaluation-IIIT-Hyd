import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  StylusInputManager,
  StrokePoint,
} from '../lib/stylusInputManager';

describe('AE-235: Tablet and Hardware Stylus Input Validation and Palm Rejection', () => {
  let manager: StylusInputManager;

  beforeEach(() => {
    manager = new StylusInputManager({
      palmRejectionCooldownMs: 400,
      maxPalmContactArea: 400,
      pressureCurve: 'ease-out',
    });
  });

  describe('Hardware Stylus Prioritization & Pressure Curves', () => {
    it('should accept stylus pen input and apply ease-out pressure curve', () => {
      const res = manager.handlePointerDown({
        pointerId: 10,
        pointerType: 'pen',
        clientX: 120,
        clientY: 240,
        pressure: 0.64,
        timestamp: 1000,
      });

      expect(res.accepted).toBe(true);
      expect(res.strokePoint).toBeDefined();
      expect(res.strokePoint?.x).toBe(120);
      expect(res.strokePoint?.y).toBe(240);
      // sqrt(0.64) = 0.8
      expect(res.strokePoint?.pressure).toBeCloseTo(0.8, 2);
    });

    it('should correctly compute varied mathematical pressure curves', () => {
      expect(manager.mapPressure(0.4, 'linear')).toBeCloseTo(0.4, 2);
      expect(manager.mapPressure(0.5, 'ease-in')).toBeCloseTo(0.25, 2);
      expect(manager.mapPressure(0.49, 'ease-out')).toBeCloseTo(0.7, 2);
      expect(manager.mapPressure(0.5, 'sigmoid')).toBeCloseTo(0.5, 2);
    });
  });

  describe('Palm Rejection Engine', () => {
    it('should reject simultaneous touch contact while stylus is actively drawing', () => {
      // 1. Stylus engages with digitizer
      manager.handlePointerDown({
        pointerId: 1,
        pointerType: 'pen',
        clientX: 100,
        clientY: 100,
        pressure: 0.5,
        timestamp: 1000,
      });

      // 2. Resting palm touches the screen concurrently
      const palmEvent = manager.handlePointerDown({
        pointerId: 2,
        pointerType: 'touch',
        clientX: 300,
        clientY: 500,
        pressure: 0.5,
        timestamp: 1050,
      });

      expect(palmEvent.accepted).toBe(false);
      expect(palmEvent.reason).toBe('PALM_REJECTION_ACTIVE');
    });

    it('should reject touch events within the 400ms cooldown window after pen lifts', () => {
      manager.handlePointerDown({
        pointerId: 1,
        pointerType: 'pen',
        clientX: 100,
        clientY: 100,
        timestamp: 1000,
      });
      // Stylus lifts at t = 1200ms
      manager.handlePointerUp({
        pointerId: 1,
        pointerType: 'pen',
        clientX: 100,
        clientY: 100,
        timestamp: 1200,
      });

      // Hand readjustment touch occurs at t = 1350ms (150ms into 400ms cooldown)
      const rejectedTouch = manager.handlePointerDown({
        pointerId: 2,
        pointerType: 'touch',
        clientX: 250,
        clientY: 250,
        timestamp: 1350,
      });
      expect(rejectedTouch.accepted).toBe(false);
      expect(rejectedTouch.reason).toBe('PALM_REJECTION_ACTIVE');

      // Intentional UI tap occurs at t = 1700ms (500ms after pen lifted, cooldown expired)
      const validTouch = manager.handlePointerDown({
        pointerId: 3,
        pointerType: 'touch',
        clientX: 44,
        clientY: 44,
        width: 10,
        height: 10,
        timestamp: 1700,
      });
      expect(validTouch.accepted).toBe(true);
      expect(validTouch.strokePoint).toBeDefined();
    });

    it('should reject touch contacts with large contact geometry (palm heel heuristic)', () => {
      // No active stylus, but palm heel rests on screen (width 25 x height 25 = 625px^2 > 400)
      const palmHeelEvent = manager.handlePointerDown({
        pointerId: 5,
        pointerType: 'touch',
        clientX: 400,
        clientY: 600,
        width: 25,
        height: 25,
        timestamp: 5000,
      });

      expect(palmHeelEvent.accepted).toBe(false);
      expect(palmHeelEvent.reason).toBe('PALM_CONTACT_SIZE');
    });
  });

  describe('Digitizer Jitter Smoothing', () => {
    it('should smooth high-frequency digitizer jitter across stroke points', () => {
      const noisyPoints: StrokePoint[] = [
        { x: 10, y: 10, pressure: 0.5 },
        { x: 18, y: 12, pressure: 0.6 }, // Jitter spike
        { x: 20, y: 20, pressure: 0.5 },
        { x: 32, y: 28, pressure: 0.7 }, // Jitter spike
        { x: 40, y: 40, pressure: 0.5 },
      ];

      const smoothed = manager.smoothStrokePoints(noisyPoints);

      expect(smoothed.length).toBe(noisyPoints.length);
      // First and last points remain intact
      expect(smoothed[0]).toEqual(noisyPoints[0]);
      expect(smoothed[smoothed.length - 1]).toEqual(noisyPoints[noisyPoints.length - 1]);

      // Interior noisy point (18, 12) is smoothed towards its neighbors (10, 10) and (20, 20)
      // 10*0.25 + 18*0.5 + 20*0.25 = 2.5 + 9 + 5 = 16.5
      expect(smoothed[1].x).toBe(16.5);
    });
  });

  describe('Ergonomic Touch-Target Validation', () => {
    it('should validate controls adhering to WCAG 2.1 AAA 44x44px target standard', () => {
      const validTarget = StylusInputManager.validateTouchTarget(48, 48);
      expect(validTarget.valid).toBe(true);
      expect(validTarget.deficitX).toBe(0);
      expect(validTarget.deficitY).toBe(0);

      const invalidTarget = StylusInputManager.validateTouchTarget(32, 28);
      expect(invalidTarget.valid).toBe(false);
      expect(invalidTarget.minRecommended).toBe(44);
      expect(invalidTarget.deficitX).toBe(12);
      expect(invalidTarget.deficitY).toBe(16);
    });
  });

  describe('PenLayer Palm Rejection Integration', () => {
    it('integrates StylusInputManager into PenLayer to reject palm contact and cooldown events', () => {
      const penLayerPath = path.join(process.cwd(), 'src', 'components', 'canvas', 'PenLayer.tsx');
      const penLayerContent = fs.readFileSync(penLayerPath, 'utf8');

      expect(penLayerContent).toContain('stylusInputManagerRef.current.handlePointerDown');
      expect(penLayerContent).toContain('stylusInputManagerRef.current.handlePointerMove');
      expect(penLayerContent).toContain('stylusInputManagerRef.current.handlePointerUp');
    });
  });
});
