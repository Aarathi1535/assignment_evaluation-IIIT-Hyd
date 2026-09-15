# AE-133: Annotation Z-Order + Overlay Visibility Toggle Implementation

## Overview
Ticket **AE-133** implements deterministic annotation z-order layering and an accessible annotation overlay visibility toggle for the answer sheet canvas. It sits on top of AE-122 through AE-132, completing the Day-3 annotation interaction capabilities.

## Architecture & Layer Hierarchy
The canvas employs a strict, deterministic 3-layer architecture rendered bottom-to-top within the Konva Stage:

```
+-------------------------------------------------------------+
| Layer 2: MarkLayer (Konva.Layer)                             |
|  - Check stamps, cross stamps, highlight boxes, text notes  |
|  - Items rendered in exact array-order: annGroup.zIndex(i)  |
|  - New annotations append to top                            |
+-------------------------------------------------------------+
| Layer 1: PenLayer (Konva.Layer)                             |
|  - Freehand pen strokes and active smoothing lines          |
+-------------------------------------------------------------+
| Layer 0: PageImageLayer (Konva.Layer)                       |
|  - Answer sheet page image (contain/fit/scaled)             |
+-------------------------------------------------------------+
```

### 1. Deterministic Z-Order
- **Stage Mounting**: `CanvasStage` mounts layers in deterministic JSX order: `<PageImageLayer>` $\to$ `<PenLayer>` $\to$ `<MarkLayer>`.
- **Intra-Layer Z-Index**: Inside `MarkLayer`, every annotation node group is explicitly assigned `annGroup.zIndex(index)` corresponding to its position in the `annotations` array.
- **Top-Appended New Annotations**: Newly placed stamps, highlights, and text notes append to the end of the annotations array, naturally receiving the highest z-index without disturbing existing annotations.

### 2. Annotation Overlay Visibility Toggle
- **Toolbar Control**: An accessible toggle button (`data-testid="canvas-overlay-toggle"`, `aria-label="Toggle Annotation Overlay Visibility"`, `aria-pressed={isOverlayVisible}`) with dynamic `Eye` (visible) / `EyeOff` (hidden) icons.
- **Visual Visibility Sync**: Synchronizes `layer.visible(isOverlayVisible)` and `group.visible(isOverlayVisible)` on both `PenLayer` and `MarkLayer` via `batchDraw()`.
- **Non-Destructive UI State**: Toggling overlay visibility modifies only UI presentation state (`isOverlayVisible`). In-memory strokes (`strokes`), annotations (`annotations`), page isolation, pan/zoom transforms, and coordinate systems remain completely unchanged.
- **Interaction Safety while Hidden**:
  - When hidden, active annotation selection (`selectedAnnotationId`) is automatically cleared.
  - Pointer event handlers in `PenLayer` and `MarkLayer` early-exit if `!visibleRef.current`, preventing accidental creation, drag, move, eraser, or selection while hidden.
  - Keyboard shortcuts (`Delete`/`Backspace`) do not delete annotations when hidden because selection is cleared.
  - Pan/zoom gestures and multi-page navigation continue to operate smoothly regardless of visibility state.

### 3. Undo / Redo Purity
- **0 History Actions on Toggle**: Visibility toggling does not invoke `annotationHistory.ts` recording methods.
- **Target Integrity**: Undo (`Ctrl+Z`) and Redo (`Ctrl+Y` / `Ctrl+Shift+Z`) operate exclusively on user drawing/stamp/move/delete mutations regardless of whether the overlay is currently visible or hidden.

## Component Props Added / Updated
- `AnswerSheetCanvasProps`:
  - `enableOverlayToggle?: boolean;` (default `true`)
  - `isOverlayVisible?: boolean;` (controlled overlay visibility state)
  - `initialOverlayVisible?: boolean;` (uncontrolled initial visibility state, default `true`)
  - `onOverlayVisibilityChange?: (visible: boolean) => void;` (callback on visibility change)
- `PenLayerProps`:
  - `visible?: boolean;` (default `true`)
- `MarkLayerProps`:
  - `visible?: boolean;` (default `true`)

## Test Coverage & Verification
- **Automated Tests**: 18 test cases in `src/__tests__/AnnotationZOrderOverlayToggle.test.ts` covering:
  - Fixed 3-layer architecture stacking
  - Deterministic z-order and top-appending of new annotations
  - Default visibility (`true`), hide/show toggle mechanics, and data non-mutation
  - Invariant image coordinate preservation
  - Selection clearing on hide and interaction suppression while hidden
  - History purity (0 undo/redo actions on toggle) and independent undo/redo
  - Multi-page annotation isolation and pan/zoom transform preservation
  - Component props contracts and accessibility attributes
- **Full Canvas Test Suite**: All 12 canvas test suites (184 tests) passing.
- **Type Check**: `npx tsc --noEmit` passing with 0 errors.
- **Linter**: `npm run lint` passing with 0 errors.
