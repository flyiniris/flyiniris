#!/usr/bin/env node
// Commercial proposal page generator.
// Usage: node proposal-tooling/generate.js <slug>
// Reads proposal-tooling/configs/<slug>.json + a template, writes
// p/<slug>/index.html. The next side job is a new config file (plus its
// commercial_proposals D1 row in iris-automation), not a new page.
// Modes: legacy package configs (no "mode") use template.html; configs with
// "mode": "lineitems" use template-lineitems.html, a generic shell that
// renders ALL client copy, items, terms and agreement from
// GET /api/commercial/<slug>/proposal at runtime. This repo is public, so a
// line-item page and its config hold no client details and no token: the
// token arrives in the emailed link's #t= fragment.
// Copy rules: no em or en dashes anywhere (global, every mode). Banned words
// are per config ("bannedWords"); configs without the key default to "video"
// and "footage". The generator refuses to emit violations.

const fs = require('fs');
const path = require('path');

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node proposal-tooling/generate.js <slug>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs', `${slug}.json`), 'utf8'));
const DEFAULT_BANNED_WORDS = ['video', 'footage'];
const bannedWords = Array.isArray(cfg.bannedWords) ? cfg.bannedWords : DEFAULT_BANNED_WORDS;

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const html = cfg.mode === 'lineitems' ? buildLineItems() : buildLegacy();

const leftovers = html.match(/{{[A-Z_]+}}/g);
if (leftovers) {
  console.error('Unreplaced placeholders:', leftovers.join(', '));
  process.exit(1);
}
if (/[\u2013\u2014]/.test(html)) {
  console.error('Banned dash character (U+2013 or U+2014) found in output. Fix the config.');
  process.exit(1);
}
if (bannedWords.length) {
  const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp('\\b(' + bannedWords.map(escRe).join('|') + ')\\b', 'i');
  if (wordRe.test(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''))) {
    console.error(`Banned word (${bannedWords.join(' or ')}) found in client-facing markup. Fix the config.`);
    process.exit(1);
  }
}

const outDir = path.join(root, 'p', cfg.slug);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`Wrote p/${cfg.slug}/index.html (${html.length} bytes)`);

// Line-item mode: a generic shell. Client copy comes from the API
// (terms.page), never from the config, and the token never touches the page.
function buildLineItems() {
  if (!cfg.apiBase) {
    console.error('Config is missing apiBase.');
    process.exit(1);
  }
  if (cfg.pageToken) {
    console.error('Line-item configs must not carry a pageToken: the page reads it from the #t= link fragment.');
    process.exit(1);
  }
  const template = fs.readFileSync(path.join(__dirname, 'template-lineitems.html'), 'utf8');
  const runtimeConfig = {
    slug: cfg.slug,
    apiBase: cfg.apiBase,
    contactEmail: cfg.contactEmail,
    defaultIncludedNotes: cfg.defaultIncludedNotes || [],
  };
  // JSON inside a script tag: escape "<" so config text can never close it.
  const runtimeJson = JSON.stringify(runtimeConfig).replace(/</g, '\\u003c');
  return template
    .replace('{{TITLE}}', esc(cfg.title))
    .replace('{{META_DESC}}', esc(cfg.metaDescription))
    .replace('{{EYEBROW}}', esc(cfg.eyebrow))
    .replace('{{HEADLINE}}', esc(cfg.headline))
    .replace(/{{CONTACT_EMAIL}}/g, esc(cfg.contactEmail))
    .replace('{{RUNTIME_CONFIG}}', () => runtimeJson);
}

// Legacy package mode (Sweet Spot). Output must stay byte-identical.
function buildLegacy() {
  const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

  const packageCards = cfg.packages.map((p) => `        <div class="package-card${p.recommended ? ' recommended' : ''}" data-package="${esc(p.id)}">
${p.recommended ? '          <div class="package-badge">Recommended</div>\n' : ''}          <div class="package-name">${esc(p.label)}</div>
          <div class="package-price"><span class="amount">${esc(p.priceDisplay)}</span></div>
          <div class="package-tax">${esc(cfg.taxNote)}</div>
          <ul class="package-features">
${p.features.map((f) => `            <li>${esc(f)}</li>`).join('\n')}
          </ul>
          <button type="button" class="package-choose">Choose ${esc(p.label)}</button>
        </div>`).join('\n');

  // First sentence becomes the card lead, the rest the body.
  const nextCards = cfg.nextItems.map((item) => {
    const idx = item.indexOf('. ');
    const lead = idx > 0 ? item.slice(0, idx + 1) : item;
    const rest = idx > 0 ? item.slice(idx + 2) : '';
    return `        <div class="next-card"><strong>${esc(lead)}</strong>${esc(rest)}</div>`;
  }).join('\n');

  const timelineSteps = cfg.timeline.map((t, i) => `        <div class="timeline-step">
          <div class="timeline-num">0${i + 1}</div>
          <div class="timeline-name">${esc(t.step)}</div>
          <div class="timeline-body">${esc(t.body)}</div>
        </div>`).join('\n');

  const agreementClauses = cfg.agreementClauses.map((c) => c.lead
    ? `        <p><strong>${esc(c.lead)}</strong> ${esc(c.text)}</p>`
    : `        <p>${esc(c.text)}</p>`).join('\n');

  const runtimeConfig = {
    slug: cfg.slug,
    apiBase: cfg.apiBase,
    pageToken: cfg.pageToken,
    taxRateBps: cfg.taxRateBps,
    taxNote: cfg.taxNote,
    taxLineLabel: cfg.taxLineLabel,
    defaultPackage: (cfg.packages.find((p) => p.recommended) || cfg.packages[0]).id,
    packages: Object.fromEntries(cfg.packages.map((p) => [p.id, {
      label: p.label, baseCents: p.baseCents, priceDisplay: p.priceDisplay,
    }])),
  };

  return template
    .replace('{{TITLE}}', esc(cfg.title))
    .replace('{{META_DESC}}', esc(cfg.metaDescription))
    .replace('{{EYEBROW}}', esc(cfg.eyebrow))
    .replace('{{HEADLINE}}', esc(cfg.headline))
    .replace('{{SUBHEAD}}', esc(cfg.subhead))
    .replace('{{PACKAGE_CARDS}}', packageCards)
    .replace('{{USAGE_LINE}}', esc(cfg.usageLine))
    .replace('{{NEXT_TITLE}}', esc(cfg.nextTitle))
    .replace('{{NEXT_CARDS}}', nextCards)
    .replace('{{NEXT_CLOSING}}', esc(cfg.nextClosing))
    .replace('{{TIMELINE_STEPS}}', timelineSteps)
    .replace('{{AGREEMENT_TITLE}}', esc(cfg.agreementTitle))
    .replace('{{AGREEMENT_CLAUSES}}', agreementClauses)
    .replace('{{SUCCESS_HEADLINE}}', esc(cfg.successHeadline))
    .replace('{{SUCCESS_BODY}}', esc(cfg.successBody))
    .replace('{{CANCEL_HEADLINE}}', esc(cfg.cancelHeadline))
    .replace('{{CANCEL_BODY}}', esc(cfg.cancelBody))
    .replace('{{RUNTIME_CONFIG}}', JSON.stringify(runtimeConfig));
}
