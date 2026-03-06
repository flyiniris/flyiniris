# Flyin' Iris — GHL SMS Copy-Paste Cheat Sheet

> All messages: From **(262) 384-5079**
> Voice: Texts from a friend. Warm, genuine, specific. Light emoji (💛 🎉 only). Short.
> Sign-off: Always "— Sean & Sierra" or "— Sean & Sierra, Flyin' Iris"

---

## GHL Merge Fields Reference

| Field | Merge Tag |
|-------|-----------|
| First name | `{{contact.first_name}}` |
| Fiancé name | `{{contact.fiancé_s_first_name}}` |
| Wedding date | `{{contact.wedding_date}}` |
| Venue | `{{contact.venue_name}}` |
| Estimated price | `{{contact.estimated_price}}` |
| Calculator tier | `{{contact.calculator_tier}}` |
| Bundle savings | `{{contact.bundle_savings}}` |
| Calendar link | `{{calendar_link}}` |
| Appointment time | `{{appointment.start_time}}` |

---

## Workflow 1 — New Inquiry Auto-Response

**When:** Within 1-2 min of new inquiry
**Consent check:** SMS Non-Marketing Consent = "Yes"
**Conditions:** None

```
Hey {{contact.first_name}}! We just got your inquiry and we're so excited — {{contact.venue_name}} on {{contact.wedding_date}} sounds absolutely beautiful. We'd love to hop on a quick 15-min call to hear about your day. No pitch, just a real conversation: {{calendar_link}}

— Sean & Sierra, Flyin' Iris 💛
```

---

## Workflow 2 — Calculator Completed

**When:** Within 1-2 min of calculator submission
**Consent check:** SMS Non-Marketing Consent = "Yes"
**Conditions:** None

```
Hey {{contact.first_name}}! Loved seeing your custom package come together 💛 We'd love to walk you through it on a quick call — {{calendar_link}}

— Sean & Sierra
```

---

## Workflow 3 — 24hr Follow-Up

**When:** 24 hours after inquiry
**Consent check:** SMS Non-Marketing Consent = "Yes"
**Conditions:** Contact NOT in Stage 3+ AND Calculator Tier is empty

```
Hey {{contact.first_name}}! Random thought — has {{contact.venue_name}} always been the dream or did you two just walk in and know? Either way we love it 💛 Whenever you're ready to chat: {{calendar_link}}

— Sean & Sierra
```

---

## Stage 3 — Discovery Call Booked (Immediate)

**When:** Immediately after call is booked
**Consent check:** SMS Non-Marketing Consent = "Yes"

```
{{contact.first_name}}! Your call is booked for {{appointment.start_time}} — can't wait to hear about your day! 💛

— Sean & Sierra
```

---

## Stage 3 — 24hr Before Call Reminder

**When:** 24 hours before appointment
**Consent check:** SMS Non-Marketing Consent = "Yes"

```
Hey {{contact.first_name}}, just a heads up — we're chatting tomorrow at {{appointment.start_time}}! Looking forward to it 💛

— Sean & Sierra
```

---

## Stage 3 — 1hr Before Call Reminder

**When:** 1 hour before appointment
**Consent check:** SMS Non-Marketing Consent = "Yes"

```
See you in an hour, {{contact.first_name}}! Here's your Zoom link: [ZOOM LINK]

— Sean & Sierra
```

---

## Stage 4B — Day 3 Thinking Nudge

**When:** 3 days after discovery call
**Consent check:** SMS Non-Marketing Consent = "Yes"
**Conditions:** Contact tagged "call-outcome-thinking"

*(No text at Day 3 — email only)*

---

## Stage 4B — Day 5 Thinking Follow-Up

**When:** 5 days after discovery call
**Consent check:** SMS Non-Marketing Consent = "Yes"
**Conditions:** Contact tagged "call-outcome-thinking"

```
Hey {{contact.first_name}}, no rush at all — just wanted you to know your date is still available. Let us know if any questions came up! 💛

— Sean & Sierra
```

---

## Stage 4B — Day 10 Urgency (Final)

**When:** 10 days after discovery call
**Consent check:** SMS Non-Marketing Consent = "Yes"
**Conditions:** Contact tagged "call-outcome-thinking"

```
Hey {{contact.first_name}}, just a heads up — we've had a couple other inquiries for {{contact.wedding_date}}. We wanted to give you first dibs before we open it up. No pressure at all 🤍

— Sean & Sierra
```

---

## Stage 5 — Proposal 48hr Follow-Up

**When:** 48 hours after proposal sent
**Consent check:** SMS Non-Marketing Consent = "Yes"

```
Hey {{contact.first_name}}, just checking in — did you get a chance to look over the proposal? Happy to answer any questions at all 💛

— Sean & Sierra
```

---

## Stage 5 — Proposal Day 10 Urgency

**When:** 10 days after proposal sent
**Consent check:** SMS Non-Marketing Consent = "Yes"

```
Hey {{contact.first_name}}, quick heads up — we're holding {{contact.wedding_date}} for you but had another inquiry come in for that weekend. Just want to make sure you get first dibs 🤍

— Sean & Sierra
```

---

## Stage 6 — Contract Signed

**When:** Immediately after contract is signed
**Consent check:** SMS Non-Marketing Consent = "Yes"

```
IT'S OFFICIAL 🎉 {{contact.first_name}}, we are SO excited to be part of your day. Check your email for what's next — this is going to be amazing.

— Sean & Sierra, Flyin' Iris 💛
```

---

## SMS Compliance Reminders

- **ALWAYS** check consent field before sending
- **Non-marketing consent** = service/booking messages
- **Marketing consent** = promotional messages
- All messages from: **(262) 384-5079**
- **Max 2 texts per 24hr** per contact (excluding appointment reminders)
- GHL should auto-append STOP language if configured in phone settings
- If consent = No or empty → **email only, never text**

## GHL Workflow IF/ELSE Pattern

For every SMS step:

```
IF → Contact Field → SMS Non-Marketing Consent → is → Yes → Send SMS
ELSE → Do nothing (email step handles it)
```
