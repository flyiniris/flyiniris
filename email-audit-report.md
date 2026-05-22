# Email Template Audit & Fix Report

**Date:** 2026-03-03
**Performed by:** API Ops Agent
**GHL Location:** gY9JdczvM3s0wQCTnD9s (Flyin' Iris)
**API Endpoint Used:** `POST /emails/builder/data`

---

## Summary

All 4 email templates were pulled from GoHighLevel, audited against the checklist, fixed, and PATCHed back via the API. Each template had exactly **1 issue**: a `lo-ai.co` booking URL that needed to be replaced with the `book.flyiniris.com` equivalent.

| Template | GHL ID | Issues Found | Status |
|----------|--------|-------------|--------|
| FIMP - INQ-01 Welcome & Film | 69a3c3596c66b2cdd08903e5 | 1 (lo-ai.co URL) | FIXED (201 OK) |
| FIMP - INQ-02 Venue Check-In | 69a3c35ad6567bda82d529de | 1 (lo-ai.co URL) | FIXED (201 OK) |
| FIMP - INQ-03 Social Proof | 69a3c35ab093ec02a636acd9 | 1 (lo-ai.co URL) | FIXED (201 OK) |
| FIMP - CALC-01 Package Recap | 69a3c3594b552f652a0b2f07 | 1 (lo-ai.co URL) | FIXED (201 OK) |

---

## Audit Checklist Results

### 1. Placeholder Text (`[PLACEHOLDER]`, `[CALENDAR LINK]`, `[CALCULATOR LINK]`)
- **INQ-01:** CLEAN - No placeholder text found
- **INQ-02:** CLEAN - No placeholder text found
- **INQ-03:** CLEAN - No placeholder text found
- **CALC-01:** CLEAN - No placeholder text found

### 2. `lo-ai.co` URLs
- **INQ-01:** FOUND & FIXED (1 instance)
- **INQ-02:** FOUND & FIXED (1 instance)
- **INQ-03:** FOUND & FIXED (1 instance)
- **CALC-01:** FOUND & FIXED (1 instance)

### 3. Blue Link Colors (`#0000FF`, `#0066CC`, `#1155CC`, `blue`)
- **INQ-01:** CLEAN - All links use `#FFBD1D` (gold) or `#9B9389` (unsubscribe muted)
- **INQ-02:** CLEAN - All links use `#FFBD1D` (gold) or `#9B9389` (unsubscribe muted)
- **INQ-03:** CLEAN - All links use `#FFBD1D` (gold) or `#9B9389` (unsubscribe muted)
- **CALC-01:** CLEAN - All links use `#FFBD1D` (gold) or `#9B9389` (unsubscribe muted)

### 4. GHL Merge Fields
- **INQ-01:** CORRECT - Uses `{{contact.first_name}}`, `{{contact.fiancé_s_first_name}}`, `{{contact.venue_name}}`, `{{contact.wedding_date}}`, `{{unsubscribe_link}}`
- **INQ-02:** CORRECT - Uses `{{contact.first_name}}`, `{{contact.fiancé_s_first_name}}`, `{{contact.venue_name}}`, `{{contact.wedding_date}}`, `{{unsubscribe_link}}`
- **INQ-03:** CORRECT - Uses `{{contact.first_name}}`, `{{contact.venue_name}}`, `{{contact.wedding_date}}`, `{{unsubscribe_link}}`
- **CALC-01:** CORRECT - Uses `{{contact.first_name}}`, `{{contact.fiancé_s_first_name}}`, `{{contact.calculator_tier}}`, `{{contact.hours_selected}}`, `{{contact.highlight_film}}`, `{{contact.teaser_film}}`, `{{contact.story_session}}`, `{{contact.estimated_price}}`, `{{contact.bundle_savings}}`, `{{contact.wedding_date}}`, `{{unsubscribe_link}}`

### 5. Booking URLs
- **INQ-01:** Fixed (see diff below)
- **INQ-02:** Fixed (see diff below)
- **INQ-03:** Fixed (see diff below)
- **CALC-01:** Fixed (see diff below)

### 6. Sign-off Branding ("Media Productions" check)
- **INQ-01:** CORRECT - Sign-off reads "Sierra & Sean" / "Flyin' Iris" (no "Media Productions")
- **INQ-02:** CORRECT - Sign-off reads "Sierra & Sean" / "Flyin' Iris"
- **INQ-03:** CORRECT - Sign-off reads "Sierra & Sean" / "Flyin' Iris"
- **CALC-01:** CORRECT - Sign-off reads "Sierra & Sean" / "Flyin' Iris"

> **Note:** The copyright footer in all templates reads "Flyin' Iris Media Productions LLC" which is the legal entity name and is correct/expected.

---

## Before/After Diffs

### FIMP - INQ-01 Welcome & Film

**1 change made** - CTA button booking URL

```diff
- <a href="https://link.lo-ai.co/widget/booking/Kd7zWqsXzAswGHR1HuDR?utm_source=ghl_email&utm_medium=email&utm_campaign=fimp_inquiry&utm_content=email1_welcome_cta" ...>
+ <a href="https://book.flyiniris.com/widget/booking/Kd7zWqsXzAswGHR1HuDR?utm_source=ghl_email&utm_medium=email&utm_campaign=fimp_inquiry&utm_content=email1_welcome_cta" ...>
```

**Context:** "BOOK YOUR DISCOVERY CALL" gold CTA button. UTM parameters preserved.

**All other URLs verified clean:**
- Film thumbnail: `https://www.flyiniris.com/?utm_source=ghl_email&...#films` -- OK
- Calculator P.S. link: `https://www.flyiniris.com/?utm_source=ghl_email&...#calculator` -- OK
- Instagram: `https://www.instagram.com/flyin.iris/` -- OK

---

### FIMP - INQ-02 Venue Check-In

**1 change made** - CTA button booking URL

```diff
- <a href="https://link.lo-ai.co/widget/booking/Kd7zWqsXzAswGHR1HuDR?utm_source=ghl_email&utm_medium=email&utm_campaign=fimp_inquiry&utm_content=email3_nudge_cta" ...>
+ <a href="https://book.flyiniris.com/widget/booking/Kd7zWqsXzAswGHR1HuDR?utm_source=ghl_email&utm_medium=email&utm_campaign=fimp_inquiry&utm_content=email3_nudge_cta" ...>
```

**Context:** "BOOK A 15-MIN CALL" gold CTA button. UTM parameters preserved.

**All other URLs verified clean:**
- Calculator text link: `https://www.flyiniris.com/?utm_source=ghl_email&...#calculator` -- OK
- Instagram: `https://www.instagram.com/flyin.iris/` -- OK

---

### FIMP - INQ-03 Social Proof

**1 change made** - Secondary booking text link

```diff
- Ready to talk? <a href="https://link.lo-ai.co/widget/booking/Kd7zWqsXzAswGHR1HuDR?utm_source=ghl_email&utm_medium=email&utm_campaign=fimp_inquiry&utm_content=email4_social_booking" ...>
+ Ready to talk? <a href="https://book.flyiniris.com/widget/booking/Kd7zWqsXzAswGHR1HuDR?utm_source=ghl_email&utm_medium=email&utm_campaign=fimp_inquiry&utm_content=email4_social_booking" ...>
```

**Context:** "Book a 15-min call" gold text link below the primary "WATCH THEIR FILM" CTA. UTM parameters preserved.

**All other URLs verified clean:**
- Film thumbnail: `https://www.flyiniris.com/?utm_source=ghl_email&...#films` -- OK
- Primary CTA ("WATCH THEIR FILM"): `https://www.flyiniris.com/?utm_source=ghl_email&...#films` -- OK
- Instagram: `https://www.instagram.com/flyin.iris/` -- OK

---

### FIMP - CALC-01 Package Recap

**1 change made** - CTA button booking URL

```diff
- <a href="https://link.lo-ai.co/widget/booking/V3H7cSaX3iSNqMlRA8O8?utm_source=ghl_email&utm_medium=email&utm_campaign=fimp_inquiry&utm_content=email2_calculator_cta" ...>
+ <a href="https://book.flyiniris.com/widget/booking/V3H7cSaX3iSNqMlRA8O8?utm_source=ghl_email&utm_medium=email&utm_campaign=fimp_inquiry&utm_content=email2_calculator_cta" ...>
```

**Context:** "LET'S TALK ABOUT YOUR PACKAGE" gold CTA button. Note this correctly uses the **calculator-specific** booking widget (`V3H7cSaX3iSNqMlRA8O8`) rather than the inquiry booking widget. UTM parameters preserved.

**All other URLs verified clean:**
- Instagram: `https://www.instagram.com/flyin.iris/` -- OK

---

## URL Mapping Summary

| Before | After | Templates |
|--------|-------|-----------|
| `https://link.lo-ai.co/widget/booking/Kd7zWqsXzAswGHR1HuDR` | `https://book.flyiniris.com/widget/booking/Kd7zWqsXzAswGHR1HuDR` | INQ-01, INQ-02, INQ-03 |
| `https://link.lo-ai.co/widget/booking/V3H7cSaX3iSNqMlRA8O8` | `https://book.flyiniris.com/widget/booking/V3H7cSaX3iSNqMlRA8O8` | CALC-01 |

All UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`) were preserved exactly as-is.

---

## API Notes

- The `GET /emails/builder/templates/{id}` endpoint returned `401 - This route is not yet supported by the IAM Service` for PIT API keys. This is a known GHL limitation.
- **Workaround used:** Listed templates via `GET /emails/builder?locationId=...`, then fetched HTML from the Firebase `previewUrl` returned in the listing response.
- Updates were applied via `POST /emails/builder/data` with `{ locationId, templateId, updatedBy, html, editorType: "html" }`.
- All 4 updates returned HTTP 201 with `{ ok: true }`.
