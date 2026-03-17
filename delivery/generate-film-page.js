#!/usr/bin/env node
/**
 * Film Delivery Page Generator
 * Generates /films/{slug}/index.html, manifest.json, and sw.js
 * from templates + JSON config.
 *
 * Usage:
 *   node delivery/generate-film-page.js config.json
 *   node delivery/generate-film-page.js delivery/sample/jessica-tyler.json
 */

const fs = require('fs');
const path = require('path');

// ── Parse CLI args ──────────────────────────────────────────────
const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node generate-film-page.js <config.json>');
  console.error('');
  console.error('Config JSON schema:');
  console.error(JSON.stringify({
    coupleNames: 'Jessica & Tyler',
    slug: 'jessica-tyler',
    filmSlug: 'jessica-tyler (optional, defaults to slug)',
    venueDisplay: 'The Grand Hall',
    weddingDate: 'September 25, 2026',
    password: 'jt092526',
    videos: {
      highlight: { title: 'Highlight Film', duration: '12:30', featured: true },
      teaser: { title: 'Teaser', duration: '5:00' },
      ceremony: { title: 'Ceremony', duration: '45:00' },
    },
    customMessage: 'Optional custom message (replaces photo gallery placeholder text)',
  }, null, 2));
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf-8'));

// ── Normalize config (support both new format and existing sample format) ──
const config = { ...raw };

// Support legacy "names" array → "coupleNames" string
if (!config.coupleNames && Array.isArray(config.names)) {
  config.coupleNames = config.names.join(' & ');
}

// Support legacy "date" → "weddingDate"
if (!config.weddingDate && config.date) {
  config.weddingDate = config.date;
}

// ── Validate required fields ────────────────────────────────────
const required = ['coupleNames', 'slug', 'weddingDate', 'videos'];
for (const field of required) {
  if (!config[field]) {
    console.error(`Missing required config field: ${field}`);
    process.exit(1);
  }
}

const {
  coupleNames,
  slug,
  filmSlug = slug,
  venueDisplay = '',
  weddingDate,
  videos,
  customMessage = '',
  password = '',
} = config;

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Convert long date string to short format: "September 25, 2026" → "09.25.2026"
 */
function dateToShort(dateStr) {
  const months = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };
  const match = dateStr.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (!match) return dateStr;
  const [, monthName, day, year] = match;
  const mm = months[monthName.toLowerCase()] || '01';
  const dd = day.padStart(2, '0');
  return `${mm}.${dd}.${year}`;
}

/**
 * Convert videos config object to VIDEOS array for the template.
 * Accepts either:
 *   - Object keyed by video ID: { highlight: { title, duration, featured }, ... }
 *   - Array (existing format): [{ id, title, category, duration, order, featured }, ...]
 */
function buildVideosArray(videos) {
  // If already an array, return as-is (supports existing config format)
  if (Array.isArray(videos)) return videos;

  // Default category mapping
  const categoryMap = {
    highlight: 'highlight',
    teaser: 'teaser',
    ceremony: 'archival',
    speeches: 'archival',
    'first-dance': 'archival',
    'parent-dances': 'archival',
    gopro: 'bonus',
    raw: 'archival',
  };

  const entries = Object.entries(videos);
  return entries.map(([id, v], i) => ({
    id,
    title: v.title || id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' '),
    category: v.category || categoryMap[id] || 'archival',
    duration: v.duration || '',
    order: v.order != null ? v.order : i,
    ...(v.featured ? { featured: true } : {}),
  }));
}

// ── Read templates ──────────────────────────────────────────────
const templateDir = path.join(__dirname, 'templates');
const htmlTemplate = fs.readFileSync(path.join(templateDir, 'couple-page.html'), 'utf-8');
const manifestTemplate = fs.readFileSync(path.join(templateDir, 'manifest.json'), 'utf-8');
const swContent = fs.readFileSync(path.join(templateDir, 'sw.js'), 'utf-8');

// ── Build data ──────────────────────────────────────────────────
const WORKER_BASE = 'https://video.flyiniris.com';
const videosArray = buildVideosArray(videos);
const featuredVideo = videosArray.find(v => v.featured) || videosArray[0];
const featuredId = featuredVideo ? featuredVideo.id : 'highlight';
const year = new Date().getFullYear().toString();
const dateShort = dateToShort(weddingDate);

// ── Replace template placeholders ───────────────────────────────
let html = htmlTemplate
  .replace(/\{\{COUPLE_NAMES\}\}/g, coupleNames)
  .replace(/\{\{DATE_LONG\}\}/g, weddingDate)
  .replace(/\{\{DATE_SHORT\}\}/g, dateShort)
  .replace(/\{\{SLUG\}\}/g, filmSlug)
  .replace(/\{\{WORKER_BASE\}\}/g, WORKER_BASE)
  .replace(/\{\{VIDEOS_JSON\}\}/g, JSON.stringify(videosArray))
  .replace(/\{\{FEATURED_VIDEO_ID\}\}/g, featuredId)
  .replace(/\{\{YEAR\}\}/g, year);

// Replace custom message in photo gallery placeholder if provided
if (customMessage) {
  html = html.replace(
    'Your photos from the big day will be viewable here soon.',
    customMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );
}

let manifest = manifestTemplate
  .replace(/\{\{COUPLE_NAMES\}\}/g, coupleNames)
  .replace(/\{\{SLUG\}\}/g, slug);

// ── Write output ────────────────────────────────────────────────
const outputDir = path.resolve(__dirname, '..', 'films', slug);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'index.html'), html, 'utf-8');
fs.writeFileSync(path.join(outputDir, 'manifest.json'), manifest, 'utf-8');
fs.writeFileSync(path.join(outputDir, 'sw.js'), swContent, 'utf-8');

console.log(`Film page generated: films/${slug}/`);
console.log(`  index.html  (${(html.length / 1024).toFixed(1)} KB)`);
console.log(`  manifest.json`);
console.log(`  sw.js`);
console.log(`  Delivery URL: https://flyiniris.com/films/${slug}/`);
if (password) {
  console.log(`  Download password: ${password}`);
}
