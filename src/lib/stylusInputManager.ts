/**
 * Tablet & Hardware Stylus Input Manager (AE-235)
 * Handles hardware stylus prioritization, palm rejection filtering,
 * pressure curve transformations, and touch-target ergonomic validation.
 */

export type PressureCurveType = 'linear' | 'ease-in' | 'ease-out' | 'sigmoid';

export interface StylusManagerOptions {
  palmRejectionCooldownMs?: number;
  maxPalmContactArea?: number;
  pressureCurve?: PressureCurveType;
  minPressure?: number;
  maxPressure?: number;
}

export interface StylusPointerEvent {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  pressure?: number;
  width?: number;
  height?: number;
  timestamp?: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface PointerResolution {
  accepted: boolean;
  reason?: 'PALM_REJECTION_ACTIVE' | 'PALM_CONTACT_SIZE' | 'UNKNOWN';
  strokePoint?: StrokePoint;
}

export class StylusInputManager {
  private readonly cooldownMs: number;
  private readonly maxContactArea: number;
  private readonly pressureCurve: PressureCurveType;
  private readonly minPressure: number;
  private readonly maxPressure: number;

  private activeStylusPointerId: number | null = null;
  private lastStylusTimestamp = 0;

  constructor(options: StylusManagerOptions = {}) {
    this.cooldownMs = options.palmRejectionCooldownMs ?? 400;
    this.maxContactArea = options.maxPalmContactArea ?? 400; // pixels^2
    this.pressureCurve = options.pressureCurve ?? 'ease-out';
    this.minPressure = options.minPressure ?? 0.05;
    this.maxPressure = options.maxPressure ?? 1.0;
  }

  /**
   * Evaluates pointerdown event against palm rejection filters and transforms input.
   */
  public handlePointerDown(event: StylusPointerEvent): PointerResolution {
    const now = event.timestamp ?? Date.now();
    const type = (event.pointerType || 'mouse').toLowerCase();

    // 1. Stylus (Pen) Priority Path
    if (type === 'pen') {
      this.activeStylusPointerId = event.pointerId;
      this.lastStylusTimestamp = now;
      // When raw pressure is 0 or undefined, default to 0.5 to coordinate with
      // cross-browser/Apple Pencil initial contact behavior (#361) rather than producing a hairline stroke.
      const rawPressure = event.pressure !== undefined && event.pressure > 0 ? event.pressure : 0.5;
      const mappedPressure = this.mapPressure(rawPressure);

      return {
        accepted: true,
        strokePoint: {
          x: event.clientX,
          y: event.clientY,
          pressure: mappedPressure,
        },
      };
    }

    // 2. Touch Contact Path: Subject to Palm Rejection
    if (type === 'touch') {
      // Check 2a: Active stylus or temporal cooldown rejection
      const isStylusActive = this.activeStylusPointerId !== null;
      const withinCooldown = now - this.lastStylusTimestamp < this.cooldownMs;

      if (isStylusActive || withinCooldown) {
        return {
          accepted: false,
          reason: 'PALM_REJECTION_ACTIVE',
        };
      }

      // Check 2b: Contact area heuristic (large palm resting on glass)
      const contactArea = (event.width || 1) * (event.height || 1);
      if (contactArea > this.maxContactArea) {
        return {
          accepted: false,
          reason: 'PALM_CONTACT_SIZE',
        };
      }

      // Normal fingertip touch
      const mappedPressure = this.mapPressure(event.pressure ?? 0.5);
      return {
        accepted: true,
        strokePoint: {
          x: event.clientX,
          y: event.clientY,
          pressure: mappedPressure,
        },
      };
    }

    // 3. Mouse path
    return {
      accepted: true,
      strokePoint: {
        x: event.clientX,
        y: event.clientY,
        pressure: 0.5,
      },
    };
  }

  /**
   * Evaluates ongoing pointermove event.
   */
  public handlePointerMove(event: StylusPointerEvent): PointerResolution {
    const now = event.timestamp ?? Date.now();
    const type = (event.pointerType || 'mouse').toLowerCase();

    if (type === 'pen') {
      this.lastStylusTimestamp = now;
      const rawPressure = event.pressure !== undefined && event.pressure > 0 ? event.pressure : 0.5;
      const mappedPressure = this.mapPressure(rawPressure);

      return {
        accepted: true,
        strokePoint: {
          x: event.clientX,
          y: event.clientY,
          pressure: mappedPressure,
        },
      };
    }

    if (type === 'touch') {
      if (this.activeStylusPointerId !== null || now - this.lastStylusTimestamp < this.cooldownMs) {
        return { accepted: false, reason: 'PALM_REJECTION_ACTIVE' };
      }
      return {
        accepted: true,
        strokePoint: {
          x: event.clientX,
          y: event.clientY,
          pressure: 0.5,
        },
      };
    }

    return {
      accepted: true,
      strokePoint: {
        x: event.clientX,
        y: event.clientY,
        pressure: 0.5,
      },
    };
  }

  /**
   * Handles pointerup or pointercancel to clear active stylus state.
   */
  public handlePointerUp(event: StylusPointerEvent): void {
    const type = (event.pointerType || 'mouse').toLowerCase();
    const now = event.timestamp ?? Date.now();

    if (type === 'pen') {
      this.activeStylusPointerId = null;
      this.lastStylusTimestamp = now;
    }
  }

  /**
   * Applies non-linear pressure curves to translate raw hardware sensor pressure.
   */
  public mapPressure(rawPressure: number, curveType?: PressureCurveType): number {
    const curve = curveType || this.pressureCurve;
    const clamped = Math.max(0.0, Math.min(1.0, rawPressure));

    let mapped: number;
    switch (curve) {
      case 'linear':
        mapped = clamped;
        break;
      case 'ease-in':
        // Quadratic: requires deliberate pressure for thick strokes
        mapped = Math.pow(clamped, 2);
        break;
      case 'ease-out':
        // Square root: responsive thickness with light pressure (reduces hand strain)
        mapped = Math.sqrt(clamped);
        break;
      case 'sigmoid':
        // Smooth S-curve transition
        mapped = 1 / (1 + Math.exp(-10 * (clamped - 0.5)));
        break;
      default:
        mapped = clamped;
    }

    return Math.min(Math.max(mapped, this.minPressure), this.maxPressure);
  }

  /**
   * Reduces digitizer quantization jitter using moving-average filtering.
   */
  public smoothStrokePoints(points: StrokePoint[]): StrokePoint[] {
    if (points.length <= 2) return [...points];

    const smoothed: StrokePoint[] = [points[0]];

    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];

      smoothed.push({
        x: prev.x * 0.25 + curr.x * 0.5 + next.x * 0.25,
        y: prev.y * 0.25 + curr.y * 0.5 + next.y * 0.25,
        pressure: prev.pressure * 0.25 + curr.pressure * 0.5 + next.pressure * 0.25,
      });
    }

    smoothed.push(points[points.length - 1]);
    return smoothed;
  }

  /**
   * Validates interactive UI touch target dimensions according to WCAG 2.1 AAA (44x44px).
   */
  public static validateTouchTarget(
    width: number,
    height: number
  ): { valid: boolean; minRecommended: number; deficitX: number; deficitY: number } {
    const minSize = 44;
    const valid = width >= minSize && height >= minSize;

    return {
      valid,
      minRecommended: minSize,
      deficitX: Math.max(0, minSize - width),
      deficitY: Math.max(0, minSize - height),
    };
  }
}
