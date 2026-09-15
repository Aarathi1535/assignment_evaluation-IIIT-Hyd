# AE-137: Debounced Annotation Autosave & Save Status Indicator

## Overview & Architecture

GitHub Issue **AE-137** introduces debounced frontend autosave of vector annotations in the grading canvas alongside a visible, accessible save status indicator.

AE-137 builds on top of:
- **AE-134**: Vector annotation serialization format (`SerializedPageAnnotations`, base image coordinate space, immutable source image).
- **AE-135**: REST save endpoint `PUT /api/scripts/{id}/pages/{p}/annotations` with `Page.annotations` as the **single source of truth**.
- **AE-136**: Annotation hydration lifecycle on canvas load (`GET /api/scripts/{id}/pages/{p}/annotations`).

```
+-------------------------------------------------------------------------+
|                           AnswerSheetCanvas                             |
|                                                                         |
|  User Edit Action (Pen, Stamp, Text, Move, Delete, Undo/Redo)           |
|       │                                                                 |
|       ▼                                                                 |
|  scheduleAutosave(strokes, annotations)                                 |
|       │                                                                 |
|       ▼                                                                 |
|  Debounce Timer (default: 800ms) ───────────► Reset on rapid edits      |
|       │                                                                 |
|       │ (on timeout or page navigation flush)                           |
|       ▼                                                                 |
|  serializePageAnnotations(strokes, annotations, options)                |
|       │                                                                 |
|       ▼                                                                 |
|  PUT /api/scripts/{id}/pages/{p}/annotations                            |
|       │                                                                 |
|       ├──► Success: status = 'saved' (Green badge: "Saved")             |
|       └──► Failure: status = 'error' (Rose badge: "Save failed" + Retry)|
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## 1. Debounce Strategy

- **Default Delay**: `800ms` (configurable via `debounceDelayMs`).
- **Rationale**:
  - 800ms provides optimal balance between high drawing performance (preventing hundreds of HTTP PUT requests while drawing continuous freehand strokes) and immediate durability.
  - Multi-point stroke drawing emits mouse/touch events continuously, but autosave is scheduled only once upon stroke completion (`handleStrokeComplete`).
  - Rapid successive actions (e.g. stamping several checkmarks or quick undo/redo) reset the debounce timer and batch into a single HTTP PUT request.

---

## 2. Trigger Model

### Trigger Operations (Autosave is scheduled)
- **Freehand Pen**: Stroke drawn & completed (`handleStrokeComplete`).
- **Eraser Tool**: Strokes erased (`handleStrokesErased`).
- **Stamps**: Checkmark or Cross stamp placed (`handleAnnotationComplete`).
- **Highlight**: Highlight region completed (`handleAnnotationComplete`).
- **Text Note**: Text note confirmed (`handleConfirmTextNote`).
- **Select / Move**: Annotation moved to new coordinates (`handleAnnotationMove`).
- **Delete**: Selected annotation deleted via UI button or Backspace/Delete key (`handleDeleteSelected`).
- **History**: Undo or Redo operation applied (`handleUndo` / `handleRedo`).

### Non-Trigger Operations (No HTTP requests generated)
- **Initial Hydration**: Fetching and loading existing annotations on canvas mount does not trigger autosave.
- **Page Navigation alone**: Switching pages without prior changes does not trigger save.
- **Pan / Zoom**: Canvas viewport transformations are transient and do not mutate annotations.
- **Overlay Toggle**: Toggling visual overlay visibility (`Eye` / `EyeOff`) is a viewport setting.
- **Selection Change**: Selecting or deselecting an annotation without moving/deleting does not trigger save.
- **Transient Text Typing**: Text entered in `TextNoteEditor` is transient until explicitly confirmed. Cancelling the editor generates no changes.

---

## 3. Lifecycle, Flushing & Race Condition Safety

1. **Page Switching Flush**:
   - If a user edits Page 1 and navigates to Page 2 before the 800ms debounce interval expires, `navigateToPage` immediately invokes `flushPendingSave()`.
   - The pending save executes targeting Page 1 (`pageNumber: 1`, `pageKey: 'page-1'`), preventing data loss and eliminating cross-page payload mixing.
2. **Unmount Safety**:
   - Pending debounce timers are cleared on unmount.
   - `isMountedRef` and `saveSeqRef` discard stale network responses if the component unmounts or a newer save cycle finishes first.
3. **Single Source of Truth**:
   - Vector data persists exclusively to `Page.annotations` on the target `Page` document.
   - The source image path (`imagePath`) is never modified or overwritten.

---

## 4. Save Status Indicator Component (`SaveStatusIndicator`)

Located in the top-right corner of the canvas (`top-3 right-3`), the indicator communicates live save states with full accessibility:

| State | Visual Indicator | Accessibility Attributes |
| :--- | :--- | :--- |
| `idle` | Rendered as `null` (unobtrusive initial state) | N/A |
| `saving` | Amber badge with spinning circle icon and `"Saving..."` | `role="status"`, `aria-live="polite"` |
| `saved` | Emerald badge with checkmark icon and `"Saved"` | `role="status"`, `aria-live="polite"` |
| `error` | Rose badge with alert icon, `"Save failed"`, and `"Retry"` button | `role="alert"`, `aria-live="assertive"` |

### Retry Flow
- On save failure (network disconnect or 500 status), the indicator transitions to `error` and displays the `Retry` button.
- Clicking `Retry` immediately invokes `handleRetrySave`, re-serializing the current in-memory annotations for the active page without requiring user page reload.

---

## 5. Scope Boundaries

- **In Scope**: Frontend debounced autosave, `PUT /api/scripts/{id}/pages/{p}/annotations`, `SaveStatusIndicator` UI and accessibility, page switch flushing, unmount safety, retry flow.
- **Out of Scope**:
  - `localStorage` or `IndexedDB` caching / crash drafts.
  - Service worker offline background sync.
  - Backend scheduled cron jobs.
  - New MongoDB collections or schema changes (reuses `Page.annotations`).
