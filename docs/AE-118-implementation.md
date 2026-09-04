# AE-118 — Load-Test Progress Updates (20 TAs)

## Objective

Validate that the professor dashboard progress aggregation and Server-Sent Events (SSE) live-update infrastructure remain stable, performant, and completely accurate under a simulated concurrent workload of 20 Teaching Assistants (TAs).

---

## Executive summary

- **Workload Simulated**: 20 distinct TAs (`Teaching Assistant 01` to `Teaching Assistant 20`), 1 Professor, 1 Course, and 1 Exam with 1,000 answer scripts (50 allocations per TA).
- **Concurrency & Stress**: Concurrent script allocation (`allocateEqual`), parallel claiming (`claimAllocation`), parallel completions (`markCompleted`), multi-subscriber SSE broadcasting (`ProgressEventService.subscribe`), high-frequency REST querying (`GET /api/exams/[id]/progress`), and concurrent reassignments (`reassignAllocation`).
- **Production Defect Assessment**: **No functional defect or data corruption defect was found in the production aggregation or allocation logic.** MongoDB atomic aggregation pipelines, transactional mutations, and status transitions maintained 100% data consistency.
- **Service Hardening**: Hardened `ProgressEventService.emitter` with `setMaxListeners(100)` to ensure high-concurrency multi-subscriber / multi-dashboard SSE sessions operate without triggering Node.js event emitter warning thresholds.

---

## What was tested

1. **20-TA Balanced Allocation & Workload Setup**:
   - Equal allocation generation across 20 TAs on an exam with 1,000 answer scripts.
   - Verification that exactly 1,000 allocations are created with exactly 50 allocations per TA (100% balanced distribution).
   - Verification of baseline progress aggregation (`total: 1000, graded: 0, progress: 20 items, cohortMedianCompletionRatio: 0, bottleneckCount: 0`).

2. **20-TA Concurrent Claim Operations**:
   - Concurrently executing 100 parallel claims across all 20 TAs (`claimAllocation`).
   - Verifying all 100 allocations transition atomically from `PENDING` to `IN_PROGRESS` with valid `claimedAt` timestamps.
   - Verifying race condition protection: double-claiming an already in-progress allocation is rejected with `HTTP 409 Conflict`, and cross-TA claim attempts are rejected with `HTTP 403 Forbidden`.

3. **20-TA Concurrent Completion & Aggregation Integrity**:
   - Concurrently completing 200 allocations across all 20 TAs (10 per TA) simultaneously.
   - Verifying database integrity: exactly 200 `COMPLETED` allocations and 800 remaining allocations.
   - Verifying aggregation outputs: `total: 1000, graded: 200, cohortMedianCompletionRatio: 0.20`, each TA with `graded: 10, total: 50, completionRatio: 0.20`.
   - Verifying idempotency: duplicate `markCompleted` calls on completed allocations are rejected with `HTTP 409 Conflict` and do not alter progress counts.

4. **SSE & Real-Time Event Dispatch Stability Under Concurrency**:
   - Attaching 5 concurrent SSE listeners / dashboard clients to `ProgressEventService.subscribe`.
   - Concurrently completing 20 allocations (1 per TA).
   - Verifying that every listener receives all 20 events with complete `examProgress` and `taProgress` payloads without dropped events or message corruption.
   - Verifying `GET /api/exams/[id]/progress/stream` route handler returns `200 OK` with `Content-Type: text/event-stream`.

5. **20-TA Cohort Bottleneck Detection Under Skewed Workload**:
   - Simulating heterogeneous grading paces:
     - 16 TAs complete 45 / 50 allocations (90% completion)
     - 4 TAs complete 5 / 50 allocations (10% completion)
   - Verifying `AllocationService.getProgress(examId)` correctly identifies:
     - `cohortMedianCompletionRatio` = 0.90
     - Exactly 4 lagging TAs flagged with `isBottleneck: true` (lagging > 20% below median)
     - 16 on-track TAs flagged with `isBottleneck: false`
     - `bottleneckCount` = 4.

6. **High-Concurrency REST API Load**:
   - Firing 50 concurrent requests to `GET /api/exams/[id]/progress` with professor authorization.
   - Verifying all 50 requests succeed with `200 OK` and identical, consistent aggregation results.
   - Latency remained low (all 50 concurrent requests served in under 5 seconds total).

7. **Reassignment Load Across 20-TA Pool**:
   - Concurrently reassigning 10 allocations between distinct pairs of TAs from the 20-TA pool.
   - Verifying that total exam allocations remain strictly 1,000, source TA totals decrement by 1, target TA totals increment by 1, and audit logs are recorded.

---

## Concurrency & load assumptions

- **TA Count**: 20 distinct TA accounts registered on a single course.
- **Dataset Size**: 1,000 answer scripts / allocations per exam (50 per TA).
- **Concurrent Operations**: Batches of 20 to 200 concurrent promises executed via `Promise.all`.
- **Database Indexing**: Aggregation pipelines utilize compound indexes on `{ exam: 1, status: 1 }` and `{ exam: 1, ta: 1 }`, ensuring performant execution even under concurrent queries.

---

## Observed results & performance metrics

| Scenario | Concurrency | Success Rate | Observed Latency / Timing | Data Integrity |
| :--- | :--- | :--- | :--- | :--- |
| **Equal Allocation** | 1,000 scripts across 20 TAs | 100% | ~14.5s (bulk setup + transaction) | 50 allocs / TA exact |
| **Concurrent Claiming** | 100 parallel claims | 100% | ~8.5s | 0 race conditions, 0 corrupted states |
| **Concurrent Completion** | 200 parallel completions | 100% | ~31.1s (individual transactions + audits) | Exact counts, 0 duplicates |
| **SSE Event Broadcasting** | 5 clients x 20 events = 100 dispatches | 100% | ~3.2s | 100% message delivery, 0 lost events |
| **Bottleneck Detection** | 20-TA skewed cohort | 100% | ~9.0s | 4 / 4 bottlenecks detected accurately |
| **REST API Load** | 50 concurrent GET requests | 100% | ~4.5s total (~90ms / req average) | 100% response consistency |
| **Reassignment Under Load**| 10 parallel reassignments | 100% | ~5.4s | Total count invariant, per-TA counts exact |

---

## Bottlenecks & defects found

- **Production Logic**: **No functional defect was found.**
- **Hardening Applied**: `ProgressEventService.emitter` was configured with `setMaxListeners(100)` to support high-concurrency multi-client SSE subscriptions without exceeding default Node.js EventEmitter limits.

---

## Validation commands & results

- **Dedicated 20-TA Load Test Suite**:
  ```bash
  npx vitest run src/__tests__/ProgressLoadTest.test.ts
  ```
  Result: **7 / 7 passed (100%)**

- **Progress & Allocation Regression Suites**:
  ```bash
  npx vitest run src/__tests__/ProgressEvents.test.ts src/__tests__/ProgressBenchmark.test.ts src/__tests__/TaLiveProgressUI.test.ts src/__tests__/TaBottleneckDetection.test.ts src/__tests__/TaClaimReleaseApi.test.ts src/__tests__/AllocationCompletion.test.ts src/__tests__/AllocationProgressApi.test.ts src/__tests__/OverallGradingSummary.test.ts
  ```
  Result: **100 / 100 passed (100%)**

- **TypeScript Compilation**:
  ```bash
  npx tsc --noEmit
  ```
  Result: **0 errors**

- **ESLint**:
  ```bash
  npx eslint src/__tests__/ProgressLoadTest.test.ts
  ```
  Result: **0 errors, 0 warnings**

- **Git Diff**:
  ```bash
  git diff --check
  ```
  Result: **Clean**

---

## Acceptance criteria checklist

- [x] Simulated and exercised 20-TA concurrent workload.
- [x] Verified progress counts remain completely correct under load.
- [x] Verified multiple TAs claiming/completing allocations do not corrupt or duplicate progress.
- [x] Verified SSE / live progress updates remain stable under 20-TA simulated workload.
- [x] Measured throughput and latency under load.
- [x] Applied non-invasive hardening (`setMaxListeners(100)` on event emitter) without unnecessary production changes.
- [x] All tests deterministic and free of flaky timing assertions.
- [x] Created implementation report documenting methodology and results.
