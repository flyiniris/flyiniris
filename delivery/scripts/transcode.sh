#!/usr/bin/env bash
#
# transcode.sh - Flyin' Iris HLS Transcoder (NVENC, source-resolution-aware)
#
# Transcodes MP4 files into source-aware HLS ladders.
#
#   4K source (>= 3840 wide)         -> 4k/ + 1080p/ ladder (2 rungs)
#   Sub-4K source (1080p, 2K, etc.)  -> 1080p/ only (1 rung)
#   Sub-1080p source (rare)          -> 1080p/ only, source-res passthrough, no upscale
#
# Encoder is NVIDIA NVENC (h264_nvenc -preset p7 -cq 18 top rung, -cq 20 1080p
# rung). This script requires an NVIDIA GPU available to ffmpeg.
#
# Usage:
#   ./transcode.sh -i <input_dir> -c <config_file> [-o <output_dir>]
#
# Dependencies: ffmpeg (with NVENC support), ffprobe, jq

set -euo pipefail

# --- Defaults ---
OUTPUT_DIR="./output"

# --- Usage ---
usage() {
    echo "Usage: $0 -i <input_dir> -c <config_file> [-o <output_dir>]"
    echo ""
    echo "  -i  Directory containing source MP4 files (required)"
    echo "  -c  Path to couple JSON config file (required)"
    echo "  -o  Output directory for HLS files (default: ./output)"
    exit 1
}

# --- Parse arguments ---
INPUT_DIR=""
CONFIG_FILE=""

while getopts "i:c:o:h" opt; do
    case $opt in
        i) INPUT_DIR="$OPTARG" ;;
        c) CONFIG_FILE="$OPTARG" ;;
        o) OUTPUT_DIR="$OPTARG" ;;
        h) usage ;;
        *) usage ;;
    esac
done

if [[ -z "$INPUT_DIR" || -z "$CONFIG_FILE" ]]; then
    echo "ERROR: -i and -c are required."
    usage
fi

# --- Preflight checks ---

if ! command -v ffmpeg &>/dev/null; then
    echo "ERROR: ffmpeg not found in PATH. Install FFmpeg with NVENC support."
    exit 1
fi

if ! command -v ffprobe &>/dev/null; then
    echo "ERROR: ffprobe not found in PATH."
    exit 1
fi

if ! command -v jq &>/dev/null; then
    echo "ERROR: jq not found in PATH. Install jq for JSON manipulation."
    exit 1
fi

if [[ ! -d "$INPUT_DIR" ]]; then
    echo "ERROR: Input directory not found: $INPUT_DIR"
    exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "ERROR: Config file not found: $CONFIG_FILE"
    exit 1
fi

# Resolve to absolute paths
INPUT_DIR="$(cd "$INPUT_DIR" && pwd)"
CONFIG_FILE="$(cd "$(dirname "$CONFIG_FILE")" && pwd)/$(basename "$CONFIG_FILE")"
OUTPUT_DIR="$(mkdir -p "$OUTPUT_DIR" && cd "$OUTPUT_DIR" && pwd)"

# Validate JSON
if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
    echo "ERROR: Config file is not valid JSON: $CONFIG_FILE"
    exit 1
fi

# --- Discover MP4 files ---

shopt -s nullglob
mp4_files=("$INPUT_DIR"/*.mp4)
shopt -u nullglob

if [[ ${#mp4_files[@]} -eq 0 ]]; then
    echo "ERROR: No MP4 files found in $INPUT_DIR"
    exit 1
fi

echo ""
echo "=== Flyin' Iris HLS Transcoder (NVENC, source-resolution-aware) ==="
echo "Input:  $INPUT_DIR"
echo "Output: $OUTPUT_DIR"
echo "Config: $CONFIG_FILE"
echo "Found ${#mp4_files[@]} MP4 file(s)"
echo ""

# Create thumbs directory
mkdir -p "$OUTPUT_DIR/thumbs"

fail_count=0
counter=0
total=${#mp4_files[@]}

# Load config into a temp file for jq manipulation
config_tmp="$(mktemp)"
cp "$CONFIG_FILE" "$config_tmp"

for mp4_path in "${mp4_files[@]}"; do
    counter=$((counter + 1))
    filename="$(basename "$mp4_path")"
    video_id="${filename%.mp4}"
    video_out_dir="$OUTPUT_DIR/$video_id"

    printf "[%d/%d] Processing %s...\n" "$counter" "$total" "$filename"

    # --- Probe duration ---
    duration_sec="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$mp4_path" 2>/dev/null)" || {
        echo "  FAILED (could not probe duration)"
        fail_count=$((fail_count + 1))
        continue
    }
    duration_sec="$(echo "$duration_sec" | tr -d '[:space:]')"

    total_seconds="${duration_sec%%.*}"
    minutes=$((total_seconds / 60))
    seconds=$((total_seconds % 60))
    duration_formatted="$(printf "%d:%02d" "$minutes" "$seconds")"

    # --- Probe resolution ---
    src_width="$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$mp4_path" 2>/dev/null | tr -d '[:space:]')" || {
        echo "  FAILED (could not probe width)"
        fail_count=$((fail_count + 1))
        continue
    }
    src_height="$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$mp4_path" 2>/dev/null | tr -d '[:space:]')"

    echo "  Source: ${src_width}x${src_height}, ${duration_formatted}"

    mkdir -p "$video_out_dir"
    ffmpeg_log="$video_out_dir/ffmpeg.log"

    if [[ "$src_width" -ge 3840 ]]; then
        # 4K source: 4K + 1080p ladder
        echo "  Ladder: 4K + 1080p (NVENC h264_nvenc, preset p7)"
        mkdir -p "$video_out_dir/4k" "$video_out_dir/1080p"

        if ! ffmpeg -nostdin -y -i "$mp4_path" \
            -filter_complex "[0:v]split=2[v4k][v1080];[v4k]copy[v4kout];[v1080]scale=1920:1080:flags=lanczos[v1080out]" \
            -map "[v4kout]" -map "0:a?" \
            -c:v h264_nvenc -preset p7 -cq 18 -pix_fmt yuv420p -c:a aac -b:a 192k \
            -hls_time 6 -hls_playlist_type vod \
            -hls_segment_filename "$video_out_dir/4k/segment_%03d.ts" \
            "$video_out_dir/4k/playlist.m3u8" \
            -map "[v1080out]" -map "0:a?" \
            -c:v h264_nvenc -preset p7 -cq 20 -pix_fmt yuv420p -c:a aac -b:a 128k \
            -hls_time 6 -hls_playlist_type vod \
            -hls_segment_filename "$video_out_dir/1080p/segment_%03d.ts" \
            "$video_out_dir/1080p/playlist.m3u8" \
            2>"$ffmpeg_log"; then
            echo "  FAILED (ffmpeg error)"
            echo "  Check log: $ffmpeg_log"
            fail_count=$((fail_count + 1))
            continue
        fi

        cat > "$video_out_dir/master.m3u8" <<MASTER
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=${src_width}x${src_height},NAME="4K"
4k/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="1080p"
1080p/playlist.m3u8
MASTER

    elif [[ "$src_width" -ge 1920 ]]; then
        # 1080p (or near-1080p / 2K) source: 1080p only
        echo "  Ladder: 1080p only (NVENC h264_nvenc, preset p7)"
        mkdir -p "$video_out_dir/1080p"

        # Passthrough if exactly 1920x1080; otherwise scale-with-pad to 1920x1080.
        if [[ "$src_width" -eq 1920 && "$src_height" -eq 1080 ]]; then
            vf_args=()
        else
            vf_args=(-vf "scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2")
        fi

        if ! ffmpeg -nostdin -y -i "$mp4_path" \
            -map 0:v -map "0:a?" \
            "${vf_args[@]}" \
            -c:v h264_nvenc -preset p7 -cq 18 -pix_fmt yuv420p -c:a aac -b:a 192k \
            -hls_time 6 -hls_playlist_type vod \
            -hls_segment_filename "$video_out_dir/1080p/segment_%03d.ts" \
            "$video_out_dir/1080p/playlist.m3u8" \
            2>"$ffmpeg_log"; then
            echo "  FAILED (ffmpeg error)"
            echo "  Check log: $ffmpeg_log"
            fail_count=$((fail_count + 1))
            continue
        fi

        cat > "$video_out_dir/master.m3u8" <<MASTER
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="1080p"
1080p/playlist.m3u8
MASTER

    else
        # Sub-1080p source (rare): source-res passthrough, no upscale.
        echo "  Ladder: source-res passthrough (NVENC h264_nvenc, preset p7). No upscale."
        mkdir -p "$video_out_dir/1080p"

        if ! ffmpeg -nostdin -y -i "$mp4_path" \
            -map 0:v -map "0:a?" \
            -c:v h264_nvenc -preset p7 -cq 18 -pix_fmt yuv420p -c:a aac -b:a 192k \
            -hls_time 6 -hls_playlist_type vod \
            -hls_segment_filename "$video_out_dir/1080p/segment_%03d.ts" \
            "$video_out_dir/1080p/playlist.m3u8" \
            2>"$ffmpeg_log"; then
            echo "  FAILED (ffmpeg error)"
            echo "  Check log: $ffmpeg_log"
            fail_count=$((fail_count + 1))
            continue
        fi

        cat > "$video_out_dir/master.m3u8" <<MASTER
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=${src_width}x${src_height},NAME="source"
1080p/playlist.m3u8
MASTER
    fi

    # --- Generate fallback thumbnail (25 percent of duration) ---
    # Canonical per-couple thumb flow is Sierra-curated via Vimeo pictures.sizes
    # (see pull-vimeo-thumbs.ps1). This ffmpeg fallback covers local-MP4-only cases.
    thumb_time="$(echo "$duration_sec * 0.25" | bc -l 2>/dev/null || echo "$(( total_seconds / 4 ))")"
    thumb_path="$OUTPUT_DIR/thumbs/$video_id.jpg"
    if ! ffmpeg -nostdin -ss "$thumb_time" -i "$mp4_path" \
        -frames:v 1 \
        -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
        -q:v 2 \
        "$thumb_path" \
        -y 2>/dev/null; then
        printf "  (thumbnail failed, non-fatal)\n"
    fi

    # --- Update config JSON duration ---
    config_tmp_new="$(mktemp)"
    jq --arg id "$video_id" --arg dur "$duration_formatted" \
        '(.videos[] | select(.id == $id)).duration = $dur' \
        "$config_tmp" > "$config_tmp_new"
    mv "$config_tmp_new" "$config_tmp"

    echo "  done (${duration_formatted})"

    # Clean up log on success
    rm -f "$ffmpeg_log"
done

# --- Write updated config JSON ---
cp "$config_tmp" "$CONFIG_FILE"
rm -f "$config_tmp"

# --- Summary ---
echo ""
echo "=== Transcode Complete ==="
echo "Processed: $counter video(s)"
if [[ $fail_count -gt 0 ]]; then
    echo "Failed:    $fail_count video(s)"
fi
echo "Output:    $OUTPUT_DIR"
echo "Config updated: $CONFIG_FILE"
echo ""

if [[ $fail_count -gt 0 ]]; then
    exit 1
fi
