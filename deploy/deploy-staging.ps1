# ==============================================================================
# Staging Deployment Script: Google Cloud Run (PowerShell - Draft / Reference)
# ==============================================================================
# NOTE: Review comments on PR #355:
# - Do not use made-up project IDs; require GCP_PROJECT_ID explicitly.
# - Exit non-zero on auth/access errors (never exit 0 on missing auth).
# - Deploy with --no-traffic preview first, run health smoke test, then shift traffic.
# - Do not grant allUsers invoker on every run.
# ==============================================================================
param (
    [string]$ProjectId = $env:GCP_PROJECT_ID,
    [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "asia-south1" }),
    [string]$ServiceName = "assignment-evaluator-staging"
)

$ErrorActionPreference = "Stop"

if (-not $ProjectId) {
    Write-Host "❌ ERROR: GCP_PROJECT_ID is required. Pass -ProjectId or set `$env:GCP_PROJECT_ID." -ForegroundColor Red
    exit 1
}

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
    exit 1
}

# Pre-flight Check 2: Verify active authenticated session (exit 1 if unauthenticated)
Write-Host "Checking Google Cloud authentication status..."
try {
    $null = & gcloud auth print-access-token 2>&1
    if ($LASTEXITCODE -ne 0) { throw "No active credentials" }
}
catch {
    Write-Host "❌ ERROR: No active Google Cloud credentials detected." -ForegroundColor Red
    Write-Host "Run 'gcloud auth login' or configure GOOGLE_APPLICATION_CREDENTIALS before deploying."
    exit 1
}

# Pre-flight Check 3: Check project access (exit 1 if inaccessible)
Write-Host "Verifying project access for '$ProjectId'..."
try {
    $null = & gcloud projects describe $ProjectId 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Project inaccessible" }
}
catch {
    Write-Host "❌ ERROR: Authenticated principal does not have access to project '$ProjectId'." -ForegroundColor Red
    exit 1
}

Write-Host "Building and submitting container image via Cloud Build..." -ForegroundColor Green
& gcloud builds submit --project="$ProjectId" --tag="$ImageTag" .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Deploying new revision with --no-traffic (Preview Phase)..." -ForegroundColor Yellow
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$tagName = "preview-$timestamp"
& gcloud run deploy $ServiceName `
    --project="$ProjectId" `
    --region="$Region" `
    --image="$ImageTag" `
    --no-traffic `
    --tag="$tagName"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$previewUrl = (& gcloud run services describe $ServiceName --project="$ProjectId" --region="$Region" --format="value(status.traffic[0].url)").Trim()

Write-Host "Running smoke test on preview revision URL: $previewUrl/api/health..."
try {
    $healthCheck = Invoke-RestMethod -Uri "$previewUrl/api/health" -TimeoutSec 15
    if ($healthCheck.success -ne $true -and $healthCheck.status -ne 'healthy') {
        throw "Health probe returned unhealthy payload"
    }
    Write-Host "✅ Smoke test passed. Migrating 100% traffic to latest revision..." -ForegroundColor Green
    & gcloud run services update-traffic $ServiceName --project="$ProjectId" --region="$Region" --to-latest
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
catch {
    Write-Host "❌ Smoke test failed on preview revision. Rolling back / leaving existing traffic intact." -ForegroundColor Red
    exit 1
}

$ServiceUrl = (& gcloud run services describe $ServiceName --project="$ProjectId" --region="$Region" --format="value(status.url)").Trim()
Write-Host ""
Write-Host "🎉 Staging deployment succeeded!" -ForegroundColor Green
Write-Host "Service URL: $ServiceUrl"
Write-Host "Healthcheck: $ServiceUrl/api/health"
