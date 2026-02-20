#!/usr/bin/env bash
#
# upload.sh — Flyin' Iris R2 Uploader
#
# Uploads transcoded HLS files, original MP4s, and thumbnails to
# Cloudflare R2 via rclone (pre-configured remote: r2fi, bucket: fi-films).
#
# Usage:
#   ./upload.sh -s <couple_slug> -o <output_dir> -r <original_dir>
#
# Dependencies: rclone (with r2fi remote configured)

set -euo pipefail

# --- Usage ---
usage() {
    echo "Usage: $0 -s <couple_slug> -o <output_dir> -r <original_dir>"
    echo ""
    echo "  -s  Couple slug (e.g., amanda-boris) (required)"
    echo "  -o  HLS output directory from transcode.sh (required)"
    echo "  -r  Directory containing original source MP4 files (required)"
    exit 1
}

# --- Parse arguments ---
COUPLE_SLUG=""
OUTPUT_DIR=""
ORIGINAL_DIR=""

while getopts "s:o:r:h" opt; do
    case $opt in
        s) COUPLE_SLUG="$OPTARG" ;;
        o) OUTPUT_DIR="$OPTARG" ;;
        r) ORIGINAL_DIR="$OPTARG" ;;
        h) usage ;;
        *) usage ;;
    esac
done

if [[ -z "$COUPLE_SLUG" || -z "$OUTPUT_DIR" || -z "$ORIGINAL_DIR" ]]; then
    echo "ERROR: -s, -o, and -r are required."
    usage
fi

# --- Preflight checks ---

if ! command -v rclone &>/dev/null; then
    echo "ERROR: rclone not found in PATH. Install rclone and configure the r2fi remote."
    exit 1
fi

if [[ ! -d "$OUTPUT_DIR" ]]; then
    echo "ERROR: Output directory not found: $OUTPUT_DIR"
    exit 1
fi

if [[ ! -d "$ORIGINAL_DIR" ]]; then
    echo "ERROR: Original directory not found: $ORIGINAL_DIR"
    exit 1
fi

# Resolve to absolute paths
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
ORIGINAL_DIR="$(cd "$ORIGINAL_DIR" && pwd)"

BUCKET="r2fi:fi-films"
BASE_REMOTE="$BUCKET/couples/$COUPLE_SLUG"

echo ""
echo "=== Flyin' Iris R2 Uploader ==="
echo "Couple:    $COUPLE_SLUG"
echo "HLS:       $OUTPUT_DIR"
echo "Originals: $ORIGINAL_DIR"
echo "Remote:    $BASE_REMOTE"
echo ""

has_errors=false

# --- Upload HLS (exclude thumbs) ---
echo "[1/3] Uploading HLS files..."
if rclone sync "$OUTPUT_DIR" "$BASE_REMOTE/hls/" --exclude "thumbs/**" --progress; then
    echo "      HLS upload complete."
else
    echo "      HLS upload FAILED."
    has_errors=true
fi

# --- Upload originals ---
echo "[2/3] Uploading original MP4s..."
if rclone sync "$ORIGINAL_DIR" "$BASE_REMOTE/originals/" --progress; then
    echo "      Originals upload complete."
else
    echo "      Originals upload FAILED."
    has_errors=true
fi

# --- Upload thumbnails ---
THUMBS_DIR="$OUTPUT_DIR/thumbs"
if [[ -d "$THUMBS_DIR" ]]; then
    echo "[3/3] Uploading thumbnails..."
    if rclone sync "$THUMBS_DIR" "$BASE_REMOTE/thumbs/" --progress; then
        echo "      Thumbnails upload complete."
    else
        echo "      Thumbnails upload FAILED."
        has_errors=true
    fi
else
    echo "[3/3] No thumbs directory found, skipping thumbnail upload."
fi

# --- Verify uploads ---
echo ""
echo "Verifying uploads..."

verify_failed=false

echo "  Checking HLS..."
if ! rclone check "$OUTPUT_DIR" "$BASE_REMOTE/hls/" --exclude "thumbs/**" 2>&1; then
    verify_failed=true
fi

echo "  Checking originals..."
if ! rclone check "$ORIGINAL_DIR" "$BASE_REMOTE/originals/" 2>&1; then
    verify_failed=true
fi

if [[ -d "$THUMBS_DIR" ]]; then
    echo "  Checking thumbnails..."
    if ! rclone check "$THUMBS_DIR" "$BASE_REMOTE/thumbs/" 2>&1; then
        verify_failed=true
    fi
fi

if [[ "$verify_failed" == "true" ]]; then
    echo "  Verification found errors."
    has_errors=true
else
    echo "  All files verified."
fi

# --- Summary ---
echo ""
echo "=== Upload Summary ==="

echo "Remote HLS size:"
rclone size "$BASE_REMOTE/hls/" 2>&1 | sed 's/^/  /'

echo "Remote originals size:"
rclone size "$BASE_REMOTE/originals/" 2>&1 | sed 's/^/  /'

echo "Remote thumbnails size:"
rclone size "$BASE_REMOTE/thumbs/" 2>&1 | sed 's/^/  /'

echo ""

if [[ "$has_errors" == "true" ]]; then
    echo "Upload completed with errors. Check output above."
    exit 1
else
    echo "All uploads completed successfully."
fi
