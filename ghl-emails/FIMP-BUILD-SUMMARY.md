# FIMP Film Intelligence System — Build Summary

**Date:** March 3, 2026
**Commit:** `d330428` on `main`
**Status:** Committed, ready to push → Cloudflare Pages auto-deploy

---

## What Was Built

6 deliverables across 11 new files, built by a 5-agent parallel team. Nothing existing was modified.

---

## Deliverable 1: Email Template Audit & Fix

**What:** Pulled all 4 live GHL email templates via API, audited for issues, patched fixes back.

**Templates patched:**
| Template | GHL ID |
|----------|--------|
| INQ-01 Welcome & Film | `69a3c3596c66b2cdd08903e5` |
| INQ-02 Venue Check-In | `69a3c35ad6567bda82d529de` |
| INQ-03 Social Proof | `69a3c35ab093ec02a636acd9` |
| CALC-01 Package Recap | `69a3c3594b552f652a0b2f07` |

**Issues found & fixed:**
- All 4 templates had `link.lo-ai.co` booking URLs → replaced with `book.flyiniris.com`
- INQ-01, INQ-02, INQ-03: CTA buttons pointed to `link.lo-ai.co/widget/booking/Kd7zWqsXzAswGHR1HuDR` → fixed
- CALC-01: CTA button pointed to `link.lo-ai.co/widget/booking/V3H7cSaX3iSNqMlRA8O8` → fixed

**Clean (no issues):** No placeholder text, no blue links, all merge fields correct, sign-offs correct.

**Output:** `email-audit-report.md` (full before/after diffs)

---

## Deliverable 2: SMS Cheat Sheet v2

**What:** Complete rewrite of all SMS messages. Short, human, friend-sending-a-link energy. Each SMS now drives to a personalized page instead of cramming info into the text.

**Workflows covered:**
- **WF-01** Inquiry Nurture: Welcome → 24hr Nudge → 48hr Social Proof
- **WF-02** Calculator Nurture: Welcome → 2hr Nudge → 48hr
- **WF-02 from Inquiry** (already inquired, now did calculator): Welcome → 2hr Nudge → 48hr
- **WF-03** Discovery Call Booked: Confirmation
- **WF-10** Missed Call Text-Back

**Key change:** SMS messages now link to personalized pages with URL params:
- `flyiniris.com/yours?fn={name}&vn={venue}&wd={date}`
- `flyiniris.com/package?fn={name}&tier={tier}&price={price}&savings={savings}`
- `flyiniris.com/films?vn={venue}`

**Output:** `sms-cheatsheet-v2.md`

---

## Deliverable 3: Personalized Pages

**What:** 3 standalone HTML pages that create a personalized experience from SMS links. Mobile-first, full brand system, goosebumps standard.

### yours.html — "We Put Something Together For You"
- **URL:** `flyiniris.com/yours?fn=Emily&vn=The+Pinery&wd=2026-09-12`
- **Reads:** first name, venue, wedding date (formatted to "September 12, 2026")
- **Sections:** Personalized hero → Featured film (Taylor & Kane) → 3 cinematic cards (Your Story / Your Film / Your Experience) → CTA (post-inquiry booking link) → Sign-off
- **Graceful degradation** if params missing — never shows "undefined"

### package.html — "Your Custom Package"
- **URL:** `flyiniris.com/package?fn=Emily&tier=S%26S+Experience&price=5200&savings=300`
- **Reads:** first name, tier, price (formatted $5,200), savings
- **Sections:** Personalized hero → Elevated package card with tier/price/savings/inclusions → Featured film → CTA (post-calculator booking link) → Sign-off

### films.html — "Films That Hit Different"
- **URL:** `flyiniris.com/films` (optional `?vn=venue`)
- **Sections:** Hero → Featured film (Taylor & Kane full-width) → 2-column grid (Taylor & Austin, Olivia & Austin) → Pullquote testimonial → CTA → Sign-off

**All pages include:** Film grain overlay, fade-in animations, OG meta tags, mobile-first (375px base), inline CSS/JS, Google Fonts only external dependency.

**Output:** `yours.html`, `package.html`, `films.html`

---

## Deliverable 4: OG Preview Images

**What:** 3 branded 1200x630px PNG images for rich SMS link previews. When someone gets a text with a flyiniris.com link, their phone shows a dark/gold preview card instead of a blank box.

| Image | Content |
|-------|---------|
| `og-yours.png` | "FLYIN' IRIS" + "We put something together for you." |
| `og-package.png` | "FLYIN' IRIS" + "Your Custom Film Package" |
| `og-films.png` | "FLYIN' IRIS" + "Films That Hit Different." |

All feature: #0A0A0A background, gold gradient top line, gold wordmark, white subtitle, muted URL footer.

**Output:** `og-yours.png`, `og-package.png`, `og-films.png`

---

## Deliverable 5: Film Index CSV Template

**What:** CSV template Sean can import directly into Google Sheets. Pre-populated with all 9 known films.

**19 columns:** Film ID, Couple Names, Wedding Date, Venue Name, Venue Type, City, Region, Season, Vibe Primary, Vibe Secondary, Guest Size, Emotional Tone, Package Tier, Highlight URL, Teaser URL, Thumbnail URL, Social Cut, Published to Website, GHL Contact ID

**Pre-populated films:**
| ID | Couple | Known Data |
|----|--------|------------|
| FI-001 | Taylor & Kane | Green Bay Country Club, country-club, green-bay, thumbnail, published |
| FI-002 | Taylor & Austin | Thumbnail, published |
| FI-003 | Olivia & Austin | Thumbnail, published |
| FI-004 | Amanda & Boris | Wedding date: 2025-08-31 |
| FI-005–009 | Cody & Sarah, Bobby & Emily, Izzy & Hunter, Kayla & Jason, Grace & Sage | Names only |

**Tag reference file** lists all valid values for: Venue Type (15), Vibe (12), Season (4), Region (11), Guest Size (3), Emotional Tone (5), Package Tier (2).

**Output:** `film-index-template.csv`, `film-index-tag-reference.csv`

---

## Deliverable 6: Film Intake Form Spec

**What:** Beautiful branded HTML page serving as a visual spec for the Google Form Sean will build. Not functional — purely a reference doc.

**Sections:**
- **A — Day-Of Details** (subcontractor fills out): couple names, date, venue, venue type, guest count, personality, key moments, notes
- **B — Editorial Notes** (Sierra fills out): vibe tags, emotional tone, music direction, pacing, emotional beats, color palette, reference film
- **C — Post-Delivery** (Sean or Sierra): highlight URL, teaser URL, delivery page URL, thumbnail, social cut, published status

Full brand system — dark theme, gold accents, film grain, Cormorant Garamond headings.

**Output:** `film-intake-form-spec.html`

---

## File Map

```
flyiniris/
├── yours.html                    ← Personalized post-inquiry page
├── package.html                  ← Personalized post-calculator page
├── films.html                    ← Curated film showcase page
├── og-yours.png                  ← OG image for /yours SMS previews
├── og-package.png                ← OG image for /package SMS previews
├── og-films.png                  ← OG image for /films SMS previews
├── film-index-template.csv       ← Import into Google Sheets
├── film-index-tag-reference.csv  ← Valid tag values lookup
├── film-intake-form-spec.html    ← Visual spec for Google Form
├── sms-cheatsheet-v2.md          ← New SMS copy for all workflows
├── email-audit-report.md         ← Before/after diff of email fixes
└── ghl-emails/
    └── FIMP-BUILD-SUMMARY.md     ← This file
```

---

## Booking URLs (Reference)

| Context | URL |
|---------|-----|
| Post-Inquiry calendar | `https://book.flyiniris.com/widget/booking/Kd7zWqsXzAswGHR1HuDR` |
| Post-Calculator calendar | `https://book.flyiniris.com/widget/booking/V3H7cSaX3iSNqMlRA8O8` |
| Package calculator | `https://www.flyiniris.com/#calculator` |
| Film showcase | `https://www.flyiniris.com/#films` |

---

## Next Steps

1. **Push to deploy:** `git push origin main` → Cloudflare Pages auto-deploys all new pages
2. **Test personalized pages** with real params in browser
3. **Update GHL workflows** to use new SMS copy from `sms-cheatsheet-v2.md`
4. **Import CSV** into Google Sheets for Film Index
5. **Build Google Form** using `film-intake-form-spec.html` as reference
6. **Future:** Wire Film Index to personalized pages for dynamic film matching by venue type
