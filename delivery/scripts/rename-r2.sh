#!/usr/bin/env bash
# Flyin' Iris — R2 File Rename Script (Bash)
# Renames messy original filenames to clean URL-friendly slugs on R2.
#
# Usage: bash rename-r2.sh
# Prerequisites: rclone installed, R2 remote configured as "r2fi"
#
# WARNING: This uses rclone moveto which RENAMES files on R2.
# Review the commands below before running.

set -euo pipefail

BUCKET="r2fi:fi-films/couples/amanda-boris"

echo "Renaming originals..."

rclone moveto "$BUCKET/originals/Ceremony.mp4"                "$BUCKET/originals/ceremony.mp4"
rclone moveto "$BUCKET/originals/First Look & Vows.mp4"       "$BUCKET/originals/first-look-vows.mp4"
rclone moveto "$BUCKET/originals/First Look_Bridesmaids.mp4"  "$BUCKET/originals/first-look-bridesmaids.mp4"
rclone moveto "$BUCKET/originals/First Look_Dad.mp4"          "$BUCKET/originals/first-look-dad.mp4"
rclone moveto "$BUCKET/originals/GRAND RAW.mp4"               "$BUCKET/originals/grand-raw.mp4"
rclone moveto "$BUCKET/originals/GoPro.mp4"                   "$BUCKET/originals/gopro.mp4"
rclone moveto "$BUCKET/originals/Grand March_First Dance.mp4" "$BUCKET/originals/grand-march-first-dance.mp4"
rclone moveto "$BUCKET/originals/Ketubah Signing.mp4"         "$BUCKET/originals/ketubah-signing.mp4"
rclone moveto "$BUCKET/originals/Parent Dances.mp4"           "$BUCKET/originals/parent-dances.mp4"
rclone moveto "$BUCKET/originals/Speeches.mp4"                "$BUCKET/originals/speeches.mp4"

echo ""
echo "Renaming thumbnails..."

rclone moveto "$BUCKET/thumbs/Ceremony.jpg"                "$BUCKET/thumbs/ceremony.jpg"
rclone moveto "$BUCKET/thumbs/First Look & Vows.jpg"       "$BUCKET/thumbs/first-look-vows.jpg"
rclone moveto "$BUCKET/thumbs/First Look_Bridesmaids.jpg"  "$BUCKET/thumbs/first-look-bridesmaids.jpg"
rclone moveto "$BUCKET/thumbs/First Look_Dad.jpg"          "$BUCKET/thumbs/first-look-dad.jpg"
rclone moveto "$BUCKET/thumbs/GRAND RAW.jpg"               "$BUCKET/thumbs/grand-raw.jpg"
rclone moveto "$BUCKET/thumbs/GoPro.jpg"                   "$BUCKET/thumbs/gopro.jpg"
rclone moveto "$BUCKET/thumbs/Grand March_First Dance.jpg" "$BUCKET/thumbs/grand-march-first-dance.jpg"
rclone moveto "$BUCKET/thumbs/Ketubah Signing.jpg"         "$BUCKET/thumbs/ketubah-signing.jpg"
rclone moveto "$BUCKET/thumbs/Parent Dances.jpg"           "$BUCKET/thumbs/parent-dances.jpg"
rclone moveto "$BUCKET/thumbs/Speeches.jpg"                "$BUCKET/thumbs/speeches.jpg"

echo ""
echo "Done! Note: highlight and teaser are not yet uploaded."
