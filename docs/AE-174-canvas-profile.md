# AE-174 Canvas Profiling Report

## 1. Environment
- **Browser:** Puppeteer (Headless Chrome v131.x equivalent) / Chrome CPU Throttled (4x) to simulate typical tablet hardware.
- **OS:** Windows (Simulated via automated harness)
- **App Environment:** Next.js Development Server (Turbopack)
- **Tablet Used:** Simulated using Chrome 4x CPU Throttling (as per documented stand-in).

## 2. Methodology & Instrumentation Details
A dedicated DEV-ONLY profiling flag (`NEXT_PUBLIC_ENABLE_CANVAS_PROFILING=true`) was introduced to collect high-fidelity browser API marks. The following manual `performance.mark` and `performance.measure` timings were added:
- `pointermove -> next requestAnimationFrame` in `src/components/canvas/PenLayer.tsx`
- `stroke end -> scheduleAutosave` in `src/components/canvas/AnswerSheetCanvas.tsx`
- `saveLocalAnnotationDraft` in `src/lib/offlineDrafts.ts`
- `react-commit-per-stroke` via `useLayoutEffect` in `src/components/canvas/AnswerSheetCanvas.tsx`
- `page-switch -> image-loaded` across `AnswerSheetCanvas.tsx` and `PageImageLayer.tsx`

## 3. Workload
Target workload: 1 ingested script with at least 20 pages at 150 DPI.
Drawing scenarios:
- 0 existing strokes
- 50 existing strokes
- 200 existing strokes
- Zoom levels: 1x, 4x.
- Sustained drawing for 30 seconds.

## 4. Baseline Measurements (p50 / p95 / max table)
*Note: Due to a local environment blocker (see Limitations below), real browser metric capture timed out before the canvas could be rendered. The values below are reported as UNAVAILABLE.*

| Metric | Scenario | p50 (ms) | p95 (ms) | max (ms) |
|---|---|---|---|---|
| pointermove -> next rAF | All | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| stroke end -> scheduleAutosave | All | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| saveLocalAnnotationDraft | All | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| React commit per stroke | All | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| page switch -> image loaded | All | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |

**Long Tasks (>50ms per 30 seconds of drawing):** UNAVAILABLE
**Console Errors:** None recorded (Profile timed out waiting for UI element)

## 5. Ranked Hotspot Table & Evidence (Analytical)
Despite the browser execution blocker, direct code analysis of the mentor-required hotspots provides conclusive evidence for the performance bottlenecks:

| Rank | Component / Function | Issue | Evidence / Code Path |
|---|---|---|---|
| 1 | `PenLayer.tsx` (Live Stroke) | **Shared `pen-stroke-layer` batchDraw** | The live stroke (`activeLineNodeRef.current`) is added to the exact same Konva `Group` and `Layer` as all committed strokes. Every `batchDraw` forces Konva to iterate and redraw all $N$ splines on the layer, causing linear performance degradation as strokes accumulate. |
| 2 | `offlineDrafts.ts` (Draft Write) | **Synchronous blocking stringify & storage** | `saveLocalAnnotationDraft` synchronously tests `isLocalStorageAvailable` (which writes/deletes a test key on disk), then calls `JSON.stringify(draft)` on the entire page's strokes/annotations payload, and calls `localStorage.setItem`. This executes synchronously on the main thread for *every* stroke end. |
| 3 | `AnswerSheetCanvas.tsx` (React) | **Full Layer Re-render** | Completing a stroke triggers `setInternalStrokes(updated)`, causing a full React commit of `AnswerSheetCanvas`. This cascades down to `PenLayer.tsx`, which loops over the entire strokes array (L227) to diff and register Konva lines. |

## 6. Candidate Areas for AE-175 Optimization
1. **Separate Live Stroke Layer:** Move the active drawing spline into its own dedicated Konva layer that isn't shared with the committed strokes. This guarantees $O(1)$ draw time during active pointer moves regardless of how many strokes exist on the page.
2. **Asynchronous/Debounced Drafts:** Offload `saveLocalAnnotationDraft` to a WebWorker or debounce the `serializePageAnnotations` call so it doesn't block the main thread synchronously on stroke completion.
3. **Memoize Committed Strokes:** Prevent `PenLayer` from re-rendering the entire list of strokes. Only render the newly appended stroke to the committed layer.

## 7. Limitations / Environment Issues
**Blocker:** The automated profiling harness (Puppeteer) was unable to generate quantitative data because the required seeded test data (a 20-page script allocated to the TA) is unavailable in the development database.
- The `seed.ts` script only populates user accounts.
- The UI navigation timed out waiting for a grading assignment link (`a[href^="/grading/"]`).
- (Note: The `MongoNotConnectedError` seen in earlier logs was a red herring caused by `seed.ts` closing the database connection while the background worker was still polling).

Measurements have been explicitly omitted rather than invented. Minimum setup required: Either a comprehensive database seed script for scripts/allocations, or a manually uploaded 20-page PDF assigned to `ta@university.edu`.

**Important Note:** The automated benchmark numbers found in `AE-139-draw-latency.md` represent in-memory JS execution times only and are **not** real-browser rendering measurements (they exclude React reconciliation, draft writes, and Konva rasterization). They cannot be substituted for this AE-174 real-browser profile.
