# AE-127 Implementation: Pen Color & Stroke-Width Selector

## Overview
Issue **AE-127** extends the freehand pen tool (AE-126) by introducing dedicated, accessible controls to select the pen color and stroke width for grading annotations.

This implementation builds directly upon the existing canvas foundation (AE-122), image fit architecture (AE-123), pan/zoom coordinate transforms (AE-124), multi-page navigation (AE-125), and freehand drawing pipeline (AE-126).

---

## 1. Supported Styles & Palette

### A. Pen Colors
Support is strictly limited to three grading colors (no arbitrary color picker):

| Color ID | Label | Hex Code | Visual / Semantic Usage |
| :--- | :--- | :--- | :--- |
| `red` *(Default)* | Red | `#e11d48` | Standard marking, corrections, deductions |
| `blue` | Blue | `#2563eb` | Informational remarks, structure notes |
| `green` | Green | `#16a34a` | Correct points, full marks, commendations |

### B. Stroke Widths
Support is strictly limited to two distinct base widths:

| Width ID | Label | Base Pixel Width | Visual Line Display |
| :--- | :--- | :--- | :--- |
| `thin` *(Default)* | Thin | `2px` | Fine text, subscript annotations, precise marks |
| `thick` | Thick | `5px` | Checkmarks, crosses, emphasis underlines |

---

## 2. Architecture & Data Flow

### A. Style Immutability
Each `FreehandStroke` stores its own immutable `color` and `strokeWidth` recorded at the moment of stroke creation:
```typescript
export interface FreehandStroke {
  id: string;
  pageKey: string | number;
  points: number[];
  color: string;       // e.g. '#e11d48'
  strokeWidth: number; // e.g. 2, 5, or pressure-adjusted
  createdAt: number;
}
```
- When the user changes the active color or width, existing strokes retain their original color and stroke width.
- Only newly initiated strokes receive the currently selected style.

### B. Data Flow into New Strokes
1. The user selects a color or width in `PenStyleSelector`.
2. `AnswerSheetCanvas` updates its active style state (`activePenColor`, `activePenWidth`).
3. `effectiveStrokeColor = resolvePenColor(activePenColor)` and `effectiveStrokeWidth = resolvePenWidth(activePenWidth)` are computed.
4. `PenLayer` receives the resolved values as `color` and `strokeWidth` props.
5. On `pointerdown`, `createStroke(pageKey, imagePoint, { color, strokeWidth, pressure })` initializes the stroke with the selected style.

---

## 3. Pressure Handling Compatibility

The pressure-to-width algorithm from AE-126 operates on the user's selected base width:
$$\text{effectiveWidth} = \text{baseWidth} \times (0.5 + 1.25 \times \text{pressure})$$

- **Thin (`2px` base)**: Scales from `1.0px` (light stylus touch) to `3.5px` (firm stylus press).
- **Thick (`5px` base)**: Scales from `2.5px` (light stylus touch) to `8.75px` (firm stylus press).
- **Non-Pressure Devices (Mouse / Standard Touch)**: Falls back directly to the exact base width (`2px` for thin, `5px` for thick).

---

## 4. UI & Accessibility (ARIA)

The `PenStyleSelector` component (`src/components/canvas/PenStyleSelector.tsx`) integrates into the canvas floating toolbar when pen mode is active:
- **Radio Groups**: Both the color selector and width selector use `role="radiogroup"` with explicit `aria-label` attributes (`"Pen Color Selector"` and `"Pen Stroke Width Selector"`).
- **Radio Buttons**: Each option is a `<button role="radio">` with `aria-checked={isSelected}` and descriptive `aria-label` (e.g. `"Red Pen Color"`, `"Thin Stroke Width (2px)"`).
- **Keyboard Navigation**: Buttons are standard focusable elements with visible focus rings (`focus:ring-2 focus:ring-blue-500`).
- **Visual Feedback**: The active selection is highlighted with high-contrast active borders and rings (`ring-1 ring-slate-300`).

---

## 5. Multi-Page Navigation Behavior

- **Style Persistence**: The user's active color and width selections are maintained at the canvas/session level across page transitions (AE-125).
- **Stroke Isolation**: Existing strokes on Page 1 remain tied to Page 1; strokes on Page 2 remain tied to Page 2.
- **New Strokes**: Creating new strokes on any page applies the currently active style.

---

## 6. Pan / Zoom Preservation

The pen style controls exist entirely within the floating UI toolbar overlay:
- Drag-pan remains active when pen mode is OFF.
- Drag-pan is safely bypassed during active drawing when pen mode is ON.
- Wheel zoom, 2-finger pinch zoom, zoom buttons (+ / −), and reset-to-fit (100%) remain fully operational regardless of active pen style.

---

## 7. Out-of-Scope Items

In accordance with strict project boundaries, the following are **NOT** implemented in AE-127:
- **AE-128**: Eraser tool, Undo / Redo history stack.
- **AE-129**: Advanced Catmull-Rom spline smoothing, predictive latency optimization.
- **Persistence**: MongoDB storage, REST APIs, or local storage persistence (in-memory state only).
- **Grading Logic / Database**: No changes to grading models or student submission schemas.
- **Arbitrary Color Picker**: No custom hex / RGB color input outside the 3 supported colors.

---

## 8. Test Validation

### Tests Executed:
- `src/__tests__/PenStyleSelector.test.ts` (AE-127: 15 tests)
- `src/__tests__/FreehandPenTool.test.ts` (AE-126: 16 tests)
- `src/__tests__/MultiPageNavigation.test.ts` (AE-125: 22 tests)
- `src/__tests__/PanZoom.test.ts` (AE-124: 12 tests)
- `src/__tests__/AnswerSheetImageFit.test.ts` (AE-123: 15 tests)
- `src/__tests__/CanvasFoundation.test.ts` (AE-122: 15 tests)

**Total Canvas Suite**: **95 / 95 passing tests**.
