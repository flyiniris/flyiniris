# Flyin' Iris — Operations Overview
### Everything That ISN'T the Automation Engine
*Last updated: March 5, 2026 by Iris*

*For automation/Workers/sequences/film matching, see `architecture.md`.*
*This doc covers: website, infrastructure, tools, integrations, compliance, and operational status.*

---

## WEBSITE — flyiniris.com

### Hosting & Deployment
- **Platform:** Cloudflare Pages (auto-deploys on git push to `main`)
- **Repo:** `https://github.com/flyiniris/flyiniris.git`
- **Local path:** `C:\Users\flyin\Claude Projects\Landing Page\flyiniris\`
- **To deploy:** `cd` into the repo, `git add . && git commit -m "message" && git push origin main`
- Cloudflare Pages picks up the push and deploys in ~30 seconds
- No build step — it's static HTML/CSS/JS served directly

### All Live Pages

| URL | File | Purpose | Status |
|-----|------|---------|--------|
| `/` | `index.html` | Main landing page — hero videos, film portfolio (HLS teasers), quiz/calculator, inquiry form, testimonials, Google reviews | **LIVE** ✅ |
| `/films` | `films.html` | Standalone film portfolio — all 15 wedding teasers in a grid with HLS playback | **LIVE** ✅ |
| `/yours` | `yours.html` | **Personalized lead page** — name, venue, date + matched film playing via HLS. Linked from nurture emails. | **LIVE** ✅ |
| `/package` | `package.html` | **Personalized proposal page** — custom tier, pricing, savings. For post-discovery follow-up. | **LIVE** (not yet connected to Worker sequences) |
| `/films/amanda-boris/` | `films/amanda-boris/index.html` | Netflix-style film delivery — PWA with Vidstack player, all wedding videos | **LIVE** (template for future couples) |
| `/privacy` | `privacy.html` | Privacy policy (SMS/TCPA compliance) | **LIVE** ✅ |
| `/terms` | `terms.html` | Terms of service | **LIVE** ✅ |

### Page Parameter Reference

**`/yours` page** (linked from nurture emails):
```
flyiniris.com/yours?fn=Sean&vn=The+Pfister+Hotel&wd=2026-09-25&film=izzy-hunter&fc=Izzy+%26+Hunter&fv=The+Gage
```
| Param | Purpose |
|-------|---------|
| `fn` | First name (hero heading: "Sean, we can't wait for your day.") |
| `vn` | Venue name (hero subheading) |
| `wd` | Wedding date, ISO format (formatted to "September 25, 2026") |
| `film` | Film slug — loads HLS teaser from R2 via hls.js |
| `fc` | Film couple display name (e.g., "Izzy & Hunter") |
| `fv` | Film venue display name (e.g., "The Gage") |
| UTM params | Standard utm_source, utm_medium, utm_campaign |

**`/package` page** (for post-discovery proposals):
```
flyiniris.com/package?fn=Sean&tier=Signature&price=5500&savings=400
```
| Param | Purpose |
|-------|---------|
| `fn` | First name |
| `tier` | Package tier name |
| `price` | Package price (formatted with commas) |
| `savings` | Bundle savings amount |

### Redirects
Old Squarespace URLs are 301-redirected via `_redirects` file:
- `/wedding-films`, `/meet-ss`, `/our-services`, `/testimonials`, `/home-1`, `/lets-talk`, `/blog/*`, `/story-sessions` → all redirect to `/`
- `/privacy-policy` → `/privacy`

### SEO
- **Sitemap:** `sitemap.xml` — NEEDS UPDATING (only has `/`, `/privacy`, `/terms` — missing `/films`, `/yours`, `/package`)
- **robots.txt:** exists, standard
- **OG images:** `og-films.png`, `og-package.png`, `og-yours.png` — used for social sharing previews
- **Schema markup:** JSON-LD on index.html (LocalBusiness + VideoObject)

### Google Reviews
- **Elfsight widget** embedded on landing page
- Widget ID: `fb2d57a6-a5d9-4ac3-85a0-146ee0086522`
- Script: `https://elfsightcdn.com/platform.js` (loaded async)
- Currently shows: 43 reviews, 5.0 stars
- Auto-pulls from Google Business profile — no manual updates needed

### Quiz / Calculator
- Built into `index.html` (not a separate page)
- 5-step quiz: excited level → vibe → priority → budget → contact info
- Calculator steps: hook question → quality preference
- Submits to Apps Script → iris-automation Worker `/webhook/inquiry`
- Calculates estimated price based on selections

---

## VIDEO INFRASTRUCTURE

### R2 Buckets
| Bucket | Purpose | Public? |
|--------|---------|---------|
| `fi-films` | HLS video segments (4K + 1080p teasers) | Private (served via fi-video-serve Worker) |
| `fi-assets` | Thumbnails, static images, review pages | Public: `https://pub-353a8c6ef8dc4c03a98225af8b12a8a9.r2.dev` |

### Video Serving
- **Worker:** `fi-video-serve` at `video.flyiniris.com`
- **HLS URL pattern:** `https://video.flyiniris.com/couples/{slug}/hls/teaser/master.m3u8`
- **Thumbnail URL pattern:** `https://pub-353a8c6ef8dc4c03a98225af8b12a8a9.r2.dev/couples/{slug}/thumbs/thumb.jpg`

### HLS Transcoding
- Uses FFmpeg with NVIDIA GPU (RTX 5070 Ti) — `h264_nvenc -preset p7`
- Output: 4K (3840x2160) + 1080p (1920x1080) only — no 480p/720p
- Master playlist with both quality levels for adaptive streaming
- Batch script: `C:\Users\flyin\Claude Projects\Landing Page\flyiniris\delivery\scripts\batch-upload-gpu.ps1`
- Upload via rclone: remote `r2fi:` configured for R2

### Thumbnails
- All 15 upscaled with **Real-ESRGAN** (4x GPU upscale → resize to 1600px → compress)
- Tool location: `C:\Users\flyin\realesrgan\`
- Output: JPG, ~130-250KB each, stored in `fi-assets/couples/{slug}/thumbs/thumb.jpg`

### Film Index
- 15 films indexed in `film-index.json` and embedded in the Worker
- Tags: slug, couple, venue, city, region, season, vibes, emotional tone, guest size, venue type
- **Interactive tagger:** Built as HTML page, hosted on R2 for Sierra to review/update
  - URL: `https://pub-353a8c6ef8dc4c03a98225af8b12a8a9.r2.dev/film-index-review.html`
  - Sierra completed tagging on March 4, 2026
  - Output saved to `film-index.json`
- **Automation review viewer:** Shows all email/SMS templates with film blocks
  - URL: `https://pub-353a8c6ef8dc4c03a98225af8b12a8a9.r2.dev/automation-review.html`
  - Internal tool — not public-facing

### Film Delivery Pages (Netflix-style)
- Template: `/films/amanda-boris/` — full PWA with Vidstack player
- Supports: highlight, teaser, archival footage, ceremony, speeches, GoPro, raw
- PWA: installable as phone app (manifest.json + sw.js)
- **Only Amanda & Boris exists** — template needs to be replicated for each couple
- Future: generate pages from JSON config per couple

### Adding a New Film (full process)
1. Download 4K teaser from Vimeo API
2. Transcode to HLS (4K + 1080p) using GPU batch script
3. Upload HLS to R2 (`fi-films/couples/{slug}/hls/teaser/`)
4. Extract or source thumbnail → upscale with Real-ESRGAN → upload to R2 (`fi-assets/couples/{slug}/thumbs/thumb.jpg`)
5. Add film to `FILMS` array in `iris-automation/src/index.ts`
6. Update `film-index.json`
7. Deploy Worker: `npx wrangler deploy`

---

## GOOGLE WORKSPACE

| Email | User | Role |
|-------|------|------|
| sean@flyiniris.com | Sean Adamec | Admin |
| sierra@flyiniris.com | Sierra Hernitz | User (kept maiden name for client recognition) |
| iris@flyiniris.com | Iris Ai | User (for future automated sends) |

- **Plan:** Starter ($3.50/user × 3 = $10.50/mo, 50% promo first 3 months)
- **MX records:** All 5 Google mail servers configured in Cloudflare
- **SPF:** Configured ✅
- **DMARC:** `v=DMARC1; p=quarantine; rua=mailto:sean@flyiniris.com` ✅
- **DKIM:** ✅ Authenticated
- **Old Gmail:** `flyin.iris.mp@gmail.com` — still active, shared business email (DO NOT DELETE)
- **Email migration:** Not yet done — need to move important threads from old Gmail to new inboxes

---

## GHL (GoHighLevel) — CRM Only

### What GHL Does
- Stores contacts + custom fields
- Pipeline tracking (13 stages from New Inquiry → Fulfilled)
- Calendar booking (Discovery Call links)
- Sends emails/SMS when the Worker calls its API
- Click tracking on email links (automatic)
- Phone number: (262) 384-5079 (A2P registered for SMS compliance)

### What GHL Does NOT Do
- No workflow logic — the Worker handles all automation decisions
- No email/SMS timing — the Worker's cron schedules everything
- No film matching — embedded in the Worker

### GHL Workflows
- **3 Published (keep as-is):** 1hr Reminder, Discovery Call Booked (webhook→Worker), Missed Call Text-Back
- **5 Draft (NEVER publish):** These duplicate Worker logic and would cause double-sends

### GHL Calendar
- Post-Inquiry calendar: `Kd7zWqsXzAswGHR1HuDR`
- Post-Calculator calendar: `V3H7cSqX3iSNqMlRA8O8`
- Booking links: `https://book.flyiniris.com/widget/booking/{calendarId}`
- Calendar has custom CSS styling (done in GHL settings)

### SMS Compliance (A2P/TCPA)
- GHL number (262) 384-5079 is A2P registered
- `/privacy` and `/terms` pages exist on flyiniris.com
- Inquiry form has SMS consent checkboxes
- Worker checks `sms_marketing_consent` and `sms_nonmarketing_consent` fields before sending SMS
- If no consent on file, SMS is skipped (logged as `sms_skipped_no_consent`)

### GHL's Future
- **Current role:** CRM + send button — this works fine for now
- **Open question from Sean:** Keep GHL long-term, or build custom dashboard + ditch it?
- **If we ditch GHL:** Would need own email/SMS sending (Twilio for SMS, SES/Postmark for email), own contact database, own pipeline UI
- **Recommendation:** Keep GHL for now, revisit after v1 is fully stable

---

## INTEGRATIONS STATUS

| Integration | Status | Notes |
|-------------|--------|-------|
| GHL API | ✅ Connected | Contacts, email, SMS, pipeline, calendar, custom fields |
| Vimeo API | ✅ Connected | Token: in secrets.md, Pro account, 307 videos |
| Google Gmail | ✅ Connected | Read + send via OAuth, tokens in google-tokens.json |
| Google Calendar | ✅ Connected | Read access, HoneyBook calendar synced |
| Google Drive | ✅ Connected | Read access (consultation notes) |
| Cloudflare R2 | ✅ Connected | rclone remote `r2fi:`, 2 buckets |
| Cloudflare Workers | ✅ Deployed | 3 workers (iris-automation, fi-video-serve, fi-video-match) |
| Cloudflare Pages | ✅ Connected | Auto-deploy from GitHub |
| Apps Script | ✅ Connected | Form → Worker webhook bridge |
| Twilio | ✅ Account created | Number: +12623812393 ($1.15/mo) — for future WhatsApp Business API or SMS fallback |
| Elfsight | ✅ Embedded | Google reviews widget on landing page |
| HoneyBook | ⚠️ Passive | Calendar synced to Google, contracts/invoices still here |
| Meta/Facebook API | ❌ Blocked | Can't create app on new computer, SMS verification broken for Sierra's number |
| Instagram/Facebook DMs | ❌ Not connected | ManyChat replacement planned, webhook endpoint exists but nothing built |
| Meta Pixel | ⚠️ Partial | Pixel ID exists (`518972926490365`), not yet firing server-side events |
| YouTube API | ❌ Not connected | Needs Sean to authorize OAuth scope |
| WhatsApp for Iris | ❌ Blocked | All VoIP numbers rejected — need prepaid SIM from store |

---

## THINGS NOT YET BUILT (Prioritized)

### High Priority
1. ~~**DKIM setup**~~ — DONE: All 3 email auth pillars live (SPF + DKIM + DMARC)
2. **Individual /films/{slug} pages** — currently only Amanda & Boris template exists. Each couple needs their own delivery page.
3. **Connect /package to Worker** — the proposal-sent sequence should link to personalized /package URL
4. **Sitemap update** — add /films, /yours, /package to sitemap.xml
5. **Meta API access** — retry app creation, or try different computer/browser

### Medium Priority
6. **Questionnaire system** — full spec in QUESTIONNAIRE-SPEC.md, builds a "Discovery Call Prep Brief" for Sean
7. **IG/FB automated DMs** — replace ManyChat. Webhook endpoint `/webhook/manychat` exists but needs Meta API access first
8. **fi-notify Worker** — internal notification system (branded emails from iris@flyiniris.com)
9. **Email migration** — move important threads from flyin.iris.mp@gmail.com to new workspace inboxes
10. **Meta Pixel server-side events** — CAPI for accurate conversion tracking

### Lower Priority
11. **Sales script for discovery calls** — needs writing
12. **Additional info page** — for leads who need more before booking a call
13. **Film deduplication** — KV `viewed:{email}` so repeat emails show different films
14. **Custom GHL dashboard** — or extract data to own UI (long-term decision)
15. **Password/2FA master list** — consolidate all credentials with 2FA status
16. **Logo vector files** — Sean needs to source/complete these
17. **Sierra's AI assistant** — separate agent for editing workflow (waiting on dedicated number)
18. **SEO venue landing pages** — one page per film venue for organic search traffic

---

## TOOLS & LOCAL SETUP

| Tool | Location | Purpose |
|------|----------|---------|
| Real-ESRGAN | `C:\Users\flyin\realesrgan\` | GPU thumbnail upscaling (4x) |
| FFmpeg | System PATH | HLS transcoding |
| rclone | System PATH | R2 uploads (remote: `r2fi:`) |
| Wrangler | npm global | Cloudflare Worker deployment |
| Node.js | v24.13.1 | Scripts, Worker builds |
| GPU | NVIDIA RTX 5070 Ti | NVENC transcoding, Real-ESRGAN upscaling |
| OpenClaw | `C:\Users\flyin\.openclaw\` | Iris AI agent (WhatsApp channel) |
| Footage Analyzer | C:\Users\flyin\Claude Projects\footage-analyzer\ | Event footage analysis pipeline. Three scripts: footage-analyzer.py (Gemini 3.1 Pro analysis), cull-footage.py (8-bin organization via hard links), timeline-generator.py (Premiere FCP7 XML generation). Reusable across all shoot types. ~$1.84 per event. |

### GPU Usage Rule
When transcoding video or upscaling images, ALWAYS use NVIDIA GPU acceleration:
- FFmpeg: `h264_nvenc -preset p7`
- Real-ESRGAN: uses GPU by default
- Claude Code should use GPU when running these tools

---

## HONEYBOOK (Legacy/Transitional)

- Still used for: contracts, invoices, payments
- Calendar synced to Google Calendar (auto-appears in Gmail/GHL)
- **7 past-due invoices** totaling ~$12,779 — Sean needs to review each
- **Theia Films** (editing partner in Philippines) — watch for their emails, flag to Sean/Sierra
- **Open question:** Stay with HoneyBook for contracts/payments, or build custom?
- **Recommendation:** Keep HoneyBook for contracts/payments until there's a clear reason to move. Focus automation energy on lead nurture and client communication first.

---

## ACTIVE CLIENTS & LEADS

| Client | Status | Notes |
|--------|--------|-------|
| Sarah & Derek | Awaiting response | Planner: Shaina, Sept 25 2026, The Lorelei, Lake Geneva |
| Jullia Hallet | Needs follow-up | Proposal sent Feb 10, no response |
| Joseph Sparks | New (today) | Photography inquiry, not videography — needs redirect |
| Arianna Soto | Payment received | Invoice paid, arriving 2-3 business days |

---

## IRIS (OpenClaw AI Agent)

### Role
- **COO of Flyin' Iris** — monitors inbox, checks pipeline, alerts Sean, manages Workers
- Sean delegates to Iris. Iris delegates to Claude Code agents. Sean never talks to agents directly.
- Available via WhatsApp: connected to Sean's personal number

### Current Limitations
- No dedicated phone number yet (needs prepaid SIM — all VoIP rejected by WhatsApp)
- No Meta API access (for social media management)
- Context window fills up during long sessions — important decisions must be written to files

### Proactive Monitoring (HEARTBEAT.md)
- Gmail inbox for new leads and client replies
- GHL pipeline for new contacts
- Worker health (cron execution, error logs)
- Alerts Sean for urgent items, stays quiet overnight (11pm-8am)

---

## KEY FILE LOCATIONS

### Iris Workspace (documentation + memory)
```
C:\Users\flyin\.openclaw\workspace\
├── MEMORY.md              — Iris long-term memory
├── architecture.md        — Full automation architecture (THE key doc)
├── operations-overview.md — This file
├── brand-voice-guide.md   — Email/SMS tone and style rules
├── ghl-master-plan.md     — Pipeline stages, custom fields, timing
├── automation-map.md      — Visual flow of all automations
├── film-index.json        — 15 films with all metadata
├── ideas-bucket.md        — Future feature ideas (referral program, etc.)
├── secrets.md             — API keys and credentials
├── ALL-CREDENTIALS.md     — Consolidated credentials reference
├── memory/                — Daily session logs (YYYY-MM-DD.md)
└── SOUL.md, USER.md, IDENTITY.md, HEARTBEAT.md — Agent config
```

### Project Directories
```
C:\Users\flyin\Claude Projects\
├── iris-automation\       — The Worker (automation brain)
│   ├── CLAUDE.md          — Technical spec
│   ├── architecture.md    — System architecture
│   └── src\               — TypeScript source
├── Landing Page\flyiniris\ — Website + video delivery
│   ├── CLAUDE.md          — Website spec
│   ├── index.html         — Main landing page
│   ├── yours.html         — Personalized lead page (HLS playback)
│   ├── package.html       — Personalized proposal page
│   ├── films\             — Film delivery pages
│   └── delivery\          — Transcoding scripts, Worker source
└── ghl-automation\        — Utility scripts (Gmail, Calendar)
    ├── CLAUDE.md          — Script reference
    └── architecture.md    — System architecture
```

---

*This doc + architecture.md together cover the entire Flyin' Iris tech stack. Keep both updated when things change.*
