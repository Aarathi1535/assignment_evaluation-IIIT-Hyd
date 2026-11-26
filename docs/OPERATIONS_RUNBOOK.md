# Operations Runbook and Cloud Deployment Guide (AE-239)

This document establishes the operational procedures for deploying, monitoring, rolling back, and recovering the IIIT Hyderabad Assignment Evaluation Platform.

---

## 1. Cloud Architecture & Deployment Overview

The application is deployed to **Google Cloud Run** with MongoDB hosted on **MongoDB Atlas**:
- **Application Runtime**: Next.js service running on Google Cloud Run in `asia-south1` (Mumbai).
- **Database**: MongoDB Atlas Multi-AZ Replica Set with continuous automated snapshots and point-in-time recovery (PITR).
- **Container Registry / Source**: Source-based builds or pre-built container images deployed via `gcloud run`.
- **Configuration & Secrets**: Injected via environment variables and GCP Secret Manager bindings.

---

## 2. Environment Configuration

Deployments require explicit project, regional, and service configuration:
- `GCP_PROJECT_ID`: The target Google Cloud Project ID (must be provided explicitly; no hard-coded project defaults).
- `GCP_REGION`: The deployment region (defaults to `asia-south1`).
- `SERVICE_NAME`: The target Cloud Run service name (defaults to `assignment-evaluator-staging` or `assignment-evaluator-production`).

### Required Service Environment Variables:
- `MONGODB_URI`: MongoDB connection string.
- `NEXTAUTH_SECRET`: Secret key for session encryption.
- `NEXTAUTH_URL`: Canonical host URL for auth redirects.

---

## 3. Observability & Health Monitoring

### 3.1 Health Probe Specification
Cloud Run probes the application over HTTP port 3000:
- **Health Check Endpoint**: `GET /api/health`

### Expected Healthy Response (`HTTP 200 OK`):
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "database": "connected",
    "timestamp": "2026-11-24T12:00:00.000Z"
  }
}
```

If the database is disconnected or unreachable, the endpoint returns `HTTP 503 Service Unavailable`:
```json
{
  "success": true,
  "data": {
    "status": "unhealthy",
    "database": "disconnected",
    "timestamp": "2026-11-24T12:00:00.000Z"
  }
}
```

---

## 4. Zero-Downtime Deployment & Safe Rollback

Deployments follow a staged release process:
1. Capture currently serving revision identifier.
2. Deploy the candidate revision with `--no-traffic` and an explicit `--tag`.
3. Discover the revision preview URL and execute a smoke test against `/api/health`.
4. Shift traffic to the verified revision, or retain the previous serving revision on failure.

### 4.1 Deployment Procedure with Tagged Preview
```bash
if [[ -z "${GCP_PROJECT_ID}" ]]; then
    echo "ERROR: GCP_PROJECT_ID is required." >&2
    exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-asia-south1}"
SERVICE_NAME="${SERVICE_NAME:-assignment-evaluator-staging}"
TAG_NAME="preview-$(date +%s)"

# Step 1: Record currently serving revision BEFORE deploying or shifting traffic
CURRENT_SERVING_REV=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.traffic.filter(percent=100).revisionName)")

echo "Currently serving revision: ${CURRENT_SERVING_REV}"

# Step 2: Deploy candidate revision with --no-traffic and an explicit tag
gcloud run deploy "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --source="." \
    --no-traffic \
    --tag="${TAG_NAME}"

# Step 3: Discover tag preview URL using exact filter
PREVIEW_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.traffic.filter(tag=${TAG_NAME}).url)")

if [[ -z "${PREVIEW_URL}" ]]; then
    echo "ERROR: Could not resolve preview URL for tag ${TAG_NAME}" >&2
    exit 1
fi

# Step 4: Run smoke test against preview revision
echo "Testing preview health: ${PREVIEW_URL}/api/health"
if curl -sf --max-time 15 "${PREVIEW_URL}/api/health"; then
    echo "Smoke test passed. Shifting 100% traffic to verified revision..."
    gcloud run services update-traffic "${SERVICE_NAME}" \
        --project="${PROJECT_ID}" \
        --region="${REGION}" \
        --to-tags="${TAG_NAME}=100"
else
    echo "Smoke test failed. Traffic remains 100% on ${CURRENT_SERVING_REV}."
    exit 1
fi
```

### 4.2 Safe Rollback to Recorded Serving Revision
If an incident or regression occurs post-traffic-migration:
```bash
if [[ -z "${GCP_PROJECT_ID}" ]]; then
    echo "ERROR: GCP_PROJECT_ID is required." >&2
    exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-asia-south1}"
SERVICE_NAME="${SERVICE_NAME:-assignment-evaluator-staging}"

# Rollback requires specifying the known good serving revision recorded prior to deployment:
# e.g. PREVIOUS_GOOD_REV="assignment-evaluator-staging-00042-xyz"
if [[ -z "${PREVIOUS_GOOD_REV}" ]]; then
    echo "ERROR: PREVIOUS_GOOD_REV must be specified (recorded prior to traffic shift)." >&2
    exit 1
fi

echo "Rolling back traffic to known good revision: ${PREVIOUS_GOOD_REV}"
gcloud run services update-traffic "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --to-revisions="${PREVIOUS_GOOD_REV}=100"

echo "Rollback successfully completed."
```

---

## 5. Incident Response & Troubleshooting

### Incident 1: Database Connection Failures
- **Symptoms**: `/api/health` returns status `503` with `"database": "disconnected"`. Application logs report connection timeouts.
- **Diagnostics**:
  1. Check MongoDB Atlas cluster metrics (CPU, RAM, connection counts).
  2. Verify network peering / IP access list rules on the Atlas cluster.
  3. Validate that `MONGODB_URI` environment variable is set and formatted correctly.
- **Remediation**:
  1. Restart Cloud Run instances if connections became stale during a network blip.
  2. Scale Atlas cluster tier if connection limits were exceeded.

### Incident 2: Application Crashing on Boot
- **Symptoms**: Cloud Run logs show container boot failure or startup probe failure.
- **Diagnostics**: Inspect container logs using:
  ```bash
  gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}" \
      --project="${GCP_PROJECT_ID}" \
      --limit=50
  ```
- **Remediation**:
  1. Verify missing required environment variables (`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `MONGODB_URI`).
  2. Roll back immediately to the previous healthy revision using the rollback procedure in Section 4.2.

---

## 6. Disaster Recovery & Backup Routine

- **Production Standard**: Primary disaster recovery and point-in-time recovery (PITR) are managed through **MongoDB Atlas Continuous Cloud Backups**.
- **Backup Strategy**:
  - Automated continuous snapshots managed by MongoDB Atlas.
  - Oplog replay allows point-in-time recovery to any minute within the retention window.
  - Restoration is performed via the MongoDB Atlas cloud console or Atlas CLI by authorized infrastructure administrators.
> [!CAUTION]
> Application restores must be performed through managed cloud snapshots. Never run destructive standalone scripts against the production database.
