# Autoscaling Configuration and Policy Specification Proposal (AE-232 / PR #357)

> [!NOTE]
> **Status: Architectural Proposal for Discussion**
> Per mentor review guidance on PR #357, this document represents an autoscaling capacity analysis and proposal. Standalone policy YAML manifests have been dropped as Cloud Run does not support them, and database connection pool options in `src/lib/db.ts` remain strictly opt-in so production defaults are unchanged pending agreement on production cluster tiers.

---

## 1. Architectural Philosophy & Workload Profile

The evaluation platform experiences cyclical traffic patterns driven by academic schedules:
- **Baseline Load**: Intermittent student script viewing, regrade checks, and administrative configuration (5–15 requests/min).
- **Batch Ingestion Spike**: Post-exam batch scanning and ingestion uploading up to 5,000 pages within an hour (~1.4 pages/sec continuous write + processing).
- **Peak TA Grading Session**: 50+ concurrent Teaching Assistants actively grading, navigating canvas annotations, updating rubric items, and rendering page layers simultaneously.
- **Results Publication Rush**: Hundreds of students simultaneously logging in to review annotated scripts and mark breakdowns following grade publication.

To support these bursts while maintaining efficient resource usage during idle periods, the platform runs on Google Cloud Run with declarative horizontal autoscaling.

---

## 2. Cloud Run Autoscaling Parameters Proposal

The proposed autoscaling parameters for Cloud Run (referenced in `deploy/cloudrun-service.yaml`) are:

| Parameter | Proposed Value | Justification |
| :--- | :---: | :--- |
| `autoscaling.knative.dev/minScale` | `1` | Aligned with `deploy/cloudrun-service.yaml` (PR #355). Guarantees at least 1 warm container to eliminate cold-start latency without over-provisioning idle resources. |
| `autoscaling.knative.dev/maxScale` | `10` | Horizontal ceiling to protect downstream MongoDB connection limits and prevent runaway compute costs. |
| `containerConcurrency` | `80` | Maximum simultaneous requests processed per container instance before Cloud Run triggers horizontal scale-out. |
| `run.googleapis.com/cpu-throttling` | `false` | Ensures background canvas compositing, image enhancements, and cryptographic seals execute with full CPU allocation. |
| `run.googleapis.com/execution-environment` | `gen2` | Full Linux kernel support with accelerated POSIX filesystem I/O for PDF rendering. |

*(Note: `targetUtilizationPercentage` is omitted because Cloud Run does not support Knative target utilization percentages; Cloud Run scales directly on concurrent requests).*

---

## 3. Database Connection Pool Protection & Sizing

Autoscaling application instances without bounding database connection pools risks exhausting MongoDB connection limits, leading to connection drops and cascading failures.

### Opt-in Connection Pool Configuration (`src/lib/db.ts`)
The application exposes optional connection pool sizing parameters via `getMongoPoolConfig()`:
- `maxPoolSize`: Configurable via `MONGO_MAX_POOL_SIZE` (opt-in; driver default applies if unset).
- `minPoolSize`: Configurable via `MONGO_MIN_POOL_SIZE` (opt-in; driver default applies if unset).
- `maxIdleTimeMS`: Configurable via `MONGO_MAX_IDLE_TIME_MS` (opt-in; driver default applies if unset).
- `serverSelectionTimeoutMS`: Configurable via `MONGO_SERVER_SELECTION_TIMEOUT_MS` (opt-in; driver default applies if unset).

When these environment variables are unset, Mongoose and the MongoDB driver apply standard defaults (e.g. `maxPoolSize: 100`, `minPoolSize: 0`), ensuring merging does not alter existing production behavior.

### Capacity Arithmetic (Illustrative Model)
If configured with `MONGO_MAX_POOL_SIZE=50`:
- Horizontal instance ceiling: $N_{\text{max}} = 10$ instances.
- Max connections per instance: $\text{maxPoolSize} = 50$ connections.
- Maximum total connections from application tier:
  $$\text{Max DB Connections} = 10 \times 50 = 500 \text{ connections}$$
- Sizing against illustrative MongoDB Atlas M10 tier (1,500 connection limit):
  $$\frac{500}{1500} \approx 33.3\% \text{ of MongoDB connection budget}$$
- Headroom: 1,000 connections remain available for administrative operations, replica set maintenance, and background workers.
- *Note:* Production cluster tier and pool limits remain subject to final agreement with mentor and infrastructure owners.

---

## 4. Container Resource Allocation

- Container Memory Limit: `2 GiB` (Request: `1 GiB`).
- Container CPU Limit: `2 vCPU` (Request: `1 vCPU`).
- Node.js Memory Management: Standard V8 heap allocation within container cgroup boundaries. Native buffers (`@napi-rs/canvas` and `pdfjs-dist`) allocate outside V8 old space within the 2 GiB limit.

---

## 5. Operational Monitoring & Alerts

Recommended Google Cloud Monitoring alerts:

1. **Instance Saturation Alert**:
   - Condition: `run.googleapis.com/container/instance_count >= 9` for > 5 consecutive minutes.
   - Severity: Warning.
   - Action: Check for stuck or abnormally slow requests; evaluate increasing `maxScale` if student enrollment expands.

2. **Database Connection Saturation Alert**:
   - Condition: MongoDB active connections > 66% of cluster quota.
   - Severity: Critical.
   - Action: Inspect connection leaks or adjust `MONGO_MAX_POOL_SIZE`.

3. **High 5xx Rate at Scale**:
   - Condition: HTTP 5xx rate > 1% when instance count > 5.
   - Severity: Critical.
   - Action: Check database replica set health and transaction rollback rates.
