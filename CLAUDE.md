# Flyin' Iris: Website, Film Delivery & Video Infrastructure

## Cross-repo source of truth (locked 2026-05-08)

This repo is the static Pages site (flyiniris.com, agreement.flyiniris.com,
prep.flyiniris.com SPA shells). It is NOT the source of truth for pricing,
brand, voice, or cross-cutting standards. Those all live in
`C:\Users\flyin\Claude Projects\iris-automation\`.

When working in this repo, before making any change that touches pricing,
brand, voice, or copy conventions, read these files in iris-automation first:

| Topic | File | Rule |
|---|---|---|
| Pricing constants | `src/pricing.ts` | Canonical. PRICING_VERSION drives validation. Calculators in this repo MIRROR these constants exactly. Any drift is a bug. When pricing.ts changes, this repo follows. Never the reverse. |
| Brand (colors, fonts, voice) | `docs/project-knowledge-2026-05/BRAND.md` | Canonical. Colors, fonts, voice rules, forbidden patterns, ad creative rules. Any UI work here references that doc. |
| FOMO live availability | `src/lib/fomo-spots.ts` + `/api/pricing/constants` endpoint | Live monthly spot count. Public calculator fetches via the endpoint, never hardcoded. |
| GHL field map, pipeline IDs | `iris-automation CLAUDE.md` | Canonical. |

### Cross-cutting hard rules (enforced from iris-automation/BRAND.md)

1. **No em or en dashes anywhere.** Hyphens in compound words (`9-12 min`) are fine. Rule applies to customer copy, code, comments, commit messages, internal docs, chat replies. Use periods, colons, commas, parentheses.
2. **Name order: "Sierra & Sean".** Sierra first, always, in any customer-facing copy. No exceptions in DMs, emails, signoffs, contracts, agreements, web. Single-name references unaffected.
3. **Sierra's surname is Hernitz.** Never Adamec, Malone, or invented. Use "Sierra Hernitz" for legal/signed copy, "Sierra" for everyday voice.
4. **Sean's surname is Adamec.**
5. **Greeting opener: "Hey [Name]!"** Never "Hi", "Dear", or "Hello".
6. **Sign-off: "Sierra & Sean" or "Sierra & Sean, Flyin' Iris".**

### When in doubt

If a question arises about pricing, copy, brand, or any cross-cutting standard
while working in this Pages repo, the answer lives in iris-automation. Read
those files first. If still ambiguous, ask Sean.

### For future Code-Pages sessions

Before any change that touches pricing, brand, voice, or copy:
1. Read `C:\Users\flyin\Claude Projects\iris-automation\CLAUDE.md`
2. Read `C:\Users\flyin\Claude Projects\iris-automation\docs\project-knowledge-2026-05\BRAND.md`
3. Read `C:\Users\flyin\Claude Projects\iris-automation\src\pricing.ts` if pricing-adjacent

Do not duplicate constants. If a constant must be embedded client-side, fetch
it from `/api/pricing/constants` on the iris-automation Worker. CORS already
allows flyiniris.com origins.

---

## What This Project Is
The flyiniris.com website + video delivery platform for Flyin' Iris wedding videography.
- **Main site:** `flyiniris.com` (interactive landing page with HLS film teasers, quiz/calculator, inquiry form)
- **Film delivery:** `flyiniris.com/films/{couple-slug}`, Netflix-style branded pages per couple
- **Video streaming:** `video.flyiniris.com` via `fi-video-serve` Worker → R2 HLS
- **Static assets:** `pub-353a8c6ef8dc4c03a98225af8b12a8a9.r2.dev` (thumbnails, images)
- Deploys to Cloudflare Pages via git push to main branch

## Current State (March 2026)
- **Landing page LIVE** with hero videos, film portfolio (HLS teasers), quiz, inquiry form
- **15 wedding films** transcoded to HLS (4K + 1080p), thumbnails upscaled with Real-ESRGAN
- **Inquiry form** → Apps Script → `iris-automation` Worker (see iris-automation project)
- **Individual film pages** (`/films/{slug}`), NOT YET BUILT, currently redirect to main site
- **Film delivery pages**, template exists but no couples deployed yet
- **Video matching engine**, logic embedded in `iris-automation` Worker (not in this project anymore)

## How It Connects to the Automation System
```
flyiniris.com inquiry form
  → Apps Script (POST to iris-automation Worker)
    → Worker creates GHL contact + starts nurture sequence
      → Emails contain personalized film thumbnails from R2 (matched by venue/vibe/season)
        → Thumbnail links back to flyiniris.com/#films (until individual pages built)
```

## IMPORTANT: What Lives Where
- **Automation logic** (email sequences, film matching, GHL API) → `iris-automation` project
- **Website + film pages + video infrastructure** → THIS project
- **GHL scripts** (Gmail scanning, calendar checks) → `ghl-automation` project

## Project Structure
```
C:\Users\flyin\Claude Projects\Landing Page\flyiniris\  # Project root (existing site repo)
├── index.html                                # Existing main website (DON'T TOUCH)
├── privacy.html                              # Existing (DON'T TOUCH)
├── terms.html                                # Existing (DON'T TOUCH)
├── CLAUDE.md                                 # This file
├── delivery/                                 # NEW: Film delivery platform
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
├── films/                                    # NEW: Generated couple pages (auto-deploy)
│   └── amanda-boris/
│       └── index.html                        # Generated from template + config
```

## CRITICAL RULES
1. **DO NOT modify** index.html, privacy.html, terms.html, or any existing files
2. All new work goes in `delivery/` (source code) and `films/` (generated output)
3. This is a Windows machine, provide both .sh (bash/WSL) and .ps1 (PowerShell) versions of scripts
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
  "password": "ab083125",
  "videos": [
    {
      "id": "teaser",
      "title": "Teaser",
      "category": "teaser",
      "duration": "",
      "order": 0,
      "featured": true
    },
    {
      "id": "highlight",
      "title": "Amanda & Boris's Wedding",
      "category": "highlight",
      "duration": "",
      "order": 1
    },
    {
      "id": "first-look-bridesmaids",
      "title": "First Look: Bridesmaids",
      "category": "archival",
      "duration": "",
      "order": 2
    },
    {
      "id": "first-look-dad",
      "title": "First Look: Dad",
      "category": "archival",
      "duration": "",
      "order": 3
    },
    {
      "id": "first-look-vows",
      "title": "First Look & Vows",
      "category": "archival",
      "duration": "",
      "order": 4
    },
    {
      "id": "ketubah-signing",
      "title": "Ketubah Signing",
      "category": "archival",
      "duration": "",
      "order": 5
    },
    {
      "id": "ceremony",
      "title": "Ceremony",
      "category": "archival",
      "duration": "",
      "order": 6
    },
    {
      "id": "grand-march-first-dance",
      "title": "Grand March & First Dance",
      "category": "archival",
      "duration": "",
      "order": 7
    },
    {
      "id": "speeches",
      "title": "Speeches",
      "category": "archival",
      "duration": "",
      "order": 8
    },
    {
      "id": "parent-dances",
      "title": "Parent Dances",
      "category": "archival",
      "duration": "",
      "order": 9
    },
    {
      "id": "gopro",
      "title": "GoPro",
      "category": "bonus",
      "duration": "",
      "order": 10
    },
    {
      "id": "grand-raw",
      "title": "Full Ceremony (Raw)",
      "category": "archival",
      "duration": "",
      "order": 11
    }
  ],
  "photos": {
    "enabled": false,
    "message": "Your photos from the big day will be viewable here soon."
  }
}
```

**Note:** `date_short` is optional. The generator auto-generates it from `date` (e.g., "August 31, 2025" → "08.31.2025"). Durations are empty until filled by the transcode script.

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
Use **Vidstack** (https://www.vidstack.io/), modern HLS player with:
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
- **FFmpeg**, installed locally, available in PATH
- **rclone**, installed locally, R2 remote configured as `r2fi`
- **Node.js 18+**, for Cloudflare Worker development (wrangler) and the page generator
- **Wrangler CLI**, `npm install -g wrangler` for Worker deployment

## SESSION LOGGING (Important!)
After completing each significant task (new feature, bug fix, refactor, deployment), append a brief summary to the shared session log:

```
echo "## $(Get-Date -Format 'yyyy-MM-dd HH:mm') | flyiniris`n- [what you did]`n- Files: [key files changed]`n- Deployed: [yes/no]`n" >> C:\Users\flyin\.openclaw\workspace\memory\claude-session-log.md
```

Keep entries 2-4 lines. This lets Iris (the AI assistant) stay aware of changes across projects without interrupting your flow.

---

## Pre-Build Validation Protocol

Before writing any code for a substantive task (anything beyond a trivial one-liner), ALWAYS complete this checklist first:

1. **Validate assumptions against real data.** If the task involves reading from existing files (JSON reports, databases, configs), actually READ those files first and verify the data structure matches what the task assumes. Do not trust spec descriptions of data shape.

2. **Check file existence and paths.** If the task references specific files, verify they exist where expected. If the task writes to specific paths, verify the parent directories exist.

3. **Confirm external dependencies.** If the task uses APIs (Gemini, Claude, Stripe, GHL, etc.), model versions, SDK packages, or environment variables, verify the expected versions/names are current and correct. Specifically check that model strings are not deprecated.

4. **Identify spec-vs-reality gaps.** Build a short table of anywhere the task's assumptions diverge from what's actually true. Include proposed handling for each gap.

5. **Flag open questions.** List anything ambiguous that needs a decision from Sean before proceeding. Do not guess on creative, architectural, or irreversible decisions.

6. **Use Agent Teams when appropriate.** For 3+ independent workstreams with clean contracts between them, split into parallel sub-agents. For self-contained single-file work, stay with single agent. Be honest about which category the task falls into.

7. **Suggest optimizations.** If the task spec would produce suboptimal results or includes anti-patterns, surface those suggestions before building. Sean prefers catching issues at design time over debug time.

8. **Report validation findings before writing code.** Summarize findings in a clear table or bullet list. Ask for green-light on any flagged issues.

This protocol protects Sean's time by catching bugs in minutes instead of hours. A 2-minute validation pass routinely prevents 30+ minutes of debugging downstream.

Skip this protocol ONLY for:
- Trivial changes (under 20 lines of code, no new dependencies, no external calls)
- Explicit "just do it" override from Sean with full context
- Continuation of a previously validated task where assumptions haven't changed

When in doubt, validate. Sean will never be annoyed by a validation pass. He WILL be annoyed by a preventable bug.

---

