# Vimeo → R2 Upload Task

## Goal
Download 13 wedding teaser videos from Vimeo, transcode to HLS (4K + 1080p — NO 480p, NO 720p, minimum quality is 1080p), extract thumbnails, and upload everything to Cloudflare R2.

## Vimeo API Access
- **Token:** 60da9fb557043177a683cb20188859fb
- **Auth Header:** `Authorization: bearer 60da9fb557043177a683cb20188859fb`
- **API Base:** https://api.vimeo.com
- To get download links: `GET https://api.vimeo.com/videos/{id}` — look at the `download` array for source files, pick the highest quality (source or the one with width=3840)

## Videos to Process

| # | Slug | Vimeo URL | Vimeo ID | Notes |
|---|------|-----------|----------|-------|
| 1 | marie-matt | https://vimeo.com/1095187776 | 1095187776 | Teaser |
| 2 | kayla-jason | https://vimeo.com/1097652265 | 1097652265 | Teaser |
| 3 | allie-matt | https://vimeo.com/1098676328 | 1098676328 | Teaser |
| 4 | sally-aj | https://vimeo.com/1100119856 | 1100119856 | Teaser |
| 5 | taylor-kane | https://vimeo.com/1104226234 | 1104226234 | Teaser |
| 6 | kate-thomas | https://vimeo.com/1105966147 | 1105966147 | Teaser |
| 7 | sandra-chas | https://vimeo.com/1110111209 | 1110111209 | Teaser |
| 8 | amanda-boris | https://vimeo.com/1116339638 | 1116339638 | Teaser |
| 9 | izzy-hunter | https://vimeo.com/1117612050 | 1117612050 | Teaser |
| 10 | emily-bobby | https://vimeo.com/1132982878 | 1132982878 | Highlight film (no separate teaser — this IS their showcase video) |
| 11 | rachel-michael-woolf | https://vimeo.com/1126515830 | 1126515830 | Teaser, Door County wedding 10.4.25 |
| 12 | rachel-michael-street | https://vimeo.com/1143294125 | 1143294125 | Teaser, 11.29.25 |
| 13 | taylor-austin | https://vimeo.com/1147527131 | 1147527131 | Teaser |

## Pipeline Per Video

### 1. Download from Vimeo
```powershell
# Get download link
$headers = @{Authorization="bearer 60da9fb557043177a683cb20188859fb"}
$video = Invoke-RestMethod -Uri "https://api.vimeo.com/videos/{VIMEO_ID}" -Headers $headers
# Find the source/highest quality download
$downloadUrl = ($video.download | Sort-Object width -Descending | Select-Object -First 1).link
# Download
Invoke-WebRequest -Uri $downloadUrl -OutFile "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\downloads\{slug}.mp4"
```

### 2. Transcode to HLS
Use the existing transcode script BUT modify for 4K + 1080p only (no 720p, no 480p):
```powershell
# Check existing transcode script first:
# C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\scripts\transcode.ps1
# Modify or create new version that outputs:
# - 4K (3840x2160) stream
# - 1080p (1920x1080) stream
# - Master playlist referencing both
# Output to: C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\output\{slug}\
```

FFmpeg HLS command pattern:
```
ffmpeg -i input.mp4 \
  -filter_complex "[0:v]split=2[v4k][v1080];\
    [v4k]copy[v4kout];\
    [v1080]scale=1920:1080[v1080out]" \
  -map "[v4kout]" -map 0:a -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k \
    -hls_time 6 -hls_playlist_type vod -hls_segment_filename "4k/segment_%03d.ts" "4k/playlist.m3u8" \
  -map "[v1080out]" -map 0:a -c:v libx264 -preset slow -crf 20 -c:a aac -b:a 128k \
    -hls_time 6 -hls_playlist_type vod -hls_segment_filename "1080p/segment_%03d.ts" "1080p/playlist.m3u8"
```

Then create master.m3u8:
```
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=3840x2160
4k/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/playlist.m3u8
```

### 3. Extract Thumbnail
```
ffmpeg -i input.mp4 -ss 00:00:05 -frames:v 1 -q:v 2 thumb.jpg
```
Also try a few timestamps (5s, 15s, 30s, midpoint) and pick the best one. Save as `thumb.jpg` in the output folder. Resize to 1920x1080 if needed (should already be that from 4K source cropped).

For Vimeo thumbnails as backup/alternative:
```powershell
$video.pictures.sizes[-1].link  # Largest available thumbnail from Vimeo
```

### 4. Upload to R2
```powershell
# Upload HLS files
rclone copy "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\output\{slug}" "r2fi:fi-films/couples/{slug}/hls/teaser/" --progress

# Upload thumbnail
rclone copy "C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\output\{slug}\thumb.jpg" "r2fi:fi-films/couples/{slug}/thumbs/" --progress
```

R2 structure per couple:
```
fi-films/couples/{slug}/
  hls/teaser/
    master.m3u8
    4k/playlist.m3u8
    4k/segment_000.ts, segment_001.ts, ...
    1080p/playlist.m3u8
    1080p/segment_000.ts, segment_001.ts, ...
  thumbs/
    teaser.jpg
```

### 5. Clean Up
After successful upload, delete local downloads and output to save disk space. Process videos one at a time to minimize disk usage.

## Important Notes
- DO NOT delete anything from Vimeo. Ever.
- DO NOT skip any video. Process all 13.
- Amanda & Boris already has content on R2 — overwrite/update with the new teaser.
- The existing transcode.ps1 script outputs 1080p/720p/480p — we need 4K/1080p instead. Either modify the script or run ffmpeg directly.
- These are wedding teasers so they're short (1-4 minutes). Emily & Bobby's highlight is longer (~25 min).
- Process one video at a time to manage disk space.
- Log progress as you go.

## Working Directory
`C:\Users\flyin\Claude Projects\Landing Page\flyiniris\`

## Verify After Upload
After each upload, verify with:
```powershell
rclone ls r2fi:fi-films/couples/{slug}/hls/teaser/master.m3u8
```
