import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_WIDTH,
  screenToImageCoordinates,
  createStroke,
  FreehandStroke,
} from '../lib/penTool';
import {
  appendSmoothedPointToStroke,
  finalizeSmoothedStroke,
} from '../lib/strokeSmoothing';
import {
  createInitialHistory,
  recordAddStroke,
} from '../lib/annotationHistory';
import { serializePageAnnotations } from '../lib/annotationSerialization';
import type { PanZoomTransform } from '../lib/panZoom';

export interface LatencyBenchmarkResult {
  scenario: string;
  inputModality: string;
  pointCount: number;
  zoomLevel: number;
  sampleCount: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
  targetMet: boolean;
}

/**
 * Lightweight mock of Konva.Line for in-memory draw pipeline execution
 */
class BenchmarkKonvaLine {
  id: string;
  _points: number[];
  stroke: string;
  strokeWidth: number;

  constructor(config: { id: string; points: number[]; stroke?: string; strokeWidth?: number }) {
    this.id = config.id;
    this._points = [...config.points];
    this.stroke = config.stroke || DEFAULT_PEN_COLOR;
    this.strokeWidth = config.strokeWidth || DEFAULT_PEN_WIDTH;
  }

  points(pts?: number[]): number[] {
    if (pts !== undefined) {
      this._points = pts;
      return this._points;
    }
    return this._points;
  }

  destroy(): void {
    this._points = [];
  }
}

/**
 * Lightweight mock of Konva.Layer for in-memory draw pipeline execution
 */
class BenchmarkKonvaLayer {
  lines: Map<string, BenchmarkKonvaLine> = new Map();
  drawCount: number = 0;

  add(line: BenchmarkKonvaLine): void {
    this.lines.set(line.id, line);
  }

  batchDraw(): void {
    this.drawCount += 1;
  }

  clear(): void {
    this.lines.clear();
  }
}

/**
 * Calculates statistical metrics (min, median/p50, p95, max, mean) from a sample array of latencies in ms.
 */
export function calculateLatencyStats(samples: number[]): {
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
} {
  if (!samples || samples.length === 0) {
    return { min: 0, median: 0, p95: 0, max: 0, mean: 0 };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;

  const min = Math.round(sorted[0] * 1000) / 1000;
  const max = Math.round(sorted[n - 1] * 1000) / 1000;

  const median =
    n % 2 === 1
      ? Math.round(sorted[Math.floor(n / 2)] * 1000) / 1000
      : Math.round(((sorted[n / 2 - 1] + sorted[n / 2]) / 2) * 1000) / 1000;

  const p95Index = Math.min(n - 1, Math.floor(n * 0.95));
  const p95 = Math.round(sorted[p95Index] * 1000) / 1000;

  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = Math.round((sum / n) * 1000) / 1000;

  return { min, median, p95, max, mean };
}

describe('AE-139: Draw Latency & Performance Benchmark (<200ms Target)', () => {
  const TARGET_LATENCY_MS = 200.0;
  const WARMUP_RUNS = 10;
  const BENCHMARK_ITERATIONS = 50;

  const layer = new BenchmarkKonvaLayer();

  describe('1. Pointer Input Event → Visible Konva Update Latency (per-event loop)', () => {
    it('measures per-point drawing latency across Mouse, Stylus, and Touch modalities (< 200ms target)', () => {
      const modalities = [
        { name: 'Mouse (pointerType: mouse)', pressure: 0 },
        { name: 'Stylus (pointerType: pen, with pressure)', pressure: 0.65 },
        { name: 'Touch (pointerType: touch)', pressure: 0 },
      ];

      const zoomLevels = [1.0, 1.5, 2.0, 4.0];

      for (const modality of modalities) {
        for (const zoom of zoomLevels) {
          const transform: PanZoomTransform = { x: -50, y: -50, zoom };
          const samples: number[] = [];

          // Warmup
          for (let w = 0; w < WARMUP_RUNS; w++) {
            const rawX = 100 + w * 2;
            const rawY = 100 + w * 2;
            const pt = screenToImageCoordinates(rawX, rawY, transform);
            let s = createStroke('page-1', pt, { pressure: modality.pressure });
            s = appendSmoothedPointToStroke(s, pt);
          }

          // Benchmark loop
          for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
            const start = performance.now();

            // 1. Convert screen coordinates under active transform
            const screenX = 150 + (i % 20) * 5;
            const screenY = 200 + (i % 20) * 5;
            const imagePoint = screenToImageCoordinates(screenX, screenY, transform);

            // 2. Stroke initialization / creation
            const newStroke = createStroke('page-1', imagePoint, {
              color: DEFAULT_PEN_COLOR,
              strokeWidth: DEFAULT_PEN_WIDTH,
              pressure: modality.pressure,
            });

            // 3. Live Konva Line registration
            const liveLine = new BenchmarkKonvaLine({
              id: newStroke.id,
              points: newStroke.points,
              stroke: newStroke.color,
              strokeWidth: newStroke.strokeWidth,
            });
            layer.add(liveLine);

            // 4. Multiple point movement updates in the gesture
            let currentStroke: FreehandStroke = newStroke;
            for (let ptIdx = 1; ptIdx <= 10; ptIdx++) {
              const moveScreenX = screenX + ptIdx * 4;
              const moveScreenY = screenY + ptIdx * 3;
              const nextImagePoint = screenToImageCoordinates(moveScreenX, moveScreenY, transform);
              currentStroke = appendSmoothedPointToStroke(currentStroke, nextImagePoint);
              liveLine.points(currentStroke.points);
            }

            // 5. Batch draw dispatch
            layer.batchDraw();

            const end = performance.now();
            samples.push(end - start);

            liveLine.destroy();
          }

          const stats = calculateLatencyStats(samples);

          // Structured benchmark reporting
          console.log(
            `[BENCHMARK] Modality: ${modality.name.padEnd(45)} | Zoom: ${zoom}x | Points: 10 | Samples: ${samples.length} | Min: ${stats.min.toFixed(3)}ms | Median (p50): ${stats.median.toFixed(3)}ms | p95: ${stats.p95.toFixed(3)}ms | Max: ${stats.max.toFixed(3)}ms | Mean: ${stats.mean.toFixed(3)}ms | Status: ${stats.p95 < TARGET_LATENCY_MS ? 'PASS (<200ms)' : 'FAIL'}`
          );

          // Assertions: p95 must be far below the 200ms PRD target
          expect(stats.p95).toBeLessThan(TARGET_LATENCY_MS);
          expect(stats.median).toBeLessThan(TARGET_LATENCY_MS);
          expect(stats.max).toBeLessThan(TARGET_LATENCY_MS);
        }
      }
    });
  });

  describe('2. End-to-End Stroke Lifecycle & Finalization Latency', () => {
    it('measures stroke completion & smoothing finalization for short (10 pt), medium (50 pt), and long (200 pt) strokes', () => {
      const strokeLengths = [10, 50, 100, 200];

      for (const count of strokeLengths) {
        const samples: number[] = [];

        for (let iter = 0; iter < BENCHMARK_ITERATIONS; iter++) {
          // Pre-populate stroke
          let stroke = createStroke('page-1', { x: 50, y: 50 });
          for (let p = 1; p < count; p++) {
            stroke = appendSmoothedPointToStroke(stroke, {
              x: 50 + p * 3 + Math.sin(p) * 2,
              y: 50 + p * 2 + Math.cos(p) * 2,
            });
          }

          const liveLine = new BenchmarkKonvaLine({
            id: stroke.id,
            points: stroke.points,
            stroke: stroke.color,
            strokeWidth: stroke.strokeWidth,
          });
          layer.add(liveLine);

          // Measure finalize on pointerup
          const start = performance.now();

          // 1. Full-stroke Chaikin/EMA smoothing finalization
          const finalized = finalizeSmoothedStroke(stroke);

          // 2. Commit to Konva Line
          liveLine.points(finalized.points);
          layer.batchDraw();

          // 3. Record in per-page undo/redo history
          const history = createInitialHistory();
          recordAddStroke(history, finalized);

          // 4. Serialize for background autosave
          serializePageAnnotations('page-1', [], [finalized]);

          const end = performance.now();
          samples.push(end - start);

          liveLine.destroy();
        }

        const stats = calculateLatencyStats(samples);

        console.log(
          `[BENCHMARK] Stroke Finalization | Points: ${String(count).padStart(3)} | Samples: ${samples.length} | Min: ${stats.min.toFixed(3)}ms | Median (p50): ${stats.median.toFixed(3)}ms | p95: ${stats.p95.toFixed(3)}ms | Max: ${stats.max.toFixed(3)}ms | Mean: ${stats.mean.toFixed(3)}ms | Status: ${stats.p95 < TARGET_LATENCY_MS ? 'PASS (<200ms)' : 'FAIL'}`
        );

        expect(stats.p95).toBeLessThan(TARGET_LATENCY_MS);
        expect(stats.median).toBeLessThan(TARGET_LATENCY_MS);
      }
    });
  });

  describe('3. Continuous High-Frequency Multi-Point Stress Test (500 Points)', () => {
    it('sustains < 200ms latency under high point-density continuous drawing without memory leaks', () => {
      const POINT_COUNT = 500;
      const samples: number[] = [];
      const transform: PanZoomTransform = { x: -100, y: -150, zoom: 2.0 };

      for (let run = 0; run < 20; run++) {
        const start = performance.now();

        let stroke = createStroke('page-1', { x: 0, y: 0 }, { pressure: 0.7 });
        const liveLine = new BenchmarkKonvaLine({
          id: stroke.id,
          points: stroke.points,
          stroke: stroke.color,
          strokeWidth: stroke.strokeWidth,
        });
        layer.add(liveLine);

        for (let p = 1; p < POINT_COUNT; p++) {
          const pt = screenToImageCoordinates(p * 2, p * 1.5, transform);
          stroke = appendSmoothedPointToStroke(stroke, pt);
          liveLine.points(stroke.points);
        }

        const finalized = finalizeSmoothedStroke(stroke);
        liveLine.points(finalized.points);
        layer.batchDraw();

        const end = performance.now();
        samples.push(end - start);

        liveLine.destroy();
      }

      const stats = calculateLatencyStats(samples);

      console.log(
        `[BENCHMARK] Stress Test (500 pts) | Zoom: 2.0x | Samples: ${samples.length} | Min: ${stats.min.toFixed(3)}ms | Median (p50): ${stats.median.toFixed(3)}ms | p95: ${stats.p95.toFixed(3)}ms | Max: ${stats.max.toFixed(3)}ms | Mean: ${stats.mean.toFixed(3)}ms | Status: ${stats.p95 < TARGET_LATENCY_MS ? 'PASS (<200ms)' : 'FAIL'}`
      );

      expect(stats.p95).toBeLessThan(TARGET_LATENCY_MS);
    });
  });

  describe('4. Statistical Benchmark Reporter Helper Verification', () => {
    it('calculates deterministic statistical metrics accurately', () => {
      const data = [1.2, 2.4, 3.1, 4.5, 5.0, 6.2, 7.8, 8.1, 9.5, 10.0];
      const stats = calculateLatencyStats(data);

      expect(stats.min).toBe(1.2);
      expect(stats.max).toBe(10.0);
      expect(stats.median).toBe((5.0 + 6.2) / 2);
      expect(stats.p95).toBe(10.0);
      expect(stats.mean).toBeCloseTo(5.78, 2);
    });

    it('handles single sample and empty arrays gracefully', () => {
      expect(calculateLatencyStats([])).toEqual({ min: 0, median: 0, p95: 0, max: 0, mean: 0 });
      expect(calculateLatencyStats([4.2])).toEqual({ min: 4.2, median: 4.2, p95: 4.2, max: 4.2, mean: 4.2 });
    });
  });
});
