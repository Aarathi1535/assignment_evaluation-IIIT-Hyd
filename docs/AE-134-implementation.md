# AE-134: Vector JSON Annotation Serialization Implementation

## Overview
Ticket **AE-134** establishes a clean, deterministic vector JSON representation and serialization/validation utilities for answer-sheet canvas annotations and freehand strokes, strictly organized per page. It builds upon the Week-7 stacked canvas implementation (AE-122 through AE-133), providing the foundational data contracts for persistence (AE-135) and canvas reconstruction (AE-136).

---

## 1. Serialization Format & Schema Specification

The serialized document is a pure, JSON-serializable vector structure with formal versioning and schema identification:

```json
{
  "version": 1,
  "schema": "urn:ae:vector-annotations:v1",
  "pages": {
    "page-1": {
      "annotations": [
        {
          "id": "check_1715000000_1_abc12",
          "pageKey": "page-1",
          "type": "check",
          "x": 120,
          "y": 340,
          "size": 28,
          "color": "#16a34a",
          "createdAt": 1715000000000
        },
        {
          "id": "cross_1715000001_2_def34",
          "pageKey": "page-1",
          "type": "cross",
          "x": 250,
          "y": 410,
          "size": 28,
          "color": "#dc2626",
          "createdAt": 1715000001000
        },
        {
          "id": "hl_1715000002_3_ghi56",
          "pageKey": "page-1",
          "type": "highlight",
          "x": 100,
          "y": 200,
          "width": 250,
          "height": 45,
          "color": "#fde047",
          "opacity": 0.35,
          "createdAt": 1715000002000
        },
        {
          "id": "text_1715000003_4_jkl78",
          "pageKey": "page-1",
          "type": "text",
          "x": 300,
          "y": 150,
          "text": "Check time complexity in step 2",
          "fontSize": 14,
          "color": "#0f172a",
          "backgroundColor": "#fef9c3",
          "borderColor": "#fde047",
          "createdAt": 1715000003000
        }
      ],
      "strokes": [
        {
          "id": "stroke_1715000004_5_mno90",
          "pageKey": "page-1",
          "points": [50, 60, 55, 65, 60, 70, 65, 75],
          "color": "#e11d48",
          "strokeWidth": 3,
          "createdAt": 1715000004000
        }
      ]
    }
  },
  "metadata": {
    "totalAnnotations": 4,
    "totalStrokes": 1
  }
}
```

---

## 2. Per-Page Organization
- All vector elements are strictly grouped under `pages["<pageKey>"]`.
- `pageKey` maps deterministically to the answer-sheet page's database ID or 0-based page index.
- Each page dictionary contains two isolated arrays:
  - `annotations`: Check stamps, Cross stamps, Highlight rectangles, Text notes.
  - `strokes`: Freehand pen drawing strokes.
- Preserves natural type separation between `MarkAnnotation` and `FreehandStroke` without artificial union forcing.

---

## 3. Supported Annotation & Stroke Types

| Type | Discriminator (`type`) | Specific Fields | Invariant Space |
| :--- | :--- | :--- | :--- |
| **Check Stamp** | `'check'` | `size`, `color` | Centered at `(x, y)` |
| **Cross Stamp** | `'cross'` | `size`, `color` | Centered at `(x, y)` |
| **Highlight Box** | `'highlight'` | `width`, `height`, `color`, `opacity` | Top-left at `(x, y)` |
| **Text Note** | `'text'` | `text`, `fontSize`, `color`, `backgroundColor`, `borderColor` | Top-left at `(x, y)` |
| **Freehand Stroke** | N/A (in `strokes`) | `points` ($[x_0, y_0, x_1, y_1, \dots]$), `color`, `strokeWidth` | Continuous line points |

---

## 4. Invariant Coordinate Representation
- All coordinates ($x, y$, $\text{width}, \text{height}$, and $\text{points}$ alternating coordinates) are strictly in **invariant base image space**.
- Pan offsets (`transform.x`, `transform.y`) and zoom scaling (`transform.zoom`) are **never baked** into the serialized coordinates.
- Annotations remain anchored to the exact identical physical pixel locations on the source document regardless of the user's viewport resolution or zoom state.

---

## 5. Deterministic Ordering
- **Intra-Page Order**: Array insertion order is preserved identically during serialization. This guarantees that layer stacking and z-index ordering established in AE-133 remain reproducible.
- **Inter-Page Order**: Page keys are sorted deterministically (by explicit page sequence when supplied, followed by numeric/lexicographical order).
- **No Side Effects**: Serialization does not generate random IDs or update timestamps during the serialization process; it operates purely as an immutable transform.

---

## 6. Lightweight Validation & Safe Deserialization (AE-136 Readiness)
To facilitate error-resilient canvas loading in AE-136, pure validation and parsing utilities are provided:
- `validateAnnotationDocument(input: unknown): ValidationResult`:
  - Validates document structure, version numbers, page dictionaries, and array schemas.
  - Validates coordinate numbers as finite numbers (`Number.isFinite`).
  - Safely returns `{ valid: false, errors: string[] }` without throwing unhandled exceptions.
- `deserializeAnnotationDocument(jsonOrObject: string | unknown): DeserializationResult`:
  - Handles string JSON parsing with try/catch.
  - Runs validation and returns structured result ready for canvas ingestion.
- `extractPageAnnotations(doc, pageKey)`:
  - Safely extracts annotations and strokes for a specific page with empty array fallbacks.

---

## 7. Source Image Separation (PRD FR-4.2)
In accordance with PRD FR-4.2 ("overlays separate from source"):
- The serialized representation contains **strictly vector geometry, styling, and text metadata**.
- The source answer-sheet image is **never baked** into the vector JSON (no image pixels, no base64 data URIs, no SVGs, no image snapshots).
- The underlying answer-sheet image asset is referenced and loaded independently.

---

## 8. Intentionally NOT Persisted (Transient UI State)
The following transient UI and viewport state parameters are intentionally excluded from serialization:
- `selectedAnnotationId` (current active selection)
- `activeTool` (`'none'`, `'pen'`, `'select'`, etc.)
- `isOverlayVisible` (temporary overlay visibility state)
- `transform` (`panX`, `panY`, `zoom`)
- `activeTextEditor` (uncommitted in-place text editor modal/anchor)
- `PageHistory` (past/future undo/redo stacks)

---

## 9. Test Coverage & Verification

Automated tests in `src/__tests__/AnnotationSerialization.test.ts` verify all 16 required criteria:
1. ✓ Check annotation serializes correctly with all styling tokens
2. ✓ Cross annotation serializes correctly with all styling tokens
3. ✓ Highlight annotation serializes correctly with geometry and opacity
4. ✓ Text note annotation serializes correctly with text and styling tokens
5. ✓ Freehand pen strokes serialize correctly with point arrays and width
6. ✓ Multiple annotations serialize in exact insertion z-order
7. ✓ Multi-page separation isolates annotations and strokes by pageKey
8. ✓ Invariant base image coordinates are preserved
9. ✓ Rendering-critical properties are preserved across deep cloning
10. ✓ Transient UI state is strictly excluded
11. ✓ Serialization produces deterministic, reproducible JSON strings
12. ✓ Source annotation and stroke objects remain completely immutable
13. ✓ Serialized output is valid standard JSON
14. ✓ Malformed input is safely rejected by non-throwing validator
15. ✓ Empty pages and empty annotation arrays are handled gracefully
16. ✓ Source image pixels/data URIs are never included

**Test Execution Results:**
- `AnnotationSerialization.test.ts`: 20 tests passed
- Full canvas test suite: 95 tests passed across 6 test suites
- `npx tsc --noEmit`: 0 errors
- `npm run lint`: 0 errors in canvas code
- `git diff --check`: Clean

---

## 10. Scope Boundaries & Out-of-Scope Confirmations
- **AE-135**: Database persistence schema, MongoDB collections, and `/api/grading/...` endpoints are **NOT** implemented in this ticket.
- **AE-136**: Canvas loading hooks and store reconstruction are **NOT** implemented in this ticket.
- **AE-137**: Autosave debounce mechanics and save indicator UI are **NOT** implemented in this ticket.
