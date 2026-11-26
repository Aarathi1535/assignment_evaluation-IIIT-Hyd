#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Staging Deployment Script: Google Cloud Run (Draft / Reference Template)
# ==============================================================================
# NOTE: Review comments on PR #355:
# - Do not use made-up project IDs; require GCP_PROJECT_ID explicitly.
# - Exit non-zero on auth/access errors (never exit 0 on missing auth).
# - Use Artifact Registry instead of deprecated gcr.io.
# - Deploy with --no-traffic preview first.
# - Look up the preview URL for TAG_NAME specifically.
# - Include identity token with curl if the service is private.
# - Shift traffic to the exact verified revision rather than --to-latest.
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
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/assignment-evaluator/app:staging-latest"

echo "=== IIIT Hyd Assignment Evaluation Platform: Staging Deploy ==="
echo "Target Project: ${PROJECT_ID}"
echo "Target Region:  ${REGION}"
echo "Target Service: ${SERVICE_NAME}"
echo "Image Tag:      ${IMAGE_TAG}"
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

# Look up the preview URL specifically for $TAG_NAME
PREVIEW_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.traffic.filter(tag=${TAG_NAME}).url)")

# Look up the specific revision name deployed with $TAG_NAME
REVISION_NAME=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.traffic.filter(tag=${TAG_NAME}).revisionName)")

echo "Preview Revision: ${REVISION_NAME}"
echo "Preview URL:      ${PREVIEW_URL}"

# Obtain identity token in case Cloud Run service is private
ID_TOKEN=$(gcloud auth print-identity-token 2>/dev/null || echo "")
AUTH_HEADER=()
if [[ -n "${ID_TOKEN}" ]]; then
    AUTH_HEADER=(-H "Authorization: Bearer ${ID_TOKEN}")
fi

echo "Running smoke test on preview revision URL: ${PREVIEW_URL}/api/health..."
if curl -sf --max-time 15 "${AUTH_HEADER[@]}" "${PREVIEW_URL}/api/health"; then
    echo "✅ Smoke test passed. Migrating 100% traffic to verified revision ${REVISION_NAME}..."
    gcloud run services update-traffic "${SERVICE_NAME}" \
        --project="${PROJECT_ID}" \
        --region="${REGION}" \
        --to-revisions="${REVISION_NAME}=100"
else
    echo "❌ Smoke test failed on preview revision. Leaving existing traffic intact."
    exit 1
fi

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --project="${PROJECT_ID}" --region="${REGION}" --format="value(status.url)")
echo ""
echo "🎉 Staging deployment succeeded!"
echo "Service URL: ${SERVICE_URL}"
echo "Healthcheck: ${SERVICE_URL}/api/health"
