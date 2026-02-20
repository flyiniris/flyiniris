<#
.SYNOPSIS
    Uploads transcoded HLS files, originals, and thumbnails to Cloudflare R2 via rclone.

.DESCRIPTION
    Syncs the HLS output directory, source MP4 originals, and generated thumbnails
    to the Flyin' Iris R2 bucket using rclone (pre-configured remote: r2fi).

.PARAMETER CoupleSlug
    The couple's URL slug (e.g., "amanda-boris").

.PARAMETER OutputDir
    The HLS output directory from transcode.ps1.

.PARAMETER OriginalDir
    The directory containing original source MP4 files.

.EXAMPLE
    .\upload.ps1 -CoupleSlug "amanda-boris" -OutputDir ".\output" -OriginalDir "C:\Videos\amanda-boris"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$CoupleSlug,

    [Parameter(Mandatory=$true)]
    [string]$OutputDir,

    [Parameter(Mandatory=$true)]
    [string]$OriginalDir
)

$ErrorActionPreference = "Stop"

# --- Preflight checks ---

if (-not (Get-Command "rclone" -ErrorAction SilentlyContinue)) {
    Write-Error "ERROR: rclone not found in PATH. Install rclone and configure the r2fi remote."
    exit 1
}

if (-not (Test-Path $OutputDir -PathType Container)) {
    Write-Error "ERROR: Output directory not found: $OutputDir"
    exit 1
}

if (-not (Test-Path $OriginalDir -PathType Container)) {
    Write-Error "ERROR: Original directory not found: $OriginalDir"
    exit 1
}

# Resolve to absolute paths
$OutputDir = (Resolve-Path $OutputDir).Path
$OriginalDir = (Resolve-Path $OriginalDir).Path

$bucket = "r2fi:fi-films"
$baseRemote = "$bucket/couples/$CoupleSlug"

Write-Host ""
Write-Host "=== Flyin' Iris R2 Uploader ===" -ForegroundColor Cyan
Write-Host "Couple:    $CoupleSlug"
Write-Host "HLS:       $OutputDir"
Write-Host "Originals: $OriginalDir"
Write-Host "Remote:    $baseRemote"
Write-Host ""

$hasErrors = $false

# --- Upload HLS (exclude thumbs) ---
Write-Host "[1/3] Uploading HLS files..." -ForegroundColor Yellow
try {
    & rclone sync "$OutputDir" "$baseRemote/hls/" --exclude "thumbs/**" --progress
    if ($LASTEXITCODE -ne 0) { throw "rclone sync HLS failed with exit code $LASTEXITCODE" }
    Write-Host "      HLS upload complete." -ForegroundColor Green
} catch {
    Write-Host "      HLS upload FAILED: $_" -ForegroundColor Red
    $hasErrors = $true
}

# --- Upload originals ---
Write-Host "[2/3] Uploading original MP4s..." -ForegroundColor Yellow
try {
    & rclone sync "$OriginalDir" "$baseRemote/originals/" --progress
    if ($LASTEXITCODE -ne 0) { throw "rclone sync originals failed with exit code $LASTEXITCODE" }
    Write-Host "      Originals upload complete." -ForegroundColor Green
} catch {
    Write-Host "      Originals upload FAILED: $_" -ForegroundColor Red
    $hasErrors = $true
}

# --- Upload thumbnails ---
$thumbsDir = Join-Path $OutputDir "thumbs"
if (Test-Path $thumbsDir -PathType Container) {
    Write-Host "[3/3] Uploading thumbnails..." -ForegroundColor Yellow
    try {
        & rclone sync "$thumbsDir" "$baseRemote/thumbs/" --progress
        if ($LASTEXITCODE -ne 0) { throw "rclone sync thumbs failed with exit code $LASTEXITCODE" }
        Write-Host "      Thumbnails upload complete." -ForegroundColor Green
    } catch {
        Write-Host "      Thumbnails upload FAILED: $_" -ForegroundColor Red
        $hasErrors = $true
    }
} else {
    Write-Host "[3/3] No thumbs directory found, skipping thumbnail upload." -ForegroundColor DarkYellow
}

# --- Verify uploads ---
Write-Host ""
Write-Host "Verifying uploads..." -ForegroundColor Yellow

$verifyFailed = $false

Write-Host "  Checking HLS..."
& rclone check "$OutputDir" "$baseRemote/hls/" --exclude "thumbs/**" 2>&1 | ForEach-Object {
    if ($_ -match "ERROR") { $verifyFailed = $true }
    Write-Host "    $_"
}

Write-Host "  Checking originals..."
& rclone check "$OriginalDir" "$baseRemote/originals/" 2>&1 | ForEach-Object {
    if ($_ -match "ERROR") { $verifyFailed = $true }
    Write-Host "    $_"
}

if (Test-Path $thumbsDir -PathType Container) {
    Write-Host "  Checking thumbnails..."
    & rclone check "$thumbsDir" "$baseRemote/thumbs/" 2>&1 | ForEach-Object {
        if ($_ -match "ERROR") { $verifyFailed = $true }
        Write-Host "    $_"
    }
}

if ($verifyFailed) {
    Write-Host "  Verification found errors." -ForegroundColor Red
    $hasErrors = $true
} else {
    Write-Host "  All files verified." -ForegroundColor Green
}

# --- Summary ---
Write-Host ""
Write-Host "=== Upload Summary ===" -ForegroundColor Cyan

Write-Host "Remote HLS size:"
& rclone size "$baseRemote/hls/" 2>&1 | ForEach-Object { Write-Host "  $_" }

Write-Host "Remote originals size:"
& rclone size "$baseRemote/originals/" 2>&1 | ForEach-Object { Write-Host "  $_" }

Write-Host "Remote thumbnails size:"
& rclone size "$baseRemote/thumbs/" 2>&1 | ForEach-Object { Write-Host "  $_" }

Write-Host ""

if ($hasErrors) {
    Write-Host "Upload completed with errors. Check output above." -ForegroundColor Red
    exit 1
} else {
    Write-Host "All uploads completed successfully." -ForegroundColor Green
}
