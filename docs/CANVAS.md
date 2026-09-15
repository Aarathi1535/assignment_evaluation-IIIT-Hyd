# Canvas Module Documentation & Interaction Reference

## 1. Overview

The **Answer Sheet Canvas Module** is a high-performance vector annotation system designed for digital evaluation and grading of scanned student answer scripts.

### Core Capabilities
- **Multi-layer HTML5 Canvas rendering**: Powered by Konva.js with decoupled stage, page image, pen drawing, and stamp/mark annotation layers.
- **Non-destructive vector annotations**: All evaluation marks (freehand pen strokes, checkmarks, crosses, text comments, highlight boxes) are stored as lightweight vector metadata in invariant base image coordinates. Source page scans are strictly immutable and never altered.
- **Sub-millisecond interactive drawing latency**: Direct Konva node updates bypass React re-rendering during active drawing gestures, ensuring real-time responsiveness (< 200ms PRD target).
- **Multi-page navigation & strict isolation**: Per-page undo/redo histories, automatic coordinate transformation resetting, and isolated stroke/annotation collections.
- **Debounced background autosave**: Changes are batched and automatically persisted to the backend API (`PUT /api/scripts/{id}/pages/{p}/annotations`) with zero disruption to active grading.
- **Multi-modal hardware input**: Unified handling of desktop mouse, digital stylus (with pressure sensitivity), and multi-touch gestures (with pinch-to-zoom).

---

## 2. Architecture & Component Hierarchy

```
+------------------------------------------------------------------------------------------------+
|                                      AnswerSheetCanvas                                         |
|                                                                                                |
|  +------------------------------------------------------------------------------------------+  |
|  | Navigation Bar (Top-Center)                               SaveStatusIndicator (Top-Right)|  |
|  | [ < Prev ]   Page 1 of 5   [ Next > ]                     [ (●) Saving... / (✓) Saved ]  |  |
|  +------------------------------------------------------------------------------------------+  |
|                                                                                                |
|  +------------------------------------------------------------------------------------------+  |
|  | CanvasStage (Konva Stage Container & Resize Observer)                                    |  |
|  |                                                                                          |  |
|  |  Layer 1: PageImageLayer                                                                 |  |
|  |  - Renders base scan (contain / cover / fill)                                            |  |
|  |  - Handles Stage Pan (mouse/touch drag when idle) & Wheel / Pinch Zoom                   |  |
|  |                                                                                          |  |
|  |  Layer 2: PenLayer                                                                       |  |
|  |  - Freehand Pen drawing (live Konva.Line updates during gesture)                          |  |
|  |  - Eraser Tool (2D segment intersection hit-testing)                                     |  |
|  |  - Online exponential smoothing & Chaikin/EMA post-processing                            |  |
|  |                                                                                          |  |
|  |  Layer 3: MarkLayer                                                                      |  |
|  |  - Checkmarks (✓), Crosses (✗), Highlighting Rectangles                                   |  |
|  |  - Sticky Text Notes (rendered Konva.Text + Konva.Rect)                                  |  |
|  |  - Annotation Selection, Drag-to-Move, and Bounding Box Indicators                         |  |
|  +------------------------------------------------------------------------------------------+  |
|                                                                                                |
|  +------------------------------------------------------------------------------------------+  |
|  | TextNoteEditor (In-Place DOM Modal Overlay for typing text notes)                        |  |
|  +------------------------------------------------------------------------------------------+  |
|                                                                                                |
|  +------------------------------------------------------------------------------------------+  |
|  | Floating Toolbar (Bottom-Right)                                                          |  |
|  | [Select] [Delete] [Pen] [Colors/Widths] [✓] [✗] [Highlight] [Text] [Eraser] [Undo] [Redo] |  |
|  +------------------------------------------------------------------------------------------+  |
+------------------------------------------------------------------------------------------------+
```

### Component Breakdown
1. **`AnswerSheetCanvas`** ([`src/components/canvas/AnswerSheetCanvas.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/canvas/AnswerSheetCanvas.tsx)): Root coordinator managing tool modes, page state, selection state, undo/redo history, hydration, and debounced autosave.
2. **`CanvasStage`** ([`src/components/canvas/CanvasStage.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/canvas/CanvasStage.tsx)): Initializes the root Konva stage and provides responsive dimension tracking via `ResizeObserver`.
3. **`PageImageLayer`** ([`src/components/canvas/PageImageLayer.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/canvas/PageImageLayer.tsx)): Loads and fits the answer sheet image. Manages pan/zoom transforms, wheel zooming, drag panning, and multi-touch pinch-to-zoom.
4. **`PenLayer`** ([`src/components/canvas/PenLayer.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/canvas/PenLayer.tsx)): Captures PointerEvents for low-latency freehand drawing and stroke erasing. Directly manipulates Konva Line nodes in real time.
5. **`MarkLayer`** ([`src/components/canvas/MarkLayer.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/canvas/MarkLayer.tsx)): Renders check, cross, highlight, and text note annotations. Handles stamp placement, live highlight rectangle drag previews, annotation selection, and draggable movement.
6. **`TextNoteEditor`** ([`src/components/canvas/TextNoteEditor.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/canvas/TextNoteEditor.tsx)): DOM-based in-place text entry modal anchored to the clicked canvas coordinate.
7. **`PenStyleSelector`** ([`src/components/canvas/PenStyleSelector.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/canvas/PenStyleSelector.tsx)): Quick color and stroke width selector embedded in the floating toolbar.
8. **`SaveStatusIndicator`** ([`src/components/canvas/SaveStatusIndicator.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/canvas/SaveStatusIndicator.tsx)): Accessible status badge displaying `idle`, `saving`, `saved`, or `error` (with retry button).

### Invariant Coordinate Model
The canvas separates physical viewport screen pixels from invariant image coordinates:
- **Image Space**: $(x, y)$ coordinates normalized to the base fitted image dimensions ($w_{base}, h_{base}$). Annotations are serialized and persisted strictly in this space.
- **Screen Space**: Physical viewport pixels inside the container DOM element.
- **Coordinate Conversion Formula**:
  $$\text{imagePoint} = \left( \frac{\text{screenX} - \text{transform.x}}{\text{transform.zoom}}, \frac{\text{screenY} - \text{transform.y}}{\text{transform.zoom}} \right)$$
  $$\text{screenPoint} = \left( \text{transform.x} + \text{imageX} \times \text{transform.zoom}, \text{transform.y} + \text{imageY} \times \text{transform.zoom} \right)$$
This guarantees that annotations remain perfectly pinned to the underlying scanned content across all zoom levels, pan translations, window resizes, and device pixel ratios.

---

## 3. Annotation Tools Reference

| Tool ID | Name | Icon | Behavior & Interaction |
| :--- | :--- | :--- | :--- |
| `none` | **Pan / Navigate** | *Default* | Default mode. Dragging pans the canvas viewport when zoomed in; drawing is inactive. |
| `select` | **Select / Move** | `MousePointer` | Click an annotation to select it and show dashed bounding box. Drag to move. Press `Delete` or `Backspace` to remove. Clicking empty canvas clears selection. |
| `pen` | **Freehand Pen** | `Pen` | Pointer drag draws continuous freehand vector lines with online smoothing and optional stylus pressure sensitivity. |
| `check` | **Check Stamp** | `Check` | Single click places a green checkmark stamp (✓) centered at the pointer coordinate. |
| `cross` | **Cross Stamp** | `X` | Single click places a red cross stamp (✗) centered at the pointer coordinate. |
| `highlight` | **Highlighter** | `Highlighter` | Click and drag in any direction to draw a semi-transparent yellow highlight rectangle. |
| `text` | **Text Note** | `Type` | Single click anchors and opens the `TextNoteEditor` modal. Type text, press `Enter` to confirm, or `Esc` to cancel. |
| `eraser` | **Eraser** | `Eraser` | Click and drag across strokes to perform continuous 2D segment intersection hit-testing and delete colliding lines. |

### Global Toolbar Utilities
- **Undo (`Undo2`)**: Reverts the last addition, move, or erase operation on the current page (`Ctrl+Z` / `Cmd+Z`).
- **Redo (`Redo2`)**: Re-applies the next undone action on the current page (`Ctrl+Shift+Z` / `Ctrl+Y` / `Cmd+Y`).
- **Overlay Visibility Toggle (`Eye` / `EyeOff`)**: Toggles visibility of all pen strokes and mark annotations without clearing in-memory data. Disables pointer drawing while hidden.
- **Delete (`Trash2`)**: Deletes the currently selected annotation (enabled only in Select mode with an active selection).
- **Zoom In (`ZoomIn`) / Zoom Out (`ZoomOut`)**: Steps zoom level by $\pm 25\%$ (bounded between $1.0\times$ and $4.0\times$).
- **Reset Zoom (`RotateCcw`)**: Resets viewport transform to $1.0\times$ default base fit.

---

## 4. Multi-Page Navigation & Isolation

When initialized with a multi-page array (`pages: AnswerSheetPage[]`):
1. **Deterministic Sorting**: Pages are sorted ascending by `pageNumber` (1, 2, ... N).
2. **Page Navigation Controls**: Renders previous page button, live page indicator (`Page X of Y`), and next page button.
3. **Strict Page Isolation**:
   - Strokes and annotations are partitioned in memory by `pageKey` (e.g. `currentPageKey`).
   - Undo/redo histories are isolated per page (`PageHistoryMap`). Undoing on Page 2 does not affect Page 1 history.
4. **Transform Reset**: Navigating to another page automatically resets viewport pan and zoom back to $1.0\times$ base fit.
5. **Autosave Flush**: Navigating to another page immediately flushes any pending debounced autosave for the current page before loading the next page scan.

---

## 5. Persistence Lifecycle & REST API

The canvas uses `Page.annotations` on the MongoDB `Page` document as the **single source of truth**.

```
[ Canvas User Action ] (Pen, Stamp, Text, Move, Delete, Undo, Redo)
        │
        ▼
[ In-Memory State & History ] (React State + PageHistoryMap)
        │
        ▼
[ Debounced Autosave Trigger ] (800ms debounce timer)
        │
        ├── Flush on Page Navigation
        └── Flush on Timeout
        │
        ▼
[ Vector Serialization ] (serializePageAnnotations -> SerializedPageAnnotations)
        │
        ▼
[ REST API Call ] (PUT /api/scripts/{scriptId}/pages/{pageNumber}/annotations)
        │
        ▼
[ MongoDB Document ] (Page.annotations: SerializedAnnotationDocument)
        │
        ▼
[ Load / Hydration on Mount ] (GET /api/scripts/{scriptId}/pages/{pageNumber}/annotations)
```

### Serialized Annotation Format (`SerializedPageAnnotations`)
```typescript
interface SerializedPageAnnotations {
  version: 1;
  pageKey: string | number;
  marks: Array<CheckAnnotation | CrossAnnotation | HighlightAnnotation | TextNoteAnnotation>;
  strokes: Array<{
    id: string;
    points: number[];
    color: string;
    strokeWidth: number;
    createdAt: number;
  }>;
  metadata?: {
    totalMarksCount: number;
    totalStrokesCount: number;
    serializedAt: number;
  };
}
```

---

## 6. Autosave Behavior & Status States

### Trigger Rules
- **Autosave Triggers (800ms debounce)**:
  - Freehand stroke completed (`onStrokeComplete`)
  - Strokes erased with eraser tool (`onStrokesErased`)
  - Check / Cross / Highlight annotation placed (`onAnnotationComplete`)
  - Text note confirmed (`handleConfirmTextNote`)
  - Annotation moved to new position (`handleAnnotationMove`)
  - Annotation deleted (`handleDeleteSelected`)
  - Undo or Redo applied (`handleUndo` / `handleRedo`)
- **Non-Triggers (Zero network requests)**:
  - Initial hydration on mount
  - Pan / zoom transformations
  - Overlay visibility toggling (`Eye` / `EyeOff`)
  - Annotation selection or deselection
  - Opening / cancelling text note editor

### Save Status Indicator States
| Status | Visual UI Badge | ARIA Accessibility | Behavior |
| :--- | :--- | :--- | :--- |
| `idle` | *Hidden (`null`)* | N/A | Initial state when no unsaved changes exist. |
| `saving` | Amber badge with spinner: `"Saving..."` | `role="status"`, `aria-live="polite"` | In-flight HTTP PUT request. |
| `saved` | Emerald badge with checkmark: `"Saved"` | `role="status"`, `aria-live="polite"` | Successfully committed to MongoDB. |
| `error` | Rose badge: `"Save failed"` + `"Retry"` button | `role="alert"`, `aria-live="assertive"` | Network error or 5xx. Clicking Retry re-sends payload. |

---

## 7. Input Support & Hardware Interoperability

- **Mouse**: Primary button (`button: 0`, `buttons: 1`) triggers drawing/stamping. Secondary/middle buttons are rejected. Mouse wheel zooms anchored around pointer coordinates.
- **Stylus / Pen (Wacom, Apple Pencil, Surface Pen)**: Uses standard W3C `pointerType: 'pen'`. Dynamic stroke width mapping:
  $$\text{strokeWidth} = \text{baseWidth} \times \left(0.5 + \text{pressure} \times 1.25\right)$$
  Falls back to default base width when driver reports `pressure: 0` or `undefined`.
- **Touch**: Single-finger drag draws or stamps when a tool is active. Two-finger touch activates multi-touch pinch-to-zoom. Stage drag-pan is locked out when any drawing tool is active to prevent accidental panning.
- **Pointer Cancellation**: Listens for `pointercancel` on `window` to cleanly finalize in-flight strokes and eraser gestures during OS interruptions, stylus lift, or palm rejection.

---

## 8. Keyboard & Interaction Shortcuts Reference

> [!IMPORTANT]
> Every shortcut listed below is verified against active source code and unit tests.

| Input / Shortcut | Action | Context / Notes |
| :--- | :--- | :--- |
| `Ctrl+Z` / `Cmd+Z` | **Undo** | Reverts the last annotation addition, stroke, move, or erasure on the active page. Disabled if typing in an `input` or `textarea`. |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | **Redo** | Re-applies the last undone annotation action on the active page. |
| `Ctrl+Y` / `Cmd+Y` | **Redo (Alternate)** | Standard Windows alternate shortcut for Redo. |
| `Delete` / `Backspace` | **Delete Selected** | Deletes the currently selected annotation in `select` mode. Ignored when typing in text fields. |
| `Enter` *(in TextNoteEditor)* | **Save Text Note** | Confirms and saves the text note annotation. (Ignored if text is empty). |
| `Shift+Enter` *(in TextNoteEditor)* | **Insert Newline** | Inserts a newline character in the text note comment area. |
| `Escape` *(in TextNoteEditor)* | **Cancel Text Note** | Closes the text note editor without creating an annotation. |
| `Mouse Wheel Up` | **Zoom In** | Magnifies canvas by $1.15\times$, anchored around pointer position. |
| `Mouse Wheel Down` | **Zoom Out** | Reduces canvas magnification by $1.15\times$, anchored around pointer position. |
| `Mouse / Touch Drag` *(Tool: `none`)* | **Pan Viewport** | Drags and pans the zoomed answer sheet scan within allowable container bounds. |
| `Mouse / Pen / Touch Drag` *(Tool: `pen`)* | **Draw Freehand Stroke** | Draws continuous smoothed vector stroke. |
| `Mouse / Pen / Touch Drag` *(Tool: `highlight`)* | **Create Highlight Box** | Creates a normalized rectangular highlight box across dragged bounds. |
| `Mouse / Pen / Touch Drag` *(Tool: `eraser`)* | **Erase Strokes** | Erases intersecting freehand strokes along the continuous pointer path. |
| `Mouse / Pen / Touch Drag` *(Tool: `select`)* | **Move Annotation** | Drags the selected annotation to a new position on the page. |
| `Two-Finger Pinch` *(Touch)* | **Pinch-to-Zoom** | Scales canvas magnification dynamically anchored around the pinch midpoint. |

---

## 9. Styling Defaults & Configuration Constants

All constants confirmed by source code in `src/lib/`:

| Parameter | Default Value | Source File | Description |
| :--- | :--- | :--- | :--- |
| `DEFAULT_PEN_COLOR` | `#e11d48` (Rose 600) | [`penTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/penTool.ts) | Default grading pen color |
| `DEFAULT_PEN_WIDTH` | `3 px` | [`penTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/penTool.ts) | Default pen stroke width |
| `PEN_COLORS` | `red` (`#e11d48`), `blue` (`#2563eb`), `green` (`#16a34a`) | [`penTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/penTool.ts) | Supported pen colors |
| `PEN_WIDTHS` | `thin` (`2 px`), `thick` (`5 px`) | [`penTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/penTool.ts) | Supported stroke widths |
| `MIN_PRESSURE_WIDTH_MULTIPLIER` | `0.5` | [`penTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/penTool.ts) | Minimum pressure width multiplier |
| `MAX_PRESSURE_WIDTH_MULTIPLIER` | `1.75` | [`penTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/penTool.ts) | Maximum pressure width multiplier |
| `DEFAULT_CHECK_COLOR` | `#16a34a` (Green 600) | [`stampTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/stampTool.ts) | Checkmark stamp color |
| `DEFAULT_CROSS_COLOR` | `#dc2626` (Red 600) | [`stampTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/stampTool.ts) | Cross stamp color |
| `DEFAULT_STAMP_SIZE` | `28 px` | [`stampTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/stampTool.ts) | Check and cross stamp bounding size |
| `DEFAULT_HIGHLIGHT_COLOR` | `#fde047` (Yellow 300) | [`stampTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/stampTool.ts) | Highlight box fill color |
| `DEFAULT_HIGHLIGHT_OPACITY`| `0.35` | [`stampTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/stampTool.ts) | Highlight box fill opacity |
| `DEFAULT_TEXT_FONT_SIZE` | `14 px` | [`stampTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/stampTool.ts) | Text note font size |
| `DEFAULT_TEXT_BG_COLOR` | `#fef9c3` (Yellow 100) | [`stampTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/stampTool.ts) | Text note sticky background |
| `DEFAULT_ERASER_RADIUS` | `12 px` | [`eraserTool.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/eraserTool.ts) | 2D segment collision hit radius |
| `MIN_ZOOM_LEVEL` | `1.0` (100%) | [`panZoom.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/panZoom.ts) | Viewport minimum zoom |
| `MAX_ZOOM_LEVEL` | `4.0` (400%) | [`panZoom.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/panZoom.ts) | Viewport maximum zoom |
| `DEFAULT_ZOOM_STEP` | `0.25` (25%) | [`panZoom.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/panZoom.ts) | Zoom button increment step |
| `DEFAULT_SMOOTHING_ALPHA` | `0.8` | [`strokeSmoothing.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/strokeSmoothing.ts) | Online smoothing moving average alpha |
| `DEFAULT_MIN_DISTANCE_THRESHOLD` | `2.0 px` | [`strokeSmoothing.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/lib/strokeSmoothing.ts) | Jitter rejection distance threshold |
| `debounceDelayMs` | `800 ms` | [`AnswerSheetCanvas.tsx`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/components/canvas/AnswerSheetCanvas.tsx) | Autosave debounce delay |

---

## 10. Developer Integration & Props API

### Basic Usage Example
```tsx
import { AnswerSheetCanvas } from '@/components/canvas';

export function GradingView({ scriptId, pages }: { scriptId: string; pages: AnswerSheetPage[] }) {
  return (
    <div className="w-full h-[800px]">
      <AnswerSheetCanvas
        scriptId={scriptId}
        pages={pages}
        initialPageIndex={0}
        fitMode="contain"
        enableAutosave={true}
        debounceDelayMs={800}
        onSaveStatusChange={(status) => console.log('Autosave status:', status)}
      />
    </div>
  );
}
```

### Key Props Reference (`AnswerSheetCanvasProps`)
- `scriptId?: string`: Identifier of the answer script for loading and saving annotations.
- `pages?: AnswerSheetPage[]`: Array of script pages with `pageNumber` and image URL paths.
- `src?: string | null`: Fallback single-image URL or data-URI if `pages` array is not used.
- `fitMode?: 'contain' | 'cover' | 'fill' | 'natural'`: Base image fit mode (default: `'contain'`).
- `enablePanZoom?: boolean`: Enables mouse wheel, drag, and pinch pan/zoom (default: `true`).
- `enablePenTool?: boolean`: Enables freehand drawing with style selector (default: `true`).
- `enableStamps?: boolean`: Enables check and cross stamp tools (default: `true`).
- `enableHighlight?: boolean`: Enables highlight rectangle tool (default: `true`).
- `enableTextNote?: boolean`: Enables in-place sticky text note tool (default: `true`).
- `enableEraserTool?: boolean`: Enables stroke erasing tool (default: `true`).
- `enableSelect?: boolean`: Enables annotation selection, move, and delete (default: `true`).
- `enableUndoRedo?: boolean`: Enables keyboard and UI undo/redo history (default: `true`).
- `enableOverlayToggle?: boolean`: Enables visual overlay visibility toggle button (default: `true`).
- `enableAutosave?: boolean`: Enables debounced autosave to backend (default: `true`).
- `debounceDelayMs?: number`: Milliseconds to debounce autosave requests (default: `800`).

---

## 11. Test Coverage Summary

The canvas module is covered by 11 focused test suites and **159 automated tests**:

| Test Suite File | Tests | Focus Area |
| :--- | :--- | :--- |
| [`CanvasFoundation.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/CanvasFoundation.test.ts) | 16 | Coordinate math, clamping, Konva layer hierarchy |
| [`AnswerSheetImageFit.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/AnswerSheetImageFit.test.ts) | 8 | Aspect ratio calculations for contain/cover/fill modes |
| [`PanZoom.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/PanZoom.test.ts) | 12 | Viewport pan bounds clamping, pinch-to-zoom geometry |
| [`FreehandPenTool.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/FreehandPenTool.test.ts) | 16 | Stroke creation, point appending, pressure sensitivity curves |
| [`StrokeSmoothing.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/StrokeSmoothing.test.ts) | 14 | Jitter rejection, online EMA smoothing, Chaikin finalization |
| [`EraserUndoRedo.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/EraserUndoRedo.test.ts) | 11 | 2D segment hit-testing, undo/redo stack recording & restoration |
| [`StampHighlightTools.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/StampHighlightTools.test.ts) | 16 | Check, cross, and highlight rectangle creation & normalization |
| [`TextNoteAnnotation.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/TextNoteAnnotation.test.ts) | 10 | Sticky note placement, font and background formatting |
| [`SelectMoveDeleteAnnotations.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/SelectMoveDeleteAnnotations.test.ts) | 17 | Selection indicators, dragging to move, keyboard/button deletion |
| [`AnnotationZOrderOverlayToggle.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/AnnotationZOrderOverlayToggle.test.ts) | 18 | Array-order z-indexing, overlay visibility toggle & pointer disable |
| [`CanvasAutosave.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/CanvasAutosave.test.ts) | 14 | Debounce timers, navigation flush, retry handling, status UI |
| [`CrossDeviceInputInteroperability.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/CrossDeviceInputInteroperability.test.ts) | 26 | Mouse, stylus, touch, Surface dual-input, high-DPI scaling |
| [`DrawLatencyBenchmark.test.ts`](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/src/__tests__/DrawLatencyBenchmark.test.ts) | 5 | Application-side drawing latency measurement & PRD NFR-5.2 |

---

## 12. Known Limitations & Current Scope

1. **Grading Portal Route Integration**:
   - The `/grading/[scriptId]` route is currently a placeholder page and does not yet mount the completed `AnswerSheetCanvas`. Integration of the canvas into the full evaluation workspace will take place in subsequent roadmap issues.
2. **Physical Hardware QA Boundary**:
   - Automated cross-device testing (AE-138) utilized W3C PointerEvent, TouchEvent, and high-DPI mathematical simulation. Physical testing was conducted on standard workstation mouse hardware. Wacom, iPad, and Microsoft Surface hardware remain designated as *not physically tested* in the test matrix.
3. **Draw Latency Measurement Boundary**:
   - Latency benchmarks (AE-139) strictly measure application-side processing (pointer ingress $\to$ coordinate transform $\to$ smoothing $\to$ Konva node update $\to$ batchDraw dispatch). Browser compositor, GPU rasterization, and physical digitizer hardware polling latencies are outside this measurement boundary.

---

## 13. Reference Documents

- [AE-122 Canvas Foundation Spike](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-122-canvas-library-spike.md)
- [AE-123 Answer Sheet Image Fitting](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-123-implementation.md)
- [AE-124 Pan & Zoom Controls](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-124-implementation.md)
- [AE-125 Multi-Page Navigation](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-125-implementation.md)
- [AE-126 Freehand Pen Tool](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-126-implementation.md)
- [AE-127 Pen Style Selector](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-127-implementation.md)
- [AE-128 Eraser Tool & Undo/Redo](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-128-implementation.md)
- [AE-129 Stroke Smoothing](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-129-implementation.md)
- [AE-130 Stamp & Highlighter Tools](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-130-implementation.md)
- [AE-131 Text Note Annotations](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-131-implementation.md)
- [AE-132 Select, Move & Delete Annotations](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-132-implementation.md)
- [AE-133 Z-Order & Overlay Toggle](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-133-implementation.md)
- [AE-134 Vector Serialization Format](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-134-implementation.md)
- [AE-135 Save Annotations REST API](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-135-implementation.md)
- [AE-136 Annotation Hydration Lifecycle](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-136-implementation.md)
- [AE-137 Debounced Autosave & Save Status](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-137-implementation.md)
- [AE-138 Cross-Device QA Report](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-138-cross-device-qa.md)
- [AE-139 Draw Latency Performance Report](file:///c:/Users/AARATHISREE/Desktop/IIIT%20Hyd%20-%20Assignment%20Evaluation/Project%20Repo/assignment-evaluator/docs/AE-139-draw-latency.md)
