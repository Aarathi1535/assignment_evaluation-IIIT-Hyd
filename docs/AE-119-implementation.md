# AE-119 — Top Allocation / Progress Bug Fixes

## 1. Audit Performed

A comprehensive architecture and implementation audit was conducted across all allocation and grading progress subsystems in the repository, including:

- Allocation data models and lifecycle constraints (`src/models/Allocation.ts`, `src/models/Grade.ts`, `src/models/Notification.ts`, `src/models/AnswerScript.ts`)
- Allocation service workflows (`src/services/AllocationService.ts`):
  - Allocation preparation & grading commencement guards (`prepareForAllocation`, `checkGradingCommenced`)
  - Deterministic allocation strategies (`allocateEqual`, `allocateByQuestion`, `allocateRandom`, `computeDistribution`)
  - Allocation preview (`previewAllocation`)
  - Allocation reassignment & audit logging (`reassignAllocation`, `getReassignmentHistory`)
  - Allocation claim, release, and completion state transitions (`claimAllocation`, `releaseAllocation`, `markCompleted`)
  - Progress aggregation, cohort median, pace, bottleneck detection, and ETA calculations (`getProgress`, `getBottlenecks`, `getAbsolutePace`, `getTaAllocationsForExam`)
- Real-time progress synchronization (`src/services/ProgressEventService.ts`, SSE endpoints in `src/app/api/exams/[id]/progress/stream/route.ts`)
- Notification lifecycle (`src/services/NotificationService.ts`, `src/app/api/allocations/route.ts`)
- Historical ticket implementations (AE-106 through AE-118)

---

## 2. Candidate Bugs Examined

During the audit, candidate defect areas were examined:

1. **Re-run allocation when grades exist on deactivated/archived scripts**:
   - Evaluated whether `checkGradingCommenced` safely detects grades associated with any script belonging to the exam regardless of `isActive` flag.
2. **Notification persistence and unread count integrity across allocation re-runs**:
   - Evaluated whether `prepareForAllocation` properly purges stale `ASSIGNMENT` notifications when an uncommenced allocation is re-run, or if orphaned notifications persist.
3. **Reassignment duplicate/conflict detection for whole-script vs question-wise allocations**:
   - Evaluated whether `reassignAllocation` accurately detects allocation conflicts when `question` is undefined/null on whole-script records.
4. **Allocation timing metadata consistency**:
   - Checked whether `claimedAt`, `completedAt`, and `durationSeconds` are correctly set and preserved across transitions (claim, release, completion, reassignment).
5. **Pace, bottleneck, and ETA calculation edge cases**:
   - Verified division-by-zero guards, insufficient data reasons, cohort median calculation on even/odd TA sets, and zero-allocation handling.

---

## 3. Bugs Already Fixed by Previous Tickets

The audit verified that earlier tickets already addressed several key requirements:

- **AE-106**: Introduced `claimedAt`, `completedAt`, and duration calculation `(completedAt - claimedAt)`.
- **AE-107**: Implemented overall exam grading summary, pace calculation, bottleneck detection, and naive ETA estimation using `completedAt` timestamps.
- **AE-108**: Implemented TA drill-down scoped strictly to `examId` and `taId`.
- **AE-109**: Hardened aggregation pipelines and MongoDB change streams.
- **AE-110 & AE-112**: Reassignment UI and backend guard preventing reassignment of scripts/questions that already possess `Grade` records.
- **AE-111 & AE-117**: Persistent transactional assignment/reassignment notifications and reusable templates.
- **AE-113 & AE-116**: Chronological reassignment history and professor activity feed.
- **AE-118**: Validated live updates and dashboard stability under 20-TA concurrency.

---

## 4. Genuine Bugs Discovered

Three genuine defects were identified in the allocation and progress codebase:

### Bug 1: Inactive/Deactivated Graded Script Leak in `checkGradingCommenced`
- **Location**: `src/services/AllocationService.ts` (`checkGradingCommenced`)
- **Root Cause**: `AnswerScript.find({ exam: examObjectId, isActive: true })` filtered strictly by `isActive: true`. If an answer script was graded and subsequently marked `isActive: false` (deactivated/archived), its script ID was omitted from the `Grade` existence check. Re-running allocation bypassed the guard and cleared/overwrote allocations on an exam where grading had already occurred.
- **Reproduction**:
  1. Create an exam with an answer script.
  2. Grade the answer script.
  3. Set `script.isActive = false`.
  4. Call `AllocationService.allocateEqual(...)`.
  5. The method proceeded to overwrite allocations instead of rejecting with 400 `Cannot re-run allocation: grades already exist for this exam.`

### Bug 2: Orphaned Notification Records & Inflated Unread Counts on Allocation Re-run
- **Location**: `src/services/AllocationService.ts` (`prepareForAllocation`)
- **Root Cause**: When an allocation was re-run before grading commenced, `prepareForAllocation` deleted existing `Allocation` records (`Allocation.deleteMany({ exam: examObjectId })`), but did not clean up the previous `ASSIGNMENT` notifications created for that exam. The subsequent allocation created a second set of notifications, leaving orphaned notifications pointing to deleted allocation IDs and falsely inflating the TA's unread notification count.
- **Reproduction**:
  1. Run `allocateEqual` on an exam for TA1 and TA2.
  2. Each TA has 1 unread notification referencing their allocation ID.
  3. Re-run `allocateEqual` with only TA1 selected before grading commences.
  4. TA1 receives 2 new notifications, but previous notifications remain in the database. TA1 now has 3 unread notifications (1 pointing to a deleted allocation), and TA2 still has 1 unread notification pointing to a deleted allocation.

### Bug 3: Mongoose Query Sanitization in Reassignment Conflict Detection
- **Location**: `src/services/AllocationService.ts` (`reassignAllocation`)
- **Root Cause**: The conflict check query `{ ta: targetTaObjectId, answerScript: allocation.answerScript, question: allocation.question, _id: { $ne: allocationObjectId } }` passed `question: undefined` for whole-script allocations. Mongoose strips `undefined` keys during query compilation, omitting the question filter rather than matching whole-script records (`question: null / $exists: false`).
- **Reproduction**:
  1. For whole-script allocations, `{ question: undefined }` stripped the property from the query object, creating ambiguity between whole-script and question-wise matching.

---

## 5. Fixes Applied

### 1. `src/services/AllocationService.ts`
- **`checkGradingCommenced`**:
  Changed script lookup to query all scripts belonging to the exam (`AnswerScript.find({ exam: examObjectId }).select('_id')`), ensuring any existing `Grade` record on any script for the exam blocks re-allocation.
- **`prepareForAllocation`**:
  Added cleanup of uncommenced `ASSIGNMENT` notifications for the exam (`await Notification.deleteMany({ exam: examObjectId, type: NotificationType.ASSIGNMENT }, { session })`) before creating the new allocation set.
- **`reassignAllocation`**:
  Normalized the conflict query to use `$or: [{ question: null }, { question: { $exists: false } }]` when `allocation.question` is null/undefined, matching the established pattern in `gradeQuery`.

---

## 6. Regression Tests

Created dedicated regression suite: `src/__tests__/AllocationBugFixesAE119.test.ts`

- `throws 400 when an inactive answer script belonging to the exam already has a Grade`
- `cleans up stale uncommenced assignment notifications when allocation is re-run before grading commences`
- `prevents duplicate whole-script allocation conflict on target TA`
- `allows reassigning a different question of the same script to a TA who already has question 1`
- `blocks reassigning question 1 to target TA if target TA already has question 1`

---

## 7. Validation Results

1. **AE-119 Regression Suite**:
   ```
   npx vitest run src/__tests__/AllocationBugFixesAE119.test.ts
   ✓ src/__tests__/AllocationBugFixesAE119.test.ts (5 tests)
   Test Files  1 passed (1)
   Tests       5 passed (5)
   ```

2. **Full Allocation & Progress Test Suites (11 files, 149 tests)**:
   ```
   ✓ src/__tests__/AllocationEqual.test.ts (13 tests)
   ✓ src/__tests__/AllocationQuestion.test.ts (17 tests)
   ✓ src/__tests__/AllocationRandom.test.ts (19 tests)
   ✓ src/__tests__/AllocationReassignment.test.ts (10 tests)
   ✓ src/__tests__/AllocationCompletion.test.ts (10 tests)
   ✓ src/__tests__/AllocationProgressApi.test.ts (15 tests)
   ✓ src/__tests__/TaAssignmentNotifications.test.ts (12 tests)
   ✓ src/__tests__/OverallGradingSummary.test.ts (13 tests)
   ✓ src/__tests__/TaDrillDown.test.ts (9 tests)
   ✓ src/__tests__/TaClaimReleaseApi.test.ts (16 tests)
   ✓ src/__tests__/AllocationReassignmentHistory.test.ts (15 tests)
   Test Files  11 passed (11)
   Tests       149 passed (149)
   ```

3. **TypeScript Type Check**:
   ```
   npx tsc --noEmit
   (Exited with code 0 - No errors)
   ```

4. **Linter**:
   ```
   npm run lint
   (Exited with code 0 - 0 errors)
   ```

5. **Git Diff Check**:
   ```
   git diff --check
   (Clean, no conflicts or whitespace issues)
   ```

---

## 8. Remaining Limitations

- Reassignment requires the target TA to be enrolled in the exam's course.
- Reassignment remains restricted to allocations in `PENDING` status with no existing `Grade` documents on that script/question.
- No artificial bugs were manufactured; only genuine defects were fixed and verified.
