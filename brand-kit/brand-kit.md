# Flyin' Iris Brand Kit (extracted from production, 2026-07-07)

Every value in this sheet was lifted verbatim from the shipped pages of flyiniris.com: `index.html` (the landing page, canonical) and `thanks.html` (the post-inquiry router, used for drift comparison). Nothing here is approximated. Where the two pages disagree, the landing page value is used and the drift is listed at the bottom.

Companion file: `brand-tokens.css` is a copy-paste stylesheet with the same values. Tell Claude Design: "use brand-tokens.css exactly."

## Hard brand rules (verbatim, non-negotiable)

1. No em or en dashes anywhere: customer copy, headings, body text, captions, code, everything. Use colons, periods, commas, parentheses. Hyphens inside compound words (9-12 min, click-to-DM) are fine.
2. Couple name order is "Sierra & Sean", Sierra first, in all customer-facing copy. Team descriptor: "husband and wife team."
3. The deliverable is always a film, never a video. "Wedding film," "highlight film," "your film."
4. Gold is the only accent. No second accent color, ever. Gold is `#FFBD1D`.
5. Greeting opener: "Hey [Name]!" Never Hi, Dear, or Hello. Sign-off: "Sierra & Sean" or "Sierra & Sean, Flyin' Iris".

## Colors

Core palette (index.html `:root`, lines 192-202):

| Token | Value | Used for |
|---|---|---|
| `--bg-primary` | `#0A0A0A` | Page background, button text on gold, theme-color meta |
| `--bg-secondary` | `#111110` | Alternating sections (testimonials, venues), cards |
| `--text-primary` | `#F5F0EB` | Headings, primary text |
| `--text-secondary` | `#C8C3B9E6` | Body copy, sub text (that is `#C8C3B9` at 90% alpha) |
| `--text-muted` | `rgba(200, 195, 185, 0.9)` | Hero subhead |
| `--accent` | `#FFBD1D` | THE gold. Labels, links, icons, buttons, dividers |
| `--accent-light` | `#FFF0C9` | Gold-tinted text inside gold boxes |
| `--accent-dark` | `#D99E0A` | Button hover, price tags |
| `--border` | `#2A2A28` | 1px borders, card outlines |

Deep-surface grays used by the inquiry form / quiz (index.html lines 1593-1722):

| Value | Used for |
|---|---|
| `#0f0f0f` | Form input and option backgrounds |
| `#1a1a1a` | Input borders (2px), progress track, disabled button |
| `#1a1700` | Gold-tinted background for selected options and gold boxes |
| `#151515` / `#1f1f1f` | Film match card background / its border |
| `#333` | Option hover border, checkbox border |
| `#6B6B6B` | Placeholders, faint hints |
| `#8E8E8E` | Step counters, tiny notes |
| `#A8A29A` | Option descriptions |
| `#C4BFB6` | Intro chips |
| `#1a1815` | Hero fallback gradient midpoint (`linear-gradient(135deg, #0A0A0A 0%, #1a1815 50%, #0A0A0A 100%)`) |

Gold at low alpha (the only tints in use, all `rgba(255, 189, 29, x)`): 0.07 price-tag bg, 0.08 icon circles and hover fills, 0.1 outline-button hover fill, 0.13 gold left-border rules, 0.15 card hover glow, 0.2 gold-box borders, 0.25 package-box border, 0.3 sound-toggle border.

Functional colors (JS-driven states, index.html lines 1655 and 2767-2771):

| Value | Used for |
|---|---|
| `#e74c3c` | Form validation errors |
| `#4CAF50` | Date available |
| `#FF9800` | Date limited |
| `#f44336` | Date booked |

Overlays: hero video overlay `rgba(0, 0, 0, 0.55)`; testimonial background overlay `rgba(10, 10, 10, 0.85)`; scrolled nav `rgba(10, 10, 10, 0.95)` with `backdrop-filter: blur(12px)`; mobile menu `rgba(10, 10, 10, 0.98)`.

## Typography

Exact Google Fonts import as shipped on the landing page (index.html line 58):

```
https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Outfit:wght@300;400;500;600;700&display=swap
```

Font stacks, exactly as written in the CSS:

- Display serif: `'Cormorant Garamond', serif`
- Body and UI sans: `'Outfit', sans-serif`

Body base (index.html `body`, lines 215-225): Outfit, weight 300, `letter-spacing: 0.01em`, `line-height: 1.6`, antialiased, color `--text-primary` on `--bg-primary`.

### Heading scale (as actually styled)

| Level | Font | Weight | Size | Line-height | Notes |
|---|---|---|---|---|---|
| Hero h1 | Cormorant Garamond | 600 | `clamp(2.2rem, 5vw, 4.2rem)` | 1.15 | Text-shadow `0 2px 20px rgba(0,0,0,0.6)`. At <=480px: `clamp(1.8rem, 7vw, 2.5rem)` |
| Section h2 | Cormorant Garamond | 600 | `clamp(1.8rem, 4vw, 2.5rem)` | inherit | Centered, `margin-bottom: 48px` |
| Big-section h2 variants | Cormorant Garamond | 600 | why: `clamp(2.2rem, 5vw, 3.2rem)`; differentiators: `clamp(2rem, 4.5vw, 3rem)` | inherit | Same style, larger clamp |
| Card title h3 | Cormorant Garamond | 600 | `clamp(1.4rem, 3vw, 1.8rem)` | 1.3 | diff-card titles |
| Quiz question | Cormorant Garamond | 600 | `1.375rem` | 1.2 | 1.25rem at <=768px |
| Eyebrow label | Outfit | 400 | `0.75rem` | inherit | UPPERCASE, `letter-spacing: 0.2em`, color gold, above every heading |

Serif italic accent (a signature): film titles, taglines, and pull quotes are Cormorant Garamond italic weight 400. Quotes in gold (`.why-quote`), film titles in `--text-secondary` at 1rem, carousel quotes `clamp(1.1rem, 2.5vw, 1.5rem)` line-height 1.7.

Gold italic word inside the hero headline: `.hero h1 .hit` is `color: var(--accent); font-style: italic;` (the "Hit" in "Wedding Films That Hit Different.").

### Body and UI text specs

- Section body copy: Outfit 300, `1.02rem` to `1.05rem`, line-height 1.7 to 1.8, color `--text-secondary`.
- Nav links: Outfit 400, `0.8rem`, `font-variant: all-small-caps`, `letter-spacing: 0.1em`, `--text-secondary`, hover `--text-primary`.
- Social proof bar: Outfit 300, `0.85rem`, `letter-spacing: 0.1em`, gold middle dots (`.gold-dot`).
- Micro text (hints, legal): `0.625rem` to `0.75rem`, colors `#6B6B6B` or `rgba(200,195,185,0.4)`.
- Quiz type scale, documented in the source itself (index.html line 1590): `0.625rem | 0.75rem | 0.875rem | 1rem | 1.375rem | clamp() | 2rem | 2.625rem`.

## Buttons

Primary `.btn` (index.html lines 572-591):

```css
font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.9375rem;
letter-spacing: 0.5px; padding: 15px 40px;
background-color: var(--accent); color: var(--bg-primary);
border: none; border-radius: 8px;
transition: background-color 0.3s ease, filter 0.3s ease;
```

Hover and focus: `background-color: var(--accent-dark)` (gold darkens, text stays near-black). At <=480px padding tightens to `15px 32px`.

Small nav button (quiz next): padding `10px 22px`, radius 6px, `0.75rem` weight 700; disabled state `#1a1a1a` bg with `#6B6B6B` text.

Outline button `.btn-outline` (thanks.html lines 282-295): transparent bg, `2px solid var(--accent)`, gold text, weight 600 `0.875rem`, padding `12px 30px`, radius 8px; hover fills `rgba(255, 189, 29, 0.1)` and shifts text and border to `--accent-light`.

Text link `.text-link` (index.html lines 791-815): Outfit 400 `0.95rem`, gold, no underline at rest; a 1px gold underline animates from `width: 0` to `100%` on hover (the signature gold underline).

## Form fields (inquiry form, canonical)

- Inputs and textareas: `padding: 13px 14px; border-radius: 8px; border: 2px solid #1a1a1a; background-color: #0f0f0f; color: var(--text-primary); font-size: 0.875rem;` Outfit. Focus: `border-color: var(--accent)`. Error: `border-color: #e74c3c`. Placeholder: `#6B6B6B`. At <=768px inputs go to `font-size: 16px` (prevents iOS zoom).
- Labels: Outfit 600, `0.75rem`, `--text-secondary`, `letter-spacing: 0.5px`, 5px below-gap.
- Checkboxes: 20px square, radius 4px, `2px solid #333`; checked fills solid gold with a near-black check.
- Date inputs: `color-scheme: dark; accent-color: #ffbd1d;` with a gold-filtered calendar icon.
- Option cards (quiz): radius 10px, `2px solid #1a1a1a` on `#0f0f0f`; hover border `#333`; selected border gold on `#1a1700` with the label turning gold.

## Spacing rhythm and layout

- Section padding: `120px 24px` desktop, `80px 20px` at <=768px, `60px 16px` at <=480px.
- Content widths: sections `max-width: 1100px`; prose blocks 640 to 650px; quiz and form column 520px; thanks page column 680px.
- Radius scale: 8px (buttons, inputs, film frames), 10px (option cards, gold boxes), 12px (feature cards), pills at 20px or 100px.
- Grids: 2-column `1fr 1fr` with `gap: 32px`, collapsing to 1 column at <=768px.
- Section divider: 100px wide, 1px tall, `linear-gradient(90deg, transparent, var(--border), transparent)` with a 60px gold shimmer sweeping through on a 4s loop.
- Gold rule dividers: 48px x 2px solid gold (`.why-divider`), 60px x 2px on the thanks page.

## Signature treatments

1. Film grain: a fixed SVG turbulence noise layer at `opacity: 0.04`, animated with `grain 8s steps(10) infinite`. On the landing page it covers the hero; on the thanks page it covers the whole page.
2. Gold shimmer: section dividers carry an infinite gold gradient sweep (`shimmer 4s ease-in-out infinite`).
3. Reveal motion: everything enters with fade-up (`translateY(30px)` to 0, `0.8s cubic-bezier(0.16, 1, 0.3, 1)`), children staggered 0.15s apart. That easing curve is used for every entrance on the site.
4. Hero video: full-bleed muted looping mp4 under `rgba(0, 0, 0, 0.55)` overlay; text carries soft black text-shadows for legibility.
5. Gold underline on hover for inline links (see `.text-link`).
6. Gold middle-dot separators between credential items.
7. One gold italic serif word inside an otherwise cream headline (`.hit`).
8. Card hover: border turns gold plus a soft gold glow (`box-shadow: 0 0 12px rgba(255, 189, 29, 0.15)` on media, `0 0 20px rgba(255, 189, 29, 0.08)` on cards).
9. Why-section blocks: full-bleed background stills at `opacity: 0.12` (0.18 when in view) behind centered text.
10. Reduced motion respected: `prefers-reduced-motion: reduce` collapses all animation durations to 0.01ms.

## Style drift found between pages (landing page wins)

1. Google Fonts URL: thanks.html loads extra weights (Cormorant Garamond 300/500 plus italic 300, Outfit 200). The kit uses the landing page URL above.
2. `--text-secondary`: `#C8C3B9E6` (90% alpha) on index vs opaque `#C8C3B9` on thanks.
3. `--text-muted`: `rgba(200,195,185,0.9)` on index vs `0.5` on thanks.
4. `--bg-card`: originally only thanks defined it (`#161615`, plus `--bg-elevated: #1A1A19`) while index used `var(--bg-card)` on FAQ items without defining it, rendering them transparent. Fixed 2026-07-07: index now defines `--bg-card: #161615` too. `--bg-elevated` remains thanks-only.
5. Primary button hover: index darkens to `#D99E0A`; thanks (`.cta-btn`) lightens to `#FFF0C9` and lifts 1px, at weight 600 and padding `14px 36px` instead of 700 and `15px 40px`. Kit standardizes on the index darken behavior.
6. Grain overlay scope: hero-only (z-index 3) on index vs full-page fixed (z-index 9999) on thanks.
7. index has the `prefers-reduced-motion` guard; thanks.html does not.
