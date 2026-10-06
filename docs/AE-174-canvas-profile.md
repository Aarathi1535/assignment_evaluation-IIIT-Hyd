# AE-174 Canvas Browser Profile

Closes #222

## Environment and workload

- **Browser:** Headless Chrome 154.0.8037.93 (Windows 64-bit; Chrome DevTools Protocol reported `HeadlessChrome/154.0.0.0`).
- **Application:** Next.js 16.2.12 development server using Turbopack.
- **CPU throttling:** Chrome DevTools Protocol `Emulation.setCPUThrottlingRate` at `rate: 4` (4× CPU slowdown). No network throttling.
- **Viewport:** 1440 × 1000 CSS pixels, device scale factor 1.
- **Harness:** `/ae174-profile`, using the real `AnswerSheetCanvas`, its sample SVG page, and 0, 50, or 200 preloaded strokes. Each case used the canvas's 100% or 400% zoom control.
- **Input:** One synthetic browser PointerEvent gesture per case: 120 pointer moves requested, paced one animation frame apart, followed by pointer-up. The report shows the pointer-move measurements actually recorded (117–119); this is browser input simulation, not physical stylus or display-present latency.
- **Long tasks:** The observer ran from `window.__AE174CanvasProfile.start()` through the gesture and a 1.2 second settle period. Counts are per single scenario run, not a 30-second aggregate.
- **Statistics:** Pointer p50/p95/max are across the recorded move samples in that single run. Other hotspots were one-shot measurements unless otherwise shown. Percent of frame is `duration ÷ 16.67 ms × 100`; it is a budget comparison, not CPU utilization. The pointer-to-rAF measure includes scheduling and waiting for the next frame.

## Measured baseline

All times are milliseconds. `p95 (% frame)` shows the measured p95 and its share of a 16.67 ms frame. Pointer cells show `p50 / p95 / max` and the p95 frame share. The `n` count is the number of pointer-to-rAF samples recorded.

| Existing strokes × zoom | Pointer to next rAF: p50 / p95 / max; p95 frame share (n) | Konva `batchDraw` call p95 (% frame) | React commit p95 (% frame) | Local draft write p95 (% frame) | Stroke end to autosave scheduling p95 (% frame) | Long tasks |
|---|---:|---:|---:|---:|---:|---:|
| 0 × 1× | 16.1 / 27.4 / 58.0; 164.4% (119) | 0.5 (3.0%) | 25.3 (151.8%) | 0.2 (1.2%) | 0.3 (1.8%) | 1 |
| 0 × 4× | 16.4 / 22.8 / 40.5; 136.8% (117) | 0.5 (3.0%) | 56.3 (337.7%) | 1.5 (9.0%) | 0.5 (3.0%) | 1 |
| 50 × 1× | 22.3 / 35.2 / 112.0; 211.2% (119) | 0.5 (3.0%) | 43.4 (260.3%) | 0.4 (2.4%) | 0.7 (4.2%) | 4 |
| 50 × 4× | 19.9 / 45.1 / 75.8; 270.5% (117) | 0.5 (3.0%) | 26.4 (158.4%) | 1.5 (9.0%) | 0.9 (5.4%) | 5 |
| 200 × 1× | 64.7 / 127.8 / 210.5; 766.6% (119) | 0.5 (3.0%) | 49.6 (297.5%) | 0.5 (3.0%) | 0.2 (1.2%) | 111 |
| 200 × 4× | 42.7 / 57.8 / 96.4; 346.7% (117) | 0.5 (3.0%) | 23.9 (143.4%) | 1.8 (10.8%) | 0.3 (1.8%) | 17 |

The page-switch measure was captured separately by switching to page 2 and back once: 35.1 ms and 96.1 ms (`n=2`; p50 35.1 ms, max 96.1 ms). The corresponding frame-budget ratios are 210.6% and 576.6%. That run observed 2 long tasks.

These numbers are a reproducible development-browser baseline, not a production build or physical tablet result. The 200-stroke runs and the React commit / pointer-to-rAF values exceed one 16.67 ms frame under this setup. No claim is made here that every input modality or hardware configuration meets a production latency target.

## Reproduce the profile

Start the isolated local harness without starting the app's database connection or ingestion worker. In PowerShell:

```powershell
$env:AE174_PROFILE_ONLY = 'true'
$env:NEXT_PUBLIC_ENABLE_CANVAS_PROFILING = 'true'
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000/ae174-profile` in Chrome 154 or later. In DevTools **Performance**, set CPU to **4x slowdown** and keep network throttling disabled. For each table row, select the stroke-count and zoom buttons first and verify the canvas readout is `100%` or `400%`. Then run this in the Console. It starts a fresh observation, dispatches one paced 120-move pointer gesture to the actual Konva canvas surface, and waits 1.2 seconds for draft-save work to settle:

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

`dump()` logs and returns the `performance.getEntriesByType('measure')` results for AE-174, disconnects the long-task observer, and clears AE-174 marks and measures. The harness controls are dev-only and use sample data; the route returns not found in production.

## Instrumented hotspots

- `PenLayer`: pointer event `e.timeStamp` to the next `requestAnimationFrame`, plus synchronous Konva `batchDraw()` call duration.
- `AnswerSheetCanvas`: stroke-end to autosave scheduling and React commit after stroke completion.
- `offlineDrafts`: local draft serialization and write duration.
- `AnswerSheetCanvas` / `PageImageLayer`: page-switch to image-load duration.
- Long tasks: `PerformanceObserver` entries of type `longtask`, observed only between explicit profile `start()` and `dump()`.

Instrumentation requires the existing `NEXT_PUBLIC_ENABLE_CANVAS_PROFILING=true` flag, a browser `window`, and `process.env.NODE_ENV !== 'production'`. It does not access browser APIs on the server and does not run in production.

## AE-139 result context

AE-139's reported Vitest timings measure in-memory drawing functions, not browser rendering or presentation. They do not substantiate a blanket “100% compliant” browser-performance claim. The browser measurements above are separate and show the exact tested workload and limits.
