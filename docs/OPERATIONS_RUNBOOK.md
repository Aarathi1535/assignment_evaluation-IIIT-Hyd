# Operations Runbook and Cloud Deployment Guide (AE-239)

This document establishes the definitive operational manual, Cloud Run deployment specifications, health monitoring endpoints, incident response playbooks, and disaster recovery procedures for the IIIT Hyderabad Assignment Evaluation Platform.

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
│  - Staging deployment script (`deploy/deploy-staging.sh`)              │
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

### Required Environment Configuration:
Deployments require explicit project and regional configuration:
- `GCP_PROJECT_ID`: The target Google Cloud Project ID (e.g. institutional project ID).
- `GCP_REGION`: The deployment region (defaults to `asia-south1` - Mumbai).

### Secret Manager Key Registry:

| Environment Variable | Secret Manager Secret Name | Purpose |
|----------------------|---------------------------|---------|
| `MONGODB_URI` | `evaluator-mongodb-uri:latest` | MongoDB Atlas connection string with replica set URI |
| `NEXTAUTH_SECRET` | `evaluator-nextauth-secret:latest` | 256-bit secret key for NextAuth JWT session tokens |
| `NEXTAUTH_URL` | `evaluator-nextauth-url:latest` | Canonical HTTPS host URL for NextAuth callbacks |
| `ORIGINAL_STORAGE_HMAC_SECRET` | `evaluator-original-hmac-secret:latest` | HMAC-SHA256 signing key for sealed immutable student assets |
| `WATERMARK_HMAC_SECRET` | `evaluator-watermark-hmac-secret:latest` | Dynamic digital watermark signature verification key |

### Provisioning IAM Permissions:
```bash
if [[ -z "${GCP_PROJECT_ID}" ]]; then
    echo "ERROR: GCP_PROJECT_ID is required" >&2
    exit 1
fi

REGION="${GCP_REGION:-asia-south1}"
SERVICE_ACCOUNT="assignment-evaluator-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

# Grant Secret Manager Access to Container Service Account
gcloud secrets add-iam-policy-binding evaluator-mongodb-uri \
    --project="${GCP_PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding evaluator-nextauth-secret \
    --project="${GCP_PROJECT_ID}" \
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
  "success": true,
  "data": {
    "status": "healthy",
    "database": "connected",
    "timestamp": "2026-11-22T12:00:00.000Z"
  }
}
```

If database connection fails, the endpoint returns `HTTP 503` with:
```json
{
  "success": true,
  "data": {
    "status": "unhealthy",
    "database": "disconnected",
    "timestamp": "2026-11-22T12:00:00.000Z"
  }
}
```

---

## 4. Zero-Downtime Deployment & Verified Rollback

All deployments follow a strict **no-traffic preview** workflow with an explicit tagged revision.

### 4.1 Deployment Procedure with Tagged Preview
```bash
if [[ -z "${GCP_PROJECT_ID}" ]]; then
    echo "ERROR: GCP_PROJECT_ID is required." >&2
    exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-asia-south1}"
SERVICE_NAME="assignment-evaluator-staging"
IMAGE_TAG="gcr.io/${PROJECT_ID}/assignment-evaluator:$(git rev-parse --short HEAD)"
TAG_NAME="preview-$(date +%s)"

# Step 1: Submit container image build
gcloud builds submit --project="${PROJECT_ID}" --tag="${IMAGE_TAG}" .

# Step 2: Deploy new revision with --no-traffic and an explicit --tag
gcloud run deploy "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --image="${IMAGE_TAG}" \
    --no-traffic \
    --tag="${TAG_NAME}"

# Step 3: Discover tag preview URL
PREVIEW_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.traffic[?tag='${TAG_NAME}'].url)")

# Step 4: Run smoke test against preview revision
echo "Testing preview health: ${PREVIEW_URL}/api/health"
if curl -sf --max-time 15 "${PREVIEW_URL}/api/health"; then
    echo "Smoke test passed. Migrating 100% traffic to latest revision..."
    gcloud run services update-traffic "${SERVICE_NAME}" \
        --project="${PROJECT_ID}" \
        --region="${REGION}" \
        --to-latest
else
    echo "Smoke test failed. Traffic left untouched on current stable revision."
    exit 1
fi
```

### 4.2 Verified Healthy Rollback Procedure
Never blindly rollback to an unverified previous revision. The rollback procedure queries revisions that reported `Ready=True` before shifting traffic:

```bash
if [[ -z "${GCP_PROJECT_ID}" ]]; then
    echo "ERROR: GCP_PROJECT_ID is required." >&2
    exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-asia-south1}"
SERVICE_NAME="assignment-evaluator-staging"

# Query the most recent healthy (Ready=True) revision prior to the current active one
PREVIOUS_HEALTHY_REV=$(gcloud run revisions list \
    --service="${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --filter="status.conditions.type:Ready AND status.conditions.status:True" \
    --format="value(metadata.name)" \
    --limit=5 | sed -n '2p')

if [[ -z "${PREVIOUS_HEALTHY_REV}" ]]; then
    echo "ERROR: No verified healthy previous revision found for rollback." >&2
    exit 1
fi

echo "Rolling back to verified healthy revision: ${PREVIOUS_HEALTHY_REV}"
gcloud run services update-traffic "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --to-revisions="${PREVIOUS_HEALTHY_REV}=100"

echo "Rollback successfully completed to ${PREVIOUS_HEALTHY_REV}."
```

---

## 5. Incident Response Playbooks

### Playbook 1: Database Connection Pool Exhaustion (Severity 1)
- **Symptoms**: Surge in HTTP 504 Gateway Timeouts; server logs reporting `MongoServerSelectionError` or connection timeout.
- **Diagnostics**: Check active connection metrics in MongoDB Atlas console or via CLI.
- **Remediation**:
  1. Temporarily cap maximum horizontal instances:
     ```bash
     gcloud run services update "${SERVICE_NAME}" \
         --project="${GCP_PROJECT_ID}" \
         --region="${GCP_REGION:-asia-south1}" \
         --max-instances=5
     ```
  2. Confirm `MONGO_POOL_CONFIG` in `src/lib/db.ts` caps `maxPoolSize: 50`.
  3. Increase cluster tier if active student concurrency requires sustained connections.

### Playbook 2: Container Out-Of-Memory (OOMKill / Exit 137) (Severity 2)
- **Symptoms**: Cloud Run logs show container termination with Exit Code `137` (SIGKILL by Linux OOM killer).
- **Diagnostics**: Large batch ingestion PDF rasterization.
- **Remediation**:
  1. Ensure client devices use bounded raster cache (`RasterMemoryCacheManager`).
  2. Increase container memory limit to 4Gi in `deploy/cloudrun-service.yaml` and redeploy.

### Playbook 3: Cryptographic HMAC Signature Mismatch (Severity 1)
- **Symptoms**: Log entry `[FILE] Status: MISMATCH (HMAC signature verification failed)`.
- **Diagnostics**:
  ```bash
  npx tsx src/scripts/verifyIntegrity.ts
  ```
- **Remediation**:
  1. Identify affected batch from the integrity report.
  2. Temporarily pause grading on the batch.
  3. Compare asset checksum with original storage backup.

---

## 6. Disaster Recovery & Backup Routine

- **Production Standard**: Primary disaster recovery is managed through **MongoDB Atlas Continuous Cloud Backups (Point-in-Time Recovery)**.
- **Drill Validation**: For operational validation in staging or local environments:
  ```bash
  # Step 1: Generate backup snapshot
  npx tsx src/scripts/backupDatabase.ts

  # Step 2: Validate archive checksums in dry-run mode (read-only, non-destructive)
  npx tsx src/scripts/restoreDatabase.ts backups/latest --dry-run

  # Step 3: Verify audit log HMAC integrity
  npx tsx src/scripts/verifyIntegrity.ts
  ```
