# Autoscaling Configuration and Policy Specification (AE-232)

This document specifies the horizontal autoscaling policies, resource thresholds, capacity calculations, and database connection pool sizing for the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Architectural Philosophy & Workload Profile

The evaluation platform experiences cyclical traffic patterns driven by academic schedules:
- **Baseline Load**: Intermittent student script viewing, regrade checks, and administrative configuration (5–15 requests/min).
- **Batch Ingestion Spike**: Post-exam batch scanning and ingestion uploading up to 5,000 pages within an hour (~1.4 pages/sec continuous write + processing).
- **Peak TA Grading Session**: 50+ concurrent Teaching Assistants actively grading, navigating canvas annotations, updating rubric items, and rendering page layers simultaneously.
- **Results Publication Rush**: Hundreds of students simultaneously logging in to review annotated scripts and mark breakdowns following grade publication.

To support these bursts while maintaining efficient resource usage during idle periods, the platform runs on Google Cloud Run with declarative horizontal autoscaling.

---

## 2. Declarative Scaling Manifest (`deploy/cloudrun-service.yaml` & `deploy/autoscaling-policy.yaml`)

The autoscaling parameters are defined using standard Knative Serving v1 annotations:

| Parameter | Value | Justification |
|-----------|-------|---------------|
| `autoscaling.knative.dev/minScale` | `1` | Aligned with `deploy/cloudrun-service.yaml` (PR #355). Guarantees at least 1 warm container to eliminate cold-start latency without over-provisioning idle resources. |
| `autoscaling.knative.dev/maxScale` | `10` | Hard horizontal ceiling to protect downstream MongoDB Atlas connection pools and prevent runaway costs. |
| `containerConcurrency` | `80` | Maximum simultaneous requests processed per container instance. |
| `autoscaling.knative.dev/targetUtilizationPercentage` | `70` | Triggers horizontal scale-out when active concurrent requests exceed 56 (70% of 80), keeping a 30% safety buffer for sudden request bursts. |
| `run.googleapis.com/cpu-throttling` | `false` | Ensures background canvas compositing, image enhancements, and cryptographic seals execute with full CPU allocation outside request lifecycles. |
| `run.googleapis.com/execution-environment` | `gen2` | Full Linux kernel support with accelerated POSIX filesystem I/O for PDF rendering. |

---

## 3. Database Connection Pool Protection & Sizing

Autoscaling application instances without bounding database connection pools risks exhausting MongoDB connection limits, leading to connection drops and cascading failures.

### Connection Pool Configuration (`src/lib/db.ts`)
The application defines explicit pool sizing parameters via `getMongoPoolConfig()`:
- `maxPoolSize`: Defaults to `50` (configurable via `MONGO_MAX_POOL_SIZE`).
- `minPoolSize`: Defaults to `5` (configurable via `MONGO_MIN_POOL_SIZE`).
- `maxIdleTimeMS`: Defaults to `30000` (30 seconds, configurable via `MONGO_MAX_IDLE_TIME_MS`).
- `serverSelectionTimeoutMS`: Defaults to `5000` (5 seconds).

### Capacity Arithmetic
- Horizontal instance ceiling: $N_{\text{max}} = 10$ instances.
- Max connections per instance: $\text{maxPoolSize} = 50$ connections.
- Maximum total connections from application tier:
  $$\text{Max DB Connections} = 10 \times 50 = 500 \text{ connections}$$
- MongoDB Atlas M10 cluster limit: **1,500 connections**.
- Utilization under maximum platform scale:
  $$\frac{500}{1500} \approx 33.3\% \text{ of MongoDB connection budget}$$
- Headroom: **1,000 connections** remain permanently available for administrative operations, background maintenance scripts, replica set health probes, and analytics queries.

---

## 4. Container Resource Allocation

- Container Memory Limit: `2 GiB` (Request: `1 GiB`).
- Container CPU Limit: `2 vCPU` (Request: `1 vCPU`).
- Node.js Heap: `--max-old-space-size=1536` (1.5 GiB max old space).
- Memory Headroom: ~512 MiB reserved for native `@napi-rs/canvas` and `pdfjs-dist` buffers.

---

## 5. Operational Monitoring & Alerts

Recommended Google Cloud Monitoring alerts:

1. **Instance Saturation Alert**:
   - Condition: `run.googleapis.com/container/instance_count >= 9` for > 5 consecutive minutes.
   - Severity: Warning.
   - Action: Check for stuck or abnormally slow requests; evaluate increasing `maxScale` if student enrollment expands.

2. **Database Connection Saturation Alert**:
   - Condition: MongoDB Atlas active connections > 1,000 (> 66% of M10 quota).
   - Severity: Critical.
   - Action: Inspect connection leaks or reduce `MONGO_MAX_POOL_SIZE`.

3. **High 5xx Rate at Scale**:
   - Condition: HTTP 5xx rate > 1% when instance count > 5.
   - Severity: Critical.
   - Action: Check database replica set health and transaction rollback rates.
