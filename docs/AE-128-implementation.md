# AE-128 Implementation: Eraser Tool & Undo/Redo Architecture

## Overview
Issue **AE-128** introduces an **Eraser Tool** and a robust **Undo / Redo Architecture** for grading annotations on the answer-sheet canvas.

This implementation builds upon the foundational canvas architecture (AE-122 to AE-127):
- **AE-122**: Konva canvas stage and rendering foundation.
- **AE-123**: Answer-sheet image loading with aspect-ratio fit.
- **AE-124**: Invariant pan and zoom coordinate transforms.
- **AE-125**: Multi-page navigation within an answer script.
- **AE-126**: Freehand vector stroke creation and Pointer Events pipeline.
- **AE-127**: Color and stroke-width selection.

---

## 1. Eraser Tool Architecture

### A. Vector Hit-Testing in Invariant Coordinate Space
The eraser does not manipulate or alter pixels of the background answer-sheet page image. Instead, it performs collision detection against the active vector strokes in base image coordinates:
- Screen pointer position $(S_x, S_y)$ is converted to invariant image coordinates $(I_x, I_y)$ using the current canvas pan/zoom transform:
  $$I_x = \frac{S_x - \text{transform.x}}{\text{transform.zoom}}, \quad I_y = \frac{S_y - \text{transform.y}}{\text{transform.zoom}}$$
- Point-to-segment squared distance is calculated between $(I_x, I_y)$ and each consecutive segment $(x_i, y_i) \to (x_{i+1}, y_{i+1})$ of existing strokes on the page.
- A stroke is hit if the shortest distance is within $\text{eraserRadius} + \frac{\text{stroke.strokeWidth}}{2}$.

### B. Multi-Stroke Drag Erasing & Batch Action Grouping
- During a continuous pointer drag in eraser mode, all crossed strokes are dynamically hidden on the canvas.
- When the gesture completes (`pointerup` / `pointercancel`), all erased strokes from that gesture are grouped into a single `erase-strokes` action in the page's history stack.

### C. Tool Mode Switching & Style Preservation
- Active tool states: `'none' | 'pen' | 'eraser'`.
- When switching to Eraser mode, the active pen style (color and stroke width) is preserved.
- When switching back to Pen mode, the selected color (`red`, `blue`, or `green`) and stroke width (`thin` or `thick`) from AE-127 remain actively selected.

---

## 2. Undo / Redo Architecture

### A. Action-Based History Model
Rather than saving memory-intensive full-canvas raster snapshots, AE-128 employs a lightweight, action-based history model:
```typescript
export type AnnotationAction =
  | {
      type: 'add-stroke';
      stroke: FreehandStroke;
    }
  | {
      type: 'erase-strokes';
      strokes: FreehandStroke[];
      originalIndices: { id: string; index: number }[];
    };

export interface PageHistory {
  past: AnnotationAction[];
  future: AnnotationAction[];
}
```

### B. Undo Semantics
- **Undoing an `add-stroke`**: Removes the stroke from the page's stroke array and pushes the action to `future`.
- **Undoing an `erase-strokes`**: Restores the erased stroke(s) to their exact original positions, preserving the original array ordering, stroke IDs, colors, and widths.

### C. Redo Semantics
- **Redoing an `add-stroke`**: Re-appends the stroke to the page's stroke array and moves the action to `past`.
- **Redoing an `erase-strokes`**: Re-erases the stroke(s) from the page's stroke array.

### D. Redo Stack Invalidation
- Initiating any new annotation action (`add-stroke` or `erase-strokes`) immediately clears the `future` stack (`future = []`), adhering to standard undo/redo specifications.

---

## 3. Page-Aware History Isolation

- Undo/redo stacks are strictly segregated per `pageKey` (`currentPage._id || activePageIndex`).
- Performing an undo or redo on Page 1 affects only Page 1 annotations and history.
- Switching between pages maintains each page's independent undo/redo history in memory.

---

## 4. Keyboard Shortcuts

Standard desktop and web shortcuts are supported:
- **Undo**: `Ctrl + Z` (Windows/Linux) or `Cmd + Z` (macOS).
- **Redo**: `Ctrl + Y` (Windows/Linux) or `Cmd + Shift + Z` / `Ctrl + Shift + Z` (cross-platform).
- **Input Isolation**: The keyboard listener automatically ignores shortcut triggers when the user's focus is within an `<input>`, `<textarea>`, or content-editable element to preserve native form editing behavior.

---

## 5. UI & Accessibility (ARIA)

The canvas floating toolbar has been updated:
- **Eraser Button**:
  - `aria-pressed={activeEraserMode}`
  - `aria-label="Toggle Eraser Tool"`
  - `title="Toggle Eraser Tool"`
  - Visual blue highlight when active.
- **Undo Button**:
  - `disabled={!canUndoActive}`
  - `aria-label="Undo Annotation"`
  - `title="Undo (Ctrl+Z)"`
  - Reduced opacity (`opacity-35`) and disabled hover states when no action is undoable.
- **Redo Button**:
  - `disabled={!canRedoActive}`
  - `aria-label="Redo Annotation"`
  - `title="Redo (Ctrl+Y / Ctrl+Shift+Z)"`
  - Reduced opacity and disabled state when no action is redoable.
- **Focus & Keyboard Navigation**:
  - Standard focus rings (`focus:ring-2 focus:ring-blue-500`) on all interactive buttons.

---

## 6. Pan / Zoom Preservation

- **Tool Mode Inactive (`activeTool === 'none'`)**: Single-pointer drag pans the canvas image within bounds.
- **Pen / Eraser Mode Active (`activeTool === 'pen' | 'eraser'`)**: Canvas drag-pan is bypassed in favor of drawing/erasing.
- **Zoom Operations**: Wheel zoom, pinch-to-zoom, step zoom buttons (+ / −), and reset-to-fit (100%) remain fully operational across all tool modes.

---

## 7. Explicit Out-of-Scope Items

In accordance with strict project boundaries:
- **AE-129**: Catmull-Rom spline stroke smoothing, Kalman filtering, or predictive stroke interpolation are NOT implemented.
- **Persistence / Database**: No MongoDB collections, API endpoints, or database persistence (state is session in-memory).
- **Grading Logic**: No changes to grading calculation or rubric services.

---

## 8. Test Validation

### Tests Executed:
- `src/__tests__/EraserUndoRedo.test.ts` (AE-128: 10 tests)
- `src/__tests__/PenStyleSelector.test.ts` (AE-127: 18 tests)
- `src/__tests__/FreehandPenTool.test.ts` (AE-126: 16 tests)
- `src/__tests__/MultiPageNavigation.test.ts` (AE-125: 22 tests)
- `src/__tests__/PanZoom.test.ts` (AE-124: 12 tests)
- `src/__tests__/AnswerSheetImageFit.test.ts` (AE-123: 15 tests)
- `src/__tests__/CanvasFoundation.test.ts` (AE-122: 15 tests)

**Total Canvas Suite**: **108 / 108 passing tests**.
