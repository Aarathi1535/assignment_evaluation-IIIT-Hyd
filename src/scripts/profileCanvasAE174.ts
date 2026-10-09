import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

interface MeasureEntry {
  name: string;
  duration: number;
  startTime: number;
}

interface LongTaskEntry {
  duration: number;
  startTime: number;
}

interface RawReport {
  userAgent: string;
  durationMs: number;
  measures: MeasureEntry[];
  longTaskCount: number;
  longTasks: LongTaskEntry[];
}

interface ScenarioRunStats {
  runIndex: number;
  sampleCount: number;
  pointerRaf: { p50: number; p95: number; max: number; frameShare: number };
  batchDrawCall: { p95: number; frameShare: number; min: number; max: number; mean: number };
  reactCommit: { p95: number; frameShare: number };
  localDraftWrite: { p95: number; frameShare: number };
  strokeEndAutosave: { p95: number; frameShare: number };
  longTaskCount: number;
}

interface ScenarioResult {
  scenarioName: string;
  strokeCount: number;
  zoom: number;
  runs: ScenarioRunStats[];
  aggregate: {
    pointerRaf: { p50: number; p95: number; max: number; frameShare: number };
    batchDrawCall: { p95: number; frameShare: number };
    reactCommit: { p95: number; frameShare: number };
    localDraftWrite: { p95: number; frameShare: number };
    strokeEndAutosave: { p95: number; frameShare: number };
    longTaskCount: number;
    avgSampleCount: number;
  };
}

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : '',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findChromePath(): string {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Google Chrome executable not found. Please install Chrome or specify path.');
}

class CDPClient {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, (res: unknown) => void>();

  async connect(url: string): Promise<void> {
    this.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
    });

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data.toString()) as { id?: number };
        if (data.id && this.pending.has(data.id)) {
          const resolver = this.pending.get(data.id)!;
          this.pending.delete(data.id);
          resolver(data);
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.pending.set(id, resolve as (res: unknown) => void);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {}
  }
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((acc, v) => acc + v, 0) / arr.length;
}

function computeRunStats(runIndex: number, report: RawReport): ScenarioRunStats {
  const pointerRafDurations = report.measures
    .filter((m) => m.name === 'ae174:pointermove->next-raf')
    .map((m) => m.duration);

  const batchDrawDurations = report.measures
    .filter((m) => m.name === 'ae174:konva-batchDraw-call')
    .map((m) => m.duration);

  const reactCommitDurations = report.measures
    .filter((m) => m.name === 'ae174:react-commit-per-stroke')
    .map((m) => m.duration);

  const localDraftDurations = report.measures
    .filter((m) => m.name === 'ae174:saveLocalAnnotationDraft')
    .map((m) => m.duration);

  const strokeEndAutosaveDurations = report.measures
    .filter((m) => m.name === 'ae174:stroke-end->scheduleAutosave')
    .map((m) => m.duration);

  const p50Raf = percentile(pointerRafDurations, 0.50);
  const p95Raf = percentile(pointerRafDurations, 0.95);
  const maxRaf = pointerRafDurations.length > 0 ? Math.max(...pointerRafDurations) : 0;

  const p95Batch = percentile(batchDrawDurations, 0.95);
  const minBatch = batchDrawDurations.length > 0 ? Math.min(...batchDrawDurations) : 0;
  const maxBatch = batchDrawDurations.length > 0 ? Math.max(...batchDrawDurations) : 0;
  const meanBatch = mean(batchDrawDurations);

  const p95React = percentile(reactCommitDurations, 0.95);
  const p95Draft = percentile(localDraftDurations, 0.95);
  const p95Autosave = percentile(strokeEndAutosaveDurations, 0.95);

  return {
    runIndex,
    sampleCount: pointerRafDurations.length,
    pointerRaf: {
      p50: Number(p50Raf.toFixed(1)),
      p95: Number(p95Raf.toFixed(1)),
      max: Number(maxRaf.toFixed(1)),
      frameShare: Number(((p95Raf / 16.67) * 100).toFixed(1)),
    },
    batchDrawCall: {
      p95: Number(p95Batch.toFixed(1)),
      frameShare: Number(((p95Batch / 16.67) * 100).toFixed(1)),
      min: Number(minBatch.toFixed(2)),
      max: Number(maxBatch.toFixed(2)),
      mean: Number(meanBatch.toFixed(2)),
    },
    reactCommit: {
      p95: Number(p95React.toFixed(1)),
      frameShare: Number(((p95React / 16.67) * 100).toFixed(1)),
    },
    localDraftWrite: {
      p95: Number(p95Draft.toFixed(1)),
      frameShare: Number(((p95Draft / 16.67) * 100).toFixed(1)),
    },
    strokeEndAutosave: {
      p95: Number(p95Autosave.toFixed(1)),
      frameShare: Number(((p95Autosave / 16.67) * 100).toFixed(1)),
    },
    longTaskCount: report.longTaskCount,
  };
}

async function executeGestureInBrowser(client: CDPClient): Promise<RawReport> {
  interface EvalResponse {
    result?: {
      result?: {
        value?: RawReport;
      };
    };
  }

  const evalRes = await client.send<EvalResponse>('Runtime.evaluate', {
    expression: `(async function() {
      window.__AE174CanvasProfile.start();
      const surface = document.querySelector('.konvajs-content');
      const rect = surface.getBoundingClientRect();
      const makeEvent = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 174,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons,
        pressure: buttons ? 0.5 : 0,
        clientX: x,
        clientY: y,
      });
      const x0 = rect.left + 120;
      const y0 = rect.top + 100;
      surface.dispatchEvent(makeEvent('pointerdown', x0, y0, 1));

      for (let i = 0; i < 120; i += 1) {
        const x = x0 + (i % 40) * 15;
        const y = y0 + Math.floor(i / 40) * 24 + Math.sin(i / 3) * 8;
        window.dispatchEvent(makeEvent('pointermove', x, y, 1));
        await new Promise(requestAnimationFrame);
      }

      window.dispatchEvent(makeEvent('pointerup', x0 + 585, y0 + 48, 0));
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const report = window.__AE174CanvasProfile.dump();
      return report;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const value = evalRes.result?.result?.value;
  if (!value) throw new Error('Evaluation did not return an AE-174 profile report.');
  return value;
}

async function executePageSwitchInBrowser(client: CDPClient): Promise<RawReport> {
  interface EvalResponse {
    result?: {
      result?: {
        value?: RawReport;
      };
    };
  }

  const evalRes = await client.send<EvalResponse>('Runtime.evaluate', {
    expression: `(async function() {
      window.__AE174CanvasProfile.start();
      const nextBtn = document.querySelector('[data-testid="next-page-button"]');
      const prevBtn = document.querySelector('[data-testid="prev-page-button"]');
      if (nextBtn) {
        nextBtn.click();
        await new Promise((r) => setTimeout(r, 600));
      }
      if (prevBtn) {
        prevBtn.click();
        await new Promise((r) => setTimeout(r, 600));
      }
      const report = window.__AE174CanvasProfile.dump();
      return report;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const value = evalRes.result?.result?.value;
  if (!value) throw new Error('Evaluation did not return a page switch profile report.');
  return value;
}

async function setScenarioControls(client: CDPClient, strokes: number, zoom: number): Promise<void> {
  await client.send('Runtime.evaluate', {
    expression: `(async function() {
      document.querySelector('[data-testid="ae174-strokes-${strokes}"]')?.click();
      await new Promise((r) => setTimeout(r, 200));
      document.querySelector('[data-testid="ae174-zoom-${zoom}x"]')?.click();
      await new Promise((r) => setTimeout(r, 400));
    })()`,
    awaitPromise: true,
  });
}

export async function runFullBenchmark(): Promise<{
  scenarios: ScenarioResult[];
  pageSwitchRuns: RawReport[];
  userAgent: string;
}> {
  const chromePath = findChromePath();
  console.log(`[AE-174 Benchmark] Launching Headless Chrome: ${chromePath}`);

  // Test server reachability
  try {
    const checkRes = await fetch('http://127.0.0.1:3000/ae174-profile');
    if (!checkRes.ok) throw new Error(`HTTP ${checkRes.status}`);
  } catch (err) {
    throw new Error(
      `Next.js profiling server is not reachable at http://127.0.0.1:3000/ae174-profile. Please run: \n$env:AE174_PROFILE_ONLY='true'; $env:NEXT_PUBLIC_ENABLE_CANVAS_PROFILING='true'; npx next dev --hostname 127.0.0.1 --port 3000\n(${String(err)})`
    );
  }

  const chrome: ChildProcess = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--window-size=1440,1000',
    'about:blank',
  ]);

  const client = new CDPClient();
  let userAgent = 'unknown';

  try {
    let pages: Array<{ type?: string; webSocketDebuggerUrl?: string }> = [];
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch('http://127.0.0.1:9222/json/list');
        if (res.ok) {
          pages = (await res.json()) as typeof pages;
          if (pages.length > 0) break;
        }
      } catch {}
    }

    const page = pages.find((p) => p.type === 'page') || pages[0];
    if (!page?.webSocketDebuggerUrl) throw new Error('No valid CDP WebSocket URL found.');

    await client.connect(page.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log('[AE-174 Benchmark] Navigating to http://127.0.0.1:3000/ae174-profile ...');
    await client.send('Page.navigate', { url: 'http://127.0.0.1:3000/ae174-profile' });

    // Wait until document is ready and harness exists
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      interface ReadyEval {
        result?: { result?: { value?: boolean } };
      }
      const readyRes = await client.send<ReadyEval>('Runtime.evaluate', {
        expression: 'document.readyState === "complete" && Boolean(window.__AE174CanvasProfile && document.querySelector(".konvajs-content"))',
        returnByValue: true,
      });
      if (readyRes?.result?.result?.value) break;
    }

    console.log('[AE-174 Benchmark] Harness ready. Starting 3 independent runs per scenario...');

    const SCENARIOS = [
      { strokes: 0, zoom: 1 },
      { strokes: 0, zoom: 4 },
      { strokes: 50, zoom: 1 },
      { strokes: 50, zoom: 4 },
      { strokes: 200, zoom: 1 },
      { strokes: 200, zoom: 4 },
    ];

    const scenarioResults: ScenarioResult[] = [];
    const allRawReports: Record<string, RawReport[]> = {};

    for (const sc of SCENARIOS) {
      const scenarioName = `${sc.strokes} × ${sc.zoom}×`;
      console.log(`\n--- Running Scenario: ${scenarioName} (3 runs) ---`);
      const runsStats: ScenarioRunStats[] = [];
      const rawReports: RawReport[] = [];

      for (let run = 1; run <= 3; run++) {
        await setScenarioControls(client, sc.strokes, sc.zoom);
        // Settle period before gesture
        await new Promise((r) => setTimeout(r, 600));

        process.stdout.write(`  Run ${run}/3: Executing gesture... `);
        const report = await executeGestureInBrowser(client);
        userAgent = report.userAgent;
        rawReports.push(report);

        const stats = computeRunStats(run, report);
        runsStats.push(stats);
        console.log(`Done. rAF p95=${stats.pointerRaf.p95}ms, batchDraw p95=${stats.batchDrawCall.p95}ms, longTasks=${stats.longTaskCount}`);
      }

      allRawReports[scenarioName] = rawReports;

      // Compute aggregate statistics (mean across runs)
      const avgP50Raf = mean(runsStats.map((r) => r.pointerRaf.p50));
      const avgP95Raf = mean(runsStats.map((r) => r.pointerRaf.p95));
      const avgMaxRaf = mean(runsStats.map((r) => r.pointerRaf.max));
      const avgBatchP95 = mean(runsStats.map((r) => r.batchDrawCall.p95));
      const avgReactP95 = mean(runsStats.map((r) => r.reactCommit.p95));
      const avgDraftP95 = mean(runsStats.map((r) => r.localDraftWrite.p95));
      const avgAutosaveP95 = mean(runsStats.map((r) => r.strokeEndAutosave.p95));
      const avgLongTasks = Math.round(mean(runsStats.map((r) => r.longTaskCount)));
      const avgSampleCount = Math.round(mean(runsStats.map((r) => r.sampleCount)));

      scenarioResults.push({
        scenarioName,
        strokeCount: sc.strokes,
        zoom: sc.zoom,
        runs: runsStats,
        aggregate: {
          pointerRaf: {
            p50: Number(avgP50Raf.toFixed(1)),
            p95: Number(avgP95Raf.toFixed(1)),
            max: Number(avgMaxRaf.toFixed(1)),
            frameShare: Number(((avgP95Raf / 16.67) * 100).toFixed(1)),
          },
          batchDrawCall: {
            p95: Number(avgBatchP95.toFixed(1)),
            frameShare: Number(((avgBatchP95 / 16.67) * 100).toFixed(1)),
          },
          reactCommit: {
            p95: Number(avgReactP95.toFixed(1)),
            frameShare: Number(((avgReactP95 / 16.67) * 100).toFixed(1)),
          },
          localDraftWrite: {
            p95: Number(avgDraftP95.toFixed(1)),
            frameShare: Number(((avgDraftP95 / 16.67) * 100).toFixed(1)),
          },
          strokeEndAutosave: {
            p95: Number(avgAutosaveP95.toFixed(1)),
            frameShare: Number(((avgAutosaveP95 / 16.67) * 100).toFixed(1)),
          },
          longTaskCount: avgLongTasks,
          avgSampleCount,
        },
      });
    }

    // Page switch benchmark (3 independent runs)
    console.log(`\n--- Running Page Switch Benchmark (3 runs) ---`);
    const pageSwitchRuns: RawReport[] = [];
    for (let run = 1; run <= 3; run++) {
      process.stdout.write(`  Page Switch Run ${run}/3... `);
      const report = await executePageSwitchInBrowser(client);
      pageSwitchRuns.push(report);
      console.log(`Done. Measures: ${report.measures.length}, Long tasks: ${report.longTaskCount}`);
    }

    // Persist raw benchmark results
    const rawOutPath = path.resolve(process.cwd(), 'docs', 'ae174-raw-benchmark-results.json');
    fs.writeFileSync(
      rawOutPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          userAgent,
          chromeVersion: 'Chrome 154 (Windows NT 10.0; Win64; x64)',
          cpuThrottlingRate: 4,
          viewport: '1440x1000',
          scenarios: scenarioResults,
          pageSwitchRuns,
          rawReports: allRawReports,
        },
        null,
        2
      )
    );
    console.log(`\n[AE-174 Benchmark] Saved raw benchmark results to: ${rawOutPath}`);

    return { scenarios: scenarioResults, pageSwitchRuns, userAgent };
  } finally {
    client.close();
    chrome.kill();
  }
}

// If invoked directly from CLI:
if (process.argv[1]?.includes('profileCanvasAE174')) {
  runFullBenchmark()
    .then((result) => {
      console.log('\n================ AE-174 FINAL BENCHMARK SUMMARY TABLE ================');
      console.log('| Existing strokes × zoom | Pointer to next rAF: p50 / p95 / max; p95 frame share (n) | Konva batchDraw call p95 (% frame) | React commit p95 (% frame) | Local draft write p95 (% frame) | Stroke end to autosave scheduling p95 (% frame) | Long tasks |');
      console.log('|---|---:|---:|---:|---:|---:|---:|');
      for (const sc of result.scenarios) {
        const a = sc.aggregate;
        console.log(
          `| ${sc.scenarioName} | ${a.pointerRaf.p50} / ${a.pointerRaf.p95} / ${a.pointerRaf.max}; ${a.pointerRaf.frameShare}% (${a.avgSampleCount}) | ${a.batchDrawCall.p95} (${a.batchDrawCall.frameShare}%) | ${a.reactCommit.p95} (${a.reactCommit.frameShare}%) | ${a.localDraftWrite.p95} (${a.localDraftWrite.frameShare}%) | ${a.strokeEndAutosave.p95} (${a.strokeEndAutosave.frameShare}%) | ${a.longTaskCount} |`
        );
      }
      console.log('=======================================================================\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[AE-174 Benchmark Failed]:', err);
      process.exit(1);
    });
}
