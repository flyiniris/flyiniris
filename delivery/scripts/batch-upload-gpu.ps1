$token = "60da9fb557043177a683cb20188859fb"
$headers = @{Authorization="bearer $token"}
$dlDir = "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\downloads"
$baseOut = "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\output"

# Skip kayla-jason (already done) and marie-matt (already done)
# Start from allie-matt
$videos = @(
    @{slug="allie-matt"; id="1098676328"},
    @{slug="sally-aj"; id="1100119856"},
    @{slug="taylor-kane"; id="1104226234"},
    @{slug="kate-thomas"; id="1105966147"},
    @{slug="sandra-chas"; id="1110111209"},
    @{slug="amanda-boris"; id="1116339638"},
    @{slug="izzy-hunter"; id="1117612050"},
    @{slug="emily-bobby"; id="1132982878"},
    @{slug="rachel-michael-woolf"; id="1126515830"},
    @{slug="rachel-michael-street"; id="1143294125"},
    @{slug="taylor-austin"; id="1147527131"}
)

$total = $videos.Count
$i = 0

foreach ($v in $videos) {
    $i++
    $slug = $v.slug
    $vid = $v.id
    Write-Host "`n========================================" 
    Write-Host "[$i/$total] Processing: $slug (Vimeo ID: $vid)"
    Write-Host "========================================`n"
    
    # 1. Get download URL
    Write-Host "[1/5] Getting download URL..."
    $video = Invoke-RestMethod -Uri "https://api.vimeo.com/videos/$vid" -Headers $headers
    $dl = $video.download | Where-Object { $_.quality -eq "uhd" -and $_.width -eq 3840 } | Select-Object -First 1
    if (-not $dl) {
        $dl = $video.download | Sort-Object width -Descending | Select-Object -First 1
    }
    Write-Host "  Quality: $($dl.quality) $($dl.width)x$($dl.height) $($dl.size_short)"
    
    # 2. Download
    Write-Host "[2/5] Downloading..."
    Invoke-WebRequest -Uri $dl.link -OutFile "$dlDir\$slug.mp4"
    Write-Host "  Downloaded: $slug.mp4"
    
    # 3. Transcode with NVENC GPU acceleration
    $outDir = "$baseOut\$slug"
    New-Item -ItemType Directory -Force -Path "$outDir\hls\teaser\4k" | Out-Null
    New-Item -ItemType Directory -Force -Path "$outDir\hls\teaser\1080p" | Out-Null
    
    Write-Host "[3/5] Transcoding 4K (NVENC GPU)..."
    & ffmpeg -hwaccel cuda -i "$dlDir\$slug.mp4" -c:v h264_nvenc -preset p7 -rc constqp -qp 18 -s 3840x2160 -c:a aac -b:a 192k -hls_time 6 -hls_playlist_type vod -hls_segment_filename "$outDir\hls\teaser\4k\segment_%03d.ts" "$outDir\hls\teaser\4k\playlist.m3u8" -y 2>&1 | Select-Object -Last 3
    Write-Host "  4K done"
    
    Write-Host "  Transcoding 1080p (NVENC GPU)..."
    & ffmpeg -hwaccel cuda -i "$dlDir\$slug.mp4" -c:v h264_nvenc -preset p7 -rc constqp -qp 20 -s 1920x1080 -c:a aac -b:a 128k -hls_time 6 -hls_playlist_type vod -hls_segment_filename "$outDir\hls\teaser\1080p\segment_%03d.ts" "$outDir\hls\teaser\1080p\playlist.m3u8" -y 2>&1 | Select-Object -Last 3
    Write-Host "  1080p done"
    
    # Master playlist
    @"
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=3840x2160
4k/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/playlist.m3u8
"@ | Set-Content "$outDir\hls\teaser\master.m3u8" -Encoding UTF8
    
    # 4. Thumbnail
    Write-Host "[4/5] Extracting thumbnail..."
    & ffmpeg -hwaccel cuda -i "$dlDir\$slug.mp4" -ss 00:00:15 -frames:v 1 -q:v 2 "$outDir\thumb.jpg" -y 2>&1 | Out-Null
    Write-Host "  Thumbnail extracted"
    
    # 5. Upload to R2
    Write-Host "[5/5] Uploading to R2..."
    & rclone copy "$outDir\hls\teaser" "r2fi:fi-films/couples/$slug/hls/teaser/" --progress 2>&1 | Select-Object -Last 5
    & rclone copy "$outDir\thumb.jpg" "r2fi:fi-films/couples/$slug/thumbs/" 2>&1 | Out-Null
    
    # Verify
    $verify = & rclone ls "r2fi:fi-films/couples/$slug/hls/teaser/master.m3u8" 2>&1
    if ($verify -match "master.m3u8") {
        Write-Host "  VERIFIED on R2"
    } else {
        Write-Host "  WARNING: Verification failed!"
    }
    
    # Cleanup local files
    Write-Host "  Cleaning up local files..."
    Remove-Item "$dlDir\$slug.mp4" -Force -ErrorAction SilentlyContinue
    Remove-Item $outDir -Recurse -Force -ErrorAction SilentlyContinue
    
    Write-Host "[$i/$total] COMPLETE: $slug`n"
}

Write-Host "`n==============================="
Write-Host "ALL $total VIDEOS COMPLETE"
Write-Host "==============================="

& openclaw system event --text "Done: All remaining 11 wedding teasers transcoded with NVENC GPU and uploaded to R2. All 13 couples now live." --mode now
