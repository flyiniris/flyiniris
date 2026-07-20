#!/usr/bin/env node
// Commercial proposal page generator.
// Usage: node proposal-tooling/generate.js <slug>
// Reads proposal-tooling/configs/<slug>.json + template.html, writes
// p/<slug>/index.html. The next side job is a new config file (plus its
// commercial_proposals D1 row in iris-automation), not a new page.
// Copy rules: no em or en dashes anywhere; client-facing copy never says
// "video" or "footage". The generator refuses to emit violations.

const fs = require('fs');
const path = require('path');

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node proposal-tooling/generate.js <slug>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs', `${slug}.json`), 'utf8'));
const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

let html = template
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

const leftovers = html.match(/{{[A-Z_]+}}/g);
if (leftovers) {
  console.error('Unreplaced placeholders:', leftovers.join(', '));
  process.exit(1);
}
if (/[\u2013\u2014]/.test(html)) {
  console.error('Banned dash character (U+2013 or U+2014) found in output. Fix the config.');
  process.exit(1);
}
if (/\b(video|footage)\b/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''))) {
  console.error('Banned word (video or footage) found in client-facing markup. Fix the config.');
  process.exit(1);
}

const outDir = path.join(root, 'p', cfg.slug);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`Wrote p/${cfg.slug}/index.html (${html.length} bytes)`);
