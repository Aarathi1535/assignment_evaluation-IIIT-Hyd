# AE-113 — Reassignment History

## Objective

Allow authorized users (Professors and Admins) to retrieve reassignment history for a specific exam from existing `AuditLog` records without creating duplicate history models or mutating data.

## Existing AuditLog architecture inspected

1. **AuditLog Schema & Model (`src/models/AuditLog.ts`)**:
   - Stores audit records with `action`, `user`, `entityId`, `entityType`, `outcome`, `details`, and timestamps (`createdAt`, `updatedAt`).
2. **Reassignment Audit Logging (`AllocationService.reassignAllocation`)**:
   - Creates an `AuditLog` entry on successful reassignment with:
     - `action`: `'ALLOCATION_REASSIGN'`
     - `outcome`: `'SUCCESS'`
     - `user`: `actingUserObjectId`
     - `entityId`: `allocationObjectId`
     - `entityType`: `'Allocation'`
     - `details`: `{ examId, answerScriptId, question, previousTaId, newTaId }`
     - `createdAt`: Date timestamp
3. **No Duplicate Model**:
   - The implementation directly queries the existing `AuditLog` collection, ensuring single-source-of-truth integrity.

## Endpoint added

- **Route**: `GET /api/exams/[id]/allocate/reassign/history`
- **File**: `src/app/api/exams/[id]/allocate/reassign/history/route.ts`
- **Behavior**:
  - Validates `examId` format (400 on invalid format).
  - Enforces `Permission.ALLOCATE_SCRIPTS` (403 on unauthorized roles like TA/Student, 401 on unauthenticated requests).
  - Fetches and formats chronological history entries.

## Authorization

- Protected by `Permission.ALLOCATE_SCRIPTS` via `requirePermission(Permission.ALLOCATE_SCRIPTS)` from `src/lib/apiAuth.ts`.
- Matches the security level of the reassignment endpoint `PUT /api/exams/[id]/allocate/reassign`.
- Unauthorized TAs and Students receive 403 Forbidden.

## AuditLog query, filter & pagination

In `AllocationService.getReassignmentHistory`:
```ts
const page = Math.max(1, options?.page || 1);
const limit = Math.min(100, Math.max(1, options?.limit || 20));
const skip = (page - 1) * limit;

const filter = {
    action: 'ALLOCATION_REASSIGN',
    'details.examId': examId
};

// Query total count and paginated audit logs in parallel
const [total, auditLogs] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
]);
```
- **Action Filter**: Exclusively queries `action: 'ALLOCATION_REASSIGN'`. Unrelated audit logs are filtered out at the database level.
- **Exam Filter**: Strictly filters to the requested `examId` inside `details.examId`. Logs from other exams are excluded.
- **Pagination**: Default `page = 1`, default `limit = 20`, maximum `limit = 100`. Database-level `.skip()` and `.limit()` ensure unbounded queries are prevented.

## Chronological ordering

- Audit logs are sorted using `.sort({ createdAt: 1, _id: 1 })`.
- Ensures oldest reassignment events appear first ($T_1 \rightarrow T_2 \rightarrow T_3$) across paginated slices.

## Current-page TA & user resolution

- Collects distinct `previousTaId`, `newTaId`, and `actingUserId` strings **only for the records returned on the current page**.
- Batch queries the `User` collection (`User.find({ _id: { $in: validUserObjectIds } }).select('_id name email role')`).
- Resolves each TA ID to `{ id, name, email }`.
- **Graceful Fallback**: If a referenced TA user has been removed or cannot be found, the record is preserved with `{ id: taId, name: 'Unknown TA', email: '' }` rather than dropping the history entry.

## Acting-user resolution

- Resolves `log.user` (the professor or admin who triggered the reassignment) from the current-page batch user query.
- Returns `{ id, name, email }` without leaking passwords or sensitive tokens.
- Gracefully falls back to `{ id: userId, name: 'Unknown User', email: '' }` if unresolvable.

## Response shape

```json
{
  "success": true,
  "message": "Reassignment history retrieved successfully",
  "data": {
    "examId": "66d1234567890abcdef12345",
    "history": [
      {
        "_id": "66d1234567890abcdef12399",
        "action": "ALLOCATION_REASSIGN",
        "timestamp": "2026-09-02T10:00:00.000Z",
        "createdAt": "2026-09-02T10:00:00.000Z",
        "allocationId": "66d1234567890abcdef12388",
        "question": 1,
        "answerScript": {
          "_id": "66d1234567890abcdef12377",
          "anonymousId": "SCRIPT-001",
          "scriptReference": "Script-batch-1-0"
        },
        "previousTa": {
          "id": "66d1234567890abcdef12301",
          "name": "Hermione Granger",
          "email": "hermione@iiit.ac.in"
        },
        "newTa": {
          "id": "66d1234567890abcdef12302",
          "name": "Ron Weasley",
          "email": "ron@iiit.ac.in"
        },
        "actingUser": {
          "id": "66d1234567890abcdef12300",
          "name": "Prof. McGonagall",
          "email": "prof@iiit.ac.in"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

## Tests

Updated `src/__tests__/AllocationReassignmentHistory.test.ts` (15 automated tests):
1. `retrieves reassignment history for an exam with resolved TAs, script info, and acting user` (PASS)
2. `filters out non-reassignment actions and logs from other exams` (PASS)
3. `returns reassignment entries in chronological order using audit event timestamps` (PASS)
4. `paginates with default page=1 and limit=20` (PASS)
5. `handles explicit page and limit with correct skip and slice` (PASS)
6. `enforces maximum limit cap of 100` (PASS)
7. `rejects invalid page parameters with 400 Bad Request` (PASS)
8. `rejects invalid limit parameters with 400 Bad Request` (PASS)
9. `returns empty array with correct pagination when exam has no reassignment events` (PASS)
10. `gracefully handles missing or deleted TA user without dropping the record` (PASS)
11. `returns 400 for invalid exam ID format` (PASS)
12. `returns 404 for non-existent exam ID` (PASS)
13. `rejects unauthorized TA requests with 403 Forbidden` (PASS)
14. `rejects unauthenticated requests with 401 Unauthorized` (PASS)
15. `retrieving history is strictly read-only and creates no allocations or audit logs` (PASS)

## Validation results

- **Targeted Vitest Suite**:
  - `npx vitest run src/__tests__/AllocationReassignmentHistory.test.ts src/__tests__/AllocationReassignment.test.ts src/__tests__/AllocationTimingMetadata.test.ts src/__tests__/TaClaimReleaseApi.test.ts`
  - **Result: 4 test files, 51 tests passed, 0 failures**.
- **ESLint**:
  - `npm run lint`
  - **Result: 0 errors**.

## Acceptance criteria mapping

- [x] **AC 1**: Dedicated GET endpoint created at `GET /api/exams/[id]/allocate/reassign/history`.
- [x] **AC 2**: Retrieves existing `AuditLog` records where `action = 'ALLOCATION_REASSIGN'`.
- [x] **AC 3**: Results are filtered to the requested exam via `details.examId = examId`.
- [x] **AC 4**: Results are returned in chronological order (`createdAt: 1, _id: 1`).
- [x] **AC 5**: Includes affected allocation and script information.
- [x] **AC 6**: Includes previous TA information.
- [x] **AC 7**: Includes new TA information.
- [x] **AC 8**: Identifies the acting user who performed the reassignment.
- [x] **AC 9**: Previous and new TA IDs are resolved to displayable name/email.
- [x] **AC 10**: Protected by `Permission.ALLOCATE_SCRIPTS`.
- [x] **AC 11**: Unauthorized users receive 403 Forbidden and cannot access history.
- [x] **AC 12**: Automated tests cover retrieval, filtering, ordering, resolution, pagination, and security.
- [x] **AC 13**: Standard pagination (page, limit, total, totalPages, maxLimit 100) integrated.

## Out of scope

- No new history collection or duplicate storage was created.
- No mutations or audit logs are performed during read requests.
- No real-time SSE or push notification mechanisms were added.
- All changes left uncommitted per workflow instructions.

## Risks / design decisions

- Database-level pagination (`.skip()` and `.limit()`) prevents memory bloat and unbounded query hazards.
- Batch user and script lookups execute **only for records on the requested page**, ensuring high query performance.
- Missing user accounts fall back to placeholder structures with original IDs preserved.

