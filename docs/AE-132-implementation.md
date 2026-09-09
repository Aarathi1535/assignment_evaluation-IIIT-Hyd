# AE-132: Select, Move, and Delete Existing Annotations — Implementation Documentation

## 1. Overview
AE-132 introduces interactive **Select**, **Move**, and **Delete** capabilities to the grading canvas, allowing evaluators to:
- Select any existing mark annotation (`check`, `cross`, `highlight`, `text note`) on the current page with a distinct visual bounding outline.
- Drag to reposition the selected annotation in invariant base image coordinates under arbitrary pan and zoom transformations.
- Delete the selected annotation via keyboard shortcut (`Delete`/`Backspace`) or accessible toolbar button.
- Perform unified single-action undo and redo operations on moves and deletions across all supported annotation types.

---

## 2. Architecture & Design Principles

### 2.1 Selection Architecture
- **Canvas Tool**: Added `'select'` mode to `CanvasTool = 'none' | 'select' | 'pen' | 'check' | 'cross' | 'highlight' | 'text' | 'eraser'`.
- **State Management**: Tracked via `selectedAnnotationId: string | null` in `AnswerSheetCanvas.tsx`.
- **Interactivity**: In `MarkLayer.tsx`, when `activeTool === 'select'`, annotation nodes are marked `draggable: true` and `listening: true`. Clicking an annotation selects it; clicking empty canvas space clears the selection.
- **Visual Indication**: Renders a clean dashed accent rectangle (`#2563eb`) around the selected annotation node.

### 2.2 Movement & Coordinate Invariance
- **Coordinate Transformation Pipeline**:
  $$\text{Pointer Move (Screen)} \xrightarrow{\text{Konva Group Drag}} \text{Invariant Image Space } (I_x, I_y) \xrightarrow{\text{Storage}} \text{Annotation State}$$
- **Drag Lifecycle**:
  - `dragstart`: Captures initial position $(x_0, y_0)$ and selects the node.
  - `dragend`: Computes final integer invariant coordinates $(x_1, y_1)$. If $(x_1, y_1) \neq (x_0, y_0)$, dispatches `onAnnotationMove` and records **one** undoable history action.
- **Attribute Preservation**: Moving an annotation preserves its `id`, `pageKey`, `type`, `color`, `size`, `text`, `fontSize`, `backgroundColor`, `borderColor`, `width`, `height`, `opacity`, and `createdAt`.

### 2.3 Deletion
- **Triggers**:
  - `Delete` or `Backspace` keyboard shortcut when canvas has a selected annotation.
  - Accessible `canvas-delete-button` in the floating toolbar.
- **Input Guard**: If an `<input>`, `<textarea>`, or `contentEditable` element is focused, `Delete`/`Backspace` does not delete canvas annotations.
- **History**: Uses `recordEraseAnnotations` to capture the deleted annotation and its original array index, creating **one** undoable history action.

### 2.4 History & Undo/Redo Engine (`annotationHistory.ts`)
- Added `type: 'move-annotation'` action:
  ```typescript
  | {
      type: 'move-annotation';
      annotationId: string;
      previousPosition: { x: number; y: number };
      newPosition: { x: number; y: number };
    }
  ```
- `recordMoveAnnotation(history, id, prevPos, newPos)`: Clears redo stack and records the position change.
- `applyUndo`: Reverts annotation from `newPosition` to `previousPosition`.
- `applyRedo`: Restores annotation from `previousPosition` to `newPosition`.
- Deletions are undone via `applyUndo`'s `erase-annotations` handler, which restores the exact annotation with all original properties at its original array position.

### 2.5 Page Isolation
- Selection is strictly tied to the current page. Switching pages via `navigateToPage` clears `selectedAnnotationId` to prevent cross-page mutations.
- `filterAnnotationsByPage` isolates annotations strictly per `pageKey`.

### 2.6 Accessibility
- Toolbar includes `canvas-select-toggle` button (`MousePointer` icon) and `canvas-delete-button` (`Trash2` icon) with proper `aria-label`, `title`, and focus indicators.
- Delete button is disabled with reduced opacity when no annotation is selected.

---

## 3. Supported Annotation Types
| Annotation Type | Selectable | Movable | Deletable | Bounds Computation |
|---|---|---|---|---|
| `check` | Yes | Yes (updates center $(x, y)$) | Yes | $[x - S/2, y - S/2, S, S]$ |
| `cross` | Yes | Yes (updates center $(x, y)$) | Yes | $[x - S/2, y - S/2, S, S]$ |
| `highlight` | Yes | Yes (updates top-left $(x, y)$) | Yes | $[x, y, \text{width}, \text{height}]$ |
| `text` (Note) | Yes | Yes (updates top-left $(x, y)$) | Yes | $[x, y, \text{textWidth}, \text{textHeight}]$ |

*Note: Freehand pen strokes remain in the pen stroke model (`FreehandStroke`) and are not modified by AE-132.*

---

## 4. Verification & Test Coverage
- **11 Canvas Test Suites Passing (166 tests total)**:
  - `SelectMoveDeleteAnnotations.test.ts` (17 tests) - **PASS**
  - `TextNoteAnnotation.test.ts` (10 tests) - **PASS**
  - `StampHighlightTools.test.ts` (16 tests) - **PASS**
  - `EraserUndoRedo.test.ts` (11 tests) - **PASS**
  - `StrokeSmoothing.test.ts` (14 tests) - **PASS**
  - `PenStyleSelector.test.ts` (18 tests) - **PASS**
  - `FreehandPenTool.test.ts` (16 tests) - **PASS**
  - `MultiPageNavigation.test.ts` (22 tests) - **PASS**
  - `PanZoom.test.ts` (12 tests) - **PASS**
  - `AnswerSheetImageFit.test.ts` (15 tests) - **PASS**
  - `CanvasFoundation.test.ts` (15 tests) - **PASS**
- **TypeScript Compiler (`tsc --noEmit`)**: 0 errors.
- **ESLint (`npm run lint`)**: 0 errors.
- **Git Diff Check (`git diff --check`)**: Clean.

---

## 5. Explicit Out-of-Scope Items
- AE-133 z-order management controls.
- AE-133 overlay visibility toggle.
- Annotation rotation or resizing handles.
- Database persistence or backend sync.
