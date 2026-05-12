# Flyin' Iris: New Couple Delivery Workflow

End-to-end guide for setting up a new couple's film delivery page on flyiniris.com.

**Authoritative spec:** `iris-automation/docs/project-knowledge-2026-05/delivery-page-standard.md`. This guide is the operational walkthrough. The spec governs page shape, schema, and brand rules.

## How it all fits together

```
┌─────────────────────────────────────────────────────────────┐
│                    flyiniris.com                             │
│                  (Cloudflare Pages)                          │
│                                                             │
│  /                     → Main website (index.html)          │
│  /films/amanda-boris/  → Couple page (generated HTML)       │
│  /films/<slug>/        → Any new couple                     │
│                                                             │
│  Auto-deploys from GitHub main branch                       │
└─────────────────────────────────────────────────────────────┘
         │ streams video from ↓
┌─────────────────────────────────────────────────────────────┐
│              fi-video-serve Worker                           │
│     (video.flyiniris.com)                                    │
│                                                             │
│  Handles:                                                   │
│  - HLS streaming (source-aware: 4K + 1080p, or 1080p only)  │
│  - Thumbnail serving                                        │
│  - Password auth (JWT tokens)                               │
│  - Full-resolution MP4 downloads (after auth)               │
│  - CORS headers for cross-origin playback                   │
└─────────────────────────────────────────────────────────────┘
         │ reads files from ↓
┌─────────────────────────────────────────────────────────────┐
│              fi-films R2 bucket                              │
│                                                             │
│  couples/<slug>/                                            │
│    hls/<video-id>/master.m3u8        ← HLS playlist         │
│    hls/<video-id>/4k/                ← present if 4K source │
│    hls/<video-id>/1080p/             ← always present       │
│    originals/<video-id>.mp4          ← Full-res downloads   │
│    thumbs/<video-id>.jpg             ← Sierra-curated thumb │
└─────────────────────────────────────────────────────────────┘
```

**The flow:** couple visits page, Vidstack player requests HLS from Worker, Worker fetches from R2, streams adaptive video. For downloads, couple enters password, Worker validates against KV and serves the original MP4.

## Step-by-step: adding a new couple

### Step 1: Prepare source files

Organize the edited MP4s in a folder with clean, URL-safe filenames:

```
C:\Videos\rachel-brandon\
  highlight.mp4
  teaser.mp4
  ceremony.mp4
  speeches.mp4
  first-dance.mp4
```

**Naming rules:**
- Lowercase, hyphens for spaces.
- No special characters (`& ' ( )` etc.).
- These filenames become the video ids used everywhere.

### Step 2: Create the couple config JSON

Real configs live in `delivery/live/<slug>.json` (gitignored). Copy the sample:

```bash
cp delivery/sample/amanda-boris.json delivery/live/rachel-brandon.json
```

Edit:

```json
{
  "slug": "rachel-brandon",
  "coupleNames": "Rachel & Brandon",
  "weddingDate": "October 12, 2024",
  "password": "rb101224",
  "videos": [
    {
      "id": "teaser",
      "title": "Teaser",
      "category": "teaser",
      "duration": "0:00",
      "order": 0,
      "featured": true
    },
    {
      "id": "highlight",
      "title": "Rachel & Brandon's Wedding",
      "category": "highlight",
      "duration": "0:00",
      "order": 1
    },
    {
      "id": "ceremony",
      "title": "Ceremony",
      "category": "archival",
      "duration": "0:00",
      "order": 2
    }
  ]
}
```

**Notes:**
- `slug` is the URL path: `flyiniris.com/films/rachel-brandon`.
- `id` must match the MP4 filename without `.mp4`.
- `duration` set to "0:00" initially. The transcoder fills it.
- Exactly one video must have `featured: true`. Convention: teaser if delivered, otherwise highlight.
- `password` is what the couple enters to unlock downloads.
- `category` must be one of: `highlight`, `teaser`, `archival`, `bonus`.

### Step 3: Transcode to HLS

Converts each MP4 into a source-resolution-aware HLS ladder using NVIDIA NVENC.

- 4K source (3840+ wide): `4k/` + `1080p/` ladder (2 rungs)
- 1080p / 2K source: `1080p/` only (1 rung)
- Sub-1080p source (rare): source-res passthrough into `1080p/`, no upscale

**PowerShell (Windows):**
```powershell
cd C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\scripts

.\transcode.ps1 `
  -InputDir "C:\Videos\rachel-brandon" `
  -ConfigFile "..\live\rachel-brandon.json" `
  -OutputDir ".\output"
```

**Bash:**
```bash
cd ~/flyiniris/delivery/scripts

./transcode.sh \
  -i "/path/to/rachel-brandon" \
  -c "../live/rachel-brandon.json" \
  -o "./output"
```

**What it does:**
- Reads each MP4 from InputDir.
- Probes resolution per clip and emits the matching ladder.
- 4K source: writes `output/<video-id>/4k/` and `output/<video-id>/1080p/` with HLS segments.
- Sub-4K source: writes `output/<video-id>/1080p/` only.
- Generates `master.m3u8` listing only the variants that exist.
- Extracts a 1280x720 fallback thumbnail at 25 percent of duration via ffmpeg. This is a fallback for local-MP4-only flows; the canonical thumbnail flow is Sierra-curated via `pull-vimeo-thumbs.ps1`.
- Updates the config JSON with measured durations.

**Time estimate:** roughly 0.3 to 0.8 min per minute of source video on the RTX hardware (NVENC `-preset p7`). An 8-clip wedding catalog totaling 30 minutes of source typically finishes in 10 to 15 minutes wall clock.

### Step 4: Upload to R2

Upload HLS files, original MP4s, and thumbnails to the R2 bucket.

**PowerShell:**
```powershell
.\upload.ps1 `
  -CoupleSlug "rachel-brandon" `
  -OutputDir ".\output" `
  -OriginalDir "C:\Videos\rachel-brandon"
```

**Bash:**
```bash
./upload.sh \
  -s "rachel-brandon" \
  -o "./output" \
  -r "/path/to/rachel-brandon"
```

**What it does:**
- Syncs HLS files to `fi-films/couples/rachel-brandon/hls/`.
- Syncs original MP4s to `fi-films/couples/rachel-brandon/originals/`.
- Syncs thumbnails to `fi-films/couples/rachel-brandon/thumbs/`.
- Verifies all uploads match.

### Step 5: Set the download password

The couple's download password lives in Cloudflare KV. Set via wrangler:

```bash
cd delivery/workers/video-serve
wrangler kv key put --binding=PASSWORDS "rachel-brandon" "rb101224"
```

(Note: modern wrangler 4.x uses `kv key` with a space, not the older `kv:key` colon form. The colon form silently fails on current wrangler.)

The key is the couple slug. The value is the password from the config JSON.

Alternatively via the Cloudflare REST API:

```bash
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/<account-id>/storage/kv/namespaces/<namespace-id>/values/rachel-brandon" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: text/plain" \
  --data "rb101224"
```

The KV namespace id is in `delivery/workers/video-serve/wrangler.toml` under `[[kv_namespaces]]`.

### Step 6: Generate the couple page

```bash
node delivery/generate-film-page.js delivery/live/rachel-brandon.json
```

This creates:
- `films/rachel-brandon/index.html`, the couple page.
- `films/rachel-brandon/manifest.json`, the PWA manifest.
- `films/rachel-brandon/sw.js`, the service worker.

The generator validates the config strictly. If it fails, every error is listed in one shot. Fix the config and re-run.

### Step 7: Deploy

```bash
git add films/rachel-brandon/
git commit -m "Add Rachel & Brandon film delivery page"
git push
```

Cloudflare Pages auto-deploys from the main branch. The page is live at `flyiniris.com/films/rachel-brandon/` within roughly a minute.

### Step 8: Verify

Test everything before sending the link to the couple:

- [ ] Page loads at `flyiniris.com/films/rachel-brandon/`.
- [ ] Featured video plays with adaptive quality.
- [ ] All collection videos play in the modal.
- [ ] Thumbnails load for every video.
- [ ] Download password works (enter password, unlock, download).
- [ ] Chromecast icon appears on supported devices.
- [ ] AirPlay works on Safari/iOS.
- [ ] Page installs as PWA on phone (Add to Home Screen).

## Quick reference commands

### Verify files in R2

```bash
# List all videos for a couple
rclone lsd r2fi:fi-films/couples/rachel-brandon/hls/

# Check a specific video's segments
rclone ls r2fi:fi-films/couples/rachel-brandon/hls/highlight/1080p/

# Test HLS through the Worker
curl -s "https://video.flyiniris.com/couples/rachel-brandon/hls/highlight/master.m3u8"
```

### Add a video to an existing couple

1. Transcode just the new MP4 (put only that file in a temp folder).
2. Upload the new HLS folder: `rclone copy output/<video-id>/ r2fi:fi-films/couples/<slug>/hls/<video-id>/`.
3. Upload the original: `rclone copy <video>.mp4 r2fi:fi-films/couples/<slug>/originals/`.
4. Upload the thumbnail: `rclone copy output/thumbs/<video-id>.jpg r2fi:fi-films/couples/<slug>/thumbs/`.
5. Add the video entry to `delivery/live/<slug>.json`.
6. Re-generate the page (Step 6 above).
7. Commit and push.

### Remove a video from a couple

1. Delete HLS: `rclone purge r2fi:fi-films/couples/<slug>/hls/<video-id>/`.
2. Delete original: `rclone delete r2fi:fi-films/couples/<slug>/originals/<video-id>.mp4`.
3. Delete thumbnail: `rclone delete r2fi:fi-films/couples/<slug>/thumbs/<video-id>.jpg`.
4. Remove the entry from `delivery/live/<slug>.json`.
5. Re-generate the page and push.

### Change a couple's download password

```bash
cd delivery/workers/video-serve
wrangler kv key put --binding=PASSWORDS "<slug>" "new-password-here"
```

Update the password in `delivery/live/<slug>.json` to keep the local source aligned with KV. The config file is gitignored so the new password stays local.

## Playback features

Every couple page includes:
- **Adaptive HLS streaming**, source-aware ladder: 4K + 1080p for hero deliverables (teaser, highlight, story session), 1080p only for day-of archival clips. Player picks the right rung based on connection and viewport.
- **Chromecast**, cast to any Chromecast-enabled TV.
- **AirPlay**, cast to Apple TV from Safari/iOS.
- **Quality selector**, manual quality override in player controls.
- **Fullscreen and PiP**, picture-in-picture for multitasking.
- **Keyboard shortcuts**, space to pause, arrows to seek, F for fullscreen.
- **PWA**, installable as a phone app via Add to Home Screen.
- **Password-gated downloads**, full-resolution MP4s behind a simple password.
- **Film grain overlay**, cinematic look matching Flyin' Iris branding.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Video shows loading spinner forever | Check HLS files exist in R2: `rclone ls r2fi:fi-films/couples/<slug>/hls/<video-id>/`. |
| Thumbnail missing (dark placeholder) | Upload thumbnail: `rclone copy output/thumbs/<id>.jpg r2fi:fi-films/couples/<slug>/thumbs/`. |
| Download password not working | Verify KV value: `wrangler kv key get --binding=PASSWORDS <slug>`. |
| Chromecast not showing | Must be on same Wi-Fi as Cast device. Only works in Chrome. |
| Page not updating after push | Hard refresh (`Ctrl+Shift+R`). Cloudflare Pages can take 1 to 2 min. |
| Transcode is very slow | Confirm NVENC is actually being used. ffmpeg should print `h264_nvenc` in stream encoder lines. If it's falling back to libx264 the GPU isn't reachable. Check `nvidia-smi`. |
| rclone upload fails | Check remote: `rclone lsd r2fi:fi-films/`. If auth error, re-run `rclone config`. |
| Generator rejects config | Read every error printed. Common: deprecated `names`/`date`/`photos` fields, missing `featured: true`, invalid category. See spec Section 5.2. |
