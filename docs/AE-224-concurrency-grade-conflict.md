# AE-224: Handling Concurrent Grade Finalization and 500 → 409 Conflict Resolution

## Status
- **Ticket**: AE-224 (PR #342)
- **Issue Reference**: Resolves grading concurrency conflict (Issue #344: HTTP 500 on concurrent grade submission instead of 409 Conflict)
- **Priority**: High (Data Integrity & API Concurrency Contract)
- **Status**: Resolved
- **Impact Area**: Grading API (`POST /api/scripts/[id]/questions/[questionNumber]/grade`, `POST /api/scripts/[id]/grades`), `GradingService`, `src/lib/errors.ts`

---

## 1. Problem Description & Root Cause

During concurrent grading workloads where multiple Teaching Assistants (TAs) or automated grading workers submit grades for the same answer script and question simultaneously:

1. **Unique Index Constraint**:
   - `src/models/Grade.ts` defines a composite unique index:
     ```ts
     GradeSchema.index({ answerScript: 1, question: 1 }, { unique: true });
     ```
   - This index is created safely during application startup via `connectDB()` and `dbMigration.migrateIndexes()` using `Model.createIndexes()`. (Note: `Model.syncIndexes()` is deliberately avoided as it can inadvertently drop undeclared indexes across shared environments).

2. **Unhandled DB Exceptions (HTTP 500 instead of HTTP 409)**:
   - When concurrent finalization requests occur, the second/losing write triggers a MongoDB `E11000 duplicate key error` on `{ answerScript: 1, question: 1 }` or a transaction `WriteConflict` (code 112).
   - Because raw MongoDB driver errors do not inherit from `HttpError`, unhandled database exceptions defaulted to `500 Internal Server Error` in route handlers rather than communicating the expected `409 Conflict` status code to the client.

---

## 2. Implemented Fix

1. **Narrowed Conflict Error Classification (`src/lib/errors.ts`)**:
   - Implemented `isConflictError(error: unknown): boolean` strictly scoped to:
     - MongoDB WriteConflict (`code: 112`, `codeName: 'WriteConflict'`, or message containing `WriteConflict`).
     - Grade unique index duplicate key error (MongoDB `code: 11000`, matching key pattern or message for `answerScript` and `question`).
   - Unrelated errors (VersionError, generic validation errors, other collection duplicate keys) are excluded and not treated as concurrency conflicts.

2. **Service-Level Error Translation (`src/services/GradingService.ts`)**:
   - In `GradingService.saveGrade`, caught transactional conflicts matching `isConflictError(err)` are normalized into `new HttpError('Conflict: Concurrent grade finalization detected...', 409)`.

3. **Mutation Route Handlers**:
   - Both `POST /api/scripts/[id]/questions/[questionNumber]/grade` and `POST /api/scripts/[id]/grades` catch `isConflictError(error)` and return HTTP 409 Conflict:
     ```json
     {
       "success": false,
       "message": "Conflict: This question was concurrently graded or finalized.",
       "data": null
     }
     ```
   - The `GET /api/scripts/[id]/grades` read handler does not perform conflict checks.

4. **Index Lifecycle Preservation (`src/utils/dbMigration.ts`)**:
   - Retained safe `createIndexes()` across models. No unsafe `syncIndexes()` calls are introduced.

---

## 3. Verification

- `src/__tests__/ConcurrentGradingAE224.test.ts`:
  - Verified concurrent TA grading on the same question returns exactly one 200 and one 409 deterministically.
  - Verified independent question grading succeeds concurrently (both 200).
  - Added unit test suite for `isConflictError` verifying correct classification of Grade E11000 and WriteConflict errors while rejecting unrelated errors.
