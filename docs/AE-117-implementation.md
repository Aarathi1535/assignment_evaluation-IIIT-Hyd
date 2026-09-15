# AE-117 — Notification Templates

## Objective

Provide typed, reusable notification templates for supported assignment, reassignment, and publish events without duplicating notification message-construction logic across the codebase.

## Implementation summary

1. **Dedicated Template Module (`src/templates/notificationTemplates.ts`)**:
   - Created centralized pure rendering functions for `ASSIGNMENT`, `REASSIGNMENT`, and `PUBLISH` notification types.
   - Defined TypeScript payload interfaces (`AssignmentTemplatePayload`, `ReassignmentTemplatePayload`, `PublishTemplatePayload`, `RenderNotificationPayload`) ensuring type-safety.
   - Built defensive parameter sanitization that handles missing, `null`, `undefined`, or invalid question numbers (e.g. `NaN`, negative numbers, `0`, empty strings) cleanly with intuitive fallbacks.
   - Provided unified `renderNotificationTemplate()` dispatcher as well as specific render helpers (`renderAssignmentTemplate`, `renderReassignmentTemplate`, `renderPublishTemplate`).

2. **Extended Notification Enum (`src/models/Notification.ts`)**:
   - Extended `NotificationType` enum with `REASSIGNMENT = 'REASSIGNMENT'` and `PUBLISH = 'PUBLISH'`, while preserving backward compatibility with `ASSIGNMENT = 'ASSIGNMENT'`.
   - No migration is required for existing notification documents, as existing records with `type: 'ASSIGNMENT'` remain completely valid against the enum.

3. **Backend Refactoring (`src/services/AllocationService.ts`)**:
   - Refactored `allocateEqual()`, `allocateByQuestion()`, and `allocateRandom()` to generate notification objects using `renderNotificationTemplate()` instead of duplicate inline string templates.
   - Refactored `reassignAllocation()` to generate reassignment notification objects via `renderNotificationTemplate()` targeting the receiving TA.

4. **Zero Regressions & Comprehensive Verification**:
   - Full repository test suite passed (80/80 test files, 1030/1030 tests).
   - Added `src/__tests__/NotificationTemplates.test.ts` covering rendering logic, edge cases, dispatching, and service-level database integration.

---

## Existing architecture reused

- **`Notification` Model (`src/models/Notification.ts`)**:
  - Reused existing schema, collection, compound indexes (`{ recipient: 1, read: 1, createdAt: -1 }`), and storage mechanism.
  - No new notification models or duplicate collections were created.

- **`NotificationService` & Allocation Transactions**:
  - Maintained atomic transactional insertion inside `AllocationService` with MongoDB sessions.
  - Reused existing notification endpoints (`GET /api/notifications`, `PATCH /api/notifications/[id]/read`, `PATCH /api/notifications/read-all`).

- **Delivery Mechanism**:
  - Reused existing persistent database notification mechanism and TA Dashboard notifications panel.

---

## Notification template design

### Template Interfaces & Functions

```typescript
export interface RenderedNotification {
  title: string;
  message: string;
}

export interface AssignmentTemplatePayload {
  question?: number | null;
}

export interface ReassignmentTemplatePayload {
  question?: number | null;
}

export interface PublishTemplatePayload {
  examTitle?: string | null;
}
```

### Assignment Notification Template
- **Whole script assignment**:
  - Title: `'New Script Assigned'`
  - Message: `'You have been assigned a new answer script for grading.'`
- **Question-specific assignment** (`question: 2`):
  - Title: `'New Script Assigned'`
  - Message: `'You have been assigned question 2 of an answer script for grading.'`

### Reassignment Notification Template
- **Whole script reassignment**:
  - Title: `'Script Reassigned to You'`
  - Message: `'An answer script has been reassigned to you for grading.'`
- **Question-specific reassignment** (`question: 3`):
  - Title: `'Script Reassigned to You'`
  - Message: `'Question 3 of an answer script has been reassigned to you for grading.'`

### Publish Notification Template
- **With exam title** (`examTitle: 'CS101 Midterm'`):
  - Title: `'Grades Published'`
  - Message: `'Grades have been published for CS101 Midterm.'`
- **Fallback (missing or blank exam title)**:
  - Title: `'Grades Published'`
  - Message: `'Grades have been published for your exam.'`

---

## Backwards compatibility with AE-111

- **`NotificationType.ASSIGNMENT`**: Value `'ASSIGNMENT'` is strictly preserved.
- **Assignment Notifications**: Generate the identical strings (`'New Script Assigned'`, `'You have been assigned a new answer script for grading.'` / `'You have been assigned question <Q> of an answer script for grading.'`).
- **Reassignment Notifications**: Persist strictly for the receiving TA (`targetTaObjectId`), maintaining the exact notification recipient semantics established in AE-111.
- **API & UI Compatibility**: Notification retrieval (`GET /api/notifications`), unread counts (`unreadNotificationCount`), mark-read (`PATCH /api/notifications/[id]/read`), and mark-all-read (`PATCH /api/notifications/read-all`) operate identically. The Notification UI is agnostic to specific enum members and renders titles/messages seamlessly.

---

## NotificationType changes & rationale

- **Rationale**: `REASSIGNMENT` and `PUBLISH` were added to provide distinct domain-specific constants for future notification routing, filtering, or downstream categorization.
- **Data Integrity**: Existing MongoDB records with `type: 'ASSIGNMENT'` continue to validate against the schema.
- **Zero Migration Required**: Because enum expansion is purely additive, no database migrations or backfills are needed.

---

## Publish notification scope

- **Reusable Template Only**: AE-117 implements the pure rendering function `renderPublishTemplate()` (and dispatcher `renderNotificationTemplate({ type: NotificationType.PUBLISH, payload })`).
- **No Trigger or Workflow Added**: In strict accordance with scope boundaries, AE-117 does NOT invent an artificial publish trigger or workflow. The template is ready for downstream feature integration.

---

## Backend changes

1. **`src/templates/notificationTemplates.ts`** (New):
   - Pure, stateless template renderers with TypeScript interfaces.
   - Robust input sanitization (`isValidQuestionNumber(q)` checks for finite integers $\ge 1$).

2. **`src/models/Notification.ts`** (Modified):
   - Added `REASSIGNMENT = 'REASSIGNMENT'` and `PUBLISH = 'PUBLISH'` to `NotificationType` enum.

3. **`src/services/AllocationService.ts`** (Modified):
   - In `allocateEqual`: Replaced inline title/message string construction with `renderNotificationTemplate({ type: NotificationType.ASSIGNMENT })`.
   - In `allocateByQuestion`: Replaced inline string construction with `renderNotificationTemplate({ type: NotificationType.ASSIGNMENT, payload: { question: q } })`.
   - In `allocateRandom`: Replaced inline string construction with `renderNotificationTemplate({ type: NotificationType.ASSIGNMENT })`.
   - In `reassignAllocation`: Replaced inline string construction with `renderNotificationTemplate({ type: NotificationType.ASSIGNMENT, payload: { question: alloc.question } })` targeting the receiving TA.

---

## API changes

- No API breaking changes.
- Existing endpoints (`GET /api/notifications`, `PATCH /api/notifications/[id]/read`, `PATCH /api/notifications/read-all`, `GET /api/allocations`) continue to operate with full backwards and forwards compatibility.

---

## Frontend changes

- None required. Existing TA dashboard and notification UI components (`NotificationPanel`, `NotificationBadge`) seamlessly render notification titles and messages created via the new templates.

---

## Tests added/updated

- **`src/__tests__/NotificationTemplates.test.ts`** (New suite, 12 tests):
  - `renders whole-script assignment template without question number`
  - `renders question-specific assignment template with valid question number`
  - `renders whole-script reassignment template without question number`
  - `renders question-specific reassignment template with valid question number`
  - `renders publish template with exam title`
  - `renders publish template fallback when exam title is missing or empty`
  - `safely handles null/undefined payloads across all templates without throwing`
  - `safely ignores invalid question values (NaN, negative, zero) and falls back cleanly`
  - `unified renderNotificationTemplate dispatches correctly`
  - `uses template in allocateEqual and persists matching notification in DB`
  - `uses template in allocateByQuestion and persists question-specific messages`
  - `uses template in reassignAllocation and notifies receiving TA only`

---

## Validation

All validation checks pass:

- **Full Repository Test Suite**:
  `npm test -- --run` (80 / 80 test files passed, 1030 / 1030 tests passed)
- **Notification Templates Tests**:
  `npx vitest run src/__tests__/NotificationTemplates.test.ts` (12 / 12 passed)
- **Allocation & Reassignment Tests**:
  `npx vitest run src/__tests__/TaAssignmentNotifications.test.ts src/__tests__/AllocationReassignment.test.ts` (22 / 22 passed)
  `npx vitest run src/__tests__/AllocationEqual.test.ts src/__tests__/AllocationQuestion.test.ts src/__tests__/AllocationRandom.test.ts src/__tests__/AllocationReassignmentHistory.test.ts src/__tests__/AllocationReassignmentUI.test.ts` (77 / 77 passed)
- **TypeScript Compilation**:
  `npx tsc --noEmit` (0 errors)
- **Linter**:
  `npm run lint` (0 errors, 0 warnings on new code)
- **Git Diff**:
  `git diff --check` (clean, no whitespace/format issues)

---

## Acceptance criteria checklist

- [x] Typed template renderer implemented for assignment notifications (whole-script and question-specific).
- [x] Typed template renderer implemented for reassignment notifications (whole-script and question-specific).
- [x] Typed template renderer implemented for grade publish notifications (with fallback for missing title).
- [x] Safe handling of missing, empty, `null`, `undefined`, and invalid input data.
- [x] `NotificationType` enum updated cleanly without breaking existing records.
- [x] `AllocationService` refactored to use centralized templates.
- [x] Preserved existing notification semantics: receiving TA is notified on assignment/reassignment, previous TA is not.
- [x] Reused existing `Notification` model, database store, API routes, and UI without duplication.
- [x] No SSE, WebSockets, or real-time streaming added.
- [x] Comprehensive test coverage with zero regressions across existing tests.

---

## Out of scope

- Real-time notification delivery via SSE, WebSockets, or polling (explicitly out of scope).
- External notification channels (Email, SMS, Web Push).
- User-configurable notification templates or customizable message editing.

---

## Notes / Risks

- None. All changes are backward compatible with all existing notification documents and allocation workflows.
