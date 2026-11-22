#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Staging Deployment Script: Google Cloud Run (Draft / Reference Template)
# ==============================================================================
# NOTE: Review comments on PR #355:
# - Do not use made-up project IDs; require GCP_PROJECT_ID explicitly.
# - Exit non-zero on auth/access errors (never exit 0 on missing auth).
# - Deploy with --no-traffic preview first, run health smoke test, then shift traffic.
# - Do not grant allUsers invoker on every run.
# ==============================================================================

if [[ -z "${GCP_PROJECT_ID:-}" ]]; then
    echo "❌ ERROR: GCP_PROJECT_ID environment variable is required."
    echo "Usage: GCP_PROJECT_ID=my-project-id [GCP_REGION=asia-south1] $0"
    exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-asia-south1}"
SERVICE_NAME="assignment-evaluator-staging"
IMAGE_TAG="gcr.io/${PROJECT_ID}/assignment-evaluator:staging-latest"

echo "=== IIIT Hyd Assignment Evaluation Platform: Staging Deploy ==="
echo "Target Project: ${PROJECT_ID}"
echo "Target Region:  ${REGION}"
echo "Target Service: ${SERVICE_NAME}"
echo ""

# Pre-flight Check 1: Verify gcloud CLI is available
if ! command -v gcloud &> /dev/null; then
    echo "❌ ERROR: 'gcloud' CLI is not installed or not in PATH."
    exit 1
fi

# Pre-flight Check 2: Verify active authenticated session (exit 1 if unauthenticated)
echo "Checking Google Cloud authentication status..."
if ! gcloud auth print-access-token &> /dev/null; then
    echo "❌ ERROR: No active Google Cloud credentials detected."
    echo "Run 'gcloud auth login' or configure GOOGLE_APPLICATION_CREDENTIALS before deploying."
    exit 1
fi

# Pre-flight Check 3: Check project access (exit 1 if inaccessible)
echo "Verifying project access for '${PROJECT_ID}'..."
if ! gcloud projects describe "${PROJECT_ID}" &> /dev/null; then
    echo "❌ ERROR: Authenticated principal does not have access to project '${PROJECT_ID}'."
    exit 1
fi

echo "Building and submitting container image via Cloud Build..."
gcloud builds submit --project="${PROJECT_ID}" --tag="${IMAGE_TAG}" .

echo "Deploying new revision to Cloud Run with --no-traffic (Preview Phase)..."
TAG_NAME="preview-$(date +%s)"
gcloud run deploy "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --image="${IMAGE_TAG}" \
    --no-traffic \
    --tag="${TAG_NAME}"

PREVIEW_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.traffic[0].url)")

echo "Running smoke test on preview revision URL: ${PREVIEW_URL}/api/health..."
if curl -sf --max-time 15 "${PREVIEW_URL}/api/health"; then
    echo "✅ Smoke test passed. Migrating 100% traffic to latest revision..."
    gcloud run services update-traffic "${SERVICE_NAME}" \
        --project="${PROJECT_ID}" \
        --region="${REGION}" \
        --to-latest
else
    echo "❌ Smoke test failed on preview revision. Rolling back / leaving existing traffic intact."
    exit 1
fi

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --project="${PROJECT_ID}" --region="${REGION}" --format="value(status.url)")
echo ""
echo "🎉 Staging deployment succeeded!"
echo "Service URL: ${SERVICE_URL}"
echo "Healthcheck: ${SERVICE_URL}/api/health"
