# Code-Backend Brief: Site Funnel Worker Changes

Written 2026-07-03 by Code-Pages (session site/selling-machine). The Pages side
of the inquiry-first funnel is built and ships when Sean merges the branch.
Everything below is Worker-side (iris-automation repo). Each item states the
exact contract the pages already code against. This file is served-shadowed by
_redirects (Pages serves nothing at /backend-brief-site-funnel.md after the
hiding rules, but keep it free of secrets anyway).

Priority order: items 1 and 2 are launch-blocking for the new ad campaign.
Items 3 to 5 complete the funnel promise. The rest are hardening.

## 1. LAUNCH-BLOCKING: flip TURNSTILE_ENFORCE on

`verifyPublicFormRequest` (src/index.ts ~317-392) is still in log-mode watch;
Turnstile and origin failures are logged, not blocked. The client-side widgets
are live on all public forms. Review the watch-period logs for false
positives, then flip `TURNSTILE_ENFORCE`. Until then the spam protection is
cosmetic. Note: the token-gated /calculator/ posts NO Turnstile token; it
authenticates with session_token against /api/package/dream + /api/package/save,
which are not Turnstile-gated. No change needed there; do NOT add the
calculator page to any Turnstile requirement.

## 2. LAUNCH-BLOCKING: deliver pricing access in inquiry email 1

The new funnel promises pricing immediately after inquiry. The thanks-page
router delivers it in-session; `inq-01-welcome` must deliver it for the inbox
path (and for the no-token fallback, whose copy now says "your pricing and
package builder link is in your welcome email").

Spec: in `src/templates/emails-batch1.ts`, add to `inq-01-welcome` (which
already requires `contact.session_token`):
- A gold CTA button "SEE YOUR PRICING + BUILD YOUR PACKAGE" linking
  `https://flyiniris.com/calculator/?session={{contact.session_token}}`
- Place it ABOVE the film-match block; the pricing promise is the reason they
  gave their email. Keep the existing /experience saved-link line or replace
  it with this; Sean's call at review.
- The calculator gate accepts `?session=` and persists to localStorage, so the
  link works cross-device with no other change.
- Hyperlink styling per BRAND.md (gold #FFBD1D, never raw URLs).

## 3. Calculator completion pipeline moves to /api/package/save

The old inline calculator posted /webhook/calculator; the gated calculator
does NOT (it has no Turnstile widget, and the session token is better auth).
The page now posts, in order:
1. `POST /api/package/dream` body `{ session_token, config }` where config =
   `{ tier: 'team'|'ss', hours: '6'..'12' (string), highlight: '5 min'|'6-8 min'|'9-12 min'|'13-15 min'|'15-20 min', teaser: bool, storySession: bool }`
2. `POST /api/package/save` body `{ session_token, config, calculated_price,
   event_id, fbp?, fbc? }` (config and calculated_price are currently ignored
   by the Worker; event_id/fbp/fbc are NEW fields for this spec)

Worker changes in the /api/package/save handler (src/index.ts ~1694-1788):
a. Fire CAPI `CalculatorCompleted` with `externalEventId = body.event_id`
   (page fires the pixel twin with the same eventID after 2xx), passing
   fbp/fbc and the contact's email/phone for match quality. Value = the
   engine-computed total from the saved config, NOT body.calculated_price.
b. Move the opportunity to CALCULATOR_COMPLETED stage and handle the sequence
   transition (item 4).
c. Robustness: /api/package/dream does a plain INSERT into saved_packages; a
   second save for the same session creates duplicate rows and
   /api/package/save's `WHERE session_token = ?` .first() can grab the stale
   one. Make dream an UPSERT on session_token (or save's SELECT
   `ORDER BY created_at DESC LIMIT 1` and its UPDATE target the same row).
d. Keep /webhook/calculator intact for now (nothing on the site posts to it
   after this branch merges; retire it in a later cleanup once confirmed).

## 4. Sequence transition: calculator completion supersedes inquiry-nurture

When the save pipeline (item 3b) runs for a contact currently enrolled in
`inquiry-nurture`: cancel inquiry-nurture (sequence + pending scheduled
actions, same primitives as the discovery-booked cleanup steps) and start
`calculator-nurture`, instead of double-enrolling. If the contact is already
in calculator-nurture, no-op (startSequence already guards). Respect the
reply-pause convention: do not clear `awaiting-human-reply`.

## 5. CAPI CalculatorCompleted dedup plumbing (from the tracking audit)

Even independent of item 3, fix the helper so a client event id can pair:
- `src/lib/tracking.ts:245-248`: add `eventId?: string` parameter to
  `trackCalculatorCompleted`; use `eventId || 'calculator-' + contact.contactId`.
- `src/index.ts:6115` (webhook path, while it lives): pass `data.event_id`
  and extend ContactInfo with `phone: data.phone, fbc: data.fbc,
  fbp: data.fbp` (currently dropped, hurting match quality).
- `src/index.ts:6107-6108`: the storeTracking gate only checks
  `utm_source || fbclid || gclid`; widen to also accept ad_id/adset_id/
  campaign_id/landing_page (pages now send them).
- handleInquiry Lead needs NO change (already consumes event_id/fbp/fbc;
  verified live-paired).

## 6. /api/films leaks internal business data (found during films.html rewire)

`GET /api/films` returns the raw KV film index including per-couple `revenue`
and internal `notes` fields, publicly. films.html now consumes this endpoint
(renders slug/coupleNames/venue/thumbnailUrl/teaserUrl/featured only, and only
when thumbnailUrl+teaserUrl are non-empty). Strip `revenue`, `notes`,
`package`, and `tier` from the public response in `handleGetFilms`
(src/index.ts:4868-4873). Also: populating thumbnailUrl/teaserUrl in the KV
index is what activates the live grid on films.html (needs 4+ media-complete
entries; until then the curated static grid renders).

## 7. Hero video hosting (LCP follow-through)

The hero mp4s (`hero-16x9-v3.mp4`, `hero-9x16-v3.mp4`) are served from
`pub-353a8c6ef8dc4c03a98225af8b12a8a9.r2.dev`, Cloudflare's rate-limited dev
endpoint, with NO Cache-Control. The page now paints a poster first, so this
is no longer the LCP, but the video should move to a custom-domain host with
`Cache-Control: public, max-age=31536000, immutable` (files are
version-suffixed). Recommended: serve them via media.flyiniris.com (fi-video
worker or R2 custom domain). After moving, update index.html `cdnBase` in the
hero injector script and swap the head preconnect from the r2.dev host. Same
recommendation eventually applies to the R2-hosted thumbs.

## 8. Custom API domain (recommendation, do not rush)

15 pages hardcode `https://iris-automation.flyin-iris-mp.workers.dev`
(inventory: index, calculator, questionnaire, contractor-onboarding x2,
portal, experience, vibe, saved, quiz, yours/taylor-neil x2,
_shells/agreement x2, thanks after this branch). Recommend `api.flyiniris.com`
as a Worker custom domain:
1. Add the custom domain to the iris-automation Worker (Cloudflare dashboard
   or wrangler routes).
2. Add `https://api.flyiniris.com` alongside the workers.dev origin in the
   Pages CSP (_headers) FIRST, deploy, THEN swap page constants in one
   commit; keep workers.dev accepting requests indefinitely (old emails carry
   workers.dev links via saved/experience pages? they do not, links go to
   flyiniris.com pages, so risk is low).
3. Update ALLOWED_ORIGINS/CORS if it validates Origin against a list.
Do not switch origins unilaterally; coordinate with a Pages-side commit.

## 9. uptime_check cron (Sean carry-forward)

The Worker's uptime_check cron has logged nothing since 2026-06-13 and may be
a silently dead uptime monitor. Verify the cron trigger still exists in
wrangler.toml, whether the handler throws early, and why nothing logs; revive
it and add a Pushover alert on failure. A selling machine with no downtime
alarm is a liability. Include the new funnel surfaces in the check set:
`/` (200), `/thanks` (200), `/calculator/?session=invalid` still 200 page
(client-side gate), `POST /webhook/inquiry` OPTIONS/reachability, and
`/api/session/<fake>` returning 404 JSON (proves the API path is alive).

## 10. CAPI verification step (run after items 3-5 deploy)

POST `https://iris-automation.flyin-iris-mp.workers.dev/api/test-capi?key=<STUDIO_PROXY_SECRET>`
(empty body; POST only, the GET twin was removed 2026-06-10). Expect
`{"status":"sent","details":"Test Lead event sent with test_event_code
TEST10256 ..."}`. Then in Meta Events Manager, pixel 518972926490365, Test
Events tab, code TEST10256: a server Lead should appear within a minute. If
the Events Manager UI shows a different current test code, update the
hardcoded TEST10256 at tracking.ts:322 to match. Never hand this URL+key to
Sean; backend terminal only.

Then verify live pairing end to end: submit a test inquiry on the branch
preview (use the reset-test-lead skill persona), and in Test Events confirm
ONE Lead with matching event_id from both Browser and Server sources.

## 11. Preview-domain CORS (small, do early: unblocks Sean's preview review)

ALLOWED_ORIGINS (src/index.ts:203-212) has no Pages preview origins, so on
the branch preview (site-selling-machine.flyiniris.pages.dev) every Worker
API call fails CORS: availability check, /api/session, the inquiry POST, the
films index. Verified in-browser 2026-07-03; the pages degrade gracefully but
the funnel cannot be exercised end to end on a preview. Add
`https://flyiniris.pages.dev` plus a suffix check for
`.flyiniris.pages.dev` origins in getCorsHeaders (suffix check, not a
wildcard header; keep echoing the exact origin). Also note the Turnstile
widget sitekey does not include the pages.dev preview hostname (console
error 110200 on preview); harmless in log-mode, and adding the preview
hostname to the Turnstile widget config in the Cloudflare dashboard makes
preview testing fully realistic before the enforce flip.

## 12. Small page-contract notes (no Worker action, context only)

- Pages send tracking top-level fields: event_id, fbp, fbc, fbclid, gclid,
  utm_*, ad_id, adset_id, campaign_id, landing_page. handleInquiry already
  reads all of them.
- The short form no longer sends: excited, vibe, priority, budget, found,
  referralName, note, full last names. handleInquiry treats all as optional
  (verified). Film matching degrades to venue+season signals; welcome-email
  FILM_BLOCK and /yours links still work via matched_film_slug.
- The discovery-prep "From their inquiry" callout loses how_they_found_us /
  referral_name for NEW leads (the form no longer asks). If referral
  attribution matters at prep time, options: re-add an optional "How'd you
  hear about us?" on the thanks page (post-conversion, zero funnel friction)
  as a PATCH to a new endpoint, or ask on the discovery call. Flagging, not
  speccing; Sean's call.
- SMS consent: only the non-marketing checkbox survives on the short form;
  smsMarketing always posts 'No'. Marketing-SMS consent can be collected
  later (portal, questionnaire) if ever needed.
