# AE-130 Implementation: Check (✓), Cross (✗), and Highlight Tools

## Overview

GitHub Ticket **AE-130** introduces three core grading annotation tools to the answer-sheet canvas:
1. **Check Stamp (✓)**: Single-click placement of a crisp green checkmark.
2. **Cross Stamp (✗)**: Single-click placement of a crisp red cross mark.
3. **Highlight Box**: Interactive drag-to-define translucent yellow rectangular highlight.

This implementation builds directly on top of the established canvas architecture (AE-122 through AE-129) and preserves all previous functionality, including freehand pen drawing, stroke smoothing, vector erasing, pan/zoom coordinate transforms, multi-page navigation, and undo/redo stacks.

---

## 1. Annotation Data Model & Representation

All annotations are stored in **invariant base image coordinates** with strict page isolation:

```typescript
export type StampType = 'check' | 'cross';

export interface CheckAnnotation {
  id: string;
  pageKey: string | number;
  type: 'check';
  x: number;      // Center X in invariant image coordinates
  y: number;      // Center Y in invariant image coordinates
  size: number;   // Stamp size in invariant image pixels (default 28px)
  color: string;  // Hex color (default '#16a34a' - green)
  createdAt: number;
}

export interface CrossAnnotation {
  id: string;
  pageKey: string | number;
  type: 'cross';
  x: number;      // Center X in invariant image coordinates
  y: number;      // Center Y in invariant image coordinates
  size: number;   // Stamp size in invariant image pixels (default 28px)
  color: string;  // Hex color (default '#dc2626' - red)
  createdAt: number;
}

export interface HighlightAnnotation {
  id: string;
  pageKey: string | number;
  type: 'highlight';
  x: number;       // Top-left X in invariant image coordinates
  y: number;       // Top-left Y in invariant image coordinates
  width: number;   // Positive width in invariant image coordinates
  height: number;  // Positive height in invariant image coordinates
  color: string;   // Fill color (default '#fde047' - yellow)
  opacity: number; // Translucency (default 0.35)
  createdAt: number;
}

export type MarkAnnotation = CheckAnnotation | CrossAnnotation | HighlightAnnotation;
```

---

## 2. Tool Selection & UI Controls

The canvas tool model has been extended to support 6 mutually exclusive active tool modes:
`export type CanvasTool = 'none' | 'pen' | 'check' | 'cross' | 'highlight' | 'eraser';`

### Floating Toolbar Buttons:
- **Pen Tool**: Toggles freehand pen mode with style dropdown (color & stroke width).
- **Check Stamp Button**:
  - Icon: `<Check />`
  - Active state: `bg-blue-600 text-white`, `aria-pressed={true}`
  - Accessible label: `aria-label="Toggle Check Stamp Tool"`
  - Test ID: `data-testid="canvas-check-toggle"`
- **Cross Stamp Button**:
  - Icon: `<X />`
  - Active state: `bg-blue-600 text-white`, `aria-pressed={true}`
  - Accessible label: `aria-label="Toggle Cross Stamp Tool"`
  - Test ID: `data-testid="canvas-cross-toggle"`
- **Highlight Button**:
  - Icon: `<Highlighter />`
  - Active state: `bg-blue-600 text-white`, `aria-pressed={true}`
  - Accessible label: `aria-label="Toggle Highlight Tool"`
  - Test ID: `data-testid="canvas-highlight-toggle"`
- **Eraser Tool**: Toggles vector erasing mode.
- **Undo / Redo**: Universal history undo/redo buttons and keyboard shortcuts.
- **Zoom Controls**: Step zoom in/out, zoom percentage readout, reset-to-fit (100%).

---

## 3. Coordinate Handling & Pan/Zoom Invariance

All pointer interactions follow the established coordinate transformation pipeline:

$$\begin{aligned}
\text{Screen Point } (S_x, S_y) &= (\text{clientX} - \text{rect.left}, \text{clientY} - \text{rect.top}) \\
\text{Image Point } (I_x, I_y) &= \left(\frac{S_x - \text{transform.x}}{\text{transform.zoom}}, \frac{S_y - \text{transform.y}}{\text{transform.zoom}}\right)
\end{aligned}$$

- **Check & Cross Placement**: Screen click coordinates are converted to $(I_x, I_y)$ before creating the annotation.
- **Highlight Box Placement**: During drag, start and current points $(I_{x1}, I_{y1})$ and $(I_{x2}, I_{y2})$ are normalized using `normalizeHighlightRect`:
  $$x = \min(I_{x1}, I_{x2}), \quad y = \min(I_{y1}, I_{y2}), \quad \text{width} = |I_{x2} - I_{x1}|, \quad \text{height} = |I_{y2} - I_{y1}|$$
- **Pan / Zoom Rendering**: Annotations are rendered inside a `Konva.Group` with `x: transform.x, y: transform.y, scale: transform.zoom`, ensuring pixel-perfect alignment with the underlying answer-sheet image under all zoom levels (100% to 400%) and pan offsets.

---

## 4. Konva Rendering Approach (`MarkLayer.tsx`)

A dedicated `MarkLayer` component sits above the `PageImageLayer` and `PenLayer`:
- **Check Marks**: Rendered as vector `Konva.Line` with `lineCap: 'round'` and `lineJoin: 'round'` in grading green (`#16a34a`).
- **Cross Marks**: Rendered as vector `Konva.Path` with crisp diagonal cross segments in grading red (`#dc2626`).
- **Highlight Boxes**: Rendered as `Konva.Rect` with yellow fill (`#fde047`), 35% opacity, and subtle border.
- **Live Highlight Preview**: Dragging dynamically updates a temporary preview `Konva.Rect` with a dashed border (`dash: [4, 4]`). On `pointerup`, the preview node is destroyed and the committed annotation is recorded.

---

## 5. Undo / Redo Integration (`annotationHistory.ts`)

The action-based history model was extended to support mark annotations seamlessly:

```typescript
export type AnnotationAction =
  | { type: 'add-stroke'; stroke: FreehandStroke }
  | { type: 'erase-strokes'; strokes: FreehandStroke[]; originalIndices: { id: string; index: number }[] }
  | { type: 'add-annotation'; annotation: MarkAnnotation }
  | { type: 'erase-annotations'; annotations: MarkAnnotation[]; originalIndices: { id: string; index: number }[] };
```

- **Single Action per Completed Placement**: Each check placement, cross placement, or highlight rectangle drag-and-release produces exactly one `add-annotation` action.
- **No Drag Jitter in History**: Pointer movements during highlight dragging only update local preview nodes; no intermediate history entries are recorded.
- **Ordering & Interleaving Preservation**: Drawing strokes and placing stamps/highlights can be freely interleaved; undoing and redoing reverses and restores operations in exact chronological sequence.
- **Keyboard Shortcuts**: `Ctrl+Z` / `Cmd+Z` (Undo), `Ctrl+Y` / `Cmd+Shift+Z` (Redo) operate universally across all annotation types.

---

## 6. Page Isolation

- Annotations strictly contain a `pageKey` matching `currentPage._id || activePageIndex`.
- `filterAnnotationsByPage(annotations, pageKey)` prevents annotations from leaking when switching pages.
- Navigating across answer script pages resets active drag states while retaining each page's distinct annotation list and undo/redo stacks.

---

## 7. Verification & Tests Executed

### Automated Unit Test Suite (`src/__tests__/StampHighlightTools.test.ts`):
1. Check stamp annotation creation with default properties.
2. Check stamp custom color, size, and ID options.
3. Cross stamp annotation creation with default properties.
4. Cross stamp custom color, size, and ID options.
5. Highlight rectangle normalization across all 4 drag directions.
6. Highlight annotation creation with invariant image bounds.
7. Coordinate mapping between screen and image space under pan/zoom.
8. Highlight rectangle coordinate storage invariance under pan/zoom.
9. Page isolation preventing mark leakage between pages.
10. Undo and redo for check mark placement.
11. Undo and redo for cross mark placement.
12. Undo and redo for highlight box placement.
13. Chronological interleaving of freehand pen strokes and mark annotations during undo/redo.
14. Erasing and restoring annotations with original index preservation.
15. Tool switching logic across all 6 canvas tools.

### Test Execution Results:
```bash
npx vitest run src/__tests__/StampHighlightTools.test.ts src/__tests__/EraserUndoRedo.test.ts src/__tests__/StrokeSmoothing.test.ts src/__tests__/PenStyleSelector.test.ts src/__tests__/FreehandPenTool.test.ts src/__tests__/MultiPageNavigation.test.ts src/__tests__/PanZoom.test.ts src/__tests__/AnswerSheetImageFit.test.ts src/__tests__/CanvasFoundation.test.ts
```
**Result**: **9 test suites passed (139 / 139 tests passed)**.

### TypeScript Compilation:
```bash
npx tsc --noEmit
```
**Result**: **0 type errors**.

### ESLint Check:
```bash
npm run lint
```
**Result**: **0 lint errors**.

---

## 8. Known Limitations & Explicit Out-of-Scope Items

In accordance with strict ticket boundaries:
- **AE-131 Text Notes**: Freeform typed text notes and bounding boxes are out of scope.
- **AE-132 Select / Move / Delete**: Selecting existing marks, moving them, or resizing them is out of scope.
- **AE-133 Z-Order & Overlay Visibility**: Dedicated layer z-index reordering and eye-toggle visibility controls are out of scope.
- **Persistence / Database**: In-memory session state only; no MongoDB models or backend endpoints introduced.
- **Grading Logic**: No changes to grading calculation or rubric services.
