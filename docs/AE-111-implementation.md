# AE-111 — TA Assignment Notifications

## Objective

Create a persistent in-app notification for the newly assigned Teaching Assistant after a successful script assignment or reassignment.

## Architecture inspected

1. **Notification Store / Models**:
   - Inspected `src/models/` and confirmed no prior notification models or conflicting structures existed.
   - Built `Notification.ts` using Mongoose schema conventions with compound indexes on `{ recipient: 1, read: 1, createdAt: -1 }`.
2. **Allocation Service & Transactions**:
   - Analyzed `AllocationService.ts` methods: `allocateEqual`, `allocateByQuestion`, `allocateRandom`, and `reassignAllocation`.
   - Verified that all allocation mutations execute within MongoDB sessions via `this.runInTransaction()`.
3. **TA Work Queue API & UI**:
   - Inspected `GET /api/allocations` (`src/app/api/allocations/route.ts`) and TA Dashboard (`src/app/(dashboard)/ta/page.tsx`).
   - Extended the TA queue response to expose `unreadNotificationCount`.
   - Added notification indicator badges, new assignment alert banner, and interactive `NotificationPanel` with mark-as-read workflows.
4. **Authentication & Permissions**:
   - Reused `requireAuth()` and `requirePermission()` from `src/lib/apiAuth.ts` and `src/constants/permissions.ts`.

## Notification model

Created `src/models/Notification.ts`:

```ts
export enum NotificationType {
    ASSIGNMENT = 'ASSIGNMENT'
}

export interface INotification extends Document {
    recipient: mongoose.Types.ObjectId;
    type: NotificationType;
    title: string;
    message: string;
    allocation?: mongoose.Types.ObjectId;
    exam?: mongoose.Types.ObjectId;
    answerScript?: mongoose.Types.ObjectId;
    question?: number;
    read: boolean;
    readAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
```

- **Indexes**:
  - `recipient: 1`
  - `read: 1`
  - `allocation: 1`
  - `exam: 1`
  - Compound index: `{ recipient: 1, read: 1, createdAt: -1 }`

## Backend changes

1. **`src/services/NotificationService.ts`**:
   - `createNotifications(inputs, session)`: Atomically inserts notification documents using the provided MongoDB transaction session.
   - `getUnreadCount(userId)`: Returns unread notification count scoped to the given user.
   - `getUserNotifications(userId, options)`: Returns paginated notifications with populated exam and answerScript metadata.
   - `markAsRead(notificationId, userId)`: Marks a notification as read with ownership verification (returns 403 if calling user is not recipient).
   - `markAllAsRead(userId)`: Marks all unread notifications as read for the user.

2. **`src/services/AllocationService.ts`**:
   - Integrated notification creation inside `allocateEqual`, `allocateByQuestion`, and `allocateRandom` transactions.
   - Integrated notification creation inside `reassignAllocation` transaction strictly for the target TA.

3. **`src/app/api/allocations/route.ts`**:
   - Extended `GET /api/allocations` to return `unreadNotificationCount` in `data.unreadNotificationCount` scoped to the authenticated TA.

4. **Notification Endpoints**:
   - `GET /api/notifications` (`src/app/api/notifications/route.ts`): Returns paginated notifications and unread count.
   - `PATCH /api/notifications/[id]/read` (`src/app/api/notifications/[id]/read/route.ts`): Marks individual notification as read.
   - `PATCH /api/notifications/read-all` (`src/app/api/notifications/read-all/route.ts`): Marks all notifications as read.

## Transaction behavior

- **Atomic Execution**: All notification creation logic participates in the exact same database session (`session`) as allocation document mutations.
- **Rollback Guarantee**: If allocation validation fails, duplicate allocation occurs, or an error is thrown, the transaction is aborted via `session.abortTransaction()`. No orphaned allocations or notifications are persisted.

## New assignment flow

1. Professor/Admin triggers allocation (`allocateEqual`, `allocateByQuestion`, or `allocateRandom`).
2. Allocation service runs within a MongoDB transaction session:
   - Validates exam, course, and teaching assistant registrations.
   - Partitions eligible scripts and computes distribution.
   - Creates `Allocation` documents via `Allocation.create(allocationsToCreate, { session })`.
   - Creates persistent in-app notifications for each assigned TA via `Notification.create(notificationsToCreate, { session })`.
3. Transaction commits both allocations and notifications simultaneously.

## Reassignment flow

1. Professor/Admin initiates reassignment via `PUT /api/exams/[id]/allocate/reassign`.
2. `AllocationService.reassignAllocation` runs within a transaction:
   - Enforces guards: allocation belongs to exam, status is `PENDING`, no grade exists, target TA belongs to course, no duplicate allocation.
   - Updates allocation: `allocation.ta = targetTaObjectId`, `allocation.allocatedBy = actingUserObjectId`.
   - Creates `ALLOCATION_REASSIGN` audit log.
   - Creates a persistent notification **ONLY for the target TA (TA-B)**:
     - `recipient`: `targetTaObjectId`
     - `type`: `NotificationType.ASSIGNMENT`
     - `title`: `'Script Reassigned to You'`
     - `allocation`: `allocation._id`
     - `exam`: `exam._id`
   - **Previous TA (TA-A) and acting professor receive NO notification**.
3. Transaction commits atomically.

## TA notification / read path

- **TA Work Queue (`GET /api/allocations`)**:
  - Automatically queries `Notification.countDocuments({ recipient: auth.user.id, read: false })` and returns `unreadNotificationCount`.
- **Notification Center (`GET /api/notifications`)**:
  - Authenticated TA queries their personal notifications, sorted with most recent first.
- **Mark as Read (`PATCH /api/notifications/[id]/read`)**:
  - Enforces `notification.recipient.toString() === auth.user.id`.
  - Sets `read: true` and `readAt: new Date()`.
  - Subsequent queries reflect the decremented unread count.

## UI changes

1. **`src/components/NotificationPanel.tsx`**:
   - In-app notification drawer/modal displaying assignment notifications.
   - Shows script reference, exam title, question number, timestamp, unread indicator dot, and "Mark read" button.
   - Includes "Mark All Read" action and close button.
2. **`src/app/(dashboard)/ta/page.tsx`**:
   - Added `Notifications` quick action button with unread count badge.
   - Added a prominent `New Assignment Notifications` alert banner when `unreadNotificationCount > 0`.
   - Mounted `NotificationPanel` with automatic count synchronization upon reading notifications.

## Tests added

- **`src/__tests__/TaAssignmentNotifications.test.ts`** (12 automated tests):
  1. `creates persistent in-app notifications for each assigned TA during allocateEqual` (PASS)
  2. `creates question-specific notification message during allocateByQuestion` (PASS)
  3. `creates persistent in-app notifications during allocateRandom` (PASS)
  4. `rolls back and creates NO notifications if allocation transaction fails` (PASS)
  5. `creates notification ONLY for the new TA (TA-B) and NOT for the previous TA (TA-A)` (PASS)
  6. `creates NO notification if reassignment fails validation` (PASS)
  7. `exposes unreadNotificationCount scoped to authenticated TA in GET /api/allocations` (PASS)
  8. `GET /api/notifications returns list and unread count scoped to authenticated user` (PASS)
  9. `PATCH /api/notifications/[id]/read marks single notification as read and decreases unread count` (PASS)
  10. `repeated PATCH /api/notifications/[id]/read is safe and idempotent` (PASS)
  11. `PATCH /api/notifications/[id]/read rejects with 403 when trying to mark another user's notification` (PASS)
  12. `PATCH /api/notifications/read-all marks all notifications for authenticated user as read` (PASS)

## Validation results

- **Targeted Vitest Suite**:
  - `npx vitest run src/__tests__/TaAssignmentNotifications.test.ts src/__tests__/AllocationReassignment.test.ts src/__tests__/AllocationTimingMetadata.test.ts src/__tests__/TaClaimReleaseApi.test.ts src/__tests__/AllocationEqual.test.ts src/__tests__/AllocationQuestion.test.ts src/__tests__/AllocationRandom.test.ts`
  - **Result: 7 test files, 97 tests passed, 0 failures**.
- **ESLint**:
  - `npm run lint`
  - **Result: 0 errors**.

## Acceptance criteria checklist

- [x] **AC 1**: Persistent Notification model created for TA assignment notifications.
- [x] **AC 2**: Notification created ONLY after all assignment/reassignment guards pass and allocation change succeeds.
- [x] **AC 3**: Notification creation occurs within the SAME DATABASE TRANSACTION as the allocation change.
- [x] **AC 4**: For new assignment, notification is created for the receiving TA.
- [x] **AC 5**: For reassignment (TA-A -> TA-B), notification is created for TA-B and NOT for TA-A.
- [x] **AC 6**: Notification contains type, recipient, title, message, allocation/script/question reference, read state, and timestamp.
- [x] **AC 7**: TA-scoped queue path (`GET /api/allocations`) exposes `unreadNotificationCount`.
- [x] **AC 8**: TA UI displays unread notification indicator/badge and alert banner when unread notifications exist.
- [x] **AC 9**: Notifications can be marked as read via API and UI.
- [x] **AC 10**: Marking as read updates and decreases the unread count accordingly.
- [x] **AC 11**: Failed assignment/reassignment operations roll back and do not create notifications.
- [x] **AC 12**: Automated tests cover assignment, reassignment, failure rollback, unread count, mark as read, and authorization guards.

## Out of scope

- AE-112 and AE-113 were not implemented.
- Email, SMS, browser/mobile push notifications, and external notification providers were not introduced.
- Professor live progress SSE streams (AE-102) were not modified.
- No git commits, pushes, or PRs were made, complying with the workflow instructions.

## Notes / Risks

- Unread notification count is fetched on TA queue retrieval and synchronized when notifications are marked as read.
- Ownership checks in `NotificationService.markAsRead` prevent cross-user notification state modification.
