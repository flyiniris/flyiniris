# Flyin' Iris R2 File Rename Script (PowerShell).
# Renames messy original filenames to clean URL-friendly slugs on R2.
#
# Usage: .\rename-r2.ps1
# Prerequisites: rclone installed, R2 remote configured as "r2fi"
#
# WARNING: This uses rclone moveto which RENAMES files on R2.
# Review the commands below before running.

$ErrorActionPreference = "Stop"
$Bucket = "r2fi:fi-films/couples/amanda-boris"

Write-Host "Renaming originals..." -ForegroundColor Cyan

$originals = @(
    @("Ceremony.mp4",                  "ceremony.mp4"),
    @("First Look & Vows.mp4",         "first-look-vows.mp4"),
    @("First Look_Bridesmaids.mp4",    "first-look-bridesmaids.mp4"),
    @("First Look_Dad.mp4",            "first-look-dad.mp4"),
    @("GRAND RAW.mp4",                 "grand-raw.mp4"),
    @("GoPro.mp4",                     "gopro.mp4"),
    @("Grand March_First Dance.mp4",   "grand-march-first-dance.mp4"),
    @("Ketubah Signing.mp4",           "ketubah-signing.mp4"),
    @("Parent Dances.mp4",             "parent-dances.mp4"),
    @("Speeches.mp4",                  "speeches.mp4")
)

foreach ($pair in $originals) {
    $src = "$Bucket/originals/$($pair[0])"
    $dst = "$Bucket/originals/$($pair[1])"
    Write-Host "  $($pair[0])  ->  $($pair[1])"
    rclone moveto $src $dst
}

Write-Host ""
Write-Host "Renaming thumbnails..." -ForegroundColor Cyan

$thumbs = @(
    @("Ceremony.jpg",                  "ceremony.jpg"),
    @("First Look & Vows.jpg",         "first-look-vows.jpg"),
    @("First Look_Bridesmaids.jpg",    "first-look-bridesmaids.jpg"),
    @("First Look_Dad.jpg",            "first-look-dad.jpg"),
    @("GRAND RAW.jpg",                 "grand-raw.jpg"),
    @("GoPro.jpg",                     "gopro.jpg"),
    @("Grand March_First Dance.jpg",   "grand-march-first-dance.jpg"),
    @("Ketubah Signing.jpg",           "ketubah-signing.jpg"),
    @("Parent Dances.jpg",             "parent-dances.jpg"),
    @("Speeches.jpg",                  "speeches.jpg")
)

foreach ($pair in $thumbs) {
    $src = "$Bucket/thumbs/$($pair[0])"
    $dst = "$Bucket/thumbs/$($pair[1])"
    Write-Host "  $($pair[0])  ->  $($pair[1])"
    rclone moveto $src $dst
}

Write-Host ""
Write-Host "Done! Note: highlight and teaser are not yet uploaded." -ForegroundColor Green
