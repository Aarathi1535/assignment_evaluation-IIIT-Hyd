const PROFILE_PREFIX = 'ae174:';

export interface CanvasProfileReport {
  userAgent: string;
  durationMs: number;
  measures: Array<{ name: string; duration: number; startTime: number }>;
  longTaskCount: number;
  longTasks: Array<{ duration: number; startTime: number }>;
}

declare global {
  interface Window {
    __AE174CanvasProfile?: {
      start: () => void;
      dump: () => CanvasProfileReport | null;
    };
  }
}

export function isCanvasProfilingEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_ENABLE_CANVAS_PROFILING === 'true' &&
    typeof window !== 'undefined' &&
    typeof performance !== 'undefined';
}

function profileName(name: string): string {
  return `${PROFILE_PREFIX}${name}`;
}

export function markCanvasProfile(name: string): void {
  if (!isCanvasProfilingEnabled()) return;
  const fullName = profileName(name);
  performance.clearMarks(fullName);
  performance.mark(fullName);
}

export function measureCanvasProfile(name: string, start: string, end: string): void {
  if (!isCanvasProfilingEnabled()) return;
  const startName = profileName(start);
  const endName = profileName(end);
  const hasStart = performance.getEntriesByName(startName, 'mark').length > 0;
  const hasEnd = performance.getEntriesByName(endName, 'mark').length > 0;
  if (hasStart && hasEnd) {
    performance.measure(profileName(name), { start: startName, end: endName });
  }
  performance.clearMarks(startName);
  performance.clearMarks(endName);
}

export function measureCanvasProfileFromTimestamp(name: string, startTime: number): void {
  if (!isCanvasProfilingEnabled() || !Number.isFinite(startTime)) return;
  performance.measure(profileName(name), { start: startTime, end: performance.now() });
}

export function measureCanvasProfileBetweenTimes(name: string, startTime: number, endTime: number): void {
  if (!isCanvasProfilingEnabled() || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return;
  performance.measure(profileName(name), { start: startTime, end: endTime });
}

function clearCanvasProfileEntries(): void {
  for (const entry of performance.getEntriesByType('mark')) {
    if (entry.name.startsWith(PROFILE_PREFIX)) performance.clearMarks(entry.name);
  }
  for (const entry of performance.getEntriesByType('measure')) {
    if (entry.name.startsWith(PROFILE_PREFIX)) performance.clearMeasures(entry.name);
  }
}

/** Installs explicit DevTools controls; long-task observation runs only between start() and dump(). */
export function installCanvasProfileControls(): () => void {
  if (!isCanvasProfilingEnabled()) return () => {};

  let observer: PerformanceObserver | null = null;
  let startedAt: number | null = null;
  let longTasks: PerformanceEntry[] = [];

  const stopObserver = () => {
    observer?.disconnect();
    observer = null;
  };

  const controls = {
    start() {
      stopObserver();
      clearCanvasProfileEntries();
      longTasks = [];
      startedAt = performance.now();

      if (typeof PerformanceObserver !== 'undefined' &&
          PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        observer = new PerformanceObserver((list) => {
          longTasks.push(...list.getEntries());
        });
        observer.observe({ type: 'longtask', buffered: false });
      }
    },
    dump() {
      if (startedAt === null) return null;
      if (observer) longTasks.push(...observer.takeRecords());
      stopObserver();

      const endedAt = performance.now();
      const measures = performance.getEntriesByType('measure')
        .filter((entry) => entry.name.startsWith(PROFILE_PREFIX) && entry.startTime >= startedAt!)
        .map((entry) => ({ name: entry.name, duration: entry.duration, startTime: entry.startTime }));
      const runLongTasks = longTasks
        .filter((entry) => entry.startTime >= startedAt! && entry.startTime < endedAt)
        .map((entry) => ({ duration: entry.duration, startTime: entry.startTime }));
      const report: CanvasProfileReport = {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        durationMs: endedAt - startedAt,
        measures,
        longTaskCount: runLongTasks.length,
        longTasks: runLongTasks,
      };

      console.log('[AE-174 canvas profile]', report);
      startedAt = null;
      longTasks = [];
      clearCanvasProfileEntries();
      return report;
    },
  };

  window.__AE174CanvasProfile = controls;
  return () => {
    stopObserver();
    startedAt = null;
    longTasks = [];
    clearCanvasProfileEntries();
    if (window.__AE174CanvasProfile === controls) delete window.__AE174CanvasProfile;
  };
}
