# AE-175 Draw Latency Review

Closes #223

## Browser measurement

The measurement uses the real `AnswerSheetCanvas` in the AE-174 `/ae174-profile` harness. It starts the AE-174 observer, sends one paced 120-move pointer gesture, waits 1.2 seconds, and reports p95 pointer-event-to-next-animation-frame duration and long-task count. The scenario has 200 preloaded strokes at 400% zoom, with Chrome CPU throttling set to 4x and network throttling disabled. This is a headless development-browser measurement, not physical stylus-to-display latency.

| Measurement | Before AE-175 | After AE-175 |
| --- | ---: | ---: |
| Pointer-to-next-rAF p95 | 57.8 ms | 18.5 ms |
| Long tasks during the run | 17 | 2 |
| Pointer samples | 117 | 117 |

The before values are the documented `200 strokes x 4x zoom` AE-174 baseline in [AE-174 Canvas Browser Profile](./AE-174-canvas-profile.md). That run used Headless Chrome 154.0.8037.93. The after run used Headless Chrome 154.0.8037.98 on Windows 64-bit and measured 18.5 ms p95 with 2 long tasks. A repeat run in the same environment measured 18.9 ms p95 and 3 long tasks (117 pointer samples). These are individual scenario runs, not an aggregate benchmark.

The harness calls `4x` the canvas zoom setting; Chrome's separate 4x CPU slowdown is also enabled. The browser script verified the displayed canvas zoom was `400%` before each after run. No network throttling was applied.

## Remaining synchronous stroke-end work

`AnswerSheetCanvas` still calls `serializePageAnnotations` synchronously from `scheduleAutosave`, which is called for every completed stroke. It filters and clones the current page's annotations and strokes before calling `saveLocalAnnotationDraft`. This work runs in the pointer-up/stroke-completion path and can delay that event and a following stroke.

AE-174's `stroke-end->scheduleAutosave` mark is placed immediately before `scheduleAutosave`; it does not include the serialization that happens inside the function. The browser harness does not report a direct serialization duration, so this hotspot remains unmeasured. AE-175 keeps the immediate local-draft update needed by AE-170/172 crash recovery and does not change the serialization flow. The pointermove p95 above measures the live drawing path and does not establish that stroke-end serialization is inexpensive. Measure and address serialization in a focused follow-up if stroke-end latency remains a problem.

## Remaining React render hotspot

AE-175's dedicated Konva layer limits pointermove redraws to the active stroke. It does not prevent `AnswerSheetCanvas` from updating React state and committing after a stroke completes. The AE-174 baseline recorded 23.9 ms p95 for `react-commit-per-stroke` in its 200-stroke/400%-zoom/4x CPU scenario. In the first AE-175 run, the harness recorded one React commit at 197.7 ms; a repeat recorded one at 188.6 ms. Each after value is a single commit sample, not a stable percentile. This indicates the full React commit remains a separate hotspot; AE-175 does not claim to fix it. A targeted React render optimization should be evaluated separately with repeated real-browser samples.

## Persistence changes

Pending drafts remain immediately readable in memory and coalesce by user/script/page. Local serialization and persistence now run through `requestIdleCallback` with a 250 ms timeout when available, with a 250 ms `setTimeout` fallback. A newer draft cancels/replaces the scheduled write, and page navigation (via `flushPendingSave`), pagehide, or hidden visibilitychange forces pending drafts to persist immediately. `memoryStorage` is used only when localStorage is unavailable or a localStorage write fails.

The GitHub PR description is external to the repository. The connected GitHub integration rejected the requested PR #235 body update with HTTP 403, so its `Closes #224` text could not be changed here; no repository file was added to represent the PR body.
