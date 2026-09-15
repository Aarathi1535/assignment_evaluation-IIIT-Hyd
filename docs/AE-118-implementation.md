# AE-118 — Concurrency-Correctness & High-Concurrency Regression Testing (20 TAs)

## Objective

Validate that the professor dashboard progress aggregation and Server-Sent Events (SSE) live-update infrastructure maintain strict transactional correctness, isolation, and data consistency without race conditions or state corruption under a simulated high-concurrency workload of 20 Teaching Assistants (TAs).

> [!NOTE]
> This test suite operates as an **in-memory concurrency-correctness regression test** running against `MongoMemoryReplSet`.
> Local and in-memory execution timings reflect single-node test-runner constraints and do **not** represent production throughput or latency SLAs.
> Deployed-environment benchmarks on dedicated infrastructure are required for production capacity and performance evaluation.

---

## Executive Summary

- **Workload Simulated**: 20 distinct TAs (`Teaching Assistant 01` to `Teaching Assistant 20`), 1 Professor, 1 Course, and 1 Exam with 1,000 answer scripts (50 allocations per TA).
- **Concurrency & Correctness Coverage**: Parallel script allocation (`allocateEqual`), concurrent claiming (`claimAllocation`), concurrent completions (`markCompleted`), multi-subscriber SSE broadcasting (`ProgressEventService.subscribe`), parallel REST querying (`GET /api/exams/[id]/progress`), and concurrent reassignments (`reassignAllocation`).
- **Data Integrity & Correctness**: **Zero race conditions, state corruption, or duplicate allocations.** MongoDB atomic aggregation pipelines, multi-document transactions, and status transitions maintained 100% data consistency across all parallel operations.
- **Service Hardening**: Configured `ProgressEventService.emitter` with `setMaxListeners(100)` to ensure high-concurrency multi-subscriber SSE sessions operate cleanly without triggering Node.js event emitter warning thresholds.
- **Transaction Contention Investigation**:
  - In the in-memory replica set (`MongoMemoryReplSet`), 100 parallel claims executed via `Promise.all` completed in ~8.5 seconds.
  - **Root Cause of Contention**: Each `claimAllocation` is wrapped in an atomic multi-document transaction (`runInTransaction`) updating `Allocation` status and writing an immutable `AuditLog` entry. In a single-instance in-memory MongoDB replica set, 100 simultaneous transactions contend for storage engine write locks and transaction coordinator slots.
  - **Design Decision**: The observed contention is expected under bursty parallel transactions on a local single-node in-memory test environment. The transactional isolation and auditability guarantees are essential for preventing double-claiming and data corruption; therefore, no unsafe or weakened transaction optimizations were introduced.

---

## What Was Tested

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

6. **High-Concurrency REST API Querying & Data Consistency**:
   - Firing 50 concurrent requests to `GET /api/exams/[id]/progress` with professor authorization.
   - Verifying all 50 requests succeed with `200 OK` and identical, consistent aggregation results without database deadlocks.

7. **Reassignment Load Across 20-TA Pool**:
   - Concurrently reassigning 10 allocations between distinct pairs of TAs from the 20-TA pool.
   - Verifying that total exam allocations remain strictly 1,000, source TA totals decrement by 1, target TA totals increment by 1, and audit logs are recorded.

---

## Concurrency & Environment Context

- **TA Count**: 20 distinct TA accounts registered on a single course.
- **Dataset Size**: 1,000 answer scripts / allocations per exam (50 per TA).
- **Concurrent Operations**: Batches of 20 to 200 concurrent promises executed via `Promise.all`.
- **Database Engine**: In-memory MongoDB replica set (`MongoMemoryReplSet`).
- **Database Indexing**: Compound indexes on `{ exam: 1, status: 1 }` and `{ exam: 1, ta: 1 }` ensure efficient query execution under concurrency.

---

## Observed In-Memory Regression Timings & Concurrency Correctness

> [!IMPORTANT]
> The timings below represent in-memory test execution metrics on a local developer machine using `MongoMemoryReplSet`.
> They demonstrate transactional safety and concurrency-correctness under load, not deployed production capacity.

| Scenario | Concurrency | Success Rate | In-Memory Timing (MongoMemoryReplSet) | Data Integrity |
| :--- | :--- | :--- | :--- | :--- |
| **Equal Allocation** | 1,000 scripts across 20 TAs | 100% | ~14.5s (bulk setup + transaction) | 50 allocs / TA exact |
| **Concurrent Claiming** | 100 parallel claims | 100% | ~8.5s (transaction lock contention) | 0 race conditions, 0 corrupted states |
| **Concurrent Completion** | 200 parallel completions | 100% | ~31.1s (individual transactions + audits) | Exact counts, 0 duplicates |
| **SSE Event Broadcasting** | 5 clients x 20 events = 100 dispatches | 100% | ~3.2s | 100% message delivery, 0 lost events |
| **Bottleneck Detection** | 20-TA skewed cohort | 100% | ~9.0s | 4 / 4 bottlenecks detected accurately |
| **REST API Querying** | 50 concurrent GET requests | 100% | ~4.5s total | 100% response consistency |
| **Reassignment Under Load**| 10 parallel reassignments | 100% | ~5.4s | Total count invariant, per-TA counts exact |

---

## Transaction Contention Analysis

- **Observation**: 100 concurrent claims executed via `Promise.all` took ~8.5s in the in-memory test suite.
- **Investigation Findings**:
  1. **Multi-Document Transactions**: Each claim call invokes `AllocationService.runInTransaction()`. Inside the transaction, MongoDB executes an atomic `findOneAndUpdate` on `Allocation` and an insert into `AuditLog`.
  2. **In-Memory Replica Set Scheduling**: `MongoMemoryReplSet` runs a single `mongod` instance in a child process. When 100 transactions are fired concurrently in Node.js, they compete for the single storage engine's transaction locks and write tickets, resulting in lock queueing.
  3. **Production vs. Test Environment**: In a deployed multi-node MongoDB cluster with adequate connection pooling and dedicated storage I/O, transactional throughput is substantially higher.
  4. **Preservation of Safety**: The transactional wrapping ensures that claims and their audit log records are atomic, preventing orphaned states or duplicate claims. Weakening transaction isolation or removing audit logging would violate security and correctness invariants; therefore, the transactional design is intentionally preserved.

---

## Validation Commands & Results

- **20-TA Concurrency-Correctness Test Suite**:
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
  npm run lint
  ```
  Result: **0 errors**
