<#
.SYNOPSIS
    Pulls Sierra-curated thumbnails from Vimeo's pictures.sizes API and uploads
    them to R2 at the canonical per-couple-delivery path.

.DESCRIPTION
    For each (videoId, vimeoId) pair, this script:
      1. Calls https://api.vimeo.com/videos/{vimeoId} with bearer auth.
      2. Reads response.pictures.sizes and picks the largest variant by width.
      3. Downloads the variant URL to a temp file.
      4. rclone-copies the file to r2fi:fi-films/couples/<slug>/thumbs/<videoId>.jpg.

    Sierra hand-uploads custom thumbnails to Vimeo per video. Those are the
    images returned by the API, not algorithmic auto-thumbs. Using this script
    keeps per-couple delivery pages aligned to her curated picks.

    Two operational modes:
      -VideoIdMap   inline hashtable of videoId -> vimeoId (good for one-offs).
      -ConfigFile   read videos[].vimeoId from a delivery/live/<slug>.json
                    file (good for the canonical flow once configs carry the
                    field; this is a forward-compat schema change pending
                    spec rollup, see Section 7.3 of delivery-page-standard.md).

    rclone remote must be configured as "r2fi" (Cloudflare R2 with Object
    Read + Write on the fi-films bucket). See delivery/README.md Step 3 of
    initial setup.

.PARAMETER Slug
    Couple slug. Used in the R2 path (couples/<Slug>/thumbs/).

.PARAMETER VideoIdMap
    Inline hashtable. Keys are videoIds (the local id used in the config and
    in R2 paths). Values are Vimeo numeric IDs.

    Example:
      -VideoIdMap @{
          "teaser" = "1143294125"
          "highlight" = "1189867481"
          "ceremony" = "1191346579"
      }

.PARAMETER ConfigFile
    Path to a delivery/live/<slug>.json config. Each videos[] entry must
    carry a "vimeoId" field. Entries without vimeoId are skipped with a
    warning. The script does not modify the config.

.PARAMETER VimeoToken
    Vimeo API bearer token. Defaults to the VIMEO_TOKEN environment variable.

.EXAMPLE
    # Inline map mode (one-off catalog)
    .\pull-vimeo-thumbs.ps1 `
        -Slug "rachel-michael-street" `
        -VideoIdMap @{
            "teaser"                  = "1143294125"
            "highlight"               = "1189867481"
            "story-session"           = "1137314276"
            "story-session-interview" = "1191346992"
            "first-look-dad"          = "1191346657"
            "ceremony"                = "1191346579"
            "grand-march"             = "1191346787"
            "speeches"                = "1191346935"
            "special-dances"          = "1191346897"
            "gopro"                   = "1191346713"
        }

.EXAMPLE
    # Config-driven mode (canonical flow once vimeoId is in the schema)
    .\pull-vimeo-thumbs.ps1 -ConfigFile "delivery\live\rachel-michael-street.json"
#>

[CmdletBinding(DefaultParameterSetName = "Map")]
param(
    [Parameter(Mandatory=$true, ParameterSetName="Map")]
    [string]$Slug,

    [Parameter(Mandatory=$true, ParameterSetName="Map")]
    [hashtable]$VideoIdMap,

    [Parameter(Mandatory=$true, ParameterSetName="Config")]
    [string]$ConfigFile,

    [string]$VimeoToken = $env:VIMEO_TOKEN
)

$ErrorActionPreference = "Stop"

if (-not $VimeoToken) { throw "VIMEO_TOKEN environment variable not set. Run: setx VIMEO_TOKEN <token> and open a new terminal." }

# --- Preflight checks ---

if (-not (Get-Command "rclone" -ErrorAction SilentlyContinue)) {
    Write-Error "ERROR: rclone not found in PATH. Install rclone and configure 'r2fi' remote (see delivery/README.md)."
    exit 1
}

# --- Resolve slug + video map ---

if ($PSCmdlet.ParameterSetName -eq "Config") {
    if (-not (Test-Path $ConfigFile -PathType Leaf)) {
        Write-Error "ERROR: Config file not found: $ConfigFile"
        exit 1
    }

    try {
        $configRaw = Get-Content -Path $ConfigFile -Raw -Encoding UTF8
        $config = $configRaw | ConvertFrom-Json
    } catch {
        Write-Error "ERROR: Failed to parse config JSON: $_"
        exit 1
    }

    if (-not $config.slug) {
        Write-Error "ERROR: Config is missing 'slug' field."
        exit 1
    }

    $Slug = $config.slug
    $VideoIdMap = @{}

    foreach ($v in $config.videos) {
        if ($v.vimeoId) {
            $VideoIdMap[[string]$v.id] = [string]$v.vimeoId
        } else {
            Write-Host "  (skipping $($v.id): no vimeoId in config)" -ForegroundColor DarkYellow
        }
    }

    if ($VideoIdMap.Count -eq 0) {
        Write-Error "ERROR: No videos in $ConfigFile carry a 'vimeoId' field. Either add vimeoId per entry or use -VideoIdMap inline."
        exit 1
    }
}

# --- Summary ---

Write-Host ""
Write-Host "=== Flyin' Iris Vimeo Thumbnail Pull ===" -ForegroundColor Cyan
Write-Host "Slug:   $Slug"
Write-Host "Target: r2fi:fi-films/couples/$Slug/thumbs/"
Write-Host "Pairs:  $($VideoIdMap.Count)"
Write-Host ""

# --- Per-video pull ---

$headers = @{ Authorization = "bearer $VimeoToken" }
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "fi-vimeo-thumbs-$Slug"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

$failCount = 0
$counter = 0
$total = $VideoIdMap.Count

foreach ($entry in $VideoIdMap.GetEnumerator() | Sort-Object Key) {
    $counter++
    $videoId = $entry.Key
    $vimeoId = $entry.Value

    Write-Host "[$counter/$total] $videoId (vimeo $vimeoId)..." -ForegroundColor Yellow -NoNewline

    # 1. Fetch metadata from Vimeo
    try {
        $videoMeta = Invoke-RestMethod -Uri "https://api.vimeo.com/videos/$vimeoId" -Headers $headers -ErrorAction Stop
    } catch {
        Write-Host " FAILED (API call: $($_.Exception.Message))" -ForegroundColor Red
        $failCount++
        continue
    }

    # 2. Pick the largest size
    if (-not $videoMeta.pictures -or -not $videoMeta.pictures.sizes) {
        Write-Host " FAILED (no pictures.sizes in API response)" -ForegroundColor Red
        $failCount++
        continue
    }

    $largest = $videoMeta.pictures.sizes | Sort-Object width -Descending | Select-Object -First 1
    if (-not $largest -or -not $largest.link) {
        Write-Host " FAILED (no usable size variant)" -ForegroundColor Red
        $failCount++
        continue
    }

    # 3. Download to temp
    $tempPath = Join-Path $tempDir "$videoId.jpg"
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $largest.link -OutFile $tempPath -ErrorAction Stop | Out-Null
        $ProgressPreference = 'Continue'
    } catch {
        Write-Host " FAILED (download: $($_.Exception.Message))" -ForegroundColor Red
        $failCount++
        continue
    }

    $sizeKb = [math]::Round((Get-Item $tempPath).Length / 1KB, 1)

    # 4. rclone copy to R2
    $r2Path = "r2fi:fi-films/couples/$Slug/thumbs/"
    & rclone copy $tempPath $r2Path 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host " FAILED (rclone exit $LASTEXITCODE)" -ForegroundColor Red
        $failCount++
        continue
    }

    Write-Host " done ($($largest.width)x$($largest.height), $sizeKb KB)" -ForegroundColor Green
}

# Clean up temp files
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

# --- Summary ---
Write-Host ""
Write-Host "=== Pull Complete ===" -ForegroundColor Cyan
Write-Host "Processed: $counter thumbnail(s)"
if ($failCount -gt 0) {
    Write-Host "Failed:    $failCount thumbnail(s)" -ForegroundColor Red
}
Write-Host "Target:    r2fi:fi-films/couples/$Slug/thumbs/"
Write-Host ""

if ($failCount -gt 0) {
    exit 1
}
