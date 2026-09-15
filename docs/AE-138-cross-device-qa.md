# AE-138: Cross-Device Input Interoperability QA Report (Mouse, Wacom, iPad, Surface)

## 1. Test Environment & Execution Profile

- **Operating System**: Windows (Workstation Environment)
- **Runtime / Test Engine**: Node.js / Vitest v4.1.10 with W3C DOM and Pointer Events Level 2/3 test harnesses
- **Target Application**: Week-7 Answer Sheet Annotation Canvas (`AnswerSheetCanvas.tsx`, `PenLayer.tsx`, `MarkLayer.tsx`, `PageImageLayer.tsx`)
- **Primary Input Framework**: Unified W3C Pointer Events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) + Konva Canvas Layering

---

## 2. Hardware Matrix & Physical Test Status

| Device / Hardware Class | Input Modalities | Physical Test Performed | Verification Method |
| :--- | :--- | :--- | :--- |
| **Standard Desktop / Laptop** | Optical Mouse, Trackpad, Wheel | **Yes** | Physical workstation input & automated PointerEvent tests |
| **Wacom / Digital Pen Tablet** | EMR/AES Stylus, Pressure Tip, Eraser | **No (NOT PHYSICALLY TESTED)** | Automated PointerEvent suite (`pointerType: 'pen'`, pressure curves, pointercancel) |
| **Apple iPad / iOS Safari** | Capacitive Touch, Multi-Touch Pinch | **No (NOT PHYSICALLY TESTED)** | Automated Touch & PointerEvent suite (`pointerType: 'touch'`, pinch geometry) |
| **Microsoft Surface / 2-in-1** | Surface Pen, Multi-Touch, High-DPI | **No (NOT PHYSICALLY TESTED)** | Automated dual-input suite, display scaling coordinate mapping |

> [!NOTE]
> As per strict QA guidelines, unavailable physical hardware (Wacom tablet, Apple iPad, Microsoft Surface) is explicitly designated as **NOT PHYSICALLY TESTED**. No hardware latency metrics or device results are fabricated. All physical hardware gaps are rigorously supplemented with code-level W3C PointerEvent, TouchEvent, and mathematical coordinate invariance tests.

---

## 3. Test Scenarios & Results

### Category 1: Standard Mouse & Trackpad
- **Test Scenarios**:
  1. Freehand drawing with primary mouse button (`button: 0`, `buttons: 1`, `pointerType: 'mouse'`).
  2. Secondary / tertiary button ignore (right-click and middle-click do not trigger unwanted drawing or stamping).
  3. Screen-to-image coordinate mapping invariance under 1.0x, 2.0x, and 4.0x zoom with pan translation.
  4. Check and Cross stamp placement on primary mouse click.
  5. Highlight rectangle creation and bounding box normalization on click-drag in all directions (TL-to-BR, BR-to-TL, TR-to-BL, BL-to-TR).
  6. In-place text note placement anchor on mouse click.
  7. Eraser tool hit-testing along 2D stroke segments within `DEFAULT_ERASER_RADIUS`.
  8. Select, drag-to-move, and delete workflow.
  9. Mouse wheel zoom anchored around cursor location.
  10. Stage panning enabled when tools are idle (`activeTool: 'none'`), and locked out when drawing tools are active.
- **Result**: **PASS** (Physical & Automated)

---

### Category 2: Wacom & Digital Stylus (Pen)
- **Test Scenarios**:
  1. Stylus pointer event handling (`pointerType: 'pen'`).
  2. Dynamic stroke width modulation via continuous pressure sensitivity formula:
     $$\text{strokeWidth} = \text{baseWidth} \times \left(0.5 + \text{pressure} \times 1.25\right)$$
     Testing pressure range from minimum (0.1) to maximum (1.0).
  3. Graceful fallback to default base stroke width when driver/hardware reports `pressure: 0`, `undefined`, or out-of-range values.
  4. Global pointer tracking across window boundaries (attaching `pointermove` and `pointerup` to `window` prevents dropped strokes).
  5. `pointercancel` handling: clean in-flight stroke and eraser gesture finalization on stylus lift, palm rejection, or OS interrupt.
  6. Accidental pan lockout during active stylus drawing gestures.
- **Result**: **PASS** (Code-level & Automated PointerEvent validation)

---

### Category 3: Apple iPad & Capacitive Touch
- **Test Scenarios**:
  1. Touch pointer event handling (`pointerType: 'touch'`) for single-finger freehand drawing and stamp placement.
  2. Multi-touch pinch zoom geometry: Euclidean distance and midpoint calculation between two touch coordinates via `calculatePinchMetrics`.
  3. Smooth pinch-to-zoom scaling anchored around touch midpoint.
  4. Viewport pan clamping preventing image boundaries from escaping the container during touch drag.
  5. Stage pan lockout during single-touch drawing gestures (`isPenActive = true`).
  6. Prevention of default browser viewport zooming/scrolling via non-passive touch listeners (`e.preventDefault()`).
  7. `pointercancel` handling during touch interruption (e.g., notification banner or gesture bar takeover).
- **Result**: **PASS** (Code-level & Automated Touch/PointerEvent validation)

---

### Category 4: Microsoft Surface Dual-Input
- **Test Scenarios**:
  1. Interoperability between Surface Pen (with pressure) and capacitive finger touch within the same grading session without tool state desynchronization.
  2. Invariant coordinate mapping under high-DPI display scaling (e.g., 150%, 200% Windows scaling) via `getBoundingClientRect()` relative screen coordinates.
  3. Simultaneous touch rejection when drawing tools are active.
  4. Eraser tool segment hit-testing with stylus tip and touch points.
- **Result**: **PASS** (Code-level & Automated validation)

---

### Category 5: Tool State, History, and Visibility Overlay
- **Test Scenarios**:
  1. Unified undo/redo stack across mixed device inputs (e.g., Mouse Stroke $\to$ Stylus Stamp $\to$ Touch Note).
  2. Complete undo and redo cycles restoring exact geometry and stroke attributes.
  3. Overlay visibility toggle (`visible = false`) disabling pointer interactions uniformly across mouse, stylus, and touch.
  4. Strict per-page annotation isolation across all device input types.
- **Result**: **PASS** (Automated validation)

---

## 4. Automated / Code-Level Validation Summary

- **Focused Test Suite**: `src/__tests__/CrossDeviceInputInteroperability.test.ts`
  - **Tests**: 26 passed, 0 failed (100% passing)
- **Existing Canvas Regression Suite**:
  - `FreehandPenTool.test.ts`: 16 passed
  - `PanZoom.test.ts`: 12 passed
  - `StampHighlightTools.test.ts`: 16 passed
  - `EraserUndoRedo.test.ts`: 11 passed
  - `SelectMoveDeleteAnnotations.test.ts`: 17 passed
  - `TextNoteAnnotation.test.ts`: 10 passed
  - `AnnotationZOrderOverlayToggle.test.ts`: 18 passed
  - `CanvasAutosave.test.ts`: 14 passed
  - `StrokeSmoothing.test.ts`: 14 passed
  - **Total Passing Tests**: 154 passed across all canvas suites.

---

## 5. Known Limitations & Device Considerations

1. **Browser Pointer Event Emulation Differences**:
   - In standard desktop Chromium and Firefox, mouse `pointerdown` events report `pressure: 0` or `pressure: 0.5`. The canvas correctly ignores pressure values $\le 0$ and treats mouse inputs as constant base-width strokes.
2. **Palm Rejection Delegation**:
   - Palm rejection relies on the underlying OS and browser emitting `pointercancel` when a palm contact is classified. The canvas component properly listens for `pointercancel` on `window` and finalizes in-flight strokes cleanly.
3. **Stylus Barrel Buttons & Eraser Flip**:
   - Stylus inverted eraser tips typically emit `pointerType: 'pen'` with secondary button IDs or distinct pointer IDs. In the current implementation, toggling between pen and eraser is controlled via the canvas toolbar.

---

## 6. Discovered Bugs

No blocking production defects or cross-device interoperability bugs were discovered during testing. The existing W3C Pointer Events architecture in Week-7 canvas cleanly handles mouse, pen/stylus, and touch inputs without requiring custom device-specific patches or production regressions.
