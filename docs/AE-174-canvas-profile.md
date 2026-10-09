# AE-174 Canvas Browser Profile

Closes #222

## Environment and workload

- **Browser:** Headless Chrome 154.0.8037.98 (Windows 64-bit; Chrome DevTools Protocol reported `HeadlessChrome/154.0.0.0`).
- **Application:** Next.js 16.2.12 development server using Turbopack.
- **CPU throttling:** Chrome DevTools Protocol `Emulation.setCPUThrottlingRate` at `rate: 4` (4× CPU slowdown). No network throttling.
- **Viewport:** 1440 × 1000 CSS pixels, device scale factor 1.
- **Harness:** `/ae174-profile`, using the real `AnswerSheetCanvas`, its sample SVG page, and 0, 50, or 200 preloaded strokes. Each case used the canvas's 100% or 400% zoom control.
- **Input:** Synthetic browser PointerEvent gestures: 120 pointer moves requested per gesture, paced one animation frame apart, followed by pointer-up. The report shows the pointer-move measurements actually recorded (117–119); this is browser input simulation, not physical stylus digitizer or display presentation latency.
- **Independent runs:** Each benchmark scenario was executed for **3 independent runs** (18 gesture runs total, plus 3 independent runs of page switching). Raw measures and run-by-run reports are preserved in `docs/ae174-raw-benchmark-results.json`.
- **Long tasks:** The observer ran from `window.__AE174CanvasProfile.start()` through the gesture and a 1.2 second settle period. Counts are per gesture run, not a 30-second aggregate.
- **Statistics:** Values in the summary table represent the aggregate statistics across the 3 independent runs. Pointer p50/p95/max are calculated across recorded move samples per run. Percent of frame is `duration ÷ 16.67 ms × 100` (frame-budget share, not CPU utilization). The pointer-to-rAF measure includes event queue scheduling and waiting for the next animation frame.

## Measured baseline

All times are milliseconds. `p95 (% frame)` shows the measured p95 and its share of a 16.67 ms frame. Pointer cells show `p50 / p95 / max` and the p95 frame share. The `n` count is the average number of pointer-to-rAF samples recorded per run.

| Existing strokes × zoom | Pointer to next rAF: p50 / p95 / max; p95 frame share (n) | Konva `batchDraw` call p95 (% frame) | React commit p95 (% frame) | Local draft write p95 (% frame) | Stroke end to autosave scheduling p95 (% frame) | Long tasks |
|---|---:|---:|---:|---:|---:|---:|
| 0 × 1× | 16.6 / 21.9 / 39.0; 131.4% (119) | 1.0 (6.2%) | 128.9 (773.2%) | 1.2 (7.0%) | 1.2 (7.4%) | 1 |
| 0 × 4× | 16.4 / 38.1 / 81.3; 228.8% (117) | 1.1 (6.6%) | 52.5 (314.7%) | 0.5 (3.2%) | 0.7 (4.0%) | 7 |
| 50 × 1× | 19.6 / 25.3 / 32.6; 152.0% (119) | 1.0 (6.0%) | 51.4 (308.3%) | 1.8 (10.6%) | 0.2 (1.0%) | 1 |
| 50 × 4× | 17.2 / 34.4 / 137.3; 206.2% (117) | 0.8 (4.8%) | 50.0 (300.1%) | 1.1 (6.4%) | 0.5 (2.8%) | 6 |
| 200 × 1× | 41.2 / 51.0 / 59.6; 306.1% (119) | 0.3 (1.8%) | 49.7 (298.1%) | 2.0 (12.0%) | 1.9 (11.4%) | 7 |
| 200 × 4× | 27.7 / 47.8 / 99.1; 286.5% (117) | 0.4 (2.6%) | 55.7 (333.9%) | 2.2 (13.0%) | 0.4 (2.6%) | 6 |

### Page-switch baseline

Page switching was measured across 3 independent runs switching between page 1 and page 2 (6 total page transitions):
- **Durations:** 11.4 ms, 19.2 ms, 23.9 ms, 53.5 ms, 56.5 ms, 58.7 ms.
- **p50 / median:** 38.7 ms (232.2% frame share).
- **Max:** 58.7 ms (352.1% frame share).
- **Long tasks:** 3–4 per run.

These numbers establish a reproducible development-browser baseline under 4× CPU throttling. The 200-stroke runs, React commit cycles, and page switches consistently exceed a 16.67 ms frame budget. No claim is made that every input modality or hardware configuration meets a production latency target.

## Analysis of `Konva batchDraw` and timer resolution

In earlier runs, `konva-batchDraw-call` reported approximately `0.5 ms` across scenarios; in the repeated 3-run benchmark, it measured between `0.3 ms` and `1.1 ms` ($p95$). Investigation of the Konva internals and browser instrumentation revealed:

1. **Asynchronous scheduling:** In Konva (`konva.js` L9258), `layer.batchDraw()` does not execute canvas drawing synchronously. Instead, it sets an internal boolean flag (`_waitingForDraw = true`) and schedules a redraw on the animation loop:
   ```javascript
   batchDraw() {
     if (!this._waitingForDraw) {
       this._waitingForDraw = true;
       Util.requestAnimFrame(() => {
         this.draw();
         this._waitingForDraw = false;
       });
     }
     return this;
   }
   ```
2. **Measurement scope:** The `konva-batchDraw-call` metric measures the synchronous invocation time of `batchDraw()`. Because `batchDraw()` only enqueues an animation frame, its synchronous JS execution time is sub-millisecond (~0.1–1.0 ms) regardless of stroke count.
3. **Timer resolution:** Under headless Chrome with 4× CPU slowdown, timer resolution and task scheduling quantize very short operations into discrete sub-millisecond intervals.
4. **Where the actual draw workload lands:** The actual rasterization of the $N$ splines occurs asynchronously within the animation frame callback (`this.draw()`). This workload is captured in the `pointermove->next-raf` metric (which increases from 21.9 ms at 0 strokes to 51.0 ms at 200 strokes) and in the long tasks observer.

## Reproduce the profile

### Option A: Automated benchmark script (recommended)

1. Start the isolated local harness server in PowerShell:
   ```powershell
   $env:AE174_PROFILE_ONLY = 'true'
   $env:NEXT_PUBLIC_ENABLE_CANVAS_PROFILING = 'true'
   npm run dev -- --hostname 127.0.0.1 --port 3000
   ```
2. In a separate terminal, run the automated measurement script:
   ```powershell
   npx tsx src/scripts/profileCanvasAE174.ts
   ```
   The script automatically spawns Headless Chrome with 4× CPU throttling, runs each scenario 3 independent times, logs progress, outputs the summary table, and saves the complete raw JSON data to `docs/ae174-raw-benchmark-results.json`.

### Option B: Interactive DevTools procedure

Open `http://127.0.0.1:3000/ae174-profile` in Chrome 154 or later. In DevTools **Performance**, set CPU to **4x slowdown** and keep network throttling disabled. For each table row, select the stroke-count and zoom buttons first and verify the canvas readout is `100%` or `400%`. Then run this in the Console:

```js
async function runAE174Gesture() {
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
  const rawMeasures = performance.getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith('ae174:'));
  console.table(rawMeasures.map(({ name, duration, startTime }) => ({ name, duration, startTime })));
  const report = window.__AE174CanvasProfile.dump();
  console.log({ longTaskCount: report.longTaskCount, longTasks: report.longTasks });
  return report;
}

const report = await runAE174Gesture();
console.log(report);
```

`dump()` logs and returns the `performance.getEntriesByType('measure')` results for AE-174, disconnects the long-task observer, and clears AE-174 marks and measures.

## Instrumented hotspots

- `PenLayer`: pointer event `e.timeStamp` to the next `requestAnimationFrame`, plus synchronous Konva `batchDraw()` call duration.
- `AnswerSheetCanvas`: stroke-end to autosave scheduling and React commit after stroke completion.
- `offlineDrafts`: local draft serialization and write duration.
- `AnswerSheetCanvas` / `PageImageLayer`: page-switch to image-load duration.
- Long tasks: `PerformanceObserver` entries of type `longtask`, observed only between explicit profile `start()` and `dump()`.

Instrumentation requires the existing `NEXT_PUBLIC_ENABLE_CANVAS_PROFILING=true` flag, a browser `window`, and `process.env.NODE_ENV !== 'production'`. It does not access browser APIs on the server and does not run in production.

## AE-139 result context

AE-139's reported Vitest timings measure in-memory drawing functions, not browser rendering or presentation. They do not substantiate a blanket “100% compliant” browser-performance claim. The browser measurements above are separate and show the exact tested workload and limits.
