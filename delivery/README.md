# Flyin' Iris — Film Delivery Platform

A Netflix-style branded video delivery platform for wedding videography clients. Each couple gets their own page at `flyiniris.com/films/{couple-slug}` where they can stream all their wedding films (highlight, teaser, archival footage), download full-res MP4s, and install it as a phone app via PWA.

Videos are stored on Cloudflare R2 and streamed via HLS through a Cloudflare Worker. No third-party video hosting — everything is self-owned.

## Prerequisites

Install these before proceeding:

| Tool | Purpose | Install |
|---|---|---|
| **FFmpeg** | Video transcoding to HLS | [ffmpeg.org/download](https://ffmpeg.org/download.html) — must be in PATH |
| **rclone** | Upload files to Cloudflare R2 | [rclone.org/install](https://rclone.org/install/) |
| **Python 3.8+** | Page generator script | [python.org](https://www.python.org/downloads/) |
| **Node.js 18+** | Cloudflare Worker development | [nodejs.org](https://nodejs.org/) |
| **Wrangler CLI** | Deploy Workers & manage KV | `npm install -g wrangler` |

Verify everything is installed:

```bash
ffmpeg -version
rclone version
python --version
node --version
wrangler --version
```

## Initial Setup

These steps only need to be done once.

### 1. Create the R2 Bucket

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com/)
2. Go to **R2 Object Storage** in the sidebar
3. Click **Create Bucket**
4. Name it `fi-films`
5. Choose the region closest to you (or leave as automatic)
6. Click **Create Bucket**

### 2. Create an R2 API Token

1. In the Cloudflare dashboard, go to **R2** > **Manage R2 API Tokens**
2. Click **Create API Token**
3. Set permissions to **Object Read & Write**
4. Scope it to the `fi-films` bucket only
5. Click **Create API Token**
6. Save the **Access Key ID** and **Secret Access Key** — you will need them in the next step

### 3. Configure rclone

Run `rclone config` and follow the prompts:

```
rclone config

n         (new remote)
r2fi      (name — must be exactly "r2fi")
s3        (storage type — choose "Amazon S3 Compliant")

Choose provider:
Cloudflare

Enter access_key_id:
<paste your Access Key ID from step 2>

Enter secret_access_key:
<paste your Secret Access Key from step 2>

Enter region:
auto

Enter endpoint:
https://<your-account-id>.r2.cloudflarestorage.com
```

Your Cloudflare Account ID is in the dashboard URL or on the R2 overview page.

Test the connection:

```bash
rclone lsd r2fi:fi-films
```

This should return without errors (empty output is fine for a new bucket).

### 4. Deploy the Video Worker

```bash
cd delivery/workers/video-serve
npm install
wrangler login        # authenticate with Cloudflare (first time only)
wrangler deploy
```

### 5. Set Worker Secrets

```bash
cd delivery/workers/video-serve
wrangler secret put JWT_SECRET
```

When prompted, enter a long random string (32+ characters). This is used to sign authentication tokens for video access.

### 6. Add the Custom Domain

1. In the Cloudflare dashboard, go to **Workers & Pages**
2. Click on the **video-serve** Worker
3. Go to **Settings** > **Triggers** > **Custom Domains**
4. Add `video.flyiniris.com`
5. Cloudflare will handle DNS and SSL automatically

## Delivering Films to a Couple

Follow these steps each time you deliver films to a new couple.

### Step 1: Export Final MP4s

Export your edited videos from your editing software (Premiere, DaVinci, etc.) as MP4 files into a single folder. Name each file by its video ID:

```
C:\exports\amanda-boris\
  highlight.mp4
  teaser.mp4
  ceremony.mp4
  speeches.mp4
  ...
```

The filenames (without `.mp4`) must match the `id` values in the config JSON.

### Step 2: Create the Couple Config JSON

Create a JSON config file for the couple. You can copy and modify `delivery/sample/amanda-boris.json`.

Save it to `delivery/sample/{slug}.json`.

**Template:**

```json
{
  "slug": "firstname-firstname",
  "names": ["FirstName1", "FirstName2"],
  "date": "Month Day, Year",
  "date_short": "MM.DD.YYYY",
  "password": "initials+dateshort",
  "videos": [
    {
      "id": "highlight",
      "title": "FirstName1 & FirstName2's Wedding",
      "category": "highlight",
      "duration": "0:00",
      "order": 0,
      "featured": true
    }
  ],
  "photos": {
    "enabled": false,
    "message": "Your photos from the big day will be viewable here soon."
  }
}
```

**Field reference:**

| Field | Type | Description |
|---|---|---|
| `slug` | string | URL-safe couple identifier (lowercase, hyphens only). Used in the URL: `flyiniris.com/films/{slug}` |
| `names` | string[] | Array of exactly 2 first names |
| `date` | string | Long-form wedding date, e.g., `"August 31, 2025"` |
| `date_short` | string | Short-form date, e.g., `"08.31.2025"` |
| `password` | string | Password the couple uses to access downloads |
| `videos` | object[] | Array of video entries (see below) |
| `photos.enabled` | boolean | Whether the photos section is active |
| `photos.message` | string | Placeholder message when photos are not yet available |

**Video entry fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier, must match the MP4 filename |
| `title` | string | Display title shown on the page |
| `category` | string | One of: `highlight`, `teaser`, `archival`, `bonus` |
| `duration` | string | Video length in `M:SS` or `MM:SS` format |
| `order` | number | Display order (0 = first) |
| `featured` | boolean | (optional) If `true`, this video is shown prominently at the top |

The `duration` field will be automatically updated by the transcode script.

### Step 3: Transcode Videos

This creates HLS streams (1080p, 720p, 480p) and thumbnails from the source MP4s.

**PowerShell (Windows):**

```powershell
.\delivery\scripts\transcode.ps1 `
  -InputDir "C:\exports\amanda-boris" `
  -ConfigFile "delivery\sample\amanda-boris.json"
```

**Bash (Mac/Linux/WSL):**

```bash
./delivery/scripts/transcode.sh \
  -i ./exports/amanda-boris \
  -c delivery/sample/amanda-boris.json
```

Output goes to `./output/` by default. This step can take a while depending on how many videos and their length.

### Step 4: Upload to R2

Uploads the HLS streams, original MP4s, and thumbnails to the R2 bucket.

**PowerShell:**

```powershell
.\delivery\scripts\upload.ps1 `
  -CoupleSlug "amanda-boris" `
  -OutputDir "./output" `
  -OriginalDir "C:\exports\amanda-boris"
```

**Bash:**

```bash
./delivery/scripts/upload.sh \
  amanda-boris \
  ./output \
  ./exports/amanda-boris
```

### Step 5: Add the Password to Worker KV

```bash
cd delivery/workers/video-serve
wrangler kv:key put --binding=PASSWORDS "amanda-boris" "ab083125"
```

Replace `amanda-boris` with the couple's slug and `ab083125` with their password from the config JSON.

### Step 6: Generate the Couple Page

```bash
python delivery/scripts/generate.py \
  --config delivery/sample/amanda-boris.json \
  --template delivery/templates/couple-page.html \
  --manifest delivery/templates/manifest.json \
  --sw delivery/templates/sw.js \
  --preview
```

This creates `films/amanda-boris/index.html` (plus `manifest.json` and `sw.js`). The `--preview` flag opens it in your browser so you can verify it looks correct before deploying.

### Step 7: Commit and Deploy

```bash
git add films/amanda-boris/
git commit -m "Add Amanda & Boris film page"
git push
```

The site auto-deploys to Cloudflare Pages from the main branch. The page will be live within a minute or two.

### Step 8: Send the Couple Their Link

Send the couple:

- **URL:** `https://flyiniris.com/films/amanda-boris`
- **Password:** `ab083125`

They can stream videos immediately, download full-res MP4s after entering the password, and install the page as a phone app (PWA) for offline-like access.

## Project Structure

```
flyiniris/
├── delivery/                         # Source code & tools
│   ├── scripts/
│   │   ├── transcode.ps1             # FFmpeg HLS transcoder (PowerShell)
│   │   ├── transcode.sh              # FFmpeg HLS transcoder (Bash)
│   │   ├── upload.ps1                # R2 uploader (PowerShell)
│   │   ├── upload.sh                 # R2 uploader (Bash)
│   │   └── generate.py               # Page generator
│   ├── workers/
│   │   └── video-serve/              # Cloudflare Worker (video streaming + auth)
│   ├── templates/
│   │   ├── couple-page.html          # Master HTML template
│   │   ├── manifest.json             # PWA manifest template
│   │   └── sw.js                     # Service worker for PWA
│   └── sample/
│       └── amanda-boris.json         # Example couple config
├── films/                            # Generated couple pages (auto-deployed)
│   └── amanda-boris/
│       ├── index.html                # Generated from template + config
│       ├── manifest.json             # PWA manifest
│       └── sw.js                     # Service worker
└── ...                               # Existing site files (do not modify)
```

## R2 Bucket Structure

Each couple's files are stored under `fi-films/couples/{slug}/`:

```
fi-films/
└── couples/
    └── amanda-boris/
        ├── hls/
        │   ├── highlight/
        │   │   ├── master.m3u8       # Multi-bitrate master playlist
        │   │   ├── 1080p/playlist.m3u8 + segments
        │   │   ├── 720p/playlist.m3u8 + segments
        │   │   └── 480p/playlist.m3u8 + segments
        │   ├── teaser/
        │   └── ...
        ├── originals/
        │   ├── highlight.mp4         # Full-res downloads
        │   └── ...
        └── thumbs/
            ├── highlight.jpg         # Video thumbnails
            └── ...
```

## Maintenance

### Storage Costs

Cloudflare R2 pricing:
- Storage: $0.015/GB per month
- At roughly 5 GB per couple (HLS + originals + thumbs), that is about $0.08/month per couple
- Class A operations (writes): $4.50 per million requests
- Class B operations (reads): $0.36 per million requests
- Egress: Free (this is why R2 is great for video delivery)

### Cleanup

After 3 years (or at the couple's request), you can remove their files from R2 to save storage costs:

```bash
rclone purge r2fi:fi-films/couples/amanda-boris
```

You can also remove the generated page:

```bash
rm -rf films/amanda-boris
git add -A && git commit -m "Remove Amanda & Boris film page" && git push
```

### Monitoring

Check storage usage in the Cloudflare dashboard under **R2** > **fi-films** > **Usage**.

## Troubleshooting

### "FFmpeg not found" or "ffmpeg is not recognized"

FFmpeg is not in your system PATH. Download it from [ffmpeg.org](https://ffmpeg.org/download.html) and add the `bin` folder to your PATH environment variable. Restart your terminal after updating PATH.

### "rclone: command not found" or remote errors

Make sure rclone is installed and the remote is named exactly `r2fi`. Verify with:

```bash
rclone listremotes
```

If `r2fi:` is not listed, run `rclone config` to set it up (see Initial Setup step 3).

### Videos not playing / HLS errors

1. Verify the Worker is deployed: `cd delivery/workers/video-serve && wrangler tail` to see live logs
2. Check that HLS files exist in R2: `rclone ls r2fi:fi-films/couples/{slug}/hls/{video-id}/master.m3u8`
3. Make sure the custom domain `video.flyiniris.com` is set up in the Worker triggers

### Password not working

The password is stored in Worker KV. Make sure the KV key matches the slug exactly:

```bash
cd delivery/workers/video-serve
wrangler kv:key get --binding=PASSWORDS "amanda-boris"
```

If it returns nothing, the key was not set. Re-run the `kv:key put` command from Step 5.

### Page not loading after git push

1. Check the Cloudflare Pages deployment status in the dashboard under **Workers & Pages** > your Pages project
2. Make sure the `films/` directory is not in `.gitignore`
3. Verify the file was committed: `git log --oneline -1 -- films/amanda-boris/index.html`

### Generator script errors

- **"Config validation failed"** — The config JSON is missing required fields. Check the error messages and fix the JSON.
- **"Template not found"** — Make sure the path to `couple-page.html` is correct relative to where you are running the command.
- **"Invalid JSON"** — The config file has a syntax error. Use a JSON validator to find the issue.
