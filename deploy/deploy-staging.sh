#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Staging Deployment Script: Google Cloud Run
# ==============================================================================
PROJECT_ID="${GCP_PROJECT_ID:-iiit-hyd-assignment-eval}"
REGION="${GCP_REGION:-asia-south1}"
SERVICE_NAME="assignment-evaluator-staging"
IMAGE_TAG="gcr.io/${PROJECT_ID}/assignment-evaluator:staging-latest"
MANIFEST_PATH="deploy/cloudrun-service.yaml"

echo "=== IIIT Hyd Assignment Evaluation Platform: Staging Deploy ==="
echo "Target Project: ${PROJECT_ID}"
echo "Target Region:  ${REGION}"
echo "Target Service: ${SERVICE_NAME}"
echo ""

# Pre-flight Check 1: Verify gcloud CLI is available
if ! command -v gcloud &> /dev/null; then
    echo "❌ ERROR: 'gcloud' CLI is not installed or not in PATH."
    echo "Please install the Google Cloud SDK before running this deployment script."
    exit 1
fi

# Pre-flight Check 2: Verify active authenticated session
echo "Checking Google Cloud authentication status..."
if ! gcloud auth print-access-token &> /dev/null; then
    echo "⚠️  AUTHENTICATION REQUIRED:"
    echo "No active Google Cloud credentials detected."
    echo "Run 'gcloud auth login' or configure GOOGLE_APPLICATION_CREDENTIALS before deploying."
    echo "Skipping live deployment (strict non-fabrication policy)."
    exit 0
fi

# Pre-flight Check 3: Check project access
echo "Verifying project access for '${PROJECT_ID}'..."
if ! gcloud projects describe "${PROJECT_ID}" &> /dev/null; then
    echo "⚠️  PROJECT ACCESS REQUIRED:"
    echo "Authenticated principal does not have access to project '${PROJECT_ID}'."
    echo "Ensure your service account or user has roles/run.admin and roles/iam.serviceAccountUser."
    echo "Skipping live deployment (strict non-fabrication policy)."
    exit 0
fi

echo "✅ Authenticated. Building and submitting container image via Cloud Build..."
gcloud builds submit --project="${PROJECT_ID}" --tag="${IMAGE_TAG}" .

echo "Deploying Cloud Run service from manifest '${MANIFEST_PATH}'..."
gcloud run services replace "${MANIFEST_PATH}" --project="${PROJECT_ID}" --region="${REGION}"

echo "Configuring public/unauthenticated access for staging URL..."
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --member="allUsers" \
    --role="roles/run.invoker"

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --project="${PROJECT_ID}" --region="${REGION}" --format="value(status.url)")
echo ""
echo "🎉 Staging deployment succeeded!"
echo "Service URL: ${SERVICE_URL}"
echo "Healthcheck: ${SERVICE_URL}/api/health"
