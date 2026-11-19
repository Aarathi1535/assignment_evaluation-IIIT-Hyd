# Cloud Run Deployment and Staging Architecture (AE-231)

This document specifies the deployment architecture, configuration parameters, secret management integrations, and operational procedures for hosting the IIIT Hyderabad Assignment Evaluation Platform on Google Cloud Run (Asia-South1 region).

---

## 1. Staging & Production Architecture

```
                 Internet / Campus Network
                            │
                            ▼
              ┌───────────────────────────┐
              │  Cloud Run HTTPS Ingress  │ (Managed TLS Termination)
              │    (asia-south1 region)   │
              └─────────────┬─────────────┘
                            │
               ┌────────────┴────────────┐
               │                         │
               ▼                         ▼
      ┌─────────────────┐       ┌─────────────────┐
      │ Cloud Run Pod 1 │       │ Cloud Run Pod N │ (Autoscaled: 1 to 10 instances)
      │ Next.js 14 Gen2 │       │ Next.js 14 Gen2 │ (2 vCPU, 2 GiB RAM per instance)
      └────────┬────────┘       └────────┬────────┘
               │                         │
     ┌─────────┴─────────────────────────┴─────────┐
     │                                             │
     ▼                                             ▼
┌────────────────────────┐             ┌─────────────────────────┐
│  GCP Secret Manager    │             │   Google Cloud Storage   │
│  - MONGODB_URI         │             │  - Original PDF / WORM   │
│  - NEXTAUTH_SECRET     │             │  - Derived Page Assets  │
│  - HMAC Signing Keys   │             │  - Watermarked PDFs     │
└────────────────────────┘             └─────────────────────────┘
     │
     ▼
┌────────────────────────┐
│  MongoDB Atlas Cluster │ (M10+ Replica Set via VPC Peering or Public IP Whitelist)
│  - Audited Collections │
│  - Transaction Locks   │
└────────────────────────┘
```

---

## 2. Declarative Service Manifest (`deploy/cloudrun-service.yaml`)

The Cloud Run deployment uses a standard Knative Serving specification:

- **Service Name**: `assignment-evaluator-staging`
- **Region**: `asia-south1` (Mumbai, minimizing latency to IIIT Hyderabad campus)
- **Execution Environment**: `gen2` (Second generation with full Linux kernel and POSIX compliance)
- **Container Port**: `3000` (Next.js standalone server)
- **Resource Limits**:
  - `cpu`: `2` (2 vCPU)
  - `memory`: `2Gi` (2 GiB RAM)
- **Resource Requests**:
  - `cpu`: `1` (1 vCPU reserved)
  - `memory`: `1Gi` (1 GiB reserved)
- **Concurrency**: `80` requests per instance
- **Instance Scaling**:
  - `minScale`: `1` (ensures warm instance, eliminating cold-start latency for grading)
  - `maxScale`: `10` (protects backend database from unbounded horizontal spike)
- **Probes**:
  - `startupProbe`: `/api/health`, 5s initial delay, period 5s, failureThreshold 20 (up to 100s startup headroom)
  - `livenessProbe`: `/api/health`, period 15s, timeout 3s, failureThreshold 3

---

## 3. Secret Management Integration

All sensitive credentials are bound from GCP Secret Manager directly into environment variables at container startup. No credentials or keys are committed to Git or baked into container images.

| Environment Variable | Secret Manager Secret Name | Purpose |
|----------------------|---------------------------|---------|
| `MONGODB_URI` | `evaluator-mongodb-uri:latest` | Database connection string with replica set credentials |
| `NEXTAUTH_SECRET` | `evaluator-nextauth-secret:latest` | Session token signing and verification key |
| `NEXTAUTH_URL` | `evaluator-nextauth-url:latest` | Canonical platform URL for OAuth redirects |
| `ORIGINAL_STORAGE_HMAC_SECRET` | `evaluator-original-hmac-secret:latest` | SHA-256 HMAC key for immutable asset verification |

### Provisioning Secrets via gcloud CLI

```bash
# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com

# Create secrets
gcloud secrets create evaluator-mongodb-uri --replication-policy="automatic"
echo -n "mongodb+srv://..." | gcloud secrets versions add evaluator-mongodb-uri --data-file=-

gcloud secrets create evaluator-nextauth-secret --replication-policy="automatic"
openssl rand -base64 32 | tr -d '\n' | gcloud secrets versions add evaluator-nextauth-secret --data-file=-

gcloud secrets create evaluator-original-hmac-secret --replication-policy="automatic"
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add evaluator-original-hmac-secret --data-file=-
```

### Granting Secret Access to the Service Account

```bash
SERVICE_ACCOUNT="assignment-evaluator-sa@iiit-hyd-assignment-eval.iam.gserviceaccount.com"

for SECRET in evaluator-mongodb-uri evaluator-nextauth-secret evaluator-nextauth-url evaluator-original-hmac-secret; do
  gcloud secrets add-iam-policy-binding "${SECRET}" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 4. Staging Deployment Execution

Deployment automation scripts are provided for both Unix/macOS (`deploy-staging.sh`) and Windows PowerShell (`deploy-staging.ps1`).

### Strict Non-Fabrication Policy

The deployment scripts enforce genuine pre-flight checks:
1. Verifies that `gcloud` CLI is installed and present in `PATH`.
2. Verifies an active authenticated Google Cloud session via `gcloud auth print-access-token`.
3. Verifies authorization against the targeted GCP Project ID via `gcloud projects describe`.

If unauthenticated or without project permissions, the scripts **cleanly exit without fabricating deployment URLs or falsifying staging success**.

### Running the Deployment

#### Bash (Linux / macOS):
```bash
export GCP_PROJECT_ID="iiit-hyd-assignment-eval"
export GCP_REGION="asia-south1"

chmod +x deploy/deploy-staging.sh
./deploy/deploy-staging.sh
```

#### PowerShell (Windows):
```powershell
$env:GCP_PROJECT_ID = "iiit-hyd-assignment-eval"
$env:GCP_REGION = "asia-south1"

.\deploy\deploy-staging.ps1
```

---

## 5. Post-Deployment Verification

Once deployed, verify platform health using the automated endpoint:

```bash
# Retrieve service URL
SERVICE_URL=$(gcloud run services describe assignment-evaluator-staging --project=iiit-hyd-assignment-eval --region=asia-south1 --format="value(status.url)")

# Health check
curl -f -s "${SERVICE_URL}/api/health" | jq .
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-11-19T12:00:00.000Z",
  "database": "connected"
}
```
