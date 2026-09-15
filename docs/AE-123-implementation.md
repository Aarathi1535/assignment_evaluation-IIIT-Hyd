# AE-123 — Answer-Sheet Page Image + Fit/Scale

## What was implemented

In AE-123, we implemented actual answer-sheet page image loading, aspect-ratio preservation, viewport containment, loading/error state management, and responsive dynamic resizing built upon the Konva canvas foundation from AE-122:

1. **Page Image API Route**: Added `/api/ingest/[id]/pages/[pageId]/image` to stream full-resolution derived answer-sheet page images stored on disk using the project's existing derived storage pipeline.
2. **Batch Script Endpoint Enhancement**: Extended `/api/ingest/[id]/scripts` to supply `imageUrl` alongside `thumbnailUrl` for every page record.
3. **Aspect-Ratio Containment & Fit Scaling**: Utilized `calculateImageFitBounds` to ensure scanned student exam pages (portrait A4, US letter, landscape attachments) fit completely within the canvas viewport without stretching, distortion, or cropping.
4. **Loading & Error State Lifecycle**: Added dynamic state synchronization in `AnswerSheetCanvas` to display user-friendly loading indicators and actionable error fallback messages when switching pages or encountering invalid/missing images.
5. **Responsive Viewport Resizing**: Integrated Konva `Stage` batch drawing and `ResizeObserver` to recalculate display bounds whenever container dimensions change (e.g. desktop widescreen, tablet portrait, mobile width, or sidebar expansion).
6. **Focused Automated Tests**: Created `src/__tests__/AnswerSheetImageFit.test.ts` covering aspect ratio preservation invariants, viewport containment rules, dynamic resize scaling, and storage path resolution.

---

## Existing image/data source

The Assignment Evaluator project processes answer sheets through an ingestion pipeline:
1. **File Storage**:
   - `PageIngestionService` renders and normalizes incoming PDF/image uploads.
   - `DerivedStorageService` stores full-resolution normalized page images on disk under `data/derived/batches/{batchId}/derived/{fileId}/{pageNumber}/page.png`.
   - Corresponding thumbnails are stored under `data/derived/batches/{batchId}/derived/{fileId}/{pageNumber}/thumb.jpg`.
2. **Database Models**:
   - `IngestionPage` documents hold `batchId`, `fileId`, `pageNumber`, `storageKey` (e.g. `batches/{batchId}/derived/{fileId}/{pageNumber}/page.png`), `width`, `height`, and `status`.
   - `Page` documents hold `answerScript`, `pageNumber`, and `imagePath`.
3. **Data Retrieval**:
   - Full page image data is requested by the frontend from `/api/ingest/[id]/pages/[pageId]/image`, which reads the buffer from `DerivedStorageService.readDerivedPage(page.storageKey)` and returns it with the appropriate `Content-Type` header (`image/png`, `image/jpeg`, etc.).

---

## Rendering approach

The answer-sheet page image is rendered inside the Konva scene-graph architecture established in AE-122:
- `CanvasStage`: Encapsulates the HTML container element and Konva `Stage`.
- `PageImageLayer`: Mounts a dedicated `Konva.Layer` containing a `Konva.Image` node.
  - Asynchronously decodes the image via standard HTML `Image` with `crossOrigin = 'anonymous'`.
  - Computes display dimensions and centered offsets using `calculateImageFitBounds`.
  - Sets `imageNode.position({ x, y })` and `imageNode.size({ width, height })`.
  - Retains background raster isolation so future annotation layers will not trigger costly page image repaints.

---

## Fit/Scale behavior

Contain-style viewport fitting is mathematically enforced by `calculateImageFitBounds`:
- **Aspect Ratio Formula**: $\text{aspectRatio} = \frac{\text{naturalWidth}}{\text{naturalHeight}}$.
- **Viewport Comparison**:
  - If $\text{aspectRatio} > \frac{\text{containerWidth}}{\text{containerHeight}}$ (image is wider than viewport):
    - $\text{renderWidth} = \text{containerWidth}$
    - $\text{renderHeight} = \frac{\text{containerWidth}}{\text{aspectRatio}}$
    - $\text{scale} = \frac{\text{containerWidth}}{\text{naturalWidth}}$
  - Else (image is taller than or equal to viewport):
    - $\text{renderHeight} = \text{containerHeight}$
    - $\text{renderWidth} = \text{containerHeight} \times \text{aspectRatio}$
    - $\text{scale} = \frac{\text{containerHeight}}{\text{naturalHeight}}$
- **Centering Offsets**:
  - $x = \frac{\text{containerWidth} - \text{renderWidth}}{2}$
  - $y = \frac{\text{containerHeight} - \text{renderHeight}}{2}$
- **Invariants**:
  1. $\frac{\text{renderWidth}}{\text{renderHeight}} \equiv \frac{\text{naturalWidth}}{\text{naturalHeight}}$ (Zero distortion).
  2. $\text{renderWidth} \le \text{containerWidth}$ and $\text{renderHeight} \le \text{containerHeight}$ (Zero clipping).
  3. Image remains perfectly centered horizontally and vertically.

---

## Loading and error handling

- **Loading State**:
  - When a new `src` is assigned, `AnswerSheetCanvas` activates a blurred backdrop with an animated `Loader2` spinner and "Loading page image..." label.
  - Prevents displaying partially decoded or unstyled canvases.
- **Error State**:
  - If the image fails to load (404, invalid URL, or decode failure), `PageImageLayer` triggers `onImageError`.
  - `AnswerSheetCanvas` hides the spinner and displays a friendly error overlay (`AlertCircle` icon, "Failed to load answer sheet", and description).
  - Raw technical stack traces or internal server details are shielded from the user.
- **Empty State**:
  - When `src` is `null` (no page selected), an empty state prompt is rendered with `FileImage` and instructions.

---

## Responsive behavior

- `CanvasStage` listens to container size changes via `ResizeObserver`.
- When the window resizes, the browser maximizes, or a grading sidebar toggles:
  1. `CanvasStage` updates `stage.width()` and `stage.height()`.
  2. `PageImageLayer` recomputes `calculateImageFitBounds` with the new dimensions.
  3. `imageNode.position()` and `imageNode.size()` are updated, followed by `layer.batchDraw()`.
  4. Tested across Desktop (1920x1080), Laptop (1366x768), Tablet portrait (768x1024), and Mobile (375x667) viewports.

---

## Tests

### Focused Suite: `src/__tests__/AnswerSheetImageFit.test.ts`
1. **Aspect Ratio Preservation**:
   - Standard A4 scan (2479 x 3508) in 1920x1080 viewport -> verified zero distortion.
   - US Letter scan (2550 x 3300) in 768x1024 tablet viewport -> verified exact aspect ratio.
   - Landscape attachment (1920 x 1080) in square container -> verified centering and fit.
   - Square section (1200 x 1200) in 1600x900 viewport -> verified 1:1 ratio.
2. **Viewport Containment Invariants**:
   - Verified contain bounds across 6 viewport presets (Full HD, WXGA, iPad portrait, Mobile narrow, Sidebar split, Ultra-wide).
3. **Dynamic Resizing**:
   - Verified smooth bounds and scale adjustment from 800x600 to 1200x900.
4. **Degenerate Dimensions**:
   - Verified zero bounds returned safely for zero or negative dimensions without runtime exceptions.
5. **Derived Storage Keying**:
   - Verified deterministic key generation and path resolution.

### Focused Suite: `src/__tests__/CanvasFoundation.test.ts`
- 15 tests verifying coordinate math, clamping, and Konva component exports.

**Results**: 30 / 30 tests passed (100%).

---

## Validation

- **Focused Tests**: `npx vitest run src/__tests__/AnswerSheetImageFit.test.ts src/__tests__/CanvasFoundation.test.ts` -> **30 passed**
- **Full Test Suite**: `npm test` -> **1031 passed** (79/80 suites passed, 1 pre-existing timing assertion in `ProgressBenchmark.test.ts`)
- **TypeScript**: `npx tsc --noEmit` -> **0 errors**
- **ESLint**: `npm run lint` -> **0 errors**

---

## Out of scope

The following capabilities are intentionally deferred to subsequent tickets as per project architecture:
- **AE-124**: Interactive pan and zoom (mouse-wheel zoom, drag pan, zoom controls, 400% zoom limit).
- **AE-125**: Multi-page navigation (next/previous page controls, page indicator, answer-script switching).
- **AE-126+**: Annotation drawing tools, pen strokes, highlighters, comments, score rubrics, and persistence.
