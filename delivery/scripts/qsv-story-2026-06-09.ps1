<#
.SYNOPSIS
  Transcode the 2 pre-downloaded 1080p story-session films on the Intel iGPU (Quick Sync),
  in parallel with the NVENC highlight batch on the RTX 5090. Uses a separate hardware
  encoder lane so it does not contend for NVENC sessions.
  Falls back to CPU libx264 if QSV init fails.
#>
$ErrorActionPreference = "Stop"
$work = "C:\fi-pull-tmp"; $dlDir = "$work\downloads"; $outRt = "$work\output"; $logDir = "$work\logs"

$items = @(
  @{ slug="brittany-jai";           key="brittany-jai-story";           cat="story" }
  @{ slug="they-met-middle-school"; key="they-met-middle-school-story"; cat="story" }
)

foreach ($it in $items) {
  $slug=$it.slug; $cat=$it.cat; $key=$it.key
  $log = "$logDir\$key.log"
  function L($m){ $l="{0} [QSV {1}] {2}" -f (Get-Date).ToString('HH:mm:ss'),$key,$m; Add-Content $log $l; Write-Host $l }
  $src = "$dlDir\$key.mp4"
  try {
    if (-not (Test-Path $src)) { L "no download, skip"; continue }
    $dur = if (Test-Path "$dlDir\$key.dur") { [int](Get-Content "$dlDir\$key.dur" -Raw) } else { 0 }
    $od = "$outRt\$key"; New-Item -ItemType Directory -Force -Path "$od\1080p" | Out-Null
    $ff = "$logDir\$key.qsv.log"

    # 1080p-only ladder on Intel Quick Sync (h264_qsv). global_quality ~ visually high.
    $qsvArgs = @('-nostdin','-y','-i',$src,'-vf','scale=1920:1080:flags=lanczos',
      '-map','0:v:0','-map','0:a?','-c:v','h264_qsv','-preset','veryslow','-global_quality','20',
      '-c:a','aac','-b:a','192k','-hls_time','6','-hls_playlist_type','vod',
      '-hls_segment_filename',"$od\1080p\segment_%03d.ts","$od\1080p\playlist.m3u8")
    $sw=[System.Diagnostics.Stopwatch]::StartNew()
    & ffmpeg @qsvArgs 2> $ff
    $ok = ($LASTEXITCODE -eq 0)
    if (-not $ok) {
      L "QSV failed (exit $LASTEXITCODE), falling back to CPU libx264"
      $x264Args = @('-nostdin','-y','-i',$src,'-vf','scale=1920:1080:flags=lanczos',
        '-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p',
        '-c:a','aac','-b:a','192k','-hls_time','6','-hls_playlist_type','vod',
        '-hls_segment_filename',"$od\1080p\segment_%03d.ts","$od\1080p\playlist.m3u8")
      & ffmpeg @x264Args 2> "$logDir\$key.x264.log"
      if ($LASTEXITCODE -ne 0) { throw "x264 fallback also failed (exit $LASTEXITCODE)" }
    }
    $sw.Stop()

    @"
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="1080p"
1080p/playlist.m3u8
"@ | Set-Content "$od\master.m3u8" -Encoding utf8NoBOM
    L ("transcoded 1080p-only via {0} in {1}s" -f $(if($ok){'QSV'}else{'x264'}), [math]::Round($sw.Elapsed.TotalSeconds))

    # Poster frame (~30% in), 1920 wide
    $thumb = "$od\$cat.jpg"; $ss = if ($dur -gt 0) { [int]($dur*0.30) } else { 8 }
    & ffmpeg -nostdin -y -ss "$ss" -i $src -frames:v 1 -vf "scale=1920:-2:flags=lanczos" -q:v 2 $thumb 2> "$logDir\$key.thumb.log"
    if ($LASTEXITCODE -eq 0) { L "poster @ ${ss}s" } else { L "WARN thumb failed" }

    & rclone copy "$od" "r2fi:fi-films/couples/$slug/hls/$cat/" --exclude "$cat.jpg" --transfers 16 --checkers 16 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "rclone HLS exit $LASTEXITCODE" }
    if (Test-Path $thumb) { & rclone copyto "$thumb" "r2fi:fi-films/couples/$slug/thumbs/$cat.jpg" 2>&1 | Out-Null }
    $chk = & rclone ls "r2fi:fi-films/couples/$slug/hls/$cat/master.m3u8" 2>&1
    if ("$chk" -match 'master.m3u8') { L "VERIFIED + uploaded" } else { throw "verify failed" }

    Remove-Item $src,"$dlDir\$key.dur" -Force -ErrorAction SilentlyContinue
    Remove-Item $od -Recurse -Force -ErrorAction SilentlyContinue
    L "DONE"
  } catch { L "FAILED: $($_.Exception.Message)" }
}
Write-Host "=== QSV story batch complete ==="