<!-- token-budget: 3000 (estimate = file bytes / 4; enforced by .githooks/pre-push claude-md-checks) -->
# CLAUDE.md: Flyin' Iris website, film delivery, video infrastructure

Source of truth precedence: live code, then generated docs (iris-automation docs/knowledge/atlas/generated/), then docs/knowledge/, then everything older; when two disagree, the higher one wins.

Machine-wide invariants (copy rules, commit hygiene, secrets, pre-build validation) live in the global `~/.claude/CLAUDE.md` and are not restated here.

## What this repo is

The static Cloudflare Pages site: flyiniris.com (inquiry-first funnel), the agreement SPA shells, per-couple film delivery pages under `films/`, and the delivery tooling under `delivery/`. Deploys to production on git push to main.

State as of 2026-07-12: the inquiry-first funnel (below) is live; `start.html` serves /start, the guided inquiry flow and ad destination (live 2026-07-12); `films.html` is the public portfolio page; couple delivery pages are deployed for amanda-boris and rachel-michael-street; `venues/` pages exist; on-site film thumbnails link to `/yours?film={slug}`. The old video-match worker is archived at `delivery/archive/video-match/` (shadowed from serving); live matching runs in the iris-automation Worker.

## Cross-repo source of truth (locked 2026-05-08)

This repo is NOT the source of truth for pricing, brand, voice, or cross-cutting standards. Those live in `C:\Users\flyin\Claude Projects\iris-automation\`:

| Topic | Canonical | Rule |
|---|---|---|
| Pricing constants | `src/pricing.ts` | Calculators here MIRROR those constants exactly (gated pages only). When pricing.ts changes, this repo follows, never the reverse. Client-side constants come from `/api/pricing/constants`, never hardcoded fresh. |
| Brand (colors, fonts, voice, copy rules) | `docs/knowledge/brand.md` | Any UI or copy work here references that doc. |
| FOMO live availability | `src/lib/fomo-spots.ts` via `/api/pricing/constants` | Never hardcode spot counts. |
| GHL field map, pipeline, IDs | `docs/knowledge/atlas/generated/ghl.md` | Canonical. |

If a question about pricing, copy, brand, or a cross-cutting standard arises while working here, the answer lives in iris-automation. Read those files first; if still ambiguous, ask Sean.

## CRITICAL RULES

1. Pushing to main deploys PRODUCTION. Feature work happens on branches; Sean reviews the branch preview and merges.
2. This is a Windows machine; when scripts are the deliverable, provide both .sh (bash/WSL) and .ps1 (PowerShell) versions.
3. Film delivery pages live at flyiniris.com/films/{slug} via Pages routing; their source tooling is `delivery/`.
4. Every committed file is served publicly by Pages; this repo is PUBLIC on GitHub. There is no ignore mechanism (.cfignore is a myth). Internal docs and tooling either stay out of the repo or get a shadowing 301 in `_redirects` (see the block at the top of that file). Never commit secrets, GHL IDs, or ops notes.
5. `_headers` carries the CSP. Any page that adds a new third-party origin MUST add it to the CSP in the same commit or the resource is silently blocked.
6. TRACKING IS SACRED (Sean, 2026-07-08, after the CSP analytics blackout). No change may remove or break GTM (GTM-M74R95NX), GA4 (G-XGSWD6JW3E), the Meta pixel, or the CSP origins they depend on. Any edit to `_headers` or a page head re-verifies analytics live post-deploy (console clean of CSP refusals, GA4 collect returns 2xx). The pre-push hook enforces a tag manifest on every push; if a page legitimately changes its tags, update the manifest in `.githooks/pre-push` in the same commit. Incident: iris-automation docs/knowledge/incidents/2026-07-08-csp-analytics-blackout.md.
7. `brand-kit/` is documentation of production and must never drift from it. Any commit that modifies anything under `brand-kit/` MUST end its session summary with the line: "BRAND KIT CHANGED: re-upload brand-kit.md, brand-tokens.css, and updated screenshots to the Fly Iris Film Redesign project in Claude Design." And whenever shipped page styling changes in a way that alters values the kit documents (colors, fonts, buttons, spacing, signature treatments), the same session must update `brand-kit/` to match and emit that same line.

## FUNNEL ARCHITECTURE (locked 2026-07-03, session site/selling-machine)

The site is an inquiry-first funnel. Exact pricing is NEVER shown to anonymous visitors (copy, schema, and page-source JS all stay price-free). ONE standing exception, Sean-approved 2026-07-10: /start's Team-available screen shows "starting at $2,800" as static copy mirroring TEAM_BASE in pricing.ts; when pricing.ts changes, that copy follows.
- start.html is /start, the guided inquiry flow (live 2026-07-12, submit-at-vibe rework 2026-07-13): one question per screen, live availability routing via /api/availability (open / Team pitch / both-booked waitlist with submissionType 'waitlist'), film lightbox on the teaser HLS masters. The real /webhook/inquiry POST fires at vibe completion, phoneless (phone '' and smsNonMarketing 'No'); the phone screen is a post-submit OPTIONAL step with no step number, no back button, and a skip ghost, and it calls POST /api/inquiry/enrich-phone fire-and-forget (all response cases advance to confirm; the receipt line mentions a text only when the response said smsSent true). A no-date ghost on the date screen skips the availability check and submits weddingDate blank (Worker dateless handling); that path gets its own confirm H1 and "Details in" strip step. Progress is n/3 with vibe the final step. The welcome screen plays hero-9x16-v3.mp4 as a poster-first strip (WELCOME_VIDEO in page source is the one-line swap point for a future ad master). Tracking mirrors index (pixel + CAPI dedup event_id, GA4, Clarity); the pre-push tag manifest covers start.html and 404.html. ?offer=doc gates the welcome documentary-offer chip and a quiet echo line on the capture screen (session-only read, never persisted); the confirm screen's offer closer renders only while /api/pricing/constants (fetched post-submit) reports fomoFreeSpot true, with the live spot count.
- index.html renders the short inquiry form at #quiz (#inquiry alias): first names, email, phone, wedding date (inline availability check), venue optional, one non-marketing SMS consent checkbox.
- Submit POSTs /webhook/inquiry on the Worker with event_id + attribution; the response's session_token goes to localStorage (fi_session_token) and the couple routes to /thanks?session=TOKEN.
- thanks.html is the router: availability payoff + film match, PRIMARY embedded booking widget (book.flyiniris.com/widget/booking/Kd7zWqsXzAswGHR1HuDR), SECONDARY /calculator/?session=TOKEN.
- /calculator/ is token-gated (head gate; anonymous hits redirect to /?src=calculator#inquiry). Save flow = POST /api/package/dream THEN /api/package/save (save alone stores no config; that ordering is load-bearing). saved.html renders the saved package and ends in book-a-call.
- Pricing constants mirror src/pricing.ts on the GATED pages only.
Worker-side follow-ups for this funnel are specced at iris-automation/docs/plans/backend-brief-site-funnel-2026-07-03.md (moved out of this repo 2026-07-04 because Pages serves every committed file).

## Delivery platform (pointers, not detail)

Operational truth lives inside `delivery/`: `delivery/README.md` (setup), `delivery/RUNBOOK.md` (the per-couple workflow, START HERE), `delivery/workflow-guide.md`. This file intentionally holds no schema, bucket-layout, or player detail; the last inline copy of those rotted.

- Quality ladder: 4k + 1080p HLS, NVENC (`delivery/scripts/transcode.ps1`), uploaded via rclone remote `r2fi` to bucket `fi-films` (`upload.ps1`).
- Page generation: `delivery/generate-film-page.js` + `generate-batch.js` from the template `delivery/templates/couple-page.html`. Live sample config: `delivery/sample/avery-jordan.json` (field names there are canonical; older docs showing `names`/`date` arrays are dead).
- Player: Vidstack, version-pinned in the template (currently @1.15.5). Container-only CSS; never `!important` or `aspect-ratio` on the player element (see delivery/RUNBOOK.md).
- Streaming worker: `delivery/workers/video-serve/` serves video.flyiniris.com (HLS, thumbs, password auth, signed downloads).
- Studio attaches delivery video on delivery day via a load-time D1 read (`delivery_video_config`); pages are batch pre-generated ahead of time and never redeployed for video attach.

## Deployment

Push to main = production deploy via Cloudflare Pages. Branch pushes get preview URLs for review. After deploying customer-facing changes, do a multi-page browser smoke (funnel pages especially).
