# Operations Runbook and Multi-Environment Deployment Guide (AE-239)

This document establishes the definitive operational manual, multi-environment deployment specifications, telemetry alerting thresholds, incident response playbooks, and disaster recovery procedures for the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Multi-Environment Deployment Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Local Development Environment                   │
│  - Docker Compose v2 Orchestration (`docker-compose.yml`)             │
│  - Standalone Next.js 14 container on port 3000                        │
│  - Local MongoDB 7.0 replica set with transaction support              │
│  - Local disk storage emulation for exam pages and PDF assets         │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Staging Environment (GCP)                       │
│  - Google Cloud Run (Asia-South1, Mumbai)                              │
│  - Declarative Knative Service Manifest (`deploy/cloudrun-service.yaml`)│
│  - 2 vCPU, 2 GiB RAM, Gen2 execution environment                      │
│  - GCP Secret Manager bindings for all credentials                     │
│  - GCS Staging Bucket (`iiit-assignment-evaluator-staging-assets`)      │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Production Environment (GCP)                     │
│  - Cloud Run Serverless Container with Horizontal Autoscaling (1-10)   │
│  - Declarative Autoscaling Policy (`deploy/autoscaling-policy.yaml`)   │
│  - MongoDB Atlas M10+ Multi-AZ Replica Set with continuous PITR        │
│  - GCS WORM Object Lock Bucket for immutable physical scan records     │
│  - Cloudflare / Cloud Armor DDoS and Web Application Firewall (WAF)    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Environment Variables & Secret Provisioning

All sensitive secrets are externalized into **GCP Secret Manager** and injected into the container environment at startup. No plaintext credentials or cryptographic keys reside in version control.

### Secret Manager Key Registry:

| Environment Variable | Secret Manager Secret Name | Replication Policy | Purpose |
|----------------------|---------------------------|--------------------|---------|
| `MONGODB_URI` | `evaluator-mongodb-uri:latest` | Automatic (Regional) | MongoDB Atlas connection string with replica set URI |
| `NEXTAUTH_SECRET` | `evaluator-nextauth-secret:latest` | Automatic (Regional) | 256-bit encryption key for NextAuth JWT session tokens |
| `NEXTAUTH_URL` | `evaluator-nextauth-url:latest` | Automatic (Regional) | Canonical HTTPS host URL for OAuth redirect validation |
| `ORIGINAL_STORAGE_HMAC_SECRET` | `evaluator-original-hmac-secret:latest` | Automatic (Regional) | HMAC-SHA256 signing key for sealed immutable student assets |
| `WATERMARK_HMAC_SECRET` | `evaluator-watermark-hmac-secret:latest` | Automatic (Regional) | Dynamic digital watermark signature verification key |

### Provisioning Command Reference:
```bash
# Provision Service Account IAM Secret Access
SERVICE_ACCOUNT="assignment-evaluator-sa@iiit-hyd-assignment-eval.iam.gserviceaccount.com"

gcloud secrets add-iam-policy-binding evaluator-mongodb-uri \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding evaluator-nextauth-secret \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"
```

---

## 3. Observability, Health Checks, and Telemetry

### 3.1 Health Probe Specification
Cloud Run probes the application over HTTP port 3000:
- **Startup Probe**: `GET /api/health`
  - Initial delay: 5s, Period: 5s, Timeout: 3s, Failure threshold: 20 (up to 100s startup headroom).
- **Liveness Probe**: `GET /api/health`
  - Period: 15s, Timeout: 3s, Failure threshold: 3.

### Expected Healthcheck Response (`HTTP 200 OK`):
```json
{
  "status": "ok",
  "database": "connected",
  "storage": "available",
  "timestamp": "2026-11-19T14:30:00.000Z"
}
```

### 3.2 Service Level Objectives (SLOs)
- **Availability SLO**: **99.9% uptime** during active semester evaluation windows.
- **Latency SLO**:
  - $P_{95} \le 200 \text{ ms}$ for standard grading navigation and score updates.
  - $P_{99} \le 500 \text{ ms}$ for complex multi-page canvas composite rendering.

---

## 4. Incident Response Playbooks

```
Severity 1: Outage / Severe Data Risk (Response < 15 min)
Severity 2: Performance Degradation / Partial Impairment (Response < 30 min)
```

### Playbook 1: Database Connection Pool Exhaustion (Severity 1)
- **Symptoms**: Surge in HTTP 504 Gateway Timeouts; server logs reporting `MongoServerSelectionError` or connection pool timeout.
- **Diagnostics**:
  ```bash
  # Check active database connection count via mongosh
  mongosh "$MONGODB_URI" --eval "db.serverStatus().connections"
  ```
- **Remediation**:
  1. Temporarily cap maximum horizontal scaling to 5 instances:
     ```bash
     gcloud run services update assignment-evaluator-staging --max-instances=5
     ```
  2. Inspect connection leak traces; verify that Mongoose connections are recycled globally (`cached.conn`).
  3. Increase MongoDB Atlas connection limits if student/TA concurrency expanded permanently.

### Playbook 2: Container Out-Of-Memory (OOMKill / Exit 137) (Severity 2)
- **Symptoms**: Cloud Run logs show container terminations with Exit Code `137` (SIGKILL by Linux OOM killer).
- **Diagnostics**: Occurs during heavy batch PDF rasterization of multi-page exam booklets.
- **Remediation**:
  1. Enforce memory constraints by ensuring `profileDeviceCapabilities` activates `constrained` raster caching (<150 MB).
  2. Scale up container memory limit in `deploy/cloudrun-service.yaml` to 4Gi:
     ```yaml
     resources:
       limits:
         memory: "4Gi"
     ```
  3. Deploy updated configuration:
     ```bash
     gcloud run services replace deploy/cloudrun-service.yaml
     ```

### Playbook 3: Cryptographic HMAC Signature Mismatch (Severity 1)
- **Symptoms**: Log entry `[FILE] Status: MISMATCH (HMAC signature verification failed)`.
- **Diagnostics**: Run server-side cryptographic audit scan:
  ```bash
  npx tsx src/scripts/verifyIntegrity.ts
  ```
- **Remediation**:
  1. Identify affected batch and script ID from the integrity verification report.
  2. Suspend grading operations on the corrupted batch.
  3. Pull authenticated original immutable PDF from Google Cloud Storage coldline backup.
  4. Recompute derived page hashes and re-seal the batch record.

### Playbook 4: Batch Ingestion Queue Congestion (Severity 2)
- **Symptoms**: Ingestion jobs remain in `PROCESSING` state for > 15 minutes post-examination.
- **Remediation**:
  1. Trigger dead-letter queue cleanup and re-queue uncompleted jobs:
     ```bash
     npx tsx src/scripts/repairDerivedPages.ts
     ```
  2. Verify storage bucket I/O quotas.

---

## 5. Zero-Downtime Deployment & Instant Rollback

### 5.1 Rolling Blue-Green Deployment
Deploy revisions without dropping active grading sessions:
```bash
# 1. Build and tag new container image
gcloud builds submit --tag=gcr.io/iiit-hyd-assignment-eval/assignment-evaluator:v1.2.0 .

# 2. Deploy revision with zero initial traffic
gcloud run deploy assignment-evaluator-staging \
    --image=gcr.io/iiit-hyd-assignment-eval/assignment-evaluator:v1.2.0 \
    --no-traffic

# 3. Verify health on preview revision URL
curl -f -s "https://v1-2-0---assignment-evaluator-staging.a.run.app/api/health"

# 4. Migrate 100% of traffic to the new revision
gcloud run services update-traffic assignment-evaluator-staging --to-latest
```

### 5.2 Instantaneous Revision Rollback
If errors spike post-release, execute an immediate rollback to the previous stable revision in < 5 seconds:
```bash
# Identify previous healthy revision ID
PREVIOUS_REV=$(gcloud run revisions list --service=assignment-evaluator-staging --format="value(metadata.name)" --limit=2 | tail -n 1)

# Route 100% traffic back to previous revision
gcloud run services update-traffic assignment-evaluator-staging --to-revisions="${PREVIOUS_REV}=100"

echo "Rollback successfully executed to revision: ${PREVIOUS_REV}"
```

---

## 6. Disaster Recovery Verification & Backup Routine

### 6.1 Scheduled Backups
- Continuous nearline oplog: Retained 7 days (MongoDB Atlas).
- Daily sealed application snapshot: Executed daily at 02:00 IST via `src/scripts/backupDatabase.ts`.
- Offsite GCS archive: WORM object lock enabled.

### 6.2 Routine Recovery Drill
Execute semi-annual non-destructive recovery drill:
```bash
# Step 1: Generate backup snapshot
npx tsx src/scripts/backupDatabase.ts

# Step 2: Validate archive checksums and dry-run restore
npx tsx src/scripts/restoreDatabase.ts backups/latest --dry-run

# Step 3: Verify audit log HMAC integrity
npx tsx src/scripts/verifyIntegrity.ts
```
Expected outcome: All steps exit with Code `0` and zero verification discrepancies.
