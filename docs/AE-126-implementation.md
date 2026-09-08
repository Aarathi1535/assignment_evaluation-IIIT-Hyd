# AE-126 — Freehand Pen Tool (Stylus, Touch & Mouse)

## What was implemented

In AE-126, we implemented a hardware-accelerated, pressure-responsive Freehand Pen Tool that enables instructors and teaching assistants to annotate and scribble directly over scanned answer-sheet pages in real-time, built cleanly upon our Konva scene-graph (AE-122), image scaling (AE-123), pan/zoom transform system (AE-124), and multi-page isolation engine (AE-125):

1. **Freehand Pen Mathematical Utilities (`src/lib/penTool.ts`)**: Pure functions for invariant coordinate conversion under dynamic viewport pan/zoom, conservative pressure-to-width scaling, unique stroke generation, point appending, and page-specific stroke filtering.
2. **Dedicated Konva Pen Layer (`src/components/canvas/PenLayer.tsx`)**: Independent hardware-accelerated scene layer positioned strictly above `PageImageLayer`. Uses a transformed `Konva.Group` synchronized with the active viewport transform $(x, y, \text{zoom})$ so strokes remain visually locked to their exact image features across pan, zoom, reset-to-fit, and window resizing.
3. **Unified Pointer Event Pipeline**: Native `PointerEvent` listeners (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) supporting mouse, touch screen, and digital stylus inputs with zero lag or render jank.
4. **Accessible Pen Mode Toggle**: Accessible toolbar button with clear active state styling, `aria-pressed`, keyboard focus, and keyboard activation (`P` key / click / Enter / Space).
5. **Pressure-Aware Stroke Scaling**: Automatically detects `PointerEvent.pressure` (0.0 to 1.0) and scales stroke width conservatively (from $0.5\times$ to $1.75\times$), falling back smoothly to the default base width (3px) on non-pressure devices.
6. **Multi-Page In-Memory Isolation**: In-memory session strokes are partitioned strictly by `pageKey`. Switching between pages isolates drawings completely with zero leakage; returning to a previously annotated page instantly restores its in-memory strokes.
7. **Focused Test Suite (`src/__tests__/FreehandPenTool.test.ts`)**: 16 dedicated unit tests validating coordinate transformations, pressure sensitivity, point appending, stroke generation, multi-page isolation, and immutability.

---

## Pointer Event Handling

- **Event Pipeline**: Leverages modern W3C Pointer Events directly on the stage container:
  - `pointerdown`: Detects primary button/stylus touch, initializes a new `FreehandStroke`, and attaches a live `Konva.Line` node to the scene group for real-time rendering.
  - `pointermove`: Appends transformed coordinates to the active stroke and invokes `layer.batchDraw()` directly on the GPU without triggering costly React component re-renders.
  - `pointerup` & `pointercancel`: Finalizes the completed stroke (if $\ge 2$ points) and commits it to the page's in-memory stroke list.
- **Gesture Conflict Prevention**:
  - When Pen Mode is **OFF**: Standard AE-124 pan/zoom mouse dragging and single-finger panning operate normally.
  - When Pen Mode is **ON**: Single-pointer dragging creates freehand strokes, while mouse-wheel zoom and two-finger pinch-to-zoom continue functioning unimpeded.

---

## Stroke Representation

Each stroke is modeled as an immutable JavaScript object:
```typescript
export interface FreehandStroke {
  id: string;          // Unique identifier, e.g. "stroke_1725790000000_1_abc12"
  pageKey: string | number; // Binds stroke to page ID or page index
  points: number[];    // Flat array of alternating coordinates [x0, y0, x1, y1, ...] in base image space
  color: string;       // Default grading red "#e11d48"
  strokeWidth: number; // Computed width (default 3px or pressure-scaled)
  createdAt: number;   // Epoch timestamp
}
```

---

## Coordinate Transformation

Drawing must maintain pixel-perfect alignment with the underlying scanned answer sheet regardless of pan offsets or magnification levels:
- **Screen to Image**:
  $$\text{imageX} = \frac{\text{screenX} - \text{transform.x}}{\text{transform.zoom}}$$
  $$\text{imageY} = \frac{\text{screenY} - \text{transform.y}}{\text{transform.zoom}}$$
- **Image to Screen**:
  $$\text{screenX} = \text{transform.x} + \text{imageX} \times \text{transform.zoom}$$
  $$\text{screenY} = \text{transform.y} + \text{imageY} \times \text{transform.zoom}$$
- **Konva Group Transform**:
  - All rendered lines are placed inside a `Konva.Group` with `position({ x: transform.x, y: transform.y })` and `scale({ x: transform.zoom, y: transform.zoom })`.
  - When the user zooms from $100\%$ to $400\%$ or pans across the page, Konva transforms the entire group in hardware. Point coordinates never need to be recomputed or re-allocated during viewport navigation.

---

## Pressure Sensitivity

- For devices supporting `PointerEvent.pressure` (e.g. Apple Pencil, Microsoft Surface Pen, Wacom, pressure-enabled stylus):
  $$\text{width} = \text{baseWidth} \times (0.5 + \text{pressure} \times 1.25)$$
  - Light touch ($\text{pressure} = 0.1$): $\approx 1.88\text{px}$
  - Normal touch ($\text{pressure} = 0.5$): $\approx 3.38\text{px}$
  - Heavy touch ($\text{pressure} = 1.0$): $\approx 5.25\text{px}$
- For standard mice or non-pressure touchscreens ($\text{pressure} = 0$, `undefined`, or $> 1.0$), the tool falls back reliably to `DEFAULT_PEN_WIDTH = 3px`.

---

## Multi-Page In-Memory Behavior

- When navigating through multi-page answer scripts (AE-125):
  1. Each stroke is tagged with `pageKey = currentPage._id || activePageIndex`.
  2. `AnswerSheetCanvas` stores `allStrokes` in session state.
  3. `PenLayer` receives only `currentPageStrokes = filterStrokesByPage(allStrokes, currentPageKey)`.
  4. Moving from Page 1 to Page 2 clears Page 1's strokes from view and displays only Page 2's annotations.
  5. Navigating back to Page 1 seamlessly restores all previously drawn strokes.
  6. Annotations remain strictly in-memory; no network requests or MongoDB writes are made.

---

## Pan/Zoom Interaction

- Preserves all AE-124 capabilities:
  - Wheel zooming centered around cursor.
  - Multi-touch pinch-to-zoom.
  - Stepped zoom controls ($-$ / $+$ / Reset to Fit).
  - Window resizing via `ResizeObserver`.
- Disables drag-panning only while in active pen drawing mode so dragging draws ink lines instead of shifting the canvas.

---

## Accessibility

- Semantic `<button type="button">` with `aria-pressed={activePenMode}` and `aria-label="Toggle Freehand Pen Tool"`.
- Keyboard focus support with visible focus ring (`focus:ring-2 focus:ring-blue-500`).
- Dynamic visual feedback: active pen button highlights in blue (`bg-blue-600 text-white`), and canvas cursor shifts to `crosshair`.

---

## Tests & Validation

### Focused Suites:
1. `src/__tests__/FreehandPenTool.test.ts` (16 tests):
   - Default pen style and unique ID generation.
   - Pressure sensitivity calculations and graceful fallback.
   - Stroke lifecycle: creation, immutable point appending, and finalization.
   - Coordinate transformation invariance across 1.0x, 2.0x, 2.5x, and 4.0x zoom.
   - Multi-page in-memory isolation and navigation simulation.
2. `src/__tests__/MultiPageNavigation.test.ts` (22 tests)
3. `src/__tests__/PanZoom.test.ts` (12 tests)
4. `src/__tests__/AnswerSheetImageFit.test.ts` (15 tests)
5. `src/__tests__/CanvasFoundation.test.ts` (15 tests)

**Total Canvas & Annotation Tests**: 80 / 80 passed (100%).

### Validation:
- `npx vitest run src/__tests__/FreehandPenTool.test.ts src/__tests__/MultiPageNavigation.test.ts src/__tests__/PanZoom.test.ts src/__tests__/AnswerSheetImageFit.test.ts src/__tests__/CanvasFoundation.test.ts` -> **80 passed**
- `npx tsc --noEmit` -> **0 errors**
- `npm run lint` -> **0 errors**

---

## Out of Scope

The following capabilities are strictly deferred to future tickets:
- **AE-127**: Pen color picker / stroke width selection toolbar.
- **AE-128**: Stroke eraser, undo/redo history stacks.
- **AE-129**: Catmull-Rom / Bézier stroke smoothing and latency optimizations.
- **AE-130+**: Annotation persistence to backend API and MongoDB storage.
