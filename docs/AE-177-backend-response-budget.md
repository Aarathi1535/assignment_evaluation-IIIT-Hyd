# AE-177 Backend Response-Time Budget Report

## 1. Baseline Performance Metrics

Below are the initial performance metrics captured using the benchmark framework:

*   **GET Script (20 pages)**: `p50: 6.56 ms`, `p95: 9.36 ms`, `max: 12.03 ms`, `Avg DB ops: 3.0`
*   **saveGrade**: `p50: 12.33 ms`, `p95: 15.08 ms`, `max: 15.92 ms`, `Avg DB ops: 7.0`
*   **Annotation Autosave**: `p50: 13.99 ms`, `p95: 19.22 ms`, `max: 42.38 ms`, `Avg DB ops: 8.0`
*   **Script Submit**: `p50: 48.77 ms`, `p95: 72.42 ms`, `max: 92.46 ms`, `Avg DB ops: 18.0`
*   **Bulk Submit (50 items)**: `p50: 2921.07 ms`, `p95: 2921.07 ms`, `max: 2921.07 ms`, `Avg DB ops: 910.5`
*   **Image GET**: `p50: 0.74 ms`, `p95: 1.83 ms`, `max: 2.55 ms`, `Avg DB ops: 1.0`
*   **getNextAllocation**: `p50: 1.77 ms`, `p95: 2.50 ms`, `max: 2.93 ms`, `Avg DB ops: 1.0`

### Analysis
All individual grading APIs were already operating well within the <= 300 ms p95 performance budget limit. However, the `Bulk Submit` endpoint took nearly 3 seconds (2921 ms) with over 910 database operations, violating the <= 2000 ms budget for 50 items.

## 2. Optimizations

### Bulk Submit (GradingService.ts)
The previous implementation of `bulkSubmit` performed a sequential loop where it repeatedly called the individual `submitScript` function for each answer script. This created massive redundancies by running validations, transactional single-document updates, and progress emissions for each of the 50 items consecutively.

**Fix:**
Implemented a bulk execution strategy:
1. Replaced the sequential update calls with Mongoose bulk operations (`updateMany`) to update grades to `isFinal: true`.
2. Utilized `updateMany` for `Allocation` to batch update allocation status to `COMPLETED` and push history items simultaneously.
3. Created `AuditLog` items asynchronously via `Promise.all`.

## 3. Post-Optimization Performance

After applying the optimizations, the benchmark yielded the following results for the bottleneck:

*   **Bulk Submit (50 items)**:
    *   `p50`: 570.61 ms (Down from 2921.07 ms)
    *   `p95`: 570.61 ms
    *   `max`: 570.61 ms
    *   `Avg DB ops`: 60.5 (Down from 910.5)

### Conclusion
The bulk submit performance now comfortably meets the performance budget, registering a sub-600ms latency profile for 50 items.
