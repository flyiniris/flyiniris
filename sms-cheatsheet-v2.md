# SMS Cheat Sheet v2: Flyin' Iris

## GHL Merge Fields Reference

| Field | Description |
|---|---|
| `{{contact.first_name}}` | Contact's first name |
| `{{contact.fiancé_s_first_name}}` | Fiance's first name |
| `{{contact.wedding_date}}` | Wedding date |
| `{{contact.venue_name}}` | Venue name |
| `{{contact.estimated_price}}` | Estimated package price |
| `{{contact.calculator_tier}}` | Calculator tier selection |
| `{{contact.bundle_savings}}` | Bundle savings amount |

---

## WF-01: Inquiry Nurture Sequence

**Welcome SMS** (immediately after inquiry)

```
hey {{contact.first_name}}! this is Sean from Flyin' Iris 🎬 just put something together for you: flyiniris.com/yours?fn={{contact.first_name}}&vn={{contact.venue_name}}&wd={{contact.wedding_date}} 💛
```

**24hr Nudge SMS**

```
{{contact.first_name}}, thought you might want to see what we could create for {{contact.venue_name}} 🤍 flyiniris.com/films?vn={{contact.venue_name}}
```

**48hr Social Proof SMS**

```
one more from us: couples say this is the film that made them pick up the phone 💛 flyiniris.com/films
```

---

## WF-02: Calculator Nurture Sequence

**Welcome SMS** (immediately after calculator)

```
{{contact.first_name}}! just built out your package details ✨ flyiniris.com/package?fn={{contact.first_name}}&tier={{contact.calculator_tier}}&price={{contact.estimated_price}}&savings={{contact.bundle_savings}}
```

**2hr Nudge SMS**

```
hey, Sean has a few discovery call spots open this week if you want to talk through your package 💛 book.flyiniris.com/widget/booking/Kd7zWqsXzAswGHR1HuDR
```

**48hr SMS**

```
last one from us, just wanted to make sure you saw your custom package 🎬 flyiniris.com/package?fn={{contact.first_name}}&tier={{contact.calculator_tier}}&price={{contact.estimated_price}}
```

---

## WF-02 (from Inquiry path: contact already inquired, now did calculator)

**Welcome SMS** (from Inquiry)

```
{{contact.first_name}}! loved seeing you build your package ✨ here's everything in one spot: flyiniris.com/package?fn={{contact.first_name}}&tier={{contact.calculator_tier}}&price={{contact.estimated_price}}&savings={{contact.bundle_savings}}
```

**2hr Nudge SMS** (from Inquiry)

```
ready whenever you are: book.flyiniris.com/widget/booking/Kd7zWqsXzAswGHR1HuDR 💛
```

**48hr SMS** (from Inquiry)

```
just making sure this didn't get buried, your custom package is still waiting 🎬 flyiniris.com/package?fn={{contact.first_name}}&tier={{contact.calculator_tier}}&price={{contact.estimated_price}}
```

---

## WF-03: Discovery Call Booked

**Confirmation SMS**

```
you're on the calendar! 🎉 so excited to hear about your day. talk soon - Sierra & Sean
```

---

## WF-10: Missed Call Text-Back

**Text-Back SMS**

```
hey! this is Sean from Flyin' Iris 🎬 sorry we missed you! call back anytime or grab a spot here: book.flyiniris.com/widget/booking/Kd7zWqsXzAswGHR1HuDR
```

---

## Compliance

- **ALWAYS** check SMS Non-Marketing Consent = "Yes" before sending
- All messages from: **(262) 384-5079**
- Max 2 texts per 24hr per contact
- If consent = No or empty: email only, never text
