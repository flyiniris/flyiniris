#!/usr/bin/env bash
#
# transcode.sh — Flyin' Iris HLS Transcoder
#
# Transcodes MP4 files into multi-bitrate HLS streams.
# For each MP4, creates 1080p/720p/480p variants, master playlist,
# thumbnail, and updates the couple config JSON with detected durations.
#
# Usage:
#   ./transcode.sh -i <input_dir> -c <config_file> [-o <output_dir>]
#
# Dependencies: ffmpeg, ffprobe, jq

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
    echo "ERROR: ffmpeg not found in PATH. Install FFmpeg and ensure it is on your PATH."
    exit 1
fi

if ! command -v ffprobe &>/dev/null; then
    echo "ERROR: ffprobe not found in PATH. Install FFmpeg and ensure it is on your PATH."
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
echo "=== Flyin' Iris HLS Transcoder ==="
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

    printf "[%d/%d] Processing %s..." "$counter" "$total" "$filename"

    # --- Probe duration ---
    duration_sec="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$mp4_path" 2>/dev/null)" || {
        echo " FAILED (could not probe duration)"
        fail_count=$((fail_count + 1))
        continue
    }
    # Trim whitespace
    duration_sec="$(echo "$duration_sec" | tr -d '[:space:]')"

    # Convert to M:SS format
    total_seconds="${duration_sec%%.*}"
    minutes=$((total_seconds / 60))
    seconds=$((total_seconds % 60))
    duration_formatted="$(printf "%d:%02d" "$minutes" "$seconds")"

    # --- Create output directories ---
    mkdir -p "$video_out_dir/1080p" "$video_out_dir/720p" "$video_out_dir/480p"

    # --- Transcode to HLS (single-pass, 3 qualities) ---
    if ! ffmpeg -i "$mp4_path" \
        -filter_complex "[0:v]split=3[v1][v2][v3];[v1]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v1out];[v2]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v2out];[v3]scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2[v3out]" \
        -map "[v1out]" -map "0:a?" \
        -c:v:0 libx264 -b:v:0 5000k -c:a:0 aac -b:a:0 128k \
        -preset medium -g 48 -keyint_min 48 \
        -hls_time 4 -hls_segment_type mpegts \
        -hls_segment_filename "$video_out_dir/1080p/segment%03d.ts" \
        -hls_playlist_type vod \
        "$video_out_dir/1080p/playlist.m3u8" \
        -map "[v2out]" -map "0:a?" \
        -c:v:1 libx264 -b:v:1 2500k -c:a:1 aac -b:a:1 128k \
        -preset medium -g 48 -keyint_min 48 \
        -hls_time 4 -hls_segment_type mpegts \
        -hls_segment_filename "$video_out_dir/720p/segment%03d.ts" \
        -hls_playlist_type vod \
        "$video_out_dir/720p/playlist.m3u8" \
        -map "[v3out]" -map "0:a?" \
        -c:v:2 libx264 -b:v:2 1000k -c:a:2 aac -b:a:2 128k \
        -preset medium -g 48 -keyint_min 48 \
        -hls_time 4 -hls_segment_type mpegts \
        -hls_segment_filename "$video_out_dir/480p/segment%03d.ts" \
        -hls_playlist_type vod \
        "$video_out_dir/480p/playlist.m3u8" \
        -y 2>"$video_out_dir/ffmpeg.log"; then
        echo " FAILED (ffmpeg error)"
        echo "  Check log: $video_out_dir/ffmpeg.log"
        fail_count=$((fail_count + 1))
        continue
    fi

    # --- Generate master.m3u8 ---
    cat > "$video_out_dir/master.m3u8" <<'MASTER'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5128000,RESOLUTION=1920x1080,NAME="1080p"
1080p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,NAME="720p"
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1128000,RESOLUTION=854x480,NAME="480p"
480p/playlist.m3u8
MASTER

    # --- Generate thumbnail (frame at 25% duration) ---
    thumb_time="$(echo "$duration_sec * 0.25" | bc -l 2>/dev/null || echo "$(( total_seconds / 4 ))")"
    thumb_path="$OUTPUT_DIR/thumbs/$video_id.jpg"
    if ! ffmpeg -ss "$thumb_time" -i "$mp4_path" \
        -frames:v 1 \
        -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
        -q:v 2 \
        "$thumb_path" \
        -y 2>/dev/null; then
        printf " (thumbnail failed)"
    fi

    # --- Update config JSON duration ---
    config_tmp_new="$(mktemp)"
    jq --arg id "$video_id" --arg dur "$duration_formatted" \
        '(.videos[] | select(.id == $id)).duration = $dur' \
        "$config_tmp" > "$config_tmp_new"
    mv "$config_tmp_new" "$config_tmp"

    echo " done ($duration_formatted)"

    # Clean up log on success
    rm -f "$video_out_dir/ffmpeg.log"
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
