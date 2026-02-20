# Flyin' Iris — New Couple Delivery Workflow

Complete guide for setting up a new couple's film delivery page on flyiniris.com.

---

## How It All Fits Together

```
┌─────────────────────────────────────────────────────────────┐
│                    flyiniris.com                             │
│                  (Cloudflare Pages)                          │
│                                                             │
│  /                     → Main website (index.html)          │
│  /films/amanda-boris/  → Couple page (generated HTML)       │
│  /films/rachel-brandon/→ Another couple page                │
│  /films/{slug}/        → Any new couple                     │
│                                                             │
│  Auto-deploys from GitHub main branch                       │
└─────────────────────────────────────────────────────────────┘
         │ streams video from ↓
┌─────────────────────────────────────────────────────────────┐
│              fi-video-serve Worker                           │
│     (fi-video-serve.flyin-iris-mp.workers.dev)              │
│                                                             │
│  Handles:                                                   │
│  • HLS streaming (adaptive 1080p/720p/480p)                 │
│  • Thumbnail serving                                        │
│  • Password auth (JWT tokens)                               │
│  • Full-res MP4 downloads (after auth)                      │
│  • CORS headers for cross-origin playback                   │
└─────────────────────────────────────────────────────────────┘
         │ reads files from ↓
┌─────────────────────────────────────────────────────────────┐
│              fi-films R2 Bucket                              │
│                                                             │
│  couples/{slug}/                                            │
│    hls/{video-id}/master.m3u8        ← HLS playlists        │
│    hls/{video-id}/1080p/             ← HD segments           │
│    hls/{video-id}/720p/              ← Med segments          │
│    hls/{video-id}/480p/              ← Low segments          │
│    originals/{video-id}.mp4          ← Full-res downloads    │
│    thumbs/{video-id}.jpg             ← Video thumbnails      │
└─────────────────────────────────────────────────────────────┘
```

**The flow:** Couple visits page → Vidstack player requests HLS from Worker → Worker fetches from R2 → streams adaptive video. For downloads, couple enters password → Worker validates → serves original MP4.

---

## Step-by-Step: Adding a New Couple

### Step 1: Prepare Source Files

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
- Lowercase, hyphens for spaces
- No special characters (& ' ( ) etc.)
- These filenames become the video IDs used everywhere

### Step 2: Create the Couple Config JSON

Copy `delivery/sample/amanda-boris.json` and edit:

```json
{
  "slug": "rachel-brandon",
  "names": ["Rachel", "Brandon"],
  "date": "October 12, 2024",
  "date_short": "10.12.2024",
  "password": "rb101224",
  "videos": [
    {
      "id": "highlight",
      "title": "Rachel & Brandon's Wedding",
      "category": "highlight",
      "duration": "0:00",
      "order": 0,
      "featured": true
    },
    {
      "id": "teaser",
      "title": "Teaser",
      "category": "teaser",
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
  ],
  "photos": {
    "enabled": false,
    "message": "Your photos from the big day will be viewable here soon."
  }
}
```

**Notes:**
- `slug` = URL path (flyiniris.com/films/**rachel-brandon**)
- `id` must match the MP4 filename (without .mp4)
- `duration` set to "0:00" — the transcoder auto-fills it
- `featured: true` on one video makes it the big player at the top
- `password` is what the couple enters to unlock downloads
- Categories: `highlight`, `teaser`, `archival`, `bonus`

Save as `delivery/sample/rachel-brandon.json`

### Step 3: Transcode to HLS

This converts each MP4 into 3 quality levels of HLS segments.

**PowerShell (Windows):**
```powershell
cd C:\Users\sierh\flyiniris\delivery\scripts

.\transcode.ps1 `
  -InputDir "C:\Videos\rachel-brandon" `
  -ConfigFile "..\sample\rachel-brandon.json" `
  -OutputDir ".\output"
```

**Bash:**
```bash
cd ~/flyiniris/delivery/scripts

./transcode.sh \
  -i "/path/to/rachel-brandon" \
  -c "../sample/rachel-brandon.json" \
  -o "./output"
```

**What it does:**
- Reads each MP4 from InputDir
- Creates `output/{video-id}/1080p/`, `720p/`, `480p/` with HLS segments
- Generates `master.m3u8` for adaptive bitrate switching
- Extracts a thumbnail at 25% of the video
- Updates the config JSON with actual durations

**Time estimate:** ~2-5 min per minute of source video, depending on your CPU.

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
- Syncs HLS files to `fi-films/couples/rachel-brandon/hls/`
- Syncs original MP4s to `fi-films/couples/rachel-brandon/originals/`
- Syncs thumbnails to `fi-films/couples/rachel-brandon/thumbs/`
- Verifies all uploads match

### Step 5: Set the Download Password

The couple's download password is stored in Cloudflare KV. Set it via the API:

```bash
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/b3269400156817c0292ea7f07141f369/storage/kv/namespaces/6258df80d4cf4a1385b7cbe29b146064/values/rachel-brandon" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: text/plain" \
  --data "rb101224"
```

The key is the couple slug, the value is the password from the config JSON.

### Step 6: Generate the Couple Page

```bash
cd ~/flyiniris/delivery

python generate.py \
  --config sample/rachel-brandon.json \
  --template templates/couple-page.html \
  --manifest templates/manifest.json \
  --sw templates/sw.js \
  --worker-base "https://fi-video-serve.flyin-iris-mp.workers.dev" \
  --output-dir ../films
```

This creates:
- `films/rachel-brandon/index.html` — the couple page
- `films/rachel-brandon/manifest.json` — PWA manifest
- `films/rachel-brandon/sw.js` — service worker for offline

### Step 7: Deploy

```bash
cd ~/flyiniris
git add films/rachel-brandon/
git commit -m "Add Rachel & Brandon film delivery page"
git push
```

Cloudflare Pages auto-deploys from the main branch. The page will be live at `flyiniris.com/films/rachel-brandon/` within ~1 minute.

### Step 8: Verify

Test everything before sending the link to the couple:

- [ ] Page loads at `flyiniris.com/films/rachel-brandon/`
- [ ] Featured video plays with adaptive quality
- [ ] All collection videos play in the modal
- [ ] Thumbnails load for every video
- [ ] Download password works (enter password → unlock → download)
- [ ] Chromecast icon appears on supported devices
- [ ] AirPlay works on Safari/iOS
- [ ] Page installs as PWA on phone (Add to Home Screen)

---

## Quick Reference Commands

### Verify files in R2
```bash
# List all videos for a couple
rclone lsd r2fi:fi-films/couples/rachel-brandon/hls/

# Check a specific video's segments
rclone ls r2fi:fi-films/couples/rachel-brandon/hls/highlight/1080p/

# Test HLS through Worker
curl -s "https://fi-video-serve.flyin-iris-mp.workers.dev/couples/rachel-brandon/hls/highlight/master.m3u8"
```

### Add a video to an existing couple
1. Transcode just the new MP4 (put only that file in a temp folder)
2. Upload the new HLS folder: `rclone copy output/{video-id}/ r2fi:fi-films/couples/{slug}/hls/{video-id}/`
3. Upload the original: `rclone copy {video}.mp4 r2fi:fi-films/couples/{slug}/originals/`
4. Upload the thumbnail: `rclone copy output/thumbs/{video-id}.jpg r2fi:fi-films/couples/{slug}/thumbs/`
5. Add the video entry to the config JSON
6. Re-generate the page (Step 6)
7. Commit and push

### Remove a video from a couple
1. Delete HLS: `rclone purge r2fi:fi-films/couples/{slug}/hls/{video-id}/`
2. Delete original: `rclone delete r2fi:fi-films/couples/{slug}/originals/{video-id}.mp4`
3. Delete thumbnail: `rclone delete r2fi:fi-films/couples/{slug}/thumbs/{video-id}.jpg`
4. Remove the entry from config JSON
5. Re-generate the page and push

### Change a couple's download password
```bash
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/b3269400156817c0292ea7f07141f369/storage/kv/namespaces/6258df80d4cf4a1385b7cbe29b146064/values/{slug}" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: text/plain" \
  --data "new-password-here"
```

---

## Playback Features

Every couple page includes:
- **Adaptive HLS streaming** — auto-adjusts to 1080p/720p/480p based on connection
- **Chromecast** — cast to any Chromecast-enabled TV
- **AirPlay** — cast to Apple TV from Safari/iOS
- **Quality selector** — manual quality override in player controls
- **Fullscreen & PiP** — picture-in-picture for multitasking
- **Keyboard shortcuts** — space to pause, arrows to seek, F for fullscreen
- **PWA** — installable as a phone app via Add to Home Screen
- **Password-gated downloads** — full-res MP4s behind a simple password
- **Film grain overlay** — cinematic look matching Flyin' Iris branding

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Video shows loading spinner forever | Check HLS files exist in R2: `rclone ls r2fi:fi-films/couples/{slug}/hls/{video-id}/` |
| Thumbnail missing (dark placeholder) | Upload thumbnail: `rclone copy output/thumbs/{id}.jpg r2fi:fi-films/couples/{slug}/thumbs/` |
| Download password not working | Verify KV value: check Cloudflare dashboard > Workers & Pages > KV > PASSWORDS |
| Chromecast not showing | Must be on same Wi-Fi as Cast device. Only works in Chrome. |
| Page not updating after push | Hard refresh (`Ctrl+Shift+R`). Cloudflare Pages can take 1-2 min. |
| Transcode is very slow | Use `-preset fast` instead of `medium` in transcode script (slightly lower quality) |
| rclone upload fails | Check remote: `rclone lsd r2fi:fi-films/` — if auth error, re-run `rclone config` |
