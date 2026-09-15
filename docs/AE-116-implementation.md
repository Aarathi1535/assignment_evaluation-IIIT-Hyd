# AE-116 — Activity Feed on Professor Dashboard Implementation Report

## Objective

Allow authorized Professors and Administrators to view the most recent grading- and allocation-related actions on the Professor Dashboard using existing `AuditLog` records without creating duplicate history models or introducing real-time streaming mechanisms.

---

## Implementation Summary

- **Single Source of Truth**: Reused the pre-existing `AuditLog` collection directly without introducing any new models, collections, or history stores.
- **Service Query**: Implemented `AllocationService.getActivityFeed()` which queries existing grading-related audit records, applies database-level limits (`.limit(limit)`), sorts in deterministic newest-first order (`.sort({ createdAt: -1, _id: -1 })`), and batch resolves referenced entities (Users, Exams, Courses, and AnswerScripts) for the current page only.
- **API Route**: Created `GET /api/professor/activity` protected by `Permission.ALLOCATE_SCRIPTS` (Professors and Admins). Unauthorized requests return `403 Forbidden` and unauthenticated requests return `401 Unauthorized`.
- **Frontend Dashboard Component**: Created `ProfessorActivityFeed` and integrated it into the Professor Dashboard (`src/app/(dashboard)/professor/page.tsx`). Handles Loading, Empty, and non-blocking Error states with a manual refresh button.
- **Read-Only**: Read operations strictly query the database without mutating records or creating audit logs during reads.
- **No Real-Time Streaming**: Real-time push, SSE, WebSockets, or polling intervals are omitted; the feed loads on page load with on-demand manual refresh.

---

## Existing Architecture Reused

1. **AuditLog Schema & Model (`src/models/AuditLog.ts`)**:
   - Stores operational audit records with `action`, `user`, `entityId`, `entityType`, `outcome`, `details`, and timestamps (`createdAt`, `updatedAt`).
2. **Pre-existing Grading Audit Events in Repository**:
   - `ALLOCATION_REASSIGN` (AE-110, AE-113)
   - `ALLOCATION_CLAIM` (AE-085, AE-090)
   - `ALLOCATION_RELEASE` (AE-085, AE-090)
   - `ALLOCATION_COMPLETE` (AE-085, AE-090)
   - `ANSWERSCRIPT_IDENTIFIED` (AE-060, AE-064)
   - `SCRIPT_REMAP` (AE-050)
   - `SCRIPT_MERGE` (AE-050)
   - `GRADE_PUBLISHED` (AE-080)
   - `EXAM_BLIND_GRADING_TOGGLED` (AE-075)
   - `INGESTION_APPROVED` (AE-070)
   - `INGESTION_APPROVAL_REVOKED` (AE-070)
3. **Authorization System (`src/lib/apiAuth.ts`, `src/constants/permissions.ts`)**:
   - Reused `requirePermission(Permission.ALLOCATE_SCRIPTS)`.
4. **UI Design System (`src/components/ui/`)**:
   - Reused `Card`, `Button`, `EmptyState`, and `LoadingSpinner`.

---

## Backend Changes

### `src/services/AllocationService.ts`

- Added `getActivityFeed(viewer?, options?)`:
  - **Filter**:
    ```ts
    const filter: Record<string, any> = {
        action: { $in: GRADING_ACTIVITY_ACTIONS },
        outcome: { $ne: 'FAILURE' }
    };
    if (options?.examId) {
        filter.$or = [
            { 'details.examId': options.examId },
            { entityId: new mongoose.Types.ObjectId(options.examId) }
        ];
    }
    ```
  - **Deterministic Ordering & Database-Level Limiting**:
    ```ts
    const [total, auditLogs] = await Promise.all([
        AuditLog.countDocuments(filter),
        AuditLog.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit)
            .lean()
    ]);
    ```
  - **Batch Resolution**: Resolves user IDs, exam IDs, course IDs, and script IDs only for the items returned in the current page slice.
  - **Data Sanitization**: Emits sanitized DTOs (`ActivityFeedItem`) containing only action names, human-readable descriptions, timestamps, exam titles/course codes, script anonymous IDs, question numbers, and safe user profiles (name, email, ID). Passwords, tokens, and private metadata are excluded.

---

## API Changes

- **Route**: `GET /api/professor/activity`
- **File**: `src/app/api/professor/activity/route.ts`
- **Query Parameters**:
  - `limit`: optional positive integer (1 to 100, default 10). Returns `400 Bad Request` if non-numeric or <= 0.
  - `examId`: optional MongoDB ObjectId. Returns `400 Bad Request` if invalid.
- **Authorization**:
  - Requires `Permission.ALLOCATE_SCRIPTS`.
  - `401 Unauthorized` for unauthenticated requests.
  - `403 Forbidden` for unauthorized roles (TAs, Students).
- **Response Format**:
```json
{
  "success": true,
  "message": "Activity feed retrieved successfully",
  "data": {
    "activities": [
      {
        "_id": "66d1234567890abcdef12399",
        "action": "ALLOCATION_REASSIGN",
        "description": "Reassigned Question 2 to Ron Weasley",
        "timestamp": "2026-09-02T10:00:00.000Z",
        "createdAt": "2026-09-02T10:00:00.000Z",
        "outcome": "SUCCESS",
        "allocationId": "66d1234567890abcdef12388",
        "question": 2,
        "exam": {
          "id": "66d1234567890abcdef12345",
          "title": "Data Structures Midterm",
          "courseCode": "CS201"
        },
        "answerScript": {
          "id": "66d1234567890abcdef12377",
          "anonymousId": "SCRIPT-001",
          "scriptReference": "Script-batch-1-0"
        },
        "actingUser": {
          "id": "66d1234567890abcdef12300",
          "name": "Prof. McGonagall",
          "email": "prof@iiit.ac.in"
        },
        "details": {
          "previousTa": {
            "id": "66d1234567890abcdef12301",
            "name": "Hermione Granger",
            "email": "hermione@iiit.ac.in"
          },
          "newTa": {
            "id": "66d1234567890abcdef12302",
            "name": "Ron Weasley",
            "email": "ron@iiit.ac.in"
          }
        }
      }
    ],
    "total": 1
  }
}
```

---

## Frontend Changes

### `src/components/ProfessorActivityFeed.tsx`
- Renders the activity stream with action icons, color-coded badges, course/exam chips, question pills, script anonymous ID tags, actor name, and relative timestamps.
- **Loading State**: Displays `LoadingSpinner` with "Loading recent activity...".
- **Empty State**: Displays `EmptyState` component when no activities are recorded.
- **Error State**: Displays a non-blocking error alert with a "Try Again" retry button without breaking the rest of the dashboard.
- **Manual Refresh**: Includes a "Refresh" button in the section header.

### `src/app/(dashboard)/professor/page.tsx`
- Embedded `<ProfessorActivityFeed limit={10} />` below the recent courses and exams cards.

---

## Tests Added / Updated

### `src/__tests__/ProfessorActivityFeed.test.ts` (15 tests)
1. `returns successful ALLOCATION_REASSIGN events recorded in AuditLog with resolved context` (PASS)
2. `returns activities ordered by newest first (descending timestamp)` (PASS)
3. `returns only the requested N activities based on limit parameter` (PASS)
4. `rejects invalid limit parameter with 400 Bad Request` (PASS)
5. `allows Admin users to retrieve the activity feed` (PASS)
6. `rejects unauthorized TA user with 403 Forbidden` (PASS)
7. `rejects unauthorized Student user with 403 Forbidden` (PASS)
8. `rejects unauthenticated request with 401 Unauthorized` (PASS)
9. `returns empty activities array with total: 0 when no activities exist` (PASS)
10. `does not expose non-grading actions or sensitive user password/token data` (PASS)
11. `filters activities by examId when specified` (PASS)
12. `returns 400 for invalid examId format` (PASS)
13. `formats relative activity time accurately` (PASS)
14. `returns correct action badges for different actions` (PASS)
15. `gracefully handles missing user or deleted TA accounts without crashing` (PASS)

---

## Validation

- **Targeted AE-116 Suite**:
  - `npx vitest run src/__tests__/ProfessorActivityFeed.test.ts`
  - Result: **15 tests passed, 0 failures**.
- **Regression Suite (AE-113 & Reassignment)**:
  - `npx vitest run src/__tests__/AllocationReassignmentHistory.test.ts src/__tests__/AllocationReassignment.test.ts src/__tests__/AllocationReassignmentUI.test.ts`
  - Result: **38 tests passed, 0 failures**.
- **TypeScript**:
  - `npx tsc --noEmit`
  - Result: **0 errors**.
- **ESLint**:
  - `npm run lint`
  - Result: **0 errors**.
- **Git Diff Check**:
  - `git diff --check`
  - Result: **0 issues**.

---

## Acceptance Criteria Checklist

- [x] **AC 1**: Existing `AuditLog` collection reused without creating any duplicate models or collections.
- [x] **AC 2**: Successful `ALLOCATION_REASSIGN` events appear in the activity feed.
- [x] **AC 3**: Returns activities in deterministic newest-first order (`createdAt: -1, _id: -1`).
- [x] **AC 4**: Database-level limiting (`.limit(limit)`) enforced to prevent memory bloat.
- [x] **AC 5**: Includes exam, script, question, and user context.
- [x] **AC 6**: Protected by `Permission.ALLOCATE_SCRIPTS` (Professors and Admins).
- [x] **AC 7**: Unauthorized roles (TAs, Students) rejected with 403 Forbidden.
- [x] **AC 8**: Unauthenticated requests rejected with 401 Unauthorized.
- [x] **AC 9**: Non-blocking error handling on the UI with manual retry.
- [x] **AC 10**: Zero sensitive credentials, tokens, or private metadata exposed.

---

## Out of Scope

- Real-time activity streaming, Server-Sent Events (SSE), WebSockets, and polling loops were explicitly excluded.
- No new database models, collections, or storage mechanisms were created.
- No changes to existing audit logging or reassignment semantics.

---

## Notes / Risks

- Batch lookups execute strictly for the current page slice to optimize database performance.
- Any unresolvable or deleted user/script IDs gracefully fall back to placeholder structures without crashing the feed.
