# SEO Plan: Couple Pages as Discoverable Real-Wedding Features

**Status as of 2026-05-12: NOT BUILT YET. Planning doc only.**

When Sean is ready to start using delivered couple pages as a marketing
discovery surface (organic search traffic from couples shopping for a
wedding videographer), this is the spec. Sits next to
[RUNBOOK.md](RUNBOOK.md) and [workflow-guide.md](workflow-guide.md).

## The model

Each couple page does double duty:

1. **Private delivery experience** for the couple themselves: Netflix
   layout, password-gated downloads, focused on their day.
2. **Public real-wedding feature** that ranks on Google for terms like
   "[venue] wedding film," "[city] wedding videographer," "[season]
   [vibe] wedding."

The "real wedding feature" pattern is industry standard (The Knot,
WeddingWire, established studios). Your couple pages are 80% of the
way there visually. The missing 20% is structured data, a paragraph
of human-written prose, and an opt-out path for couples who want it
private.

## Consent posture (decided 2026-05-12)

**Opt-out, not opt-in.** Sean's videography contract grants marketing
rights to the studio. Affirmative per-couple opt-in is not legally
required and would bottleneck the SEO automation.

Implementation:
- Default `seo.publish: true` for every new couple going forward.
- The delivery email to the couple includes one sentence: *"This page
  is also featured in our public film gallery. If you'd prefer it
  stay private, just reply and we'll switch it off."*
- Sierra flips to `false` only on the rare reply-and-ask.

No new GHL fields. No consent-tracking automation. No contract
changes. Legal posture stays where it already is.

The reason for the soft opt-out (rather than nothing) is reputational
risk management: estranged-family searches, religious community drama,
custody-dispute scenarios. Rare, but the soft heads-up to the couple
prevents most of them.

## Data Sean already has per couple

Most of these fields are in GHL custom fields (per the 24-field
prep-page wiring) or derivable from existing data.

| Field | Source | SEO role |
|---|---|---|
| Couple names | GHL contact + spouse field | Page title, headline |
| Wedding date | GHL `wedding_date` | Schema.org Event date, season derivation |
| Venue name + city | GHL `venue_name`, `venue_city` | Geo keywords, Schema.org Place |
| Vibe tags | GHL `vibe_tags` (multi-select) | Keyword graph, internal cross-links |
| Guest count | GHL field | Optional context for prose |
| Package tier | GHL `package` | Filter (S&S vs Team if either gets featured differently) |
| Discovery call notes | GHL `discovery_notes` or prep brief | Source material for AI-drafted prose |
| Hero thumbnails | R2 `fi-films/couples/<slug>/thumbs/` | OG image, Schema.org VideoObject thumbnail |
| Films delivered | `delivery/live/<slug>.json` | VideoObject array per film |

What is NOT in the system today and would need to be added:

- A short **"story moment"** field. One sentence Sierra writes about
  the most memorable part of the day. Could land on a post-wedding
  handoff form or just live in the JSON config until something better
  exists. The AI-draft script uses it as a seed.

## Bare-minimum spec (target: ~1 day of build when Sean greenlights)

Ships the framework that turns existing manual work into 80% of the
SEO value, with no new infrastructure.

### 1. JSON config schema extension

In `delivery/live/<slug>.json`, add an optional `seo` block:

```json
{
  "slug": "rachel-michael-street",
  "coupleNames": "Rachel & Michael",
  "weddingDate": "November 29, 2025",
  "password": "cedar-816",
  "videos": [...],
  "seo": {
    "publish": true,
    "headline": "An intimate November wedding on Cedarburg's Cedar Street",
    "story": "Rachel and Michael chose a small Cedarburg ceremony on the kind of late-November day that earns its memory. Two paragraphs of brand-voice prose, ~200 words total, written by Sierra (or AI-drafted, Sierra-reviewed). The first sentence works as a meta description fallback. Mention the venue, the vibe, the moment that made the day, and one specific detail only that wedding had.",
    "venue": "Cedar Street Lakehouse",
    "venueCity": "Cedarburg, WI",
    "season": "fall",
    "vibe": ["intimate", "modern-romantic", "candlelit"],
    "keywords": ["Cedarburg wedding videographer", "Wisconsin lakehouse wedding film", "intimate fall wedding"]
  }
}
```

`publish: true` is the default. `publish: false` for couples who opt out.

### 2. Template extensions when `seo.publish === true`

In `delivery/templates/couple-page.html`:

- Replace the generic `<meta name="description">` with `headline` plus
  the first sentence of `story`.
- Add a `<section class="story">` rendered above the films grid (or
  inside the hero area, design call) carrying the 200-word paragraph.
- Add a JSON-LD block: `VideoObject` per delivered film (name,
  description, thumbnailUrl, contentUrl from R2 worker, uploadDate),
  `Event` for the wedding (name, startDate, location with venue
  Place), aggregated.
- Tag chips at the bottom: "More [vibe] weddings," "More [season]
  weddings," "More [city] weddings." Initially link to filter URLs
  like `/films/?vibe=<tag>` even if the filter pages do not exist
  yet, so the link graph forms.

### 3. Two new generated files at the films/ root

- `films/index.html`: the public gallery. Lists every couple with
  `seo.publish: true`. Shows hero thumbnail, headline, 1-line snippet,
  link to the couple page. Built by a second pass of the generator
  that scans `delivery/live/*.json`.
- `sitemap.xml` and `robots.txt` at the site root. Sitemap lists only
  `seo.publish: true` couples plus the gallery. Submit to Google
  Search Console once.

### 4. AI-draft helper script

`delivery/scripts/draft-seo.ps1 -Slug <slug>`:

- Pulls couple data from GHL via the existing `ghl.getContact` helper
  (already in iris-automation).
- Calls Claude API with a prompt that takes the intake data plus an
  optional one-sentence "story moment" Sierra provides via flag, and
  returns a 200-word draft in the brand voice.
- Drops the draft into the `seo` block of the local
  `delivery/live/<slug>.json` (creates the block if missing). Leaves
  `publish` at the existing value or sets to `true` if newly created.
- Reuses the discovery-prep brief generator pattern at
  `iris-automation/src/lib/consultation-prep-brief.ts` for the
  GHL-data-to-prose plumbing.

Estimated runtime per couple: ~10 seconds Claude API call + 5 seconds
GHL fetch.

### 5. Sierra's per-couple workflow

After Sean ships the page via the existing RUNBOOK:

1. `.\draft-seo.ps1 -Slug amanda-boris -StoryMoment "the moment Amanda's dad couldn't get through his speech"`
2. JSON now has a draft `seo` block.
3. Sierra opens the JSON, reads the prose, edits whatever needs to
   sound more like her voice. Adjusts tags or keywords if needed.
4. Re-run generator. Page now has the SEO content. Gallery and
   sitemap auto-include it.
5. `git add films/<slug>/ films/index.html sitemap.xml ; git commit ; git push`

Time per couple: ~5 to 10 minutes including the prose edit.

### Build estimate (bare minimum)

- Schema validation in generator + template SEO block + JSON-LD: ~3-4 hrs
- Gallery + sitemap.xml + robots.txt: ~2 hrs
- AI-draft script (Claude API call + GHL pull + JSON write): ~2-3 hrs
- RUNBOOK.md update with the new SEO step: ~30 min
- **Total: ~1 work day**

### What this does NOT include

- Admin UI in iris-studio (deferred to Phase 2)
- Auto-publish on contract sign or delivery (deferred to Phase 3)
- Auto-generated cross-link "More like this" sections beyond the
  static tag chips (deferred to Phase 3)
- Webhook-triggered regeneration on R2 upload completion (Phase 3)
- IG / Pinterest auto-share on publish (Phase 4 if ever)

## Ideal end-state spec (Phase 2/3, ~1-2 weeks total once minimum proves out)

Build only after Sierra has manually published 5+ couples with the
bare-minimum flow and Sean knows what the friction actually is.

### Phase 2: Admin UI in iris-studio (~3-4 days)

- Add "Featured Films Drafts" page to iris-studio.
- Shows the queue of delivered couples whose `seo` block is missing
  or has `publish: false`.
- Each row: AI-drafted prose preview, edit-in-place textarea, tag
  pickers pulled from the existing GHL vibe field, "Publish" button.
- Publish button hits a worker endpoint that writes the JSON, runs
  the generator, commits via GitHub API, pushes. Sierra never opens
  a terminal.

### Phase 3: Trigger and cross-link automation (~3-4 days)

- Webhook on R2 upload completion (or Sierra marking "delivered" in
  iris-studio) auto-triggers the AI draft pipeline. Sierra gets a
  Pushover ping: "New SEO draft ready for [couple]."
- Cross-link "More [tag] weddings" sections build from the aggregate
  JSON-LD across all featured couples. Regenerate every couple page
  on each new publish so the link graph compounds (this is where
  the SEO velocity actually accumulates).
- Tag-filter pages at `/films/?vibe=intimate` etc., generated from
  the gallery data. The chip links from Phase 1 finally land on real
  pages.

### Phase 4: Polish (optional, only if traffic justifies)

- Per-tag landing pages with their own SEO copy ("Cedarburg wedding
  videographer" gets its own page with intro + featured films).
- Schema.org `Review` aggregation if you collect couple testimonials.
- IG / Pinterest auto-share on publish.

## When to actually build this

Trigger conditions, in order of priority:

1. **You're shipping more than 1 couple per month.** SEO is a 3 to 6
   month game. Building it before you have a steady supply of content
   means the gallery is empty and Google has nothing to index.
2. **You have at least one couple whose wedding you want to feature
   for portfolio purposes anyway.** The first few featured couples
   double as case studies you'd want regardless.
3. **You're not in the middle of a higher-priority build.** This is
   marketing infrastructure, not customer-blocking work. It can wait
   for a clean window.

When all three are true: tell Claude "build the bare-minimum SEO spec
from delivery/SEO-PLAN.md." The spec above is self-contained.

## What to do for the NEXT couple before this is built

If a couple ships and SEO is not yet built, you can still set the
foundation manually:

1. Note the venue name, city, vibe tags, season in
   `delivery/live/<slug>.json` as comments at the top of the file
   (informal, just so the data is captured for later backfill).
2. Have Sierra write 200 words about the day in a scratch note. Same
   reason. Future-you will thank present-you when the SEO build
   happens and you backfill 5 couples in one afternoon.
3. Make sure the delivery email uses the soft opt-out language above.
   This way the couples are already informed before the SEO framework
   actually goes live, and you have plausible "we told them" cover.

That is enough to make the eventual backfill cheap. Past couples
without this data will need Sierra to either remember the day or skip
them in the first batch.

## Past gotchas already solved (don't relitigate)

- Don't add a per-couple opt-in GHL field. We already decided opt-out
  is the right model (see "Consent posture" above).
- Don't try to fully zero-touch this. AI-drafted prose still needs
  Sierra's eye for brand voice. The friction is unavoidable and
  acceptable.
- Don't build Phase 2 or 3 before the bare minimum has shipped 5
  couples. Without that proof, you do not yet know what to optimize.
