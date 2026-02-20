# R2 Upload Best Practices

## Quick Reference

- **Bucket name:** `fi-films`
- **rclone remote:** `r2fi`
- **Public URL:** `https://pub-3341f3d8ad7e4901ad7a54fdac1d90ef.r2.dev/`
- **Worker URL:** `https://video.flyiniris.com/`

---

## 1. Use rclone (NOT wrangler)

Wrangler has a **300 MB upload limit**. Use rclone instead — it handles multipart uploads for large files automatically.

```bash
# Upload a single file
rclone copy "path/to/file.mp4" r2fi:fi-films/destination/folder/

# Upload and rename in one step
rclone copyto "path/to/file.mp4" r2fi:fi-films/clean-filename.mp4

# Upload an entire folder
rclone copy "path/to/folder/" r2fi:fi-films/destination/folder/
```

## 2. File Naming Rules

**Always rename files to clean, URL-safe names before uploading.**

| Bad | Good |
|-----|------|
| `Teaser- Rachel & Brandon's Wedding 10.12.24.mp4` | `rb-teaser.mp4` |
| `Final Cut (v2) MASTER.mp4` | `highlight.mp4` |
| `IMG_1234 copy.jpg` | `ceremony-thumb.jpg` |

- Lowercase, hyphens instead of spaces
- No special characters (`&`, `'`, `(`, `)`, etc.)
- Keep it short and descriptive

## 3. Bucket Folder Structure

Follow this structure for couple film deliveries:

```
fi-films/
  couples/{slug}/
    hls/{video-id}/
      master.m3u8
      1080p/playlist.m3u8, segments...
      720p/...
      480p/...
    originals/{video-id}.mp4
    thumbs/{video-id}.jpg
```

For quick tests or standalone files, the bucket root is fine:
```
fi-films/rb-teaser.mp4
```

## 4. Serving: Worker vs Public Bucket

| | Worker (`video.flyiniris.com`) | Public Bucket (`pub-*.r2.dev`) |
|---|---|---|
| **Use for** | Production couple pages | Quick tests, examples, sharing |
| **HLS streaming** | Yes | No |
| **CORS headers** | Yes (configured) | No |
| **Auth/downloads** | Yes (password-gated) | No (public) |
| **Custom domain** | Yes | No |
| **crossorigin attr** | Include on player | Remove from player |

**Important:** When using the public bucket URL directly in a Vidstack player, do NOT include the `crossorigin` attribute or the video won't load.

```html
<!-- Public R2 bucket — no crossorigin -->
<media-player src="https://pub-...r2.dev/file.mp4" playsinline>

<!-- Worker URL — include crossorigin -->
<media-player src="https://video.flyiniris.com/..." crossorigin playsinline>
```

## 5. Verify Upload

```bash
# List files in a bucket path
rclone ls r2fi:fi-films/

# List files in a subfolder
rclone ls r2fi:fi-films/couples/amanda-boris/originals/

# Check file size
rclone size r2fi:fi-films/rb-teaser.mp4

# Test public URL (use -k on Windows if SSL errors)
curl -k -sI "https://pub-3341f3d8ad7e4901ad7a54fdac1d90ef.r2.dev/rb-teaser.mp4"
```

## 6. Common Operations

```bash
# Delete a file
rclone delete r2fi:fi-films/old-file.mp4

# Move/rename a file (server-side, instant)
rclone moveto r2fi:fi-films/old-name.mp4 r2fi:fi-films/new-name.mp4

# Copy within R2 (server-side, instant)
rclone copyto r2fi:fi-films/source.mp4 r2fi:fi-films/couples/slug/originals/source.mp4

# Sync a local folder to R2 (uploads only new/changed files)
rclone sync "local/folder/" r2fi:fi-films/destination/ --progress
```

## 7. Upload Checklist

- [ ] Rename file to a clean, URL-safe name
- [ ] Upload with `rclone copy` or `rclone copyto`
- [ ] Verify with `rclone ls` that it's in the right path
- [ ] If for a couple page: place in `couples/{slug}/` structure
- [ ] If using public URL directly: remove `crossorigin` from the player
- [ ] Test playback in browser before pushing
