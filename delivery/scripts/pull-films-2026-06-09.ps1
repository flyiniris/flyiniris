<#
.SYNOPSIS
  Pull the locked /yours film library from Vimeo -> NVENC HLS -> R2 (fi-films), by category.

.DESCRIPTION
  Two-phase, resource-maximizing:
    PHASE 1 (download): resolve each 4K (uhd 3840) download URL from the Vimeo API and curl
      it down with high parallelism (default 8 workers) to saturate the pipe. Vimeo throttles
      each connection to ~5 MB/s, so concurrency is the only way to fill the link.
    PHASE 2 (transcode): for each downloaded master, transcode to a 4K + 1080p HLS ladder
      (h264_nvenc p7, cq18/cq20) matching the existing R2 teasers, extract a crisp 1920-wide
      poster frame, upload HLS + poster to R2, verify, and clean up. Runs at lower concurrency
      (default 3 = 6 NVENC sessions, under the driver cap) because the GPU is the bottleneck here.
      The 1080p downscale runs on the GPU via scale_cuda (lanczos) so each job is NVENC-bound,
      not CPU-bound; falls back to CPU lanczos if scale_cuda is unavailable.

  Token is read from secrets.md at runtime and never printed.

  R2 layout (per couple): couples/{slug}/hls/{category}/master.m3u8 + couples/{slug}/thumbs/{category}.jpg
  amanda-boris + rachel-michael-street are already in R2 and are NOT in this manifest (their
  films-table rows point at existing files).

.PARAMETER DlWorkers   Parallel download workers (default 8).
.PARAMETER TxWorkers   Parallel transcode workers (default 3; each uses 2 NVENC sessions).
.PARAMETER Only        Comma-separated "{slug}-{category}" filter for validation runs.
.PARAMETER Phase       all | download | transcode (default all).
.PARAMETER UseCpuScale Force CPU lanczos 1080p downscale instead of scale_cuda.
#>
param(
  [int]$DlWorkers = 8,
  [int]$TxWorkers = 3,
  [string]$Only = "",
  [ValidateSet('all','download','transcode')][string]$Phase = 'all',
  [switch]$UseCpuScale
)

$ErrorActionPreference = "Stop"
# Space-free working dir: ffmpeg/rclone arg handling is brittle with spaces in paths.
$work   = "C:\fi-pull-tmp"
$dlDir  = Join-Path $work "downloads"
$outRt  = Join-Path $work "output"
$logDir = Join-Path $work "logs"
New-Item -ItemType Directory -Force -Path $dlDir, $outRt, $logDir | Out-Null

function Get-VimeoToken {
  $sec = Get-Content "$env:USERPROFILE\.openclaw\workspace\secrets.md" -Raw
  foreach ($line in ($sec -split "`n")) {
    if ($line -match 'Personal Access Token:\s*(.+)$') { return $Matches[1].Trim() }
  }
  throw "Vimeo token not found in secrets.md"
}
$token = Get-VimeoToken

# Detect GPU scaler support once (unless forced to CPU).
$scaleCuda = $false
if (-not $UseCpuScale) {
  $filters = & ffmpeg -hide_banner -filters 2>$null
  $scaleCuda = [bool]($filters | Select-String -SimpleMatch 'scale_cuda')
}
Write-Host ("1080p downscale path: {0}" -f $(if ($scaleCuda) { 'scale_cuda (GPU)' } else { 'lanczos (CPU)' })) -ForegroundColor DarkCyan

# --- Locked manifest (2026-06-09 handoff). ---
$manifest = @(
  @{ slug="marie-matt";            vimeo="1128297349"; category="highlight" }
  @{ slug="kayla-jason";           vimeo="1115351865"; category="highlight" }
  @{ slug="allie-matt";            vimeo="1140183305"; category="highlight" }
  @{ slug="sally-aj";              vimeo="1154796075"; category="highlight" }
  @{ slug="taylor-kane";           vimeo="1149038912"; category="highlight" }
  @{ slug="kate-thomas";           vimeo="1163406975"; category="highlight" }
  @{ slug="sandra-chas";           vimeo="1175265814"; category="highlight" }
  @{ slug="izzy-hunter";           vimeo="1170389868"; category="highlight" }
  @{ slug="emily-bobby";           vimeo="1132982878"; category="highlight" }
  @{ slug="rachel-michael-woolf";  vimeo="1179335090"; category="highlight" }
  @{ slug="taylor-austin";         vimeo="1199189258"; category="highlight" }
  @{ slug="olivia-austin";         vimeo="1050968375"; category="highlight" }
  @{ slug="sarah-cody";            vimeo="1080916826"; category="highlight" }
  @{ slug="taylor-kane";           vimeo="1102040627"; category="story" }
  # 1080p-only story-session examples (source-aware transcode -> 1080p-only ladder).
  @{ slug="brittany-jai";          vimeo="1069817798"; category="story" }
  @{ slug="they-met-middle-school"; vimeo="1016847985"; category="story" }
  # olivia-austin teaser was never in R2 (only the static-bucket thumb existed). 4K source.
  @{ slug="olivia-austin";         vimeo="1167580738"; category="teaser" }
)
if ($Only) {
  $want = $Only -split ',' | ForEach-Object { $_.Trim() }
  $manifest = @($manifest | Where-Object { ("$($_.slug)-$($_.category)" -in $want) -or ($_.slug -in $want) })
}

Write-Host ("=== {0} item(s) | DlWorkers={1} TxWorkers={2} Phase={3} ===" -f @($manifest).Count, $DlWorkers, $TxWorkers, $Phase) -ForegroundColor Cyan

# ============================ PHASE 1: DOWNLOAD ============================
if ($Phase -in 'all','download') {
  Write-Host "--- PHASE 1: download ---" -ForegroundColor Cyan
  $manifest | ForEach-Object -ThrottleLimit $DlWorkers -Parallel {
    $m = $_; $token = $using:token; $dlDir = $using:dlDir; $logDir = $using:logDir
    $key = "$($m.slug)-$($m.category)"
    $log = Join-Path $logDir "$key.log"
    function L($msg) { $line = "{0} [{1}] {2}" -f (Get-Date).ToString('HH:mm:ss'), $key, $msg; Add-Content -Path $log -Value $line; Write-Host $line }
    $src = Join-Path $dlDir "$key.mp4"
    try {
      if ((Test-Path $src) -and (Get-Item $src).Length -gt 1MB) { L "DL skip (already have $([math]::Round((Get-Item $src).Length/1MB)) MB)"; return }
      $headers = @{ Authorization = "bearer $token" }
      $v = Invoke-RestMethod -Uri "https://api.vimeo.com/videos/$($m.vimeo)?fields=name,duration,width,height,download" -Headers $headers
      $dl = $v.download | Where-Object { $_.quality -eq 'uhd' -and $_.width -eq 3840 } | Select-Object -First 1
      if (-not $dl) { $dl = $v.download | Sort-Object width -Descending | Select-Object -First 1 }
      if (-not $dl) { throw "no download rendition" }
      L "DL start $($dl.width)x$($dl.height) $($dl.size_short) dur=$([int]$v.duration)s"
      & curl.exe -s -L --retry 3 --retry-delay 2 -o $src $dl.link
      if ($LASTEXITCODE -ne 0) { throw "curl exit $LASTEXITCODE" }
      if (-not (Test-Path $src) -or (Get-Item $src).Length -lt 1MB) { throw "download too small/missing" }
      # Stash duration for the transcode phase (poster frame timing).
      Set-Content -Path (Join-Path $dlDir "$key.dur") -Value ([int]$v.duration)
      L "DL done $([math]::Round((Get-Item $src).Length/1MB)) MB"
    } catch { L "DL FAILED: $($_.Exception.Message)" }
  }
}

# ============================ PHASE 2: TRANSCODE ============================
if ($Phase -in 'all','transcode') {
  Write-Host "--- PHASE 2: transcode + upload ---" -ForegroundColor Cyan
  $manifest | ForEach-Object -ThrottleLimit $TxWorkers -Parallel {
    $m = $_; $dlDir = $using:dlDir; $outRt = $using:outRt; $logDir = $using:logDir; $scaleCuda = $using:scaleCuda
    $slug = $m.slug; $cat = $m.category; $key = "$slug-$cat"
    $log = Join-Path $logDir "$key.log"
    function L($msg) { $line = "{0} [{1}] {2}" -f (Get-Date).ToString('HH:mm:ss'), $key, $msg; Add-Content -Path $log -Value $line; Write-Host $line }
    $src = Join-Path $dlDir "$key.mp4"
    try {
      if (-not (Test-Path $src) -or (Get-Item $src).Length -lt 1MB) { L "TX skip (no download)"; return }
      $durFile = Join-Path $dlDir "$key.dur"
      $dur = if (Test-Path $durFile) { [int](Get-Content $durFile -Raw) } else { 0 }

      # Source-resolution-aware: 4K source -> 4K+1080p ladder; sub-4K -> 1080p-only
      # (no upscaled fake-4K rung), matching the existing R2 convention.
      $probe = & ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 $src 2>$null
      $srcW = 0; if ("$probe" -match '(\d+)\s*,\s*(\d+)') { $srcW = [int]$Matches[1] }
      $od = Join-Path $outRt $key
      $ff = Join-Path $logDir "$key.ffmpeg.log"
      $is4k = $srcW -ge 3840

      if ($is4k) {
        New-Item -ItemType Directory -Force -Path "$od\4k", "$od\1080p" | Out-Null
        if ($scaleCuda) {
          $ffArgs = @(
            '-nostdin','-y','-hwaccel','cuda','-hwaccel_output_format','cuda','-i',$src,
            '-filter_complex','[0:v]split=2[v4k][vs];[vs]scale_cuda=1920:1080:interp_algo=lanczos[v1080o]',
            '-map','[v4k]','-map','0:a?','-c:v','h264_nvenc','-preset','p7','-cq','18','-c:a','aac','-b:a','192k',
              '-hls_time','6','-hls_playlist_type','vod','-hls_segment_filename',"$od\4k\segment_%03d.ts","$od\4k\playlist.m3u8",
            '-map','[v1080o]','-map','0:a?','-c:v','h264_nvenc','-preset','p7','-cq','20','-c:a','aac','-b:a','128k',
              '-hls_time','6','-hls_playlist_type','vod','-hls_segment_filename',"$od\1080p\segment_%03d.ts","$od\1080p\playlist.m3u8"
          )
        } else {
          $ffArgs = @(
            '-nostdin','-y','-hwaccel','cuda','-i',$src,
            '-filter_complex','[0:v]split=2[v4k][v1080];[v1080]scale=1920:1080:flags=lanczos[v1080o]',
            '-map','[v4k]','-map','0:a?','-c:v','h264_nvenc','-preset','p7','-cq','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k',
              '-hls_time','6','-hls_playlist_type','vod','-hls_segment_filename',"$od\4k\segment_%03d.ts","$od\4k\playlist.m3u8",
            '-map','[v1080o]','-map','0:a?','-c:v','h264_nvenc','-preset','p7','-cq','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k',
              '-hls_time','6','-hls_playlist_type','vod','-hls_segment_filename',"$od\1080p\segment_%03d.ts","$od\1080p\playlist.m3u8"
          )
        }
      } else {
        New-Item -ItemType Directory -Force -Path "$od\1080p" | Out-Null
        if ($scaleCuda) {
          $ffArgs = @(
            '-nostdin','-y','-hwaccel','cuda','-hwaccel_output_format','cuda','-i',$src,
            '-vf','scale_cuda=1920:1080:interp_algo=lanczos','-map','0:v:0','-map','0:a?',
            '-c:v','h264_nvenc','-preset','p7','-cq','18','-c:a','aac','-b:a','192k',
            '-hls_time','6','-hls_playlist_type','vod','-hls_segment_filename',"$od\1080p\segment_%03d.ts","$od\1080p\playlist.m3u8"
          )
        } else {
          $ffArgs = @(
            '-nostdin','-y','-hwaccel','cuda','-i',$src,
            '-vf','scale=1920:1080:flags=lanczos','-map','0:v:0','-map','0:a?',
            '-c:v','h264_nvenc','-preset','p7','-cq','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k',
            '-hls_time','6','-hls_playlist_type','vod','-hls_segment_filename',"$od\1080p\segment_%03d.ts","$od\1080p\playlist.m3u8"
          )
        }
      }
      $tEnc = [System.Diagnostics.Stopwatch]::StartNew()
      & ffmpeg @ffArgs 2> $ff
      if ($LASTEXITCODE -ne 0) { throw "ffmpeg exit $LASTEXITCODE (see $ff)" }
      $tEnc.Stop()

      if ($is4k) {
        @"
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=3840x2160,NAME="4K"
4k/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="1080p"
1080p/playlist.m3u8
"@ | Set-Content "$od\master.m3u8" -Encoding utf8NoBOM
      } else {
        @"
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="1080p"
1080p/playlist.m3u8
"@ | Set-Content "$od\master.m3u8" -Encoding utf8NoBOM
      }
      L "transcoded $(if ($is4k) {'4k+1080p'} else {'1080p-only'}) (srcW=$srcW) in $([math]::Round($tEnc.Elapsed.TotalSeconds))s"

      # Poster frame from the 4K master (~30% in), 1920 wide, crisp. CPU (single frame).
      $thumb = Join-Path $od "$cat.jpg"
      $ss = if ($dur -gt 0) { [int]($dur * 0.30) } else { 8 }
      $tf = Join-Path $logDir "$key.thumb.log"
      $tArgs = @('-nostdin','-y','-ss',"$ss",'-i',$src,'-frames:v','1','-vf','scale=1920:-2:flags=lanczos','-q:v','2',$thumb)
      & ffmpeg @tArgs 2> $tf
      if ($LASTEXITCODE -ne 0) { L "WARN thumbnail failed (non-fatal)" } else { L "poster frame @ ${ss}s" }

      # Upload HLS (exclude the poster) + poster to R2.
      & rclone copy "$od" "r2fi:fi-films/couples/$slug/hls/$cat/" --exclude "$cat.jpg" --transfers 16 --checkers 16 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "rclone HLS copy exit $LASTEXITCODE" }
      if (Test-Path $thumb) {
        & rclone copyto "$thumb" "r2fi:fi-films/couples/$slug/thumbs/$cat.jpg" 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "rclone thumb copy exit $LASTEXITCODE" }
      }
      $chk = & rclone ls "r2fi:fi-films/couples/$slug/hls/$cat/master.m3u8" 2>&1
      if ("$chk" -match 'master.m3u8') { L "VERIFIED + uploaded" } else { throw "verify failed: $chk" }

      Remove-Item $src -Force -ErrorAction SilentlyContinue
      Remove-Item $durFile -Force -ErrorAction SilentlyContinue
      Remove-Item $od -Recurse -Force -ErrorAction SilentlyContinue
      L "DONE"
    } catch { L "TX FAILED: $($_.Exception.Message)" }
  }
}

Write-Host "=== Batch complete. Logs in $logDir ===" -ForegroundColor Cyan