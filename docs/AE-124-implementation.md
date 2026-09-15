# AE-124 — Pan & Zoom

## What was implemented

In AE-124, we implemented interactive pan and zoom navigation for the answer-sheet canvas viewer:
1. **Interactive Zooming up to 400%**: Mouse wheel zoom and multi-touch pinch zoom centered around the cursor/touch midpoint.
2. **Deterministic Pan Boundaries**: Natural drag/pan allowing instructors and TAs to inspect every corner of the enlarged scan while preventing the image from getting lost outside the viewport.
3. **Pinch & Touch Gesture Support**: Native touch gesture tracking using Euclidean distance and centroid calculation.
4. **Floating Zoom Toolbar**: Accessible controls (Zoom In `+`, Zoom Out `-`, Zoom Level Badge, Reset to Fit) with keyboard focus support and `aria-label`s.
5. **Mathematical Isolation**: Pure, testable functions in `src/lib/panZoom.ts` for bounds, clamping, stepped zoom, and pointer projection.

---

## Zoom model

The zoom model cleanly separates:
1. **Base Fit Scale ($z_{\text{base}}$)**: Calculated by AE-123 via `calculateImageFitBounds` to fit the image completely within the container viewport with aspect-ratio containment.
2. **Interactive Zoom Multiplier ($z \in [1.0, 4.0]$)**:
   - $1.0 = 100\%$ (default fit-to-viewport state).
   - $4.0 = 400\%$ (maximum magnification for detailed handwriting examination).
3. **Rendered Dimensions**:
   - $\text{renderWidth} = \text{baseBounds.width} \times z$
   - $\text{renderHeight} = \text{baseBounds.height} \times z$

---

## Wheel zoom

- Pointer-anchored calculation keeps the point directly beneath the mouse cursor stationary during zoom in/out.
- Calling `e.evt.preventDefault()` on wheel events prevents unintentional parent page scrolling during canvas zooming.
- Clamped strictly between $100\%$ ($1.0\times$) and $400\%$ ($4.0\times$).

---

## Drag/pan

- When zoomed in ($z > 1.0$), dragging with primary mouse button pans the viewport.
- Dynamic cursor feedback:
  - `default` at fit scale ($100\%$).
  - `grab` when hovering zoomed image.
  - `grabbing` during active pan drag.
- Updates Konva node positions and triggers `batchDraw()` directly, avoiding full React component tree re-renders on continuous pointer movements.

---

## Pinch/touch zoom

- Multi-touch tracking calculates Euclidean distance $d = \sqrt{\Delta x^2 + \Delta y^2}$ and touch centroid $(\frac{x_1+x_2}{2}, \frac{y_1+y_2}{2})$.
- Scales proportionally based on pinch ratio $\frac{d_{\text{current}}}{d_{\text{start}}}$ centered around the touch midpoint.
- Single-finger touch operates as normal drag panning.

---

## Pan bounds

The mathematical clamping strategy ensures the image is never lost outside the viewport:
- **Dimension $\le$ Viewport**: The image is strictly centered ($X = \frac{\text{containerWidth} - \text{renderWidth}}{2}$, $Y = \frac{\text{containerHeight} - \text{renderHeight}}{2}$).
- **Dimension $>$ Viewport**: Clamped between:
  - Minimum: $\text{containerDimension} - \text{renderDimension}$ (opposite edge touching viewport boundary).
  - Maximum: $0$ (origin edge touching viewport boundary).

---

## Resize behavior

- When the canvas container changes size (window resize, device rotation, sidebar toggle):
  1. `CanvasStage` updates dimensions via `ResizeObserver`.
  2. `calculateImageFitBounds` recomputes the base fit geometry.
  3. `calculatePanBounds` re-clamps the current pan position so the enlarged scan remains within valid bounds.

---

## Performance considerations

- Pointer movements and pan drags bypass React render cycles, updating Konva node transformations (`imageNode.position()`, `imageNode.size()`) directly and queuing hardware-accelerated canvas `batchDraw()`.
- The background scanned bitmap remains isolated on `PageImageLayer` and is not re-decoded during pan/zoom.

---

## Tests

### Focused Suite: `src/__tests__/PanZoom.test.ts`
1. **Zoom Limits & Stepping**: Verified $1.0\times$ min zoom, $4.0\times$ max zoom, and $0.25$ stepped increments.
2. **Pan Bounds Calculation**: Verified strict centering when $\le$ viewport and edge bounds when $>$ viewport.
3. **Clamping Pan Position**: Verified boundary enforcement across all 4 directions.
4. **Pointer-Anchored Zoom**: Verified point-invariance invariant at center, top-left, and corners.
5. **Multi-Touch Pinch Metrics**: Verified Euclidean distance and centroid calculation.

### Results
- `npx vitest run src/__tests__/PanZoom.test.ts src/__tests__/AnswerSheetImageFit.test.ts src/__tests__/CanvasFoundation.test.ts`: **42 / 42 tests passed (100%)**.

---

## Validation

- **Focused Tests**: 42 passed (100%)
- **TypeScript**: `npx tsc --noEmit` -> 0 errors
- **ESLint**: `npm run lint` -> 0 errors

---

## Out of scope

- **AE-125**: Multi-page navigation (next/previous buttons, thumbnail strip, page indicators).
- **AE-126+**: Annotation drawing tools, pen/highlighter strokes, score rubrics, comments.
