<#
.SYNOPSIS
    Transcodes MP4 video files into multi-bitrate HLS streams for the Flyin' Iris delivery platform.

.DESCRIPTION
    For each MP4 in InputDir, creates 3 HLS quality variants (1080p, 720p, 480p),
    generates a master playlist, extracts a thumbnail, and updates the couple config
    JSON with detected durations.

.PARAMETER InputDir
    Directory containing source MP4 files.

.PARAMETER ConfigFile
    Path to the couple JSON config file.

.PARAMETER OutputDir
    Output directory for HLS files (default: ./output).

.EXAMPLE
    .\transcode.ps1 -InputDir "C:\Videos\amanda-boris" -ConfigFile ".\sample\amanda-boris.json"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$InputDir,

    [Parameter(Mandatory=$true)]
    [string]$ConfigFile,

    [string]$OutputDir = "./output"
)

$ErrorActionPreference = "Stop"

# --- Preflight checks ---

if (-not (Get-Command "ffmpeg" -ErrorAction SilentlyContinue)) {
    Write-Error "ERROR: ffmpeg not found in PATH. Install FFmpeg and ensure it is on your PATH."
    exit 1
}

if (-not (Get-Command "ffprobe" -ErrorAction SilentlyContinue)) {
    Write-Error "ERROR: ffprobe not found in PATH. Install FFmpeg and ensure it is on your PATH."
    exit 1
}

if (-not (Test-Path $InputDir -PathType Container)) {
    Write-Error "ERROR: Input directory not found: $InputDir"
    exit 1
}

if (-not (Test-Path $ConfigFile -PathType Leaf)) {
    Write-Error "ERROR: Config file not found: $ConfigFile"
    exit 1
}

# Resolve to absolute paths
$InputDir = (Resolve-Path $InputDir).Path
$ConfigFile = (Resolve-Path $ConfigFile).Path
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)

# --- Load config JSON ---

try {
    $configRaw = Get-Content -Path $ConfigFile -Raw -Encoding UTF8
    $config = $configRaw | ConvertFrom-Json
} catch {
    Write-Error "ERROR: Failed to parse config JSON: $_"
    exit 1
}

# --- Discover MP4 files ---

$mp4Files = Get-ChildItem -Path $InputDir -Filter "*.mp4" | Sort-Object Name
if ($mp4Files.Count -eq 0) {
    Write-Error "ERROR: No MP4 files found in $InputDir"
    exit 1
}

Write-Host ""
Write-Host "=== Flyin' Iris HLS Transcoder ===" -ForegroundColor Cyan
Write-Host "Input:  $InputDir"
Write-Host "Output: $OutputDir"
Write-Host "Config: $ConfigFile"
Write-Host "Found $($mp4Files.Count) MP4 file(s)"
Write-Host ""

# Create output and thumbs directories
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
New-Item -ItemType Directory -Path "$OutputDir\thumbs" -Force | Out-Null

$failCount = 0
$counter = 0

foreach ($mp4 in $mp4Files) {
    $counter++
    $videoId = [System.IO.Path]::GetFileNameWithoutExtension($mp4.Name)
    $inputPath = $mp4.FullName
    $videoOutDir = Join-Path $OutputDir $videoId

    Write-Host "[$counter/$($mp4Files.Count)] Processing $($mp4.Name)..." -ForegroundColor Yellow -NoNewline

    # --- Probe duration ---
    try {
        $durationSec = & ffprobe -v error -show_entries format=duration -of csv=p=0 "$inputPath" 2>&1
        $durationSec = [double]$durationSec.Trim()
    } catch {
        Write-Host " FAILED (could not probe duration)" -ForegroundColor Red
        $failCount++
        continue
    }

    $totalMinutes = [int][math]::Floor($durationSec / 60)
    $totalSeconds = [int][math]::Floor($durationSec % 60)
    $durationFormatted = "{0}:{1:D2}" -f $totalMinutes, $totalSeconds

    # --- Create output directories ---
    foreach ($quality in @("1080p", "720p", "480p")) {
        New-Item -ItemType Directory -Path (Join-Path $videoOutDir $quality) -Force | Out-Null
    }

    # --- Transcode to HLS (single-pass, 3 qualities) ---
    $segDir1080 = (Join-Path (Join-Path $videoOutDir "1080p") "segment%03d.ts")
    $playlist1080 = (Join-Path (Join-Path $videoOutDir "1080p") "playlist.m3u8")
    $segDir720 = (Join-Path (Join-Path $videoOutDir "720p") "segment%03d.ts")
    $playlist720 = (Join-Path (Join-Path $videoOutDir "720p") "playlist.m3u8")
    $segDir480 = (Join-Path (Join-Path $videoOutDir "480p") "segment%03d.ts")
    $playlist480 = (Join-Path (Join-Path $videoOutDir "480p") "playlist.m3u8")

    $ffmpegLog = Join-Path $videoOutDir "ffmpeg.log"
    $filterComplex = "[0:v]split=3[v1][v2][v3];[v1]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v1out];[v2]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v2out];[v3]scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2[v3out]"

    # Build argument string for Start-Process (handles spaces in paths)
    $ffmpegArgStr = "-nostdin -i `"$inputPath`" -filter_complex `"$filterComplex`" " +
        "-map `"[v1out]`" -map 0:a? " +
        "-c:v:0 libx264 -b:v:0 5000k -c:a:0 aac -b:a:0 128k " +
        "-preset medium -g 48 -keyint_min 48 " +
        "-hls_time 4 -hls_segment_type mpegts " +
        "-hls_segment_filename `"$segDir1080`" " +
        "-hls_playlist_type vod `"$playlist1080`" " +
        "-map `"[v2out]`" -map 0:a? " +
        "-c:v:1 libx264 -b:v:1 2500k -c:a:1 aac -b:a:1 128k " +
        "-preset medium -g 48 -keyint_min 48 " +
        "-hls_time 4 -hls_segment_type mpegts " +
        "-hls_segment_filename `"$segDir720`" " +
        "-hls_playlist_type vod `"$playlist720`" " +
        "-map `"[v3out]`" -map 0:a? " +
        "-c:v:2 libx264 -b:v:2 1000k -c:a:2 aac -b:a:2 128k " +
        "-preset medium -g 48 -keyint_min 48 " +
        "-hls_time 4 -hls_segment_type mpegts " +
        "-hls_segment_filename `"$segDir480`" " +
        "-hls_playlist_type vod `"$playlist480`" " +
        "-y"

    $ffmpegProcess = Start-Process -FilePath "ffmpeg" -ArgumentList $ffmpegArgStr -NoNewWindow -Wait -PassThru -RedirectStandardError $ffmpegLog
    if ($ffmpegProcess.ExitCode -ne 0) {
        Write-Host " FAILED (ffmpeg exit code $($ffmpegProcess.ExitCode))" -ForegroundColor Red
        Write-Host "  Check log: $ffmpegLog" -ForegroundColor DarkGray
        $failCount++
        continue
    }

    # --- Generate master.m3u8 ---
    $masterPlaylist = @"
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5128000,RESOLUTION=1920x1080,NAME="1080p"
1080p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,NAME="720p"
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1128000,RESOLUTION=854x480,NAME="480p"
480p/playlist.m3u8
"@
    $masterPath = Join-Path $videoOutDir "master.m3u8"
    [System.IO.File]::WriteAllText($masterPath, $masterPlaylist, [System.Text.UTF8Encoding]::new($false))

    # --- Generate thumbnail (frame at 25% duration) ---
    $thumbTime = $durationSec * 0.25
    $thumbPath = Join-Path (Join-Path $OutputDir "thumbs") "$videoId.jpg"
    $thumbLog = Join-Path $videoOutDir "thumb.log"
    $thumbArgStr = "-nostdin -ss $thumbTime -i `"$inputPath`" -frames:v 1 " +
        "-vf `"scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2`" " +
        "-q:v 2 `"$thumbPath`" -y"
    $thumbProcess = Start-Process -FilePath "ffmpeg" -ArgumentList $thumbArgStr -NoNewWindow -Wait -PassThru -RedirectStandardError $thumbLog
    if ($thumbProcess.ExitCode -ne 0) {
        Write-Host " (thumbnail failed)" -ForegroundColor DarkYellow -NoNewline
    }

    # --- Update config JSON duration ---
    $found = $false
    for ($i = 0; $i -lt $config.videos.Count; $i++) {
        if ($config.videos[$i].id -eq $videoId) {
            $config.videos[$i].duration = $durationFormatted
            $found = $true
            break
        }
    }

    if (-not $found) {
        Write-Host " (no matching config entry)" -ForegroundColor DarkYellow -NoNewline
    }

    Write-Host " done ($durationFormatted)" -ForegroundColor Green

    # Clean up log files on success
    Remove-Item -Path $ffmpegLog -ErrorAction SilentlyContinue
    Remove-Item -Path $thumbLog -ErrorAction SilentlyContinue
}

# --- Write updated config JSON ---
$updatedJson = $config | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($ConfigFile, $updatedJson, [System.Text.UTF8Encoding]::new($false))

# --- Summary ---
Write-Host ""
Write-Host "=== Transcode Complete ===" -ForegroundColor Cyan
Write-Host "Processed: $counter video(s)"
if ($failCount -gt 0) {
    Write-Host "Failed:    $failCount video(s)" -ForegroundColor Red
}
Write-Host "Output:    $OutputDir"
Write-Host "Config updated: $ConfigFile"
Write-Host ""

if ($failCount -gt 0) {
    exit 1
}
