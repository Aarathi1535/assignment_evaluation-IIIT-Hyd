# AE-110 — Reassign Scripts Between TAs

## Objective

Allow an authorized professor/admin to select an eligible assigned script and reassign it to another eligible TA using the existing reassignment API.

## Implementation summary

We implemented the complete script reassignment capability for professors and administrators while preserving the existing backend architecture and server-side authorization guards:

1. **Clean Timing Metadata on Allocation Release**:
   - Fixed a bug in `AllocationService.releaseAllocation` where returning an `IN_PROGRESS` allocation back to `PENDING` left a stale `claimedAt` timestamp.
   - Updated the MongoDB query to `$unset: { claimedAt: 1 }` along with setting `status: AllocationStatus.PENDING`.
   - Verified that subsequent claims, completions, and reassignments operate with clean timing metadata.

2. **Reassignment Modal Component (`ReassignModal.tsx`)**:
   - Created a modal dialog for professors/admins to safely reassign allocations.
   - Displays current TA, script identifier, scope (Whole Script vs Question N), and allocation status (`PENDING`).
   - Filters candidate replacement TAs to exclude the current TA and any inactive TAs.
   - Dispatches a `PUT /api/exams/[id]/allocate/reassign` request with `{ allocationId, targetTaId }`.
   - Handles loading states, meaningful backend error messages, and success confirmations.

3. **Professor Live Progress & TA Drilldown Integration (`TaLiveProgressView.tsx`)**:
   - Integrated the reassignment workflow into the TA workload drill-down view (`/professor/exams/[id]/progress`).
   - Added an "Actions" column to the assigned scripts table.
   - Renders a "Reassign" button strictly for `PENDING` allocations (locked for in-progress and completed scripts).
   - On successful reassignment, refreshes both the TA's specific workload data and the overall exam progress metrics, while presenting a success toast notification.

4. **Comprehensive Automated Testing**:
   - Added `AllocationReassignmentUI.test.ts` covering helper functions, security guards, status validation, and integration with the reassignment route.
   - Updated `AllocationTimingMetadata.test.ts` to assert that `releaseAllocation` clears `claimedAt` and preserves timing cleanliness through reassignment.

## Files changed

- `src/services/AllocationService.ts`:
  - Fixed `releaseAllocation` to include `$unset: { claimedAt: 1 }` when transitioning an allocation back to `PENDING`.
- `src/components/ReassignModal.tsx`:
  - Created new modal component providing the reassignment interface, target TA selection, pure utility helpers (`filterEligibleReplacementTas`, `isAllocationReassignable`, `getReassignmentScopeText`, `formatReassignSuccessMessage`), and error/success presentation.
- `src/components/TaLiveProgressView.tsx`:
  - Extended professor TA drill-down view to include actions column with "Reassign" button for pending allocations, load course teaching assistants, handle reassignment callbacks, and trigger workload/progress refreshes.
- `src/__tests__/AllocationTimingMetadata.test.ts`:
  - Added tests asserting that `releaseAllocation` unsets `claimedAt` in MongoDB and that reassigning a released allocation retains clean timestamps.
- `src/__tests__/AllocationReassignmentUI.test.ts`:
  - Created automated test suite validating UI logic, replacement TA filtering, pending status restrictions, API integration, error propagation, and role authorization.
- `docs/AE-110-implementation.md`:
  - Created implementation report.

## Backend changes

- **releaseAllocation claimedAt fix**:
  - In `AllocationService.releaseAllocation`, added `$unset: { claimedAt: 1 }` to the `findOneAndUpdate` atomic update alongside `$set: { status: AllocationStatus.PENDING }`.
- **Existing Reassignment Endpoint & Service Reused**:
  - Reused the existing `PUT /api/exams/[id]/allocate/reassign` endpoint (`src/app/api/exams/[id]/allocate/reassign/route.ts`).
  - Reused `AllocationService.reassignAllocation()` without duplicating business rules, cross-resource checks, or audit logging.
  - Server-side authorization (`Permission.ALLOCATE_SCRIPTS`), course enrollment validation, and conflict checks remain authoritative.

## Frontend changes

- **Reassignment UI Location**:
  - Added to the professor's live progress TA drilldown view (`TaLiveProgressView.tsx`), accessible at `/professor/exams/[id]/progress`.
- **Presentation of Pending Allocations**:
  - Assigned scripts table includes an "Actions" column. Rows with `status === 'PENDING'` display an interactive "Reassign" button with an icon. Rows with `IN_PROGRESS` or `COMPLETED` display non-actionable status labels ("In Progress" / "Graded").
- **Target TA Selection**:
  - When the modal opens, it populates available course TAs and filters out the current TA as well as inactive TAs.
- **Success/Error Behavior**:
  - During request submission, displays loading indicators and disables inputs to prevent duplicate submissions.
  - On error, displays the backend's exact error message inside an alert banner.
  - On success, displays confirmation, auto-closes the modal, and renders a success banner in the main drilldown view.
- **Refresh/Update Behavior**:
  - On success, dispatches `fetchTaWorkload(selectedTaId)` to update the current TA's allocated scripts list and `fetchProgress()` to refresh overall exam progress.

## Tests added/updated

1. `src/__tests__/AllocationReassignmentUI.test.ts`:
   - `filterEligibleReplacementTas excludes the current TA from the options` (PASS)
   - `filterEligibleReplacementTas excludes inactive TAs from the options` (PASS)
   - `filterEligibleReplacementTas handles _id and id interchangeably` (PASS)
   - `filterEligibleReplacementTas returns empty array for null/empty input` (PASS)
   - `isAllocationReassignable allows ONLY PENDING allocations` (PASS)
   - `getReassignmentScopeText formats Whole Script vs Question number correctly` (PASS)
   - `formatReassignSuccessMessage produces a friendly confirmation message` (PASS)
   - `Successfully reassigns a PENDING allocation from TA-1 to TA-2 and returns 200 with updated allocation` (PASS)
   - `Rejects reassignment when allocation is IN_PROGRESS with meaningful 400 error message` (PASS)
   - `Rejects reassignment when allocation is COMPLETED with meaningful 400 error message` (PASS)
   - `Rejects reassignment if target TA is not registered on the course` (PASS)
   - `Rejects request with missing allocationId or targetTaId` (PASS)
   - `Enforces authorization guard: rejects non-professor / unauthorized TA sessions with 403` (PASS)

2. `src/__tests__/AllocationTimingMetadata.test.ts`:
   - Updated test 9: `release succeeds IN_PROGRESS -> PENDING and clears claimedAt` (PASS)
   - Added test 11: `releaseAllocation clears claimedAt and subsequent reassignment does not carry stale claim timestamps (AE-110)` (PASS)

3. Existing Test Suites:
   - `src/__tests__/AllocationReassignment.test.ts` (10 tests PASS)
   - `src/__tests__/TaClaimReleaseApi.test.ts` (16 tests PASS)
   - Full Vitest suite: 77 test files, 991 tests passing (PASS)

## Validation

- **Targeted Vitest Suite**:
  - Command: `npx vitest run src/__tests__/AllocationReassignmentUI.test.ts src/__tests__/AllocationTimingMetadata.test.ts src/__tests__/AllocationReassignment.test.ts src/__tests__/TaClaimReleaseApi.test.ts`
  - Result: **PASS** (4 test files, 50 tests passed, 0 failures)
- **Full Vitest Suite**:
  - Command: `npm test -- --run`
  - Result: **PASS** (77 test files, 991 tests passed, 0 failures)
- **ESLint Validation**:
  - Command: `npm run lint`
  - Result: **PASS** (0 errors, 7 existing repository warnings)
- **Next.js Build Validation**:
  - Command: `npm run build`
  - Result: **Compilation & TypeScript type checking passed** (Pre-existing static prerender issue on unrelated `/professor` dashboard page documented in Notes/Risks).

## Acceptance criteria checklist

- [x] 1. Professor/admin can select an eligible PENDING allocation and choose another eligible TA.
- [x] 2. The selected allocation is reassigned through the existing `src/app/api/exams/[id]/allocate/reassign/route.ts`.
- [x] 3. The UI clearly shows: current TA, script/allocation identifier, question where applicable, allocation status, eligible replacement TAs.
- [x] 4. The UI displays an appropriate success state after successful reassignment.
- [x] 5. The UI displays an appropriate error state when reassignment is rejected by the backend.
- [x] 6. Reassignment must not expose or bypass existing server-side authorization or eligibility guards.
- [x] 7. releaseAllocation must clear stale claimedAt metadata when returning an allocation to PENDING.
- [x] 8. Existing allocation status and timing metadata must remain consistent after reassignment.
- [x] 9. Automated tests must cover the reassignment UI flow and relevant success/error states.

## Out of scope

- Drag-and-drop functionality was not implemented.
- AE-111 notifications were not implemented.
- AE-112 was not modified.
- AE-113 reassignment history retrieval was not implemented.
- Existing reassignment backend was not rebuilt.

## Notes / Risks

- Target TA filtering in the UI is a usability enhancement; backend validation in `AllocationService.reassignAllocation` remains strictly authoritative for checking TA enrollment and avoiding duplicate allocation conflicts.
- Next.js build: Static compilation and TypeScript type checking passed completely across all routes and components. Pre-existing static prerendering failure on unrelated root `/professor` page occurs when static build workers evaluate `use client` hooks in the outer layout without an active session mock. All tests and runtime endpoints function as expected.
