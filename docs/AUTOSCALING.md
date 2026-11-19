# Autoscaling Configuration and Policy Specification (AE-232)

This document specifies the horizontal autoscaling policies, resource thresholds, capacity calculations, and stabilization parameters for the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Architectural Philosophy & Workload Profile

The evaluation platform experiences distinctive cyclical traffic patterns driven by academic schedules:
- **Baseline Load**: Intermittent student script viewing, regrade checks, and administrative configuration (5–15 requests/min).
- **Batch Ingestion Spike**: Post-exam batch scanning and ingestion uploading up to 5,000 pages within an hour (~1.4 pages/sec continuous write + processing).
- **Peak TA Grading Session**: 50+ concurrent Teaching Assistants actively grading, navigating canvas annotations, updating rubric items, and rendering page layers simultaneously.
- **Results Publication Rush**: Hundreds of students simultaneously logging in to review annotated scripts and mark breakdowns following grade publication.

To support these spikes without over-provisioning during idle periods, the platform uses a dual-target declarative horizontal autoscaling strategy:
1. **Cloud Run Autoscaling**: Serverless concurrency-driven autoscaling for managed container execution.
2. **Kubernetes Horizontal Pod Autoscaler (HPA v2)**: Metric-driven autoscaling (CPU & Memory) for self-hosted campus cluster deployments.

---

## 2. Declarative Scaling Manifest (`deploy/autoscaling-policy.yaml`)

### Cloud Run Autoscaling Profile

| Parameter | Value | Justification |
|-----------|-------|---------------|
| `minScale` | `2` | Guarantees warm container readiness across availability zones; eliminates cold-start latency for graders. |
| `maxScale` | `10` | Hard horizontal ceiling to protect downstream MongoDB connection limits and avoid uncontrolled cost spikes. |
| `containerConcurrency` | `80` | Maximum simultaneous requests handled by each container instance. |
| `targetUtilizationPercentage` | `70%` | Scales out when active concurrent requests exceed 56 (70% of 80), keeping buffer for sudden bursts. |
| `cpu-throttling` | `false` | Ensures background canvas compositing, image enhancements, and cryptographic seals run at full clock speed. |
| `execution-environment` | `gen2` | Full Linux kernel support with accelerated POSIX I/O for file processing. |

### Kubernetes HPA (v2) Profile

| Parameter | Value | Justification |
|-----------|-------|---------------|
| `minReplicas` | `2` | Multi-pod baseline providing high availability and zero-downtime rolling upgrades. |
| `maxReplicas` | `10` | Aligned with the database connection pool budget. |
| `CPU Utilization Target` | `75%` | Reserves 25% headroom for Node.js event-loop operations (PDF rendering, crypto verification). |
| `Memory Utilization Target` | `80%` | Protects V8 runtime from memory pressure during multi-page high-resolution rasterization. |
| `Scale-up Stabilization` | `0 seconds` | Instant scale-out on incoming traffic surges; adds up to 50% pods or 2 pods per 15-second evaluation. |
| `Scale-down Stabilization` | `300 seconds (5 min)` | Prevents flapping (rapid thrashing between scale-up and scale-down) during grading lulls. |

---

## 3. Capacity Modeling & Database Protection

Autoscaling must preserve downstream system health, specifically database connection limits and storage bandwidth.

### Database Connection Pool Arithmetic
- Each application pod configures a maximum connection pool size:
  $$\text{maxPoolSize} = 10$$
- Under maximum horizontal autoscaling ($$N_{\text{max}} = 10$$ instances):
  $$\text{Max DB Connections} = 10 \times 10 = 100 \text{ connections}$$
- MongoDB Atlas M10 cluster limit: **1,500 connections**.
- Utilization under maximum platform scale:
  $$\frac{100}{1500} \approx 6.7\% \text{ of MongoDB connection budget}$$
- This guarantees that even under maximum scale-out, the database connection pool cannot be exhausted or cause denial of service to replica set health probes.

### Memory & V8 Heap Sizing
- Container Memory Allocation: `2 GiB`
- Node.js max-old-space-size: `--max-old-space-size=1536` (1.5 GiB)
- Headroom for native Canvas & PDF rendering libraries: `512 MiB`
- Triggering scale-out at 80% RAM utilization (1.6 GiB) ensures additional pods are provisioned well before any single pod approaches OOMKill thresholds.

---

## 4. Cold-Start Mitigation & Anti-Flapping Behavior

```
      Traffic Surge (Exam End)
                 │
                 ▼
     ┌────────────────────────┐
     │ Utilization > 70% / 75%│
     └───────────┬────────────┘
                 │ Scale-up window: 0s (Instant)
                 ▼
     ┌────────────────────────┐
     │ Scale Up (+2 pods/15s) │
     └───────────┬────────────┘
                 │
                 │ Grading Session Concludes (Gradual decrease)
                 ▼
     ┌────────────────────────┐
     │ Utilization < 70% / 75%│
     └───────────┬────────────┘
                 │ Scale-down window: 300s (Wait 5 minutes)
                 ▼
     ┌────────────────────────┐
     │ Stable? -> Scale Down  │
     │ Flapping PREVENTED     │
     └────────────────────────┘
```

1. **Warm Pool Baseline**: Maintaining `minScale: 2` ensures that initial grading requests receive sub-100ms response times without paying container cold-start penalties (~3–5 seconds).
2. **Scale-Down Dampening**: A 300-second stabilization window ensures that temporary pauses in grading activity (e.g. TA reviewing rubric criteria or taking a break) do not trigger premature de-provisioning that would force subsequent requests to wait for scale-up.

---

## 5. Monitoring & Operational Alerts

Recommended alerting rules for Google Cloud Monitoring and Prometheus:

1. **Instance Saturation Alert**:
   - Condition: `instance_count >= 9` for > 5 consecutive minutes.
   - Severity: Warning.
   - Action: Check for stuck long-running requests or evaluate increasing `maxScale` if enrollment increased.

2. **Rapid Flapping Alert**:
   - Condition: Pod count delta > 5 transitions within 15 minutes.
   - Severity: Warning.
   - Action: Inspect scale-down stabilization window and verify workload distribution.

3. **High Error Rate at Peak Scale**:
   - Condition: HTTP 5xx rate > 1% when instance count > 5.
   - Severity: Critical.
   - Action: Check MongoDB replica set response latency and connection pool wait queues.
