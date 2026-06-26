<#
.SYNOPSIS
    Downloads the SOURCE master file of each delivery film from Vimeo via the
    Vimeo API, then runs the existing HLS transcode + R2 upload pipeline so the
    couple's delivery page serves Vidstack HLS (not a Vimeo embed).

.DESCRIPTION
    Vimeo is treated as an INGEST source here, not a player. For each
    (videoId, vimeoId) pair this script:
      1. Calls https://api.vimeo.com/videos/{id}?fields=download,name with
         bearer auth.
      2. Reads the response 'download' array and picks the SOURCE rendition
         (quality 'source', else the largest entry by size, else by width).
      3. Downloads that rendition to InputDir/{videoId}.mp4.
      4. (Unless -SkipTranscode) chains to the EXISTING transcode.ps1 (NVENC
         source-resolution-aware HLS ladder: 4K + 1080p, or 1080p only, no 720p)
         and then upload.ps1 (rclone sync HLS + originals + thumbs to R2).

    The 'download' array is only populated when the bearer token OWNS the video
    and the token has the video_files scope. The Flyin Iris delivery films live
    on the Flyin Iris Vimeo account, so the account token can pull sources. If a
    video's download array is missing or empty, that item fails with a clear
    message (download not enabled on the video, or token lacks video_files scope).

    DISK SPACE: 4K wedding sources can be MULTI-GIGABYTE each. Point -InputDir at
    a drive with room for every source in the batch (a full wedding catalog can
    run tens of GB).

    ===================================================================
    WHERE THIS RUNS (the seam)
    -------------------------------------------------------------------
    This is a LOCAL operator script. It runs on the Alienware (NVENC GPU
    transcode + multi-GB downloads). A Cloudflare Worker CANNOT drive this:
    Workers have no GPU, no ffmpeg, and no local disk for multi-GB masters.

    Pipeline position:
      Vimeo (source files)
        -> [this script, local]  download + transcode.ps1 + upload.ps1
          -> R2 (HLS + originals + thumbs at couples/<slug>/...)
            -> operator attaches the video list in Studio
              -> Studio writes the load-time D1 delivery config
                -> the delivery page fetches that config at load and renders HLS
    The page never reads Vimeo directly. Once HLS is in R2 and the Studio video
    list is attached, the couple-page.html load-time fetch picks it up with no
    page regeneration or redeploy.
    ===================================================================

.PARAMETER Slug
    Couple slug. Used for the upload R2 path (couples/<Slug>/...) and to locate
    the default config at delivery/live/<Slug>.json in -VideoIdMap mode.

.PARAMETER VideoIdMap
    Inline hashtable. Keys are videoIds (the local id used in the config and in
    R2 paths). Values are Vimeo references: a bare numeric id, or a full Vimeo
    URL (a trailing /hash path segment or ?h=hash query is captured for unlisted
    videos and passed through as id:hash on the API call).

    Example:
      -VideoIdMap @{
          "teaser"    = "1143294125"
          "highlight" = "https://vimeo.com/1189867481/ab12cd34ef"
          "ceremony"  = "https://player.vimeo.com/video/1191346579?h=99887766"
      }

.PARAMETER ConfigFile
    Path to a delivery/live/<slug>.json config. Each videos[] entry must carry a
    "vimeoId" field; entries without it are skipped with a warning. This same
    file is passed to transcode.ps1 (which writes measured durations back into
    it). The script reads 'slug' from the config when present.

.PARAMETER VimeoToken
    Vimeo API bearer token. Defaults to the VIMEO_TOKEN environment variable.
    NEVER printed, echoed, or logged by this script.

.PARAMETER InputDir
    Temp directory for the downloaded source MP4s. Defaults to a per-slug temp
    path. This directory is also handed to upload.ps1 as the originals dir.

.PARAMETER OutputDir
    HLS output directory for transcode.ps1 / upload.ps1. Default: ./output.

.PARAMETER SkipTranscode
    Download the Vimeo sources only. Skips transcode.ps1 and upload.ps1. Useful
    to stage sources, inspect them, or run the transcode by hand later.

.EXAMPLE
    # Inline map mode, full pipeline
    .\vimeo-ingest.ps1 `
        -Slug "rachel-michael-street" `
        -ConfigFile "delivery\live\rachel-michael-street.json" `
        -VideoIdMap @{
            "teaser"    = "1143294125"
            "highlight" = "1189867481"
            "ceremony"  = "1191346579"
        }

.EXAMPLE
    # Config-driven mode (vimeoId per videos[] entry), full pipeline
    .\vimeo-ingest.ps1 -ConfigFile "delivery\live\rachel-michael-street.json"

.EXAMPLE
    # Download sources only, no transcode / upload
    .\vimeo-ingest.ps1 -Slug "rachel-michael-street" -VideoIdMap @{ "teaser" = "1143294125" } -SkipTranscode
#>

[CmdletBinding(DefaultParameterSetName = "Map")]
param(
    [Parameter(Mandatory=$true, ParameterSetName="Map")]
    [string]$Slug,

    [Parameter(Mandatory=$true, ParameterSetName="Map")]
    [hashtable]$VideoIdMap,

    [Parameter(ParameterSetName="Map")]
    [Parameter(Mandatory=$true, ParameterSetName="Config")]
    [string]$ConfigFile,

    [string]$VimeoToken = $env:VIMEO_TOKEN,

    [string]$InputDir,

    [string]$OutputDir = "./output",

    [switch]$SkipTranscode
)

$ErrorActionPreference = "Stop"

if (-not $VimeoToken) {
    throw "VIMEO_TOKEN environment variable not set. Run: setx VIMEO_TOKEN <token> and open a new terminal."
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

    if ($config.slug) { $Slug = [string]$config.slug }
    if (-not $Slug) {
        Write-Error "ERROR: Config is missing 'slug' field and no -Slug was given."
        exit 1
    }

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

# --- Resolve the config file used for transcode (Map mode default) ---
# transcode.ps1 requires a -ConfigFile (it writes measured durations into it and
# matches MP4 basenames to videos[].id). In Config mode we already have it. In
# Map mode, default to delivery/live/<Slug>.json when transcoding.
$scriptDir = $PSScriptRoot
$transcodeConfig = $ConfigFile
if (-not $transcodeConfig) {
    $transcodeConfig = Join-Path $scriptDir "..\live\$Slug.json"
}

if (-not $SkipTranscode) {
    if (-not (Test-Path $transcodeConfig -PathType Leaf)) {
        Write-Error "ERROR: transcode needs a config file. Expected: $transcodeConfig. Pass -ConfigFile, or use -SkipTranscode to download only."
        exit 1
    }
}

# --- Resolve InputDir (temp download dir) ---
if (-not $InputDir) {
    $InputDir = Join-Path ([System.IO.Path]::GetTempPath()) "fi-vimeo-ingest-$Slug"
}
New-Item -ItemType Directory -Path $InputDir -Force | Out-Null

# --- Parse a Vimeo reference (bare id or URL) into id + optional unlisted hash ---
# Accepts:
#   1143294125
#   https://vimeo.com/1143294125
#   https://vimeo.com/1143294125/ab12cd34ef          (path-form unlisted hash)
#   https://vimeo.com/1143294125?h=ab12cd34ef          (query-form unlisted hash)
#   https://player.vimeo.com/video/1143294125?h=ab12cd34ef
function Get-VimeoRef([string]$ref) {
    $id = $null
    $hash = $null

    # First run of digits is the numeric video id.
    $idMatch = [regex]::Match($ref, '(\d{6,})')
    if ($idMatch.Success) { $id = $idMatch.Groups[1].Value }

    # Unlisted hash: query form ?h=xxxx wins, else the path segment after the id.
    $qMatch = [regex]::Match($ref, '[?&]h=([0-9a-zA-Z]+)')
    if ($qMatch.Success) {
        $hash = $qMatch.Groups[1].Value
    } elseif ($id) {
        $pMatch = [regex]::Match($ref, ('{0}/([0-9a-zA-Z]+)' -f $id))
        if ($pMatch.Success) { $hash = $pMatch.Groups[1].Value }
    }

    return @{ Id = $id; Hash = $hash }
}

# --- Summary ---
Write-Host ""
Write-Host "=== Flyin' Iris Vimeo Source Ingest ===" -ForegroundColor Cyan
Write-Host "Slug:      $Slug"
Write-Host "Download:  $InputDir"
Write-Host "Output:    $OutputDir"
Write-Host "Pairs:     $($VideoIdMap.Count)"
if ($SkipTranscode) { Write-Host "Mode:      download only (-SkipTranscode)" -ForegroundColor DarkYellow }
Write-Host "Note:      4K sources can be multi-GB. Ensure $InputDir has disk space." -ForegroundColor DarkYellow
Write-Host ""

# --- Per-video download ---
# Bearer header is built from the token variable and never written to output.
$headers = @{ Authorization = "bearer $VimeoToken" }

$failCount = 0
$counter = 0
$total = $VideoIdMap.Count

foreach ($entry in $VideoIdMap.GetEnumerator() | Sort-Object Key) {
    $counter++
    $videoId = $entry.Key
    $ref = Get-VimeoRef ([string]$entry.Value)
    $vimeoId = $ref.Id

    if (-not $vimeoId) {
        Write-Host "[$counter/$total] $videoId FAILED (could not parse a Vimeo id from '$($entry.Value)')" -ForegroundColor Red
        $failCount++
        continue
    }

    # Owned-video API calls use id + token. The unlisted hash is appended as
    # id:hash when present, so nothing breaks if films are switched to unlisted.
    $apiSeg = if ($ref.Hash) { "${vimeoId}:$($ref.Hash)" } else { $vimeoId }
    Write-Host "[$counter/$total] $videoId (vimeo $vimeoId)..." -ForegroundColor Yellow -NoNewline

    # 1. Fetch download metadata
    try {
        $videoMeta = Invoke-RestMethod -Uri "https://api.vimeo.com/videos/$apiSeg?fields=download,name" -Headers $headers -ErrorAction Stop
    } catch {
        Write-Host " FAILED (API call: $($_.Exception.Message))" -ForegroundColor Red
        $failCount++
        continue
    }

    # 2. Validate the download array (requires ownership + video_files scope)
    if (-not $videoMeta.download -or $videoMeta.download.Count -eq 0) {
        Write-Host " FAILED (no 'download' renditions: download not enabled on this video, or token lacks the video_files scope / does not own it)" -ForegroundColor Red
        $failCount++
        continue
    }

    # 3. Pick the SOURCE rendition: quality 'source' first, else largest by size,
    #    else widest by width.
    $chosen = $videoMeta.download | Where-Object { $_.quality -eq 'source' } | Select-Object -First 1
    if (-not $chosen) {
        $chosen = $videoMeta.download | Sort-Object { [long]($_.size) } -Descending | Select-Object -First 1
    }
    if (-not $chosen) {
        $chosen = $videoMeta.download | Sort-Object { [int]($_.width) } -Descending | Select-Object -First 1
    }
    if (-not $chosen -or -not $chosen.link) {
        Write-Host " FAILED (no usable download rendition with a link)" -ForegroundColor Red
        $failCount++
        continue
    }

    # 4. Download the chosen rendition to InputDir/{videoId}.mp4
    $destPath = Join-Path $InputDir "$videoId.mp4"
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $chosen.link -OutFile $destPath -ErrorAction Stop | Out-Null
        $ProgressPreference = 'Continue'
    } catch {
        Write-Host " FAILED (download: $($_.Exception.Message))" -ForegroundColor Red
        $failCount++
        continue
    }

    $sizeMb = [math]::Round((Get-Item $destPath).Length / 1MB, 1)
    $qualityLabel = if ($chosen.quality) { $chosen.quality } else { "unknown" }
    $dims = if ($chosen.width) { "$($chosen.width)x$($chosen.height), " } else { "" }
    Write-Host " done ($qualityLabel, $dims$sizeMb MB)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Download Complete ===" -ForegroundColor Cyan
Write-Host "Downloaded: $($counter - $failCount) of $counter source(s)"
if ($failCount -gt 0) {
    Write-Host "Failed:     $failCount source(s)" -ForegroundColor Red
}
Write-Host "Sources:    $InputDir"
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "One or more downloads failed. Fix those before transcoding." -ForegroundColor Red
    exit 1
}

if ($SkipTranscode) {
    Write-Host "Skipping transcode + upload (-SkipTranscode). Sources staged in $InputDir." -ForegroundColor DarkYellow
    exit 0
}

# --- Chain to the existing transcode + upload pipeline ---
# Reuses transcode.ps1 (NVENC HLS ladder, unchanged) then upload.ps1 (rclone to
# R2). InputDir doubles as upload.ps1's -OriginalDir so the source MP4s land in
# couples/<slug>/originals for the password-gated downloads.
$transcodeScript = Join-Path $scriptDir "transcode.ps1"
$uploadScript = Join-Path $scriptDir "upload.ps1"

Write-Host "=== Transcoding (transcode.ps1) ===" -ForegroundColor Cyan
& $transcodeScript -InputDir $InputDir -ConfigFile $transcodeConfig -OutputDir $OutputDir
if ($LASTEXITCODE -ne 0) {
    Write-Error "ERROR: transcode.ps1 exited $LASTEXITCODE. Stopping before upload."
    exit 1
}

Write-Host "=== Uploading to R2 (upload.ps1) ===" -ForegroundColor Cyan
& $uploadScript -CoupleSlug $Slug -OutputDir $OutputDir -OriginalDir $InputDir
if ($LASTEXITCODE -ne 0) {
    Write-Error "ERROR: upload.ps1 exited $LASTEXITCODE."
    exit 1
}

Write-Host ""
Write-Host "=== Ingest Complete ===" -ForegroundColor Cyan
Write-Host "HLS for '$Slug' is in R2. Next: attach the video list in Studio, which"
Write-Host "writes the load-time delivery config the couple page reads."
Write-Host ""
