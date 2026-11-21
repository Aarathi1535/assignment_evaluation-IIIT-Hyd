# Issue AE-343: Handling Concurrent Grade Finalization and Duplicate Submission Conflicts

## Status
- **Issue**: AE-343
- **Priority**: High (Data Integrity & Fault Handling)
- **Status**: Resolved
- **Impact Area**: Grading API (`/api/scripts/[id]/questions/[questionNumber]/grade`, `/api/scripts/[id]/grades`), `GradingService`, Database Index Lifecycle

---

## 1. Problem Description

During high-concurrency evaluation workloads where multiple Teaching Assistants (TAs) or automated grading processes interact simultaneously with the same answer script and question, race conditions were identified:

1. **Missing Unique Compound Index on Fresh Databases**:
   - The Mongoose schema in `src/models/Grade.ts` defines:
     ```ts
     GradeSchema.index({ answerScript: 1, question: 1 }, { unique: true });
     ```
   - On a clean production or fresh test database, `dbMigration.migrateIndexes()` was calling `Model.createIndexes()` instead of `Model.syncIndexes()`. This failed to reliably build unique indexes on unindexed collections, allowing two TAs finalizing the same question concurrently to insert duplicate final Grade documents.

2. **Uncaught Transaction / Duplicate Key Errors (HTTP 500 instead of HTTP 409)**:
   - When the unique compound index existed, or when a TA double-submitted final grades simultaneously, the losing transaction encountered an unhandled MongoDB `E11000 duplicate key error` (code 11000) or `WriteConflict` (code 112 / `TransientTransactionError`).
   - The route handlers caught this error, but since the raw MongoDB exception is not an `HttpError`, `status = error instanceof HttpError ? error.statusCode : 500` defaulted to **500 Internal Server Error** instead of returning a clean **409 Conflict**.

---

## 2. Root Cause Analysis

- **Mongoose Index Synchronization**: `createIndexes()` does not reconcile or force-sync indexes against the live MongoDB collection catalog in the same manner as `syncIndexes()`.
- **Exception Classification**: `src/lib/errors.ts` had `isDuplicateKeyError()`, but lacked a general `isConflictError()` helper that also recognizes transaction write conflicts (`code: 112`, `WriteConflict`, `VersionError`, `TransientTransactionError`). Consequently, transactional collision errors percolated up as uncaught generic errors.

---

## 3. Implemented Fix

1. **Index Synchronization**:
   - Updated `src/utils/dbMigration.ts` to call `syncIndexes()` on `Allocation`, `Grade`, and `RegradeRequest`. This ensures that every server start or migration properly builds the `{ answerScript: 1, question: 1 }` unique index on MongoDB.

2. **Conflict Error Classification (`src/lib/errors.ts`)**:
   - Added `isConflictError(error: unknown): boolean` recognizing MongoDB duplicate key errors (code 11000, `E11000`), Write Conflicts (code 112, `WriteConflict`), Mongoose `VersionError`, and `TransientTransactionError`.

3. **Service-Level Conflict Normalization (`src/services/GradingService.ts`)**:
   - In `GradingService.saveGrade`, caught transactional conflict errors are mapped to `new HttpError('Conflict: Concurrent grade finalization detected...', 409)`.

4. **API Route Handlers**:
   - Both `/api/scripts/[id]/questions/[questionNumber]/grade` and `/api/scripts/[id]/grades` catch `isConflictError(error)` and return HTTP 409 Conflict with a structured response `{ success: false, message: 'Conflict: This question was concurrently graded or finalized.' }`.

---

## 4. Verification

- Integration test in `src/__tests__/ConcurrentGradingAE224.test.ts` builds indexes via `syncIndexes()`, allocates both TAs to the same question, fires simultaneous requests directly through the route, asserts exactly one 200 and one 409 status code with winning values, and verifies deterministic behavior across 20 repetitions.
