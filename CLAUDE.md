# Flyin' Iris — Client Film Delivery Platform

## What We're Building
A Netflix-style branded video delivery platform for wedding videography clients.
Each couple gets their own page at `flyiniris.com/films/{couple-slug}` where they can
stream all their wedding films (highlight, teaser, archival footage), download full-res
MP4s, and install it as a phone app via PWA. Videos are stored on Cloudflare R2 and
streamed via HLS through a Cloudflare Worker. No third-party services — we own everything.

## Project Structure
```
C:\Users\sierh\flyiniris\                    # Project root (existing site repo)
├── index.html                                # Existing main website (DON'T TOUCH)
├── privacy.html                              # Existing (DON'T TOUCH)
├── terms.html                                # Existing (DON'T TOUCH)
├── CLAUDE.md                                 # This file
├── delivery/                                 # NEW — Film delivery platform
│   ├── scripts/
│   │   ├── transcode.sh                      # FFmpeg HLS transcoder
│   │   ├── transcode.ps1                     # PowerShell version for Windows
│   │   ├── upload.sh                         # rclone R2 uploader
│   │   ├── upload.ps1                        # PowerShell version
│   │   └── generate.py                       # Page generator from config JSON
│   ├── workers/
│   │   ├── video-serve/
│   │   │   ├── src/
│   │   │   │   └── index.js                  # Cloudflare Worker entry
│   │   │   ├── wrangler.toml                 # Worker config
│   │   │   └── package.json
│   │   └── README.md
│   ├── templates/
│   │   ├── couple-page.html                  # Master template with Vidstack player
│   │   ├── manifest.json                     # PWA manifest template
│   │   └── sw.js                             # Service worker for PWA
│   ├── sample/
│   │   └── amanda-boris.json                 # Sample couple config for testing
│   └── README.md                             # Setup & usage documentation
├── films/                                    # NEW — Generated couple pages (auto-deploy)
│   └── amanda-boris/
│       └── index.html                        # Generated from template + config
```

## CRITICAL RULES
1. **DO NOT modify** index.html, privacy.html, terms.html, or any existing files
2. All new work goes in `delivery/` (source code) and `films/` (generated output)
3. This is a Windows machine — provide both .sh (bash/WSL) and .ps1 (PowerShell) versions of scripts
4. The project auto-deploys to Cloudflare Pages from GitHub main branch
5. Film pages will be accessible at flyiniris.com/films/{slug} via Cloudflare Pages routing

## Brand Reference
- Background: `#0A0A0A` (primary), `#111110` (secondary), `#161615` (cards), `#1A1A19` (elevated)
- Text: `#F5F0EB` (primary), `#C8C3B9` (secondary), `rgba(200,195,185,0.5)` (muted)
- Accent Gold: `#FFBD1D` (CTAs/hover), `#D99E0A` (dark/pressed), `#FFF0C9` (light hover)
- Borders: `#2A2A28` (resting), `#3A3A38` (disabled), gold on hover/focus
- Headings: `Cormorant Garamond`, weight 600 (semibold), serif
- Body: `Outfit`, weight 300 (light), sans-serif
- Labels: `Outfit`, weight 400
- Buttons: `Outfit`, weight 600
- Google Fonts: `https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&family=Outfit:wght@200;300;400;500;600;700&display=swap`
- Design: Dark-first. Gold is ACCENT ONLY, never a background fill. 8px border-radius. 0.25s ease transitions. Film grain overlay on body.

## Couple Config JSON Schema
```json
{
  "slug": "amanda-boris",
  "names": ["Amanda", "Boris"],
  "date": "August 31, 2025",
  "date_short": "08.31.2025",
  "password": "ab083125",
  "videos": [
    {
      "id": "highlight",
      "title": "Amanda & Boris's Wedding",
      "category": "highlight",
      "duration": "11:01",
      "order": 0,
      "featured": true
    },
    {
      "id": "teaser",
      "title": "Teaser",
      "category": "teaser",
      "duration": "5:46",
      "order": 1
    },
    {
      "id": "first-look-bridesmaids",
      "title": "First Look: Bridesmaids",
      "category": "archival",
      "duration": "8:09",
      "order": 2
    },
    {
      "id": "first-look-dad",
      "title": "First Look: Dad",
      "category": "archival",
      "duration": "3:28",
      "order": 3
    },
    {
      "id": "first-look-vows",
      "title": "First Look & Vows",
      "category": "archival",
      "duration": "7:41",
      "order": 4
    },
    {
      "id": "ketubah-signing",
      "title": "Ketubah Signing",
      "category": "archival",
      "duration": "7:08",
      "order": 5
    },
    {
      "id": "ceremony",
      "title": "Ceremony",
      "category": "archival",
      "duration": "16:15",
      "order": 6
    },
    {
      "id": "grand-march-first-dance",
      "title": "Grand March & First Dance",
      "category": "archival",
      "duration": "9:04",
      "order": 7
    },
    {
      "id": "speeches",
      "title": "Speeches",
      "category": "archival",
      "duration": "26:03",
      "order": 8
    },
    {
      "id": "parent-dances",
      "title": "Parent Dances",
      "category": "archival",
      "duration": "8:19",
      "order": 9
    },
    {
      "id": "gopro",
      "title": "GoPro",
      "category": "bonus",
      "duration": "10:08",
      "order": 10
    }
  ],
  "photos": {
    "enabled": false,
    "message": "Your photos from the big day will be viewable here soon."
  }
}
```

## R2 Bucket Structure
```
fi-films/                                     # R2 bucket name
├── couples/
│   └── amanda-boris/
│       ├── hls/
│       │   ├── highlight/
│       │   │   ├── master.m3u8               # Master playlist (multi-bitrate)
│       │   │   ├── 1080p/
│       │   │   │   ├── playlist.m3u8
│       │   │   │   ├── segment000.ts
│       │   │   │   └── ...
│       │   │   ├── 720p/
│       │   │   │   └── ...
│       │   │   └── 480p/
│       │   │       └── ...
│       │   ├── teaser/
│       │   └── ... (one folder per video ID)
│       ├── originals/
│       │   ├── highlight.mp4                  # Full-res download files
│       │   ├── teaser.mp4
│       │   └── ...
│       └── thumbs/
│           ├── highlight.jpg                  # Thumbnail per video
│           ├── teaser.jpg
│           └── ...
```

## Worker Endpoint Design
- Base URL: `https://video.flyiniris.com` (custom domain on Worker)
- Or fallback: `https://video-serve.<account>.workers.dev`
- `GET /couples/{slug}/hls/{video-id}/master.m3u8` → HLS playlist
- `GET /couples/{slug}/hls/{video-id}/{quality}/playlist.m3u8` → quality playlist
- `GET /couples/{slug}/hls/{video-id}/{quality}/{segment}.ts` → video segment
- `GET /couples/{slug}/thumbs/{video-id}.jpg` → thumbnail
- `POST /couples/{slug}/download/{video-id}` → requires password in body, returns signed URL
- `POST /couples/{slug}/auth` → validates password, returns session token

## Video Player
Use **Vidstack** (https://www.vidstack.io/) — modern HLS player with:
- Adaptive bitrate streaming
- Quality selector UI
- Fullscreen, PiP
- Chromecast + AirPlay support
- Chapter navigation
- Keyboard shortcuts
- Mobile-optimized

Import via CDN:
```html
<link rel="stylesheet" href="https://cdn.vidstack.io/player/theme.css" />
<link rel="stylesheet" href="https://cdn.vidstack.io/player/video.css" />
<script type="module" src="https://cdn.vidstack.io/player"></script>
```

## Dependencies & Tools
- **FFmpeg** — installed locally, available in PATH
- **rclone** — installed locally, R2 remote configured as `r2fi`
- **Python 3** — for page generator script
- **Node.js 18+** — for Cloudflare Worker development (wrangler)
- **Wrangler CLI** — `npm install -g wrangler` for Worker deployment
