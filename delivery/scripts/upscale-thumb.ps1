<#
.SYNOPSIS
    Produces a 4K (3840x2160) delivery-page thumbnail from a source image or a
    frame grab, using Real-ESRGAN, and places it in R2 at the canonical path.

.DESCRIPTION
    The two source paths (Sierra's choice per film) converge here:

      1. Frame grab  (-SourceVideo): extract a frame from the couple's 4K source
         video (the same source the HLS transcode uses). Highest quality, the
         source is already 4K.
      2. Sierra still (-SourceImage / -StagedUrl / -StagedAuto): a still Sierra
         picked. -StagedAuto / -StagedUrl pull the raw still Studio staged to
         fi-assets (delivery-thumb-sources/<slug>/<videoId>.<ext>), so Sierra
         never touches the filesystem for that path.

    All paths then: Real-ESRGAN x4 (realesrgan-ncnn-vulkan, realesrgan-x4plus,
    -s 4, GPU) -> resize/crop to exactly 3840x2160 16:9 -> JPEG compress to the
    ~250-420 KB range -> rclone to r2fi:fi-films/couples/<slug>/thumbs/<videoId>.jpg
    (served by video.flyiniris.com, referenced by the page thumbUrl + og:image).

    SOURCE RESOLUTION GUARD. Real-ESRGAN at 4x on a small source produces a soft
    result, which would degrade the hero image and the social-share og:image. The
    minimum source width is 960: 4x of 960 is exactly 3840, so anything below 960
    cannot reach 4K without interpolation beyond the model. Below 960 the script
    REFUSES (use -Force to override). Below 1920 (a 1080p-equivalent source) it
    WARNS that headroom is limited but proceeds. A 4K frame grab (3840 wide)
    upscales to 15360 then downsamples to 3840, which is the sharpest result.

    LOCAL ONLY. Real-ESRGAN is GPU work (realesrgan-ncnn-vulkan.exe on the
    Alienware); a Cloudflare Worker cannot run it, same constraint as transcode
    and the Vimeo ingest. Studio's only role is staging Sierra's raw still; this
    script does the upscale and the final placement.

.PARAMETER Slug
    Couple slug. Used in the R2 destination path.

.PARAMETER VideoId
    Video id. The thumb lands at couples/<Slug>/thumbs/<VideoId>.jpg.

.PARAMETER SourceImage
    Path to a local source still (Sierra-provided).

.PARAMETER SourceVideo
    Path to the couple's source video. A frame is grabbed at -FramePercent.

.PARAMETER StagedUrl
    Direct URL of a Studio-staged still to download.

.PARAMETER StagedAuto
    Derive the staged still URL from Slug + VideoId on the fi-assets public
    bucket and download it (tries jpg, png, webp).

.PARAMETER FramePercent
    Frame-grab position as a percent of duration (default 25).

.EXAMPLE
    .\upscale-thumb.ps1 -Slug rachel-michael-street -VideoId teaser -SourceVideo "C:\src\teaser.mp4"

.EXAMPLE
    .\upscale-thumb.ps1 -Slug rachel-michael-street -VideoId highlight -StagedAuto
#>

param(
    [Parameter(Mandatory=$true)][string]$Slug,
    [Parameter(Mandatory=$true)][string]$VideoId,
    [string]$SourceImage,
    [string]$SourceVideo,
    [string]$StagedUrl,
    [switch]$StagedAuto,
    [double]$FramePercent = 25,
    [string]$WorkDir,
    [int]$MinSourceWidth = 960,
    [int]$RecommendWidth = 1920,
    [switch]$Force,
    [switch]$SkipUpload,
    [string]$EsrganDir = "C:\Users\flyin\realesrgan",
    [int]$JpegQuality = 3
)

$ErrorActionPreference = "Stop"

$FI_ASSETS_PUBLIC_BASE = "https://pub-353a8c6ef8dc4c03a98225af8b12a8a9.r2.dev"
$TARGET_W = 3840
$TARGET_H = 2160

# --- Preflight ---
foreach ($tool in @("ffmpeg", "ffprobe")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Error "ERROR: $tool not found in PATH."
        exit 1
    }
}
$esrgan = Join-Path $EsrganDir "realesrgan-ncnn-vulkan.exe"
if (-not (Test-Path $esrgan)) {
    Write-Error "ERROR: realesrgan-ncnn-vulkan.exe not found at $esrgan"
    exit 1
}
if (-not $SkipUpload -and -not (Get-Command "rclone" -ErrorAction SilentlyContinue)) {
    Write-Error "ERROR: rclone not found in PATH (needed to upload, or pass -SkipUpload)."
    exit 1
}

# Exactly one source must be given.
$sourceCount = @($SourceImage, $SourceVideo, $StagedUrl).Where({ $_ }).Count + [int]$StagedAuto.IsPresent
if ($sourceCount -ne 1) {
    Write-Error "ERROR: provide exactly one of -SourceImage, -SourceVideo, -StagedUrl, -StagedAuto."
    exit 1
}

if (-not $WorkDir) { $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) "fi-thumb-$Slug-$VideoId" }
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

Write-Host ""
Write-Host "=== Flyin' Iris 4K Thumbnail Upscale ===" -ForegroundColor Cyan
Write-Host "Slug/Video: $Slug / $VideoId"
Write-Host "Target:     ${TARGET_W}x${TARGET_H} JPEG -> couples/$Slug/thumbs/$VideoId.jpg"
Write-Host ""

# --- 1. Resolve the source to a local image file ---
$srcImg = $null

if ($SourceImage) {
    if (-not (Test-Path $SourceImage -PathType Leaf)) { Write-Error "ERROR: SourceImage not found: $SourceImage"; exit 1 }
    $srcImg = (Resolve-Path $SourceImage).Path
    Write-Host "Source: provided still ($srcImg)"
}
elseif ($SourceVideo) {
    if (-not (Test-Path $SourceVideo -PathType Leaf)) { Write-Error "ERROR: SourceVideo not found: $SourceVideo"; exit 1 }
    $durRaw = & ffprobe -v error -show_entries format=duration -of csv=p=0 "$SourceVideo" 2>&1
    $dur = [double]($durRaw.Trim())
    $grabAt = [math]::Max(0, $dur * ($FramePercent / 100.0))
    $srcImg = Join-Path $WorkDir "source-frame.jpg"
    # Full-resolution frame, no scaling (the source is already 4K on the good path).
    & ffmpeg -nostdin -ss $grabAt -i "$SourceVideo" -frames:v 1 -q:v 2 "$srcImg" -y -loglevel error
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $srcImg)) { Write-Error "ERROR: frame grab failed."; exit 1 }
    Write-Host "Source: frame grab at $([math]::Round($grabAt,1))s of $([math]::Round($dur,1))s"
}
else {
    # Staged still: download from the fi-assets public bucket.
    $url = $StagedUrl
    $dlPath = Join-Path $WorkDir "staged-source"
    if ($StagedAuto) {
        $picked = $null
        foreach ($ext in @("jpg", "png", "webp")) {
            $try = "$FI_ASSETS_PUBLIC_BASE/delivery-thumb-sources/$Slug/$VideoId.$ext"
            try {
                $ProgressPreference = 'SilentlyContinue'
                Invoke-WebRequest -Uri $try -OutFile "$dlPath.$ext" -ErrorAction Stop | Out-Null
                $picked = "$dlPath.$ext"; $url = $try; break
            } catch { continue }
        }
        if (-not $picked) { Write-Error "ERROR: no staged still found for $Slug/$VideoId (tried jpg, png, webp)."; exit 1 }
        $srcImg = $picked
    } else {
        $ext = ([System.IO.Path]::GetExtension($url)).TrimStart('.').ToLower()
        if (-not $ext) { $ext = "jpg" }
        $srcImg = "$dlPath.$ext"
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $url -OutFile $srcImg -ErrorAction Stop | Out-Null
    }
    Write-Host "Source: staged still ($url)"
}

# --- 2. Probe source resolution + guard ---
$probe = & ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$srcImg" 2>&1
$dims = "$probe".Trim().Split('x')
$srcW = [int]$dims[0]
$srcH = [int]$dims[1]
Write-Host "Source resolution: ${srcW}x${srcH}"

if ($srcW -lt $MinSourceWidth) {
    if ($Force) {
        Write-Host "  WARNING: source width $srcW is below the $MinSourceWidth floor. -Force set, proceeding, but the 4K thumb will be soft." -ForegroundColor Red
    } else {
        Write-Error "REFUSED: source width $srcW is below the $MinSourceWidth floor. 4x reaches only $([int]($srcW*4)) wide, so hitting ${TARGET_W} would interpolate and look soft. Use a larger source (a 4K frame grab is ideal) or pass -Force to override."
        exit 1
    }
} elseif ($srcW -lt $RecommendWidth) {
    Write-Host "  WARNING: source width $srcW is below the recommended $RecommendWidth. It reaches 4K but with limited headroom. A 1080p+ still or a 4K frame grab looks sharper." -ForegroundColor DarkYellow
} else {
    Write-Host "  Source is large enough for a sharp 4K result." -ForegroundColor DarkGray
}

# --- 3. Real-ESRGAN x4 upscale (GPU). Same tool + model + scale as upscale-video.ps1. ---
$upscaled = Join-Path $WorkDir "upscaled.jpg"
Write-Host "Upscaling with Real-ESRGAN (realesrgan-x4plus, 4x, GPU)..." -ForegroundColor Yellow
& $esrgan -i "$srcImg" -o "$upscaled" -n realesrgan-x4plus -s 4 -f jpg -g 0
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $upscaled)) { Write-Error "ERROR: Real-ESRGAN upscale failed."; exit 1 }

# --- 4. Resize/crop to exactly 3840x2160 16:9 + JPEG compress ---
# Cover the 16:9 frame (scale up to fill), then center-crop. Works for any source
# aspect ratio without letterboxing.
$final = Join-Path $WorkDir "$VideoId.jpg"
& ffmpeg -nostdin -i "$upscaled" -vf "scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H}" -q:v $JpegQuality "$final" -y -loglevel error
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $final)) { Write-Error "ERROR: resize/crop failed."; exit 1 }

# --- 5. Verify output dims + size ---
$outProbe = (& ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$final" 2>&1).Trim()
$outKb = [math]::Round((Get-Item $final).Length / 1KB, 0)
Write-Host "Output: $outProbe, ${outKb} KB" -ForegroundColor Green
if ($outProbe -ne "${TARGET_W}x${TARGET_H}") { Write-Error "ERROR: output is $outProbe, expected ${TARGET_W}x${TARGET_H}."; exit 1 }
if ($outKb -lt 150 -or $outKb -gt 600) {
    Write-Host "  NOTE: ${outKb} KB is outside the typical 250-420 KB range. Adjust -JpegQuality (lower number = larger/higher quality) if needed." -ForegroundColor DarkYellow
}

# --- 6. Upload to R2 (fi-films, the same bucket + path the page reads) ---
if ($SkipUpload) {
    Write-Host "SkipUpload set. Final thumb left at: $final" -ForegroundColor Cyan
} else {
    $dest = "r2fi:fi-films/couples/$Slug/thumbs/"
    & rclone copyto "$final" "${dest}$VideoId.jpg"
    if ($LASTEXITCODE -ne 0) { Write-Error "ERROR: rclone upload failed (exit $LASTEXITCODE)."; exit 1 }
    Write-Host "Uploaded -> ${dest}$VideoId.jpg" -ForegroundColor Green
    Write-Host "Live at: https://video.flyiniris.com/couples/$Slug/thumbs/$VideoId.jpg"
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
