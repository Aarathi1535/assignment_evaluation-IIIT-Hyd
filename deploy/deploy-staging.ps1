# ==============================================================================
# Staging Deployment Script: Google Cloud Run (PowerShell)
# ==============================================================================
param (
    [string]$ProjectId = $env:GCP_PROJECT_ID,
    [string]$Region = $env:GCP_REGION,
    [string]$ServiceName = "assignment-evaluator-staging",
    [string]$ManifestPath = "deploy/cloudrun-service.yaml"
)

$ErrorActionPreference = "Stop"

if (-not $ProjectId) { $ProjectId = "iiit-hyd-assignment-eval" }
if (-not $Region) { $Region = "asia-south1" }
$ImageTag = "gcr.io/$ProjectId/assignment-evaluator:staging-latest"

Write-Host "=== IIIT Hyd Assignment Evaluation Platform: Staging Deploy ===" -ForegroundColor Cyan
Write-Host "Target Project: $ProjectId"
Write-Host "Target Region:  $Region"
Write-Host "Target Service: $ServiceName"
Write-Host ""

# Pre-flight Check 1: Verify gcloud CLI is available
$gcloudCmd = Get-Command gcloud -ErrorAction SilentlyContinue
if (-not $gcloudCmd) {
    Write-Host "❌ ERROR: 'gcloud' CLI is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install the Google Cloud SDK before running this deployment script."
    exit 1
}

# Pre-flight Check 2: Verify active authenticated session
Write-Host "Checking Google Cloud authentication status..."
try {
    $authCheck = & gcloud auth print-access-token 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "No active credentials"
    }
}
catch {
    Write-Host "⚠️  AUTHENTICATION REQUIRED:" -ForegroundColor Yellow
    Write-Host "No active Google Cloud credentials detected."
    Write-Host "Run 'gcloud auth login' or configure GOOGLE_APPLICATION_CREDENTIALS before deploying."
    Write-Host "Skipping live deployment (strict non-fabrication policy)."
    exit 0
}

# Pre-flight Check 3: Check project access
Write-Host "Verifying project access for '$ProjectId'..."
try {
    $projectCheck = & gcloud projects describe $ProjectId 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Project inaccessible"
    }
}
catch {
    Write-Host "⚠️  PROJECT ACCESS REQUIRED:" -ForegroundColor Yellow
    Write-Host "Authenticated principal does not have access to project '$ProjectId'."
    Write-Host "Ensure your service account or user has roles/run.admin and roles/iam.serviceAccountUser."
    Write-Host "Skipping live deployment (strict non-fabrication policy)."
    exit 0
}

Write-Host "✅ Authenticated. Building and submitting container image via Cloud Build..." -ForegroundColor Green
& gcloud builds submit --project="$ProjectId" --tag="$ImageTag" .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Deploying Cloud Run service from manifest '$ManifestPath'..."
& gcloud run services replace "$ManifestPath" --project="$ProjectId" --region="$Region"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Configuring public/unauthenticated access for staging URL..."
& gcloud run services add-iam-policy-binding $ServiceName `
    --project="$ProjectId" `
    --region="$Region" `
    --member="allUsers" `
    --role="roles/run.invoker"

$ServiceUrl = (& gcloud run services describe $ServiceName --project="$ProjectId" --region="$Region" --format="value(status.url)").Trim()
Write-Host ""
Write-Host "🎉 Staging deployment succeeded!" -ForegroundColor Green
Write-Host "Service URL: $ServiceUrl"
Write-Host "Healthcheck: $ServiceUrl/api/health"
