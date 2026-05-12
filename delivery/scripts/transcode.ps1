<#
.SYNOPSIS
    Transcodes MP4 video files into source-resolution-aware HLS streams for the
    Flyin' Iris delivery platform.

.DESCRIPTION
    For each MP4 in InputDir, probes the source resolution and creates an HLS
    ladder that matches the source (no upscaling, no useless duplicate streams).

      4K source (>= 3840 wide)         -> 4k/ + 1080p/ ladder (2 rungs)
      Sub-4K source (1080p, 2K, etc.)  -> 1080p/ only (1 rung, scaled to fit if needed)
      Sub-1080p source (rare)          -> 1080p/ only, source-res passthrough (no upscale)

    Encoder is NVIDIA NVENC (h264_nvenc -preset p7 -cq 18 top rung, -cq 20 1080p rung)
    so this script requires an NVIDIA GPU. Audio is AAC 192k for the top rung,
    128k for the 1080p downscale rung.

    Each video gets a master.m3u8 with the actual variants present, plus a
    fallback thumbnail extracted at 25 percent of duration via ffmpeg. The
    canonical per-couple thumbnail flow is Sierra-curated via Vimeo's
    pictures.sizes API (see delivery/scripts/pull-vimeo-thumbs.ps1); the
    ffmpeg-extracted thumb here exists for local-MP4 cases where Vimeo
    has no curated thumb yet.

    The config JSON is updated in place with measured durations.

.PARAMETER InputDir
    Directory containing source MP4 files.

.PARAMETER ConfigFile
    Path to the couple JSON config file.

.PARAMETER OutputDir
    Output directory for HLS files (default: ./output).

.EXAMPLE
    .\transcode.ps1 -InputDir "C:\Videos\rachel-michael-street" -ConfigFile ".\delivery\live\rachel-michael-street.json"
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
Write-Host "=== Flyin' Iris HLS Transcoder (NVENC, source-resolution-aware) ===" -ForegroundColor Cyan
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

    Write-Host "[$counter/$($mp4Files.Count)] Processing $($mp4.Name)..." -ForegroundColor Yellow

    # --- Probe duration + resolution ---
    try {
        $durationSec = & ffprobe -v error -show_entries format=duration -of csv=p=0 "$inputPath" 2>&1
        $durationSec = [double]$durationSec.Trim()
    } catch {
        Write-Host "  FAILED (could not probe duration)" -ForegroundColor Red
        $failCount++
        continue
    }

    $totalMinutes = [int][math]::Floor($durationSec / 60)
    $totalSeconds = [int][math]::Floor($durationSec % 60)
    $durationFormatted = "{0}:{1:D2}" -f $totalMinutes, $totalSeconds

    try {
        $probeJson = & ffprobe -v quiet -print_format json -show_streams "$inputPath" 2>&1
        $probeData = $probeJson | ConvertFrom-Json
        $videoStream = $probeData.streams | Where-Object { $_.codec_type -eq "video" } | Select-Object -First 1
        $srcWidth = [int]$videoStream.width
        $srcHeight = [int]$videoStream.height
    } catch {
        Write-Host "  FAILED (could not probe resolution)" -ForegroundColor Red
        $failCount++
        continue
    }

    Write-Host "  Source: ${srcWidth}x${srcHeight}, $durationFormatted"

    # --- Branch on source resolution ---
    $ffmpegLog = Join-Path $videoOutDir "ffmpeg.log"
    New-Item -ItemType Directory -Path $videoOutDir -Force | Out-Null

    if ($srcWidth -ge 3840) {
        # 4K source: 4K + 1080p ladder
        Write-Host "  Ladder: 4K + 1080p (NVENC h264_nvenc, preset p7)" -ForegroundColor DarkGray

        New-Item -ItemType Directory -Path (Join-Path $videoOutDir "4k") -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $videoOutDir "1080p") -Force | Out-Null

        $seg4k = Join-Path $videoOutDir "4k\segment_%03d.ts"
        $play4k = Join-Path $videoOutDir "4k\playlist.m3u8"
        $seg1080 = Join-Path $videoOutDir "1080p\segment_%03d.ts"
        $play1080 = Join-Path $videoOutDir "1080p\playlist.m3u8"

        $ffmpegArgStr = "-nostdin -y -i `"$inputPath`" " +
            "-filter_complex `"[0:v]split=2[v4k][v1080];[v4k]copy[v4kout];[v1080]scale=1920:1080:flags=lanczos[v1080out]`" " +
            "-map `"[v4kout]`" -map 0:a? -c:v h264_nvenc -preset p7 -cq 18 -pix_fmt yuv420p -c:a aac -b:a 192k " +
            "-hls_time 6 -hls_playlist_type vod " +
            "-hls_segment_filename `"$seg4k`" `"$play4k`" " +
            "-map `"[v1080out]`" -map 0:a? -c:v h264_nvenc -preset p7 -cq 20 -pix_fmt yuv420p -c:a aac -b:a 128k " +
            "-hls_time 6 -hls_playlist_type vod " +
            "-hls_segment_filename `"$seg1080`" `"$play1080`""

        $ffmpegProcess = Start-Process -FilePath "ffmpeg" -ArgumentList $ffmpegArgStr -NoNewWindow -Wait -PassThru -RedirectStandardError $ffmpegLog
        if ($ffmpegProcess.ExitCode -ne 0) {
            Write-Host "  FAILED (ffmpeg exit code $($ffmpegProcess.ExitCode))" -ForegroundColor Red
            Write-Host "  Check log: $ffmpegLog" -ForegroundColor DarkGray
            $failCount++
            continue
        }

        $masterPlaylist = @"
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=${srcWidth}x${srcHeight},NAME="4K"
4k/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="1080p"
1080p/playlist.m3u8
"@
    } elseif ($srcWidth -ge 1920) {
        # 1080p (or near-1080p / 2K) source: 1080p only ladder, single rung
        Write-Host "  Ladder: 1080p only (NVENC h264_nvenc, preset p7)" -ForegroundColor DarkGray

        New-Item -ItemType Directory -Path (Join-Path $videoOutDir "1080p") -Force | Out-Null

        $seg1080 = Join-Path $videoOutDir "1080p\segment_%03d.ts"
        $play1080 = Join-Path $videoOutDir "1080p\playlist.m3u8"

        # If source is exactly 1920x1080, passthrough scale (no-op). If source is wider
        # (e.g., 2K 2048-wide DCI), downscale to 1920x1080. Either way: 1080p target.
        if ($srcWidth -eq 1920 -and $srcHeight -eq 1080) {
            $vfArg = ""
        } else {
            $vfArg = "-vf `"scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2`" "
        }

        $ffmpegArgStr = "-nostdin -y -i `"$inputPath`" -map 0:v -map 0:a? " +
            $vfArg +
            "-c:v h264_nvenc -preset p7 -cq 18 -pix_fmt yuv420p -c:a aac -b:a 192k " +
            "-hls_time 6 -hls_playlist_type vod " +
            "-hls_segment_filename `"$seg1080`" `"$play1080`""

        $ffmpegProcess = Start-Process -FilePath "ffmpeg" -ArgumentList $ffmpegArgStr -NoNewWindow -Wait -PassThru -RedirectStandardError $ffmpegLog
        if ($ffmpegProcess.ExitCode -ne 0) {
            Write-Host "  FAILED (ffmpeg exit code $($ffmpegProcess.ExitCode))" -ForegroundColor Red
            Write-Host "  Check log: $ffmpegLog" -ForegroundColor DarkGray
            $failCount++
            continue
        }

        $masterPlaylist = @"
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="1080p"
1080p/playlist.m3u8
"@
    } else {
        # Sub-1080p source (rare): passthrough at source res into the 1080p/ folder.
        # No upscale. Master playlist reports actual source resolution.
        Write-Host "  Ladder: source-res passthrough (NVENC h264_nvenc, preset p7). No upscale." -ForegroundColor DarkYellow

        New-Item -ItemType Directory -Path (Join-Path $videoOutDir "1080p") -Force | Out-Null

        $seg1080 = Join-Path $videoOutDir "1080p\segment_%03d.ts"
        $play1080 = Join-Path $videoOutDir "1080p\playlist.m3u8"

        $ffmpegArgStr = "-nostdin -y -i `"$inputPath`" -map 0:v -map 0:a? " +
            "-c:v h264_nvenc -preset p7 -cq 18 -pix_fmt yuv420p -c:a aac -b:a 192k " +
            "-hls_time 6 -hls_playlist_type vod " +
            "-hls_segment_filename `"$seg1080`" `"$play1080`""

        $ffmpegProcess = Start-Process -FilePath "ffmpeg" -ArgumentList $ffmpegArgStr -NoNewWindow -Wait -PassThru -RedirectStandardError $ffmpegLog
        if ($ffmpegProcess.ExitCode -ne 0) {
            Write-Host "  FAILED (ffmpeg exit code $($ffmpegProcess.ExitCode))" -ForegroundColor Red
            Write-Host "  Check log: $ffmpegLog" -ForegroundColor DarkGray
            $failCount++
            continue
        }

        $masterPlaylist = @"
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=${srcWidth}x${srcHeight},NAME="source"
1080p/playlist.m3u8
"@
    }

    # --- Write master playlist ---
    $masterPath = Join-Path $videoOutDir "master.m3u8"
    [System.IO.File]::WriteAllText($masterPath, $masterPlaylist, [System.Text.UTF8Encoding]::new($false))

    # --- Generate fallback thumbnail (frame at 25 percent of duration) ---
    # Canonical per-couple thumb flow is Sierra-curated via Vimeo pictures.sizes
    # (see pull-vimeo-thumbs.ps1). This ffmpeg fallback covers local-MP4-only cases.
    $thumbTime = $durationSec * 0.25
    $thumbPath = Join-Path (Join-Path $OutputDir "thumbs") "$videoId.jpg"
    $thumbLog = Join-Path $videoOutDir "thumb.log"
    $thumbArgStr = "-nostdin -ss $thumbTime -i `"$inputPath`" -frames:v 1 " +
        "-vf `"scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2`" " +
        "-q:v 2 `"$thumbPath`" -y"
    $thumbProcess = Start-Process -FilePath "ffmpeg" -ArgumentList $thumbArgStr -NoNewWindow -Wait -PassThru -RedirectStandardError $thumbLog
    if ($thumbProcess.ExitCode -ne 0) {
        Write-Host "  (thumbnail failed, non-fatal)" -ForegroundColor DarkYellow
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
        Write-Host "  (no matching config entry for id=$videoId, duration not recorded)" -ForegroundColor DarkYellow
    }

    Write-Host "  done ($durationFormatted)" -ForegroundColor Green

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
