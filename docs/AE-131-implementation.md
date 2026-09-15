# AE-131: Text-Note Annotation (Typed Comment on Sheet) — Implementation Documentation

## 1. Overview
AE-131 introduces the **Text Note** tool into the grading canvas, allowing evaluators to click anywhere on an answer sheet to type contextual annotations. The note editor opens in place, accepts multiline comments, and places a sticky-note style visual badge directly onto the Konva canvas in invariant base image coordinates.

---

## 2. Architecture & Design Principles

### 2.1 Coordinate Invariance
- Text notes store their anchor point `(x, y)` in invariant base image pixels.
- When opening the editor, `imageToScreenCoordinates(ix, iy, transform)` computes the exact screen pixel offset for the DOM popover overlay.
- When saving, the note's origin is recorded in invariant image space `(I_x, I_y)`.
- During panning and zooming, the Konva rendering group automatically scales and translates the note badge so it stays anchored at the identical page location without distortion or drift.

### 2.2 In-Place Editor (`TextNoteEditor.tsx`)
- Floating DOM overlay positioned dynamically relative to the canvas container.
- Auto-focuses on mount for instant typing.
- Stops keyboard event propagation (`e.stopPropagation()`) so global canvas shortcuts (`Ctrl+Z`, `Ctrl+Y`, etc.) are not triggered while typing comments.
- Supports `Enter` or `Ctrl+Enter` to quickly confirm, and `Escape` to cancel without creating an empty annotation.
- Rejects empty or whitespace-only inputs without mutating annotation history.

### 2.3 Konva Rendering (`MarkLayer.tsx`)
- Renders each `TextNoteAnnotation` as a `Konva.Group` at `(note.x, note.y)` containing:
  - Background `Konva.Rect` with soft sticky-note styling (light yellow background `#fef9c3`, subtle border `#fde047`, rounded corner radius `4`, padding `6px`).
  - `Konva.Text` element with wrapped text, crisp typography, and high contrast.

### 2.4 History & Undo/Redo Integration (`annotationHistory.ts`)
- `TextNoteAnnotation` is a first-class member of the `MarkAnnotation` polymorphic union.
- Confirming a note pushes a single `'add-annotation'` action onto the page history.
- Cancelling or rejecting an empty note records zero actions.
- Eraser tool can erase text notes alongside strokes and stamps via `'erase-annotations'`.
- `applyUndo` and `applyRedo` restore text notes with exact ID, position, and text content.

### 2.5 Page Isolation
- Each note is tagged with `pageKey`.
- `filterAnnotationsByPage` isolates annotations strictly per page, preventing notes from leaking across pages during multi-page navigation.

---

## 3. Implementation Details

### 3.1 Files Modified & Created
1. `src/lib/stampTool.ts`:
   - Defined `TextNoteAnnotation` interface.
   - Added `DEFAULT_TEXT_FONT_SIZE`, `DEFAULT_TEXT_COLOR`, `DEFAULT_TEXT_BG_COLOR`, `DEFAULT_TEXT_BORDER_COLOR`.
   - Implemented `createTextNoteAnnotation(pageKey, imagePoint, text, options)`.
   - Updated `MarkAnnotation` union to include `TextNoteAnnotation`.

2. `src/components/canvas/types.ts`:
   - Extended `CanvasTool` union: `'none' | 'pen' | 'check' | 'cross' | 'highlight' | 'text' | 'eraser'`.
   - Added `enableTextNote?: boolean` prop to `AnswerSheetCanvasProps`.
   - Re-exported `TextNoteAnnotation`.

3. `src/components/canvas/TextNoteEditor.tsx` (NEW):
   - In-place popover editor with `data-testid="text-note-editor"`.
   - Textarea with `data-testid="text-note-input"`.
   - Confirm button with `data-testid="text-note-confirm-button"`.
   - Cancel button with `data-testid="text-note-cancel-button"`.
   - Auto-focus, key event isolation, keyboard shortcuts (`Enter`/`Ctrl+Enter`, `Escape`).

4. `src/components/canvas/MarkLayer.tsx`:
   - Added Konva rendering for text notes.
   - Added `onTextNoteClick` prop callback.
   - Set cursor to `text` when `activeTool === 'text'`.

5. `src/components/canvas/AnswerSheetCanvas.tsx`:
   - Added Text Note toggle button in floating toolbar (`data-testid="canvas-text-toggle"`).
   - Managed `activeTextEditor` state `({ imagePoint, screenPoint })`.
   - Implemented `handleTextNoteClick`, `handleConfirmTextNote`, and `handleCancelTextNote`.
   - Rendered `TextNoteEditor` overlay positioned at screen coordinates.

6. `src/components/canvas/index.ts`:
   - Exported `TextNoteEditor`.

7. `src/__tests__/TextNoteAnnotation.test.ts` (NEW):
   - 10 comprehensive tests covering creation, validation, invariance, history, undo/redo, and tool switching.

---

## 4. Verification & Test Coverage
- **10 canvas test suites passing (149 tests total)**:
  - `TextNoteAnnotation.test.ts` (10 tests)
  - `StampHighlightTools.test.ts` (16 tests)
  - `EraserUndoRedo.test.ts` (11 tests)
  - `StrokeSmoothing.test.ts` (14 tests)
  - `PenStyleSelector.test.ts` (18 tests)
  - `FreehandPenTool.test.ts` (16 tests)
  - `MultiPageNavigation.test.ts` (22 tests)
  - `PanZoom.test.ts` (12 tests)
  - `AnswerSheetImageFit.test.ts` (15 tests)
  - `CanvasFoundation.test.ts` (15 tests)
- **TypeScript Compiler (`tsc --noEmit`)**: 0 errors.
- **ESLint (`npm run lint`)**: 0 errors.
- **Git Diff Check (`git diff --check`)**: Clean.
