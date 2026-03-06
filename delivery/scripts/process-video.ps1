param(
    [Parameter(Mandatory=$true)][string]$Slug,
    [Parameter(Mandatory=$true)][string]$VimeoId
)

$ErrorActionPreference = "Stop"
$token = "60da9fb557043177a683cb20188859fb"
$basePath = "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery"
$downloadDir = "$basePath\downloads"
$outputDir = "$basePath\output\$Slug"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Processing: $Slug (Vimeo ID: $VimeoId)" -ForegroundColor Cyan
Write-Host "========================================`n"

# Ensure dirs exist
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
New-Item -ItemType Directory -Force -Path "$outputDir\4k" | Out-Null
New-Item -ItemType Directory -Force -Path "$outputDir\1080p" | Out-Null

# Step 1: Get download URL from Vimeo API
Write-Host "[1/5] Fetching Vimeo API info..." -ForegroundColor Yellow
$headers = @{Authorization="bearer $token"}
$video = Invoke-RestMethod -Uri "https://api.vimeo.com/videos/$VimeoId" -Headers $headers
$downloads = $video.download | Sort-Object width -Descending
$best = $downloads | Select-Object -First 1

Write-Host "  Video: $($video.name)"
Write-Host "  Duration: $($video.duration)s"
Write-Host "  Source: $($best.quality) $($best.width)x$($best.height) ($($best.type))"
Write-Host "  Size: $([math]::Round($best.size / 1MB, 1)) MB"

$inputFile = "$downloadDir\$Slug.mp4"

# Step 2: Download
Write-Host "`n[2/5] Downloading..." -ForegroundColor Yellow
if (Test-Path $inputFile) {
    Write-Host "  File already exists, skipping download."
} else {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $best.link -OutFile $inputFile
    $ProgressPreference = 'Continue'
    $fileSize = [math]::Round((Get-Item $inputFile).Length / 1MB, 1)
    Write-Host "  Downloaded: $fileSize MB"
}

# Get source resolution
$probeJson = & ffprobe -v quiet -print_format json -show_streams $inputFile 2>&1
$probeData = $probeJson | ConvertFrom-Json
$videoStream = $probeData.streams | Where-Object { $_.codec_type -eq "video" } | Select-Object -First 1
$srcWidth = [int]$videoStream.width
$srcHeight = [int]$videoStream.height
Write-Host "  Source resolution: ${srcWidth}x${srcHeight}"

# Step 3: Transcode to HLS (4K + 1080p)
Write-Host "`n[3/5] Transcoding to HLS..." -ForegroundColor Yellow

if ($srcWidth -ge 3840) {
    # Source is 4K or larger - create both 4K and 1080p
    Write-Host "  Creating 4K + 1080p streams..."
    & ffmpeg -y -i $inputFile `
        -filter_complex "[0:v]split=2[v4k][v1080];[v4k]copy[v4kout];[v1080]scale=1920:1080:flags=lanczos[v1080out]" `
        -map "[v4kout]" -map 0:a? -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k `
        -hls_time 6 -hls_playlist_type vod `
        -hls_segment_filename "$outputDir\4k\segment_%03d.ts" "$outputDir\4k\playlist.m3u8" `
        -map "[v1080out]" -map 0:a? -c:v libx264 -preset slow -crf 20 -c:a aac -b:a 128k `
        -hls_time 6 -hls_playlist_type vod `
        -hls_segment_filename "$outputDir\1080p\segment_%03d.ts" "$outputDir\1080p\playlist.m3u8"

    # Create master playlist
    @"
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=3840x2160
4k/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/playlist.m3u8
"@ | Out-File -FilePath "$outputDir\master.m3u8" -Encoding UTF8 -NoNewline
} else {
    # Source is less than 4K - create 1080p only, label as "4k" folder for consistency
    Write-Host "  Source is ${srcWidth}x${srcHeight} (not 4K). Creating source-res + 1080p streams..."

    # Stream 1: source resolution (in 4k folder)
    & ffmpeg -y -i $inputFile `
        -map 0:v -map 0:a? -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k `
        -hls_time 6 -hls_playlist_type vod `
        -hls_segment_filename "$outputDir\4k\segment_%03d.ts" "$outputDir\4k\playlist.m3u8"

    # Stream 2: 1080p
    & ffmpeg -y -i $inputFile `
        -map 0:v -map 0:a? -vf "scale=1920:1080:flags=lanczos" `
        -c:v libx264 -preset slow -crf 20 -c:a aac -b:a 128k `
        -hls_time 6 -hls_playlist_type vod `
        -hls_segment_filename "$outputDir\1080p\segment_%03d.ts" "$outputDir\1080p\playlist.m3u8"

    # Create master playlist with actual source resolution
    @"
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=${srcWidth}x${srcHeight}
4k/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/playlist.m3u8
"@ | Out-File -FilePath "$outputDir\master.m3u8" -Encoding UTF8 -NoNewline
}

Write-Host "  Transcode complete."

# Step 4: Extract thumbnail
Write-Host "`n[4/5] Extracting thumbnail..." -ForegroundColor Yellow
$duration = [int]$video.duration
$midpoint = [math]::Floor($duration / 2)
$timestamps = @(5, 15, 30, $midpoint)

# Extract multiple candidates
$bestThumb = $null
$bestSize = 0
foreach ($ts in $timestamps) {
    if ($ts -ge $duration) { continue }
    $tsStr = [TimeSpan]::FromSeconds($ts).ToString("hh\:mm\:ss")
    $thumbPath = "$outputDir\thumb_${ts}s.jpg"
    & ffmpeg -y -ss $tsStr -i $inputFile -frames:v 1 -q:v 2 -vf "scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" $thumbPath 2>$null
    if (Test-Path $thumbPath) {
        $size = (Get-Item $thumbPath).Length
        if ($size -gt $bestSize) {
            $bestSize = $size
            $bestThumb = $thumbPath
        }
    }
}

# Copy best thumbnail as teaser.jpg
if ($bestThumb) {
    Copy-Item $bestThumb "$outputDir\teaser.jpg" -Force
    # Clean up candidates
    Get-ChildItem "$outputDir\thumb_*s.jpg" | Remove-Item -Force
    Write-Host "  Thumbnail saved (from $bestThumb)"
} else {
    Write-Host "  WARNING: Could not extract thumbnail!" -ForegroundColor Red
}

# Step 5: Upload to R2
Write-Host "`n[5/5] Uploading to R2..." -ForegroundColor Yellow

# Upload HLS files (master.m3u8, 4k/, 1080p/)
Write-Host "  Uploading HLS files..."
& rclone copy "$outputDir\master.m3u8" "r2fi:fi-films/couples/$Slug/hls/teaser/" --progress
& rclone copy "$outputDir\4k" "r2fi:fi-films/couples/$Slug/hls/teaser/4k/" --progress
& rclone copy "$outputDir\1080p" "r2fi:fi-films/couples/$Slug/hls/teaser/1080p/" --progress

# Upload thumbnail
Write-Host "  Uploading thumbnail..."
& rclone copy "$outputDir\teaser.jpg" "r2fi:fi-films/couples/$Slug/thumbs/" --progress

# Verify upload
Write-Host "`n  Verifying upload..."
$verify = & rclone ls "r2fi:fi-films/couples/$Slug/hls/teaser/master.m3u8" 2>&1
if ($verify -match "master.m3u8") {
    Write-Host "  VERIFIED: master.m3u8 exists on R2" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Could not verify master.m3u8 on R2!" -ForegroundColor Red
}

# Clean up local files
Write-Host "`nCleaning up local files..."
Remove-Item $inputFile -Force -ErrorAction SilentlyContinue
Remove-Item $outputDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "DONE: $Slug" -ForegroundColor Green
Write-Host "========================================`n"
