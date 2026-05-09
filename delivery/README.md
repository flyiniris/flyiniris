# Flyin' Iris: Film Delivery Platform

A Netflix-style branded video delivery platform for wedding videography clients. Each couple gets their own page at `flyiniris.com/films/<couple-slug>/` where they can stream all their wedding films (highlight, teaser, archival), download full-resolution MP4s, and install the page as a phone app via PWA.

Videos are stored on Cloudflare R2 and streamed via HLS through a Cloudflare Worker. No third-party video hosting.

**Authoritative spec:** `iris-automation/docs/project-knowledge-2026-05/delivery-page-standard.md`. This README covers setup and per-couple workflow only.

## Prerequisites

Install these before proceeding:

| Tool | Purpose | Install |
|---|---|---|
| **FFmpeg** | Video transcoding to HLS | [ffmpeg.org/download](https://ffmpeg.org/download.html). Must be in PATH. |
| **rclone** | Upload files to Cloudflare R2 | [rclone.org/install](https://rclone.org/install/) |
| **Node.js 18+** | Page generator and Worker development | [nodejs.org](https://nodejs.org/) |
| **Wrangler CLI** | Deploy Workers and manage KV | `npm install -g wrangler` |

Verify everything is installed:

```bash
ffmpeg -version
rclone version
node --version
wrangler --version
```

## Initial setup

These steps only need to be done once.

### 1. Create the R2 bucket

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com/).
2. Open R2 Object Storage in the sidebar.
3. Click Create Bucket.
4. Name it `fi-films`.
5. Choose the region closest to you (or leave automatic).
6. Click Create Bucket.

### 2. Create an R2 API token

1. In the Cloudflare dashboard, open R2 then Manage R2 API Tokens.
2. Click Create API Token.
3. Set permissions to Object Read & Write.
4. Scope to the `fi-films` bucket only.
5. Click Create API Token.
6. Save the Access Key ID and Secret Access Key. You will need them in the next step.

### 3. Configure rclone

Run `rclone config` and follow the prompts:

```
n         (new remote)
r2fi      (name, must be exactly "r2fi")
s3        (storage type, choose "Amazon S3 Compliant")

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

Your Cloudflare Account ID is on the R2 overview page.

Test the connection:

```bash
rclone lsd r2fi:fi-films
```

This should return without errors (empty output is fine for a new bucket).

### 4. Deploy the video Worker

```bash
cd delivery/workers/video-serve
npm install
wrangler login        # authenticate with Cloudflare (first time only)
wrangler deploy
```

### 5. Set Worker secrets

```bash
cd delivery/workers/video-serve
wrangler secret put JWT_SECRET
```

When prompted, enter a long random string (32+ characters). This is used to sign authentication tokens for video access.

### 6. Add the custom domain

1. In the Cloudflare dashboard, open Workers & Pages.
2. Click on the `fi-video-serve` Worker.
3. Open Settings, then Triggers, then Custom Domains.
4. Add `video.flyiniris.com`.
5. Cloudflare handles DNS and SSL automatically.

## Delivering films to a couple

Per `delivery-page-standard.md` Section 7. Eight steps:

### Step 1: Export final MP4s

Export edited videos from the editing software (Premiere, DaVinci, etc.) as MP4 files into a single folder. Name each file by its planned video id:

```
C:\exports\amanda-boris\
  highlight.mp4
  teaser.mp4
  ceremony.mp4
  speeches.mp4
  ...
```

The filenames (without `.mp4`) must match the `id` values in the config JSON.

### Step 2: Create the couple config JSON

Real configs live in `delivery/live/<slug>.json` and are gitignored. Copy `delivery/sample/amanda-boris.json` to `delivery/live/<slug>.json` and edit.

**Schema (Node generator, per spec Section 5):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | yes | Lowercase, hyphens only, matches `/^[a-z0-9-]+$/`. Used in URL: `flyiniris.com/films/<slug>`. |
| `coupleNames` | string | yes | Pre-joined display string, e.g., `"Amanda & Boris"`. The couple's order is the couple's choice. |
| `weddingDate` | string | yes | Long form, e.g., `"August 31, 2025"`. |
| `password` | string | optional | Couple's download password. Only present in `delivery/live/<slug>.json`, never in sample configs with real values. |
| `videos` | object[] | yes | Non-empty array of video entries. |
| `photos` (or any deprecated field) | n/a | n/a | Reject. See spec Section 5.2. |

**Video entry fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique within the couple. Must match the MP4 filename. |
| `title` | string | optional | Display title. Defaults to id with hyphens replaced and first letter capped. |
| `category` | string | yes | One of `highlight`, `teaser`, `archival`, `bonus`. Free-form values rejected. |
| `duration` | string | optional | Set by the transcode script after measuring source. |
| `order` | number | yes | Integer, lowest first. |
| `featured` | boolean | optional | Exactly one video must have `featured: true`. Generator errors on zero or multiple. |

### Step 3: Transcode videos

Creates HLS streams (1080p, 720p, 480p) and thumbnails from the source MP4s.

**PowerShell (Windows):**

```powershell
.\delivery\scripts\transcode.ps1 `
  -InputDir "C:\exports\amanda-boris" `
  -ConfigFile "delivery\live\amanda-boris.json"
```

**Bash (Mac/Linux/WSL):**

```bash
./delivery/scripts/transcode.sh \
  -i ./exports/amanda-boris \
  -c delivery/live/amanda-boris.json
```

Output goes to `./output/` by default. This step can take a while depending on number of videos and length.

### Step 4: Upload to R2

Uploads HLS streams, original MP4s, and thumbnails to the R2 bucket.

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

### Step 5: Add the password to Worker KV

```bash
cd delivery/workers/video-serve
wrangler kv:key put --binding=PASSWORDS "amanda-boris" "ab083125"
```

Replace `amanda-boris` with the couple's slug and `ab083125` with the password from the config JSON.

### Step 6: Generate the couple page

```bash
node delivery/generate-film-page.js delivery/live/amanda-boris.json
```

This creates `films/amanda-boris/index.html`, `films/amanda-boris/manifest.json`, and `films/amanda-boris/sw.js`.

Optional flags:
- `--worker-base <url>` to override the Worker base URL (default `https://video.flyiniris.com`).
- `--output-root <dir>` to write to an alternate output root (e.g., `delivery/test-output` for dry runs).

The generator validates the config strictly per spec Section 5.1. Any validation failure exits non-zero with a descriptive error listing every problem found.

### Step 7: Commit and deploy

```bash
git add films/amanda-boris/
git commit -m "Add Amanda & Boris film page"
git push
```

The site auto-deploys to Cloudflare Pages from the main branch. The page is live within a minute or two.

### Step 8: Send the couple their link

Send the couple:

- **URL:** `https://flyiniris.com/films/amanda-boris/`
- **Password:** `ab083125`

They can stream videos immediately, download full-resolution MP4s after entering the password, and install the page as a phone app (PWA) for offline-like access.

## Project structure

```
flyiniris/
├── delivery/                            # Source code and tooling
│   ├── generate-film-page.js            # Canonical Node page generator
│   ├── scripts/
│   │   ├── transcode.ps1                # FFmpeg HLS transcoder (PowerShell)
│   │   ├── transcode.sh                 # FFmpeg HLS transcoder (Bash)
│   │   ├── upload.ps1                   # R2 uploader (PowerShell)
│   │   └── upload.sh                    # R2 uploader (Bash)
│   ├── archive/                         # Archived legacy tooling, not maintained
│   │   └── generate.py                  # Legacy Python generator (replaced by Node)
│   ├── workers/
│   │   └── video-serve/                 # Cloudflare Worker (HLS + auth + downloads)
│   ├── templates/
│   │   ├── couple-page.html             # Master HTML template
│   │   ├── manifest.json                # PWA manifest template
│   │   └── sw.js                        # Service worker for PWA
│   ├── sample/
│   │   └── amanda-boris.json            # Sample couple config (no real password)
│   └── live/                            # Real couple configs (gitignored)
│       ├── .gitkeep
│       └── README.md
├── films/                               # Generated couple pages (auto-deployed)
│   └── amanda-boris/
│       ├── index.html                   # Generated from template + config
│       ├── manifest.json                # PWA manifest
│       └── sw.js                        # Service worker
└── ...                                  # Existing site files (do not modify)
```

## R2 bucket structure

Each couple's files are stored under `fi-films/couples/<slug>/`:

```
fi-films/
└── couples/
    └── amanda-boris/
        ├── hls/
        │   ├── highlight/
        │   │   ├── master.m3u8          # Multi-bitrate master playlist
        │   │   ├── 1080p/playlist.m3u8 + segments
        │   │   ├── 720p/playlist.m3u8 + segments
        │   │   └── 480p/playlist.m3u8 + segments
        │   ├── teaser/
        │   └── ...
        ├── originals/
        │   ├── highlight.mp4            # Full-resolution downloads
        │   └── ...
        └── thumbs/
            ├── highlight.jpg            # Video thumbnails
            └── ...
```

## Maintenance

### Storage costs

Cloudflare R2 pricing:
- Storage: $0.015/GB per month.
- At roughly 5 GB per couple (HLS + originals + thumbs), about $0.08/month per couple.
- Class A operations (writes): $4.50 per million requests.
- Class B operations (reads): $0.36 per million requests.
- Egress: free (this is why R2 is great for video delivery).

### Cleanup

After 3 years (or at the couple's request), files can be removed from R2 to save storage cost:

```bash
rclone purge r2fi:fi-films/couples/amanda-boris
```

The generated page can also be removed:

```bash
rm -rf films/amanda-boris
git add -A && git commit -m "Remove Amanda & Boris film page" && git push
```

### Monitoring

Check storage usage in the Cloudflare dashboard under R2, then `fi-films`, then Usage.

## Troubleshooting

### "FFmpeg not found" or "ffmpeg is not recognized"

FFmpeg is not in the system PATH. Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add the `bin` folder to PATH. Restart the terminal after updating PATH.

### "rclone: command not found" or remote errors

Ensure rclone is installed and the remote is named exactly `r2fi`. Verify with:

```bash
rclone listremotes
```

If `r2fi:` is not listed, run `rclone config` to set it up (see Initial Setup step 3).

### Videos not playing or HLS errors

1. Verify the Worker is deployed: `cd delivery/workers/video-serve && wrangler tail` to see live logs.
2. Check that HLS files exist in R2: `rclone ls r2fi:fi-films/couples/<slug>/hls/<video-id>/master.m3u8`.
3. Ensure the custom domain `video.flyiniris.com` is set up on the Worker triggers.

### Password not working

The password lives in Worker KV. Ensure the KV key matches the slug exactly:

```bash
cd delivery/workers/video-serve
wrangler kv:key get --binding=PASSWORDS "amanda-boris"
```

If it returns nothing, the key was not set. Re-run the `kv:key put` command from Step 5.

### Page not loading after git push

1. Check the Cloudflare Pages deployment status under Workers & Pages, then the Pages project.
2. Ensure the `films/` directory is not in `.gitignore`.
3. Verify the file was committed: `git log --oneline -1 -- films/<slug>/index.html`.

### Generator validation errors

The Node generator rejects deprecated fields (`names`, `date`, `photos`, `customMessage`, `venueDisplay`, `filmSlug`) and enforces the schema in spec Section 5.1. If a config was migrated from an older shape, fix the field names and re-run.

Common errors:
- `'slug' must match /^[a-z0-9-]+$/`. Use lowercase letters, digits, and hyphens only.
- `'coupleNames' is required`. Replace any `names: [...]` array with `coupleNames: "Name1 & Name2"`.
- `'weddingDate' is required`. Replace any `date: ...` field with `weddingDate: ...`.
- `videos[i].category "..." must be one of highlight, teaser, archival, bonus`. Pick the correct enum value.
- `exactly one video must have featured: true`. Set `featured: true` on the teaser (or highlight if no teaser).
