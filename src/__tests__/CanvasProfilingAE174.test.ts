import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installCanvasProfileControls,
  isCanvasProfilingEnabled,
  markCanvasProfile,
  measureCanvasProfile,
  measureCanvasProfileFromTimestamp,
} from '../lib/canvasProfiling';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('AE-174 canvas profiling', () => {
  it('requires the feature flag, a browser window, and a non-production environment', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_ENABLE_CANVAS_PROFILING', 'true');
    vi.stubGlobal('window', {});

    expect(isCanvasProfilingEnabled()).toBe(true);

    vi.stubEnv('NODE_ENV', 'production');
    expect(isCanvasProfilingEnabled()).toBe(false);
  });

  it('starts pointer latency at the supplied PointerEvent timestamp', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_ENABLE_CANVAS_PROFILING', 'true');
    vi.stubGlobal('window', {});
    const measure = vi.spyOn(performance, 'measure');

    measureCanvasProfileFromTimestamp('pointermove->next-raf', 12.5);

    expect(measure).toHaveBeenCalledWith(
      'ae174:pointermove->next-raf',
      expect.objectContaining({ start: 12.5, end: expect.any(Number) })
    );
  });

  it('dumps and clears AE-174 entries and disconnects long-task observation', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_ENABLE_CANVAS_PROFILING', 'true');
    vi.stubGlobal('window', {});
    const disconnect = vi.fn();
    const observe = vi.fn();
    class TestPerformanceObserver {
      static supportedEntryTypes = ['longtask'];
      constructor(callback: PerformanceObserverCallback) { void callback; }
      observe = observe;
      disconnect = disconnect;
      takeRecords() { return []; }
    }
    vi.stubGlobal('PerformanceObserver', TestPerformanceObserver);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const uninstall = installCanvasProfileControls();
    window.__AE174CanvasProfile?.start();
    markCanvasProfile('test-start');
    markCanvasProfile('test-end');
    measureCanvasProfile('test-measure', 'test-start', 'test-end');
    const report = window.__AE174CanvasProfile?.dump();

    expect(observe).toHaveBeenCalledWith({ type: 'longtask', buffered: false });
    expect(disconnect).toHaveBeenCalled();
    expect(report?.measures.map((entry) => entry.name)).toContain('ae174:test-measure');
    expect(performance.getEntriesByType('measure').filter((entry) => entry.name.startsWith('ae174:'))).toHaveLength(0);
    uninstall();
  });
});
