# AE-135: Save Annotations Endpoint Implementation

## Overview
Ticket **AE-135** implements the backend persistence endpoint for saving page-level vector annotations for an answer script page: `PUT /api/scripts/[id]/pages/[p]/annotations`.

It builds upon the vector JSON format and validation utilities established in **AE-134**, storing vector annotations and freehand pen strokes directly on the target `Page` document as the single source of truth while preserving source document image immutability (PRD FR-4.2).

---

## 1. Endpoint Specification

### Method & Path
- `PUT /api/scripts/[id]/pages/[p]/annotations`

### Route Parameters
- `id`: MongoDB ObjectId of the `AnswerScript`.
- `p`: Page identifier (either MongoDB ObjectId of the `Page` or numeric 1-based `pageNumber`).

### Request Headers
- `Content-Type: application/json`
- NextAuth Session cookie / token.

### Request Body
Accepts single-page vector data or full AE-134 document:
```json
{
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
      "id": "text_1715000003_4_jkl78",
      "pageKey": "page-1",
      "type": "text",
      "x": 300,
      "y": 150,
      "text": "Check formula on line 3",
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
      "points": [50, 60, 55, 65, 60, 70],
      "color": "#e11d48",
      "strokeWidth": 3,
      "createdAt": 1715000004000
    }
  ]
}
```

### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Annotations saved successfully",
  "data": {
    "scriptId": "64b8a1c2d3e4f5a6b7c8d9e0",
    "pageId": "64b8a1c2d3e4f5a6b7c8d9e1",
    "pageNumber": 1,
    "annotations": [ ... ],
    "strokes": [ ... ],
    "totalAnnotations": 2,
    "totalStrokes": 1,
    "savedAt": "2026-09-10T12:00:00.000Z"
  }
}
```

### Error Responses
- `400 Bad Request`: Invalid script ID format, invalid page identifier format, invalid JSON body, malformed annotation types, out-of-bounds coordinates, or page does not belong to the requested script.
- `401 Unauthorized`: Unauthenticated request (no active NextAuth session).
- `403 Forbidden`: Unauthorized user role (e.g. Student) or evaluator not assigned to the exam/course.
- `404 Not Found`: AnswerScript or Page not found.
- `500 Internal Server Error`: Unexpected server exception.

---

## 2. Persistence Architecture & Single Source of Truth

### `Page` Model as Single Source of Truth (`src/models/Page.ts`)
- Vector annotation data is stored directly on the target `Page` document:
  - `annotations?: SerializedPageAnnotations | null;`
  - `annotatedBy?: mongoose.Types.ObjectId | null;`
- Preserves existing fields (`imagePath`, `pageNumber`, `answerScript`, `isActive`).
- Subsequent reads in **AE-136** read directly from `Page.annotations`.

### Unmodified `Annotation` Model (`src/models/Annotation.ts`)
- To eliminate dual-write overhead and maintain a single source of truth, no duplicate records or dual-writes are made to the `Annotation` collection. `Annotation.ts` remains in its original repository schema.

---

## 3. Authentication & Authorization

- Enforces evaluator permissions via `requirePermission(Permission.GRADE_SCRIPT)` with fallbacks to `Permission.SAVE_MARKS_FEEDBACK` and `Permission.EDIT_EXAM`.
- Validates that evaluator roles (`TA`, `PROFESSOR`, `ADMIN`) have scoped access to the exam via `ExamRepository.getExamById(...)`.
- Explicitly rejects `STUDENT` users with `403 Forbidden`.
- Explicitly rejects unauthenticated requests with `401 Unauthorized`.

---

## 4. Validation & Idempotency Behavior

- **Identifier Validation**: Verifies that `scriptId` is a 24-character hexadecimal ObjectId, and `pageIdentifier` is either an ObjectId or positive integer.
- **Payload Validation**: Leverages AE-134's `validateAnnotationDocument` to ensure all check/cross/highlight/text marks and pen strokes have valid finite numeric coordinates, valid color hexes, and positive dimensions.
- **Script-Page Integrity**: Verifies that the resolved page strictly belongs to `script._id`. If a page exists under a different script, rejects with `400 Bad Request`.
- **Deterministic Replacement**: Replaces previous vector state on the target page document directly, guaranteeing that repeated PUTs are idempotent without creating duplicate documents.

---

## 5. Source Image Immutability (PRD FR-4.2)

- The source image storage path (`Page.imagePath` and `IngestionPage.storageKey`) is **never modified, overwritten, or cleared** during annotation saving.
- Only vector overlay JSON is persisted.

---

## 6. Test Coverage & Verification

Automated test suite `src/__tests__/SaveAnnotationsApi.test.ts` covers:
1. ✓ Successful annotation save by numeric `pageNumber` directly on `Page.annotations`.
2. ✓ Successful annotation save by Page `ObjectId`.
3. ✓ Repeated PUT replaces existing annotation state on the same Page document without duplicate creation (idempotency).
4. ✓ Rejects invalid annotation payload with `400 Bad Request`.
5. ✓ Rejects invalid script ID or page identifier format with `400 Bad Request`.
6. ✓ Returns `400 Bad Request` when requested page belongs to a different script.
7. ✓ Rejects unauthenticated requests with `401 Unauthorized`.
8. ✓ Rejects unauthorized user roles (Student) with `403 Forbidden`.
9. ✓ Confirms source page image storage path remains completely untouched and immutable.
10. ✓ Preserves all supported AE-134 annotation types (check, cross, highlight, text note, pen strokes) and styling properties.
11. ✓ Verifies `Annotation` collection has 0 documents created and `Page.annotations` is the sole single source of truth.

---

## 7. Out-of-Scope Confirmations
- **AE-136**: Canvas loading workflow and client-side annotation hydration are **NOT** implemented in this ticket.
- **AE-137**: Autosave debounce mechanics and UI save status indicators are **NOT** implemented in this ticket.
- **UI / Frontend**: Grading UI modifications are intentionally avoided.
