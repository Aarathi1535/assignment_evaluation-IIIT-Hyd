# AE-125 — Multi-Page Navigation

## What was implemented

In AE-125, we extended the answer-sheet canvas viewer with deterministic multi-page navigation across all pages of an answer script, building directly on the Konva foundation (AE-122), image fit/scaling (AE-123), and pan/zoom interaction (AE-124):

1. **Multi-Page Navigation Engine (`src/lib/pageNavigation.ts`)**: Pure mathematical models and utilities for deterministic page sorting, boundary clamping, next/previous transitions, and indicator formatting.
2. **Deterministic Page Ordering**: Pages are sorted by `pageNumber` ascending (1, 2, ... N), tiebroken by `fileIndex` and unique IDs to guarantee consistent order regardless of asynchronous database fetch sequence.
3. **Canvas Component Multi-Page Extension (`src/components/canvas/AnswerSheetCanvas.tsx`)**: Extended `AnswerSheetCanvas` to accept an `AnswerSheetPage[]` list while retaining full backwards compatibility with single-image `src` mode.
4. **Accessible Top Navigation Bar**: Interactive Previous and Next buttons with semantic accessible names, keyboard activation, disabled boundary states, and an `aria-live="polite"` page indicator ("Page X of Y").
5. **Image Transition & Pan/Zoom Reconciliation**: Seamless image updates without ghosting or stale pan/zoom states from prior pages (every newly selected page resets cleanly to its 100% fit-to-viewport state).
6. **Graceful Empty/Error Handling**: Informative empty state overlays when an answer script contains zero pages or when individual page images fail to load.
7. **Focused Test Suite (`src/__tests__/MultiPageNavigation.test.ts`)**: Comprehensive unit and integration tests covering ordering, boundary enforcement, transitions, indicator formatting, URL extraction, and zoom reconciliation.

---

## Existing page data source

The Assignment Evaluator pipeline organizes exam submissions into answer scripts and associated ingestion pages:
1. **API Endpoints**:
   - `/api/ingest/[id]/scripts`: Returns all `AnswerScript` records for a batch along with their embedded `pages` array.
   - Each page record contains:
     - `_id`: Unique identifier for the page document.
     - `pageNumber`: 1-based page number within the script/exam.
     - `fileIndex`: Zero-based index indicating source file sequence in batch uploads.
     - `imageUrl`: Full-resolution image route (`/api/ingest/[id]/pages/[pageId]/image`).
     - `thumbnailUrl`: Low-resolution thumbnail route (`/api/ingest/[id]/pages/[pageId]/thumbnail`).
     - `width`, `height`: Native pixel dimensions.
     - `nearBlank`, `isDuplicate`, `omrResult`: Ingestion flags.
2. **Canvas Prop Model**:
   - `AnswerSheetCanvas` accepts `pages?: AnswerSheetPage[]`.
   - Each page item adheres to the `AnswerSheetPage` interface in `src/lib/pageNavigation.ts`.
   - Existing storage architectures and database schemas are reused directly with zero second storage mechanisms created.

---

## Page ordering

Database retrieval order is not assumed to be chronological or sequential. To guarantee deterministic sequencing:
- `sortScriptPages(pages: AnswerSheetPage[])` implements a strict sort order:
  1. `pageNumber` ascending: $1, 2, 3, \dots, N$.
  2. `fileIndex` ascending: Preserves page ordering across multi-file merges.
  3. `_id` / `id` lexicographical: Guarantees deterministic tiebreaking for identical numbers.
  4. Original position: Stable fallback.
- The sort helper is pure and does not mutate the source array.

---

## Navigation behavior

Navigation between pages enforces strict boundaries:
- **Previous Page**:
  - Decreases active page index by 1 (`getPrevPageIndex`).
  - Disabled at the first page (index 0).
- **Next Page**:
  - Advances active page index by 1 (`getNextPageIndex`).
  - Disabled at the final page (index $N - 1$).
- **Boundaries**:
  - `clampPageIndex` strictly confines any target index to $[0, \text{totalPages} - 1]$.
  - If total pages is 0 or 1, both navigation buttons are disabled.
  - Page index $< 0$ or $\ge \text{totalPages}$ is mathematically prevented.
- **Controlled & Uncontrolled Support**:
  - Supports controlled mode via `currentPageIndex` and `onPageChange(pageIndex, page)`.
  - Supports uncontrolled mode via internal state and `initialPageIndex`.

---

## Page indicator

- Displays clear, 1-based human-readable page information:
  - Format: `Page 1 of 5`, `Page 2 of 8`, etc.
  - Formatted by pure helper `formatPageIndicator(currentPageIndex, totalPages)`.
- When zero pages exist, displays `"No pages"`.
- Uses `aria-live="polite"` and `aria-atomic="true"` on the indicator container for screen reader announcements upon page changes.

---

## Image loading

- When active page index changes:
  1. `getPageImageUrl(currentPage)` retrieves `currentPage.imageUrl` or `currentPage.src`.
  2. `AnswerSheetCanvas` triggers loading overlay (`Loader2` spinner) while unmounting/updating the previous image.
  3. `PageImageLayer` asynchronously loads and decodes the new page image.
  4. Aspect ratio containment is preserved via `calculateImageFitBounds`.
  5. Upon load completion, `handleImageLoad` calculates centered bounds and renders to the Konva canvas.

---

## Pan/zoom interaction

- AE-124 pan and zoom capabilities (mouse wheel zoom, drag/pan, pinch zoom, floating zoom toolbar) remain 100% active and functional on all pages.
- When changing pages:
  - The viewport transform is reset to `{ x: 0, y: 0, zoom: 1.0 }`.
  - Upon image load, `handleImageLoad` calculates centered `baseBounds` and sets the initial transform to `{ x: bounds.x, y: bounds.y, zoom: 1.0 }`.
  - Stale pan offsets or zoom levels from the previous page do not bleed into the new page, ensuring the new scan is immediately centered and fully visible.
  - Per-page zoom persistence is intentionally omitted in compliance with ticket boundaries.

---

## Loading, error, and empty states

- **Image Loading**: Shows semi-transparent backdrop with animated spinner and "Loading page image..." text.
- **Image Error**: If an image fails to fetch or decode, shows an error banner with descriptive message without crashing canvas state.
- **Empty Script**: If an answer script has 0 pages (`pages = []`), displays a centered empty state ("No pages in answer script") and omits invalid navigation controls.

---

## Accessibility

- **Semantic Navigation**: The top toolbar is wrapped in `<nav role="navigation" aria-label="Answer Sheet Page Navigation">`.
- **Buttons**:
  - Standard `<button type="button">` elements.
  - Explicit `aria-label="Previous Page"` and `aria-label="Next Page"`.
  - Explicit `disabled` attributes at boundaries.
  - Full keyboard focusability with visible focus rings (`focus:ring-2 focus:ring-blue-500`).
- **Page Indicator**: Announced to assistive technologies via `aria-live="polite"`.

---

## Tests

### Focused Suite: `src/__tests__/MultiPageNavigation.test.ts`
1. **Deterministic Page Ordering**:
   - Verified ascending sort by `pageNumber` on scrambled page arrays.
   - Verified `fileIndex` tiebreaking.
   - Verified `_id` lexicographical tiebreaking.
   - Verified immutability of original page array.
   - Verified null/undefined safety.
2. **Initial Page Selection & Boundaries**:
   - Verified boundary clamping for negative, out-of-range, and valid indices.
   - Verified boundary clamping when `totalPages <= 0`.
   - Verified disabled state for Previous at first page.
   - Verified disabled state for Next at last page.
   - Verified disabled state for both buttons when single or zero pages.
3. **Next and Previous Page Transitions**:
   - Verified index stepping with upper/lower boundary protection.
4. **Page Indicator Formatting**:
   - Verified `"Page 1 of 5"`, `"Page 2 of 5"`, `"Page 8 of 8"` outputs.
   - Verified empty string / `"No pages"` handling for zero pages.
5. **Page Image URL Resolution**:
   - Verified resolution from `imageUrl`, `src`, and null fallbacks.
6. **Script Navigation Flow & Image Switching**:
   - Simulated full forward traversal (1 -> 2 -> 3 -> 4 -> 5) and backward traversal (5 -> 4 -> 3 -> 2 -> 1).
7. **Pan/Zoom Reconciliation**:
   - Verified stale zoom is discarded and reset to 1.0 upon page transitions.

### Additional Canvas Suites:
- `src/__tests__/PanZoom.test.ts`: 12 tests passed
- `src/__tests__/AnswerSheetImageFit.test.ts`: 15 tests passed
- `src/__tests__/CanvasFoundation.test.ts`: 15 tests passed

**Total Canvas Tests**: 64 / 64 passed (100%).

---

## Validation

- **Focused Tests**: `npx vitest run src/__tests__/MultiPageNavigation.test.ts src/__tests__/PanZoom.test.ts src/__tests__/AnswerSheetImageFit.test.ts src/__tests__/CanvasFoundation.test.ts` -> **64 passed**
- **Full Test Suite**: `npm test` -> **1053 passed**
- **TypeScript**: `npx tsc --noEmit` -> **0 errors**
- **ESLint**: `npm run lint` -> **0 errors**

---

## Out of scope

The following remain strictly outside AE-125:
- Annotations, pen drawing tools, highlighters, comments, score rubrics, and grading logic.
- Cross-script navigation between different students.
- Sidebar thumbnail page browser / thumbnail strips.
- Page reordering, deletion, or uploading from canvas.
- Persisted per-page pan/zoom states.
