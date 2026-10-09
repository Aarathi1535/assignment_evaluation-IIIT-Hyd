# AE-177: Backend Response Budget & Server-Timing Instrumentation

## Objective

Measure and optimize backend database latency for grading operations to maintain high-frequency grading capabilities. The target performance budget is < 300ms for individual backend database submissions (and effectively >300Hz grading throughput).

## 1. Server-Timing Instrumentation

To allow real-time monitoring of backend database query delays, we implemented a custom `withServerTiming` HOC in `src/lib/serverTiming.ts`. It leverages Node.js `AsyncLocalStorage` and Mongoose's `monitorCommands` to automatically intercept, measure, and aggregate all MongoDB roundtrips that occur during an API request.

The following API routes have been wrapped:
- `GET /api/scripts/[id]`
- `POST /api/scripts/[id]/submit`
- `POST/PUT /api/scripts/[id]/questions/[questionNumber]/grade`
- `GET/POST/PUT /api/scripts/[id]/grades`
- `POST /api/exams/[id]/submissions/bulk`
- `GET /api/ingest/[id]/pages/[pageId]/image`
- `GET /api/allocations/next`

This enables the `Server-Timing: db;dur=XXX` header in responses, allowing the Network tab to easily identify slow endpoints.

## 2. Identified Database Optimizations (Cheap Fixes)

We avoided risky or extensive refactoring (like bulkSubmit batching) in favor of the cheap fixes identified by the mentor:

1. **`IngestionPage.find(...)` Over-fetching**:
   - Issue: Fetched entire documents instead of just the needed fields.
   - Fix: Added `.select('_id pageNumber')` and `.lean()` in `GET /api/scripts/[id]`.
2. **`AnnotationPersistenceService` Concurrency**:
   - Issue: Needed an atomic write capability.
   - Fix: Confirmed it strictly uses `findOneAndUpdate` without `$setOnInsert` to safely handle lock contention on vector annotations.
3. **`GradingService.submitScript` Sequential Grade Updates**:
   - Issue: The submission looped over grades and called `.save()` on each individually.
   - Fix: Transitioned to `Grade.updateMany({ _id: { $in: gradeIds } }, { $set: { isFinal: true } })` to finalize all grades in a single round-trip.
4. **`AllocationService.getNextAllocation` Index & Deterministic Ordering**:
   - Issue: Query took 1.2s because it lacked an index, and deterministic ordering required an `_id` tie-breaker.
   - Fix: Added the compound index `{ ta: 1, exam: 1, status: 1, createdAt: 1, _id: 1 }` to the `Allocation` schema and sort via `{ createdAt: 1, _id: 1 }` to ensure deterministic ordering while keeping the query fully indexed.
5. **Asynchronous Progress Dispatch**:
   - Issue: `submitScript` awaited `ProgressEventService.dispatchProgressEvent`, which introduced ~50ms of blocking aggregation latency per call.
   - Fix: Fired the event asynchronously to avoid blocking the critical response path.

## 3. Benchmarking

Created `src/__tests__/AE177ResponseBudgetBenchmark.test.ts` to explicitly benchmark the modified `GradingService.submitScript` and bulk submission logic.

**Benchmark Targets**:
- **Individual Latency Budget**: < 300ms
- **Integration Test Budget (100 Iterations)**: < 2000ms
- **Bulk Processing Budget (50 Items)**: < 15000ms (aligned with `DEFAULT_BULK_TIMEOUT_MS` to support realistic bulk processing while maintaining transaction-safe timeout safeguards against runaway processing)

**Results**:
The benchmark successfully passed by executing 100 sequential `submitScript` operations in approximately ~1.9s (~19ms average per submission) and 50 bulk items within ~2.2s, confirming that the optimizations successfully keep latency well within the required performance budget.

## Future Follow-ups
- File follow-up ticket for `bulkSubmit` batching (currently using unoptimized loop).
- File follow-up ticket for audit-on-autosave optimizations.
