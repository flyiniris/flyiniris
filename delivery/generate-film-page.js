#!/usr/bin/env node
/**
 * Film Delivery Page Generator (canonical)
 *
 * Source of truth: iris-automation/docs/project-knowledge-2026-05/delivery-page-standard.md
 * Generates films/<slug>/index.html, manifest.json, and sw.js from the template + JSON config.
 *
 * Usage:
 *   node delivery/generate-film-page.js delivery/live/<slug>.json
 *   node delivery/generate-film-page.js delivery/sample/amanda-boris.json
 *   node delivery/generate-film-page.js <config> --worker-base https://video.flyiniris.com
 *   node delivery/generate-film-page.js <config> --output-root ../films
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_WORKER_BASE = 'https://video.flyiniris.com';
const SLUG_RE = /^[a-z0-9-]+$/;
const CATEGORY_ENUM = ['highlight', 'teaser', 'archival', 'bonus'];
const DEPRECATED_FIELDS = ['names', 'date', 'date_short', 'photos', 'customMessage', 'venueDisplay', 'filmSlug'];
const HERO_MAX = 5;

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { configPath: null, workerBase: DEFAULT_WORKER_BASE, outputRoot: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--worker-base' && args[i + 1]) {
      out.workerBase = args[i + 1];
      i++;
    } else if (args[i] === '--output-root' && args[i + 1]) {
      out.outputRoot = args[i + 1];
      i++;
    } else if (!out.configPath) {
      out.configPath = args[i];
    }
  }
  return out;
}

function printUsageAndExit() {
  console.error('Usage: node generate-film-page.js <config.json> [--worker-base <url>] [--output-root <dir>]');
  console.error('');
  console.error('Config schema (see iris-automation/docs/project-knowledge-2026-05/delivery-page-standard.md Section 5):');
  console.error(JSON.stringify({
    slug: 'jessica-tyler',
    coupleNames: 'Jessica & Tyler',
    weddingDate: 'September 25, 2026',
    password: 'optional, real configs go in delivery/live/ (gitignored)',
    videos: [
      { id: 'teaser', title: 'Teaser', category: 'teaser', duration: '', order: 0, featured: true },
      { id: 'highlight', title: "Jessica & Tyler's Wedding", category: 'highlight', duration: '', order: 1 },
    ],
  }, null, 2));
  process.exit(1);
}

function validateConfig(config, configPath) {
  const errors = [];

  // Reject deprecated fields up front
  DEPRECATED_FIELDS.forEach(f => {
    if (config[f] !== undefined) {
      errors.push(`'${f}' is deprecated and must be removed (delivery-page-standard.md Section 5.2)`);
    }
  });

  // slug
  if (!config.slug || typeof config.slug !== 'string') {
    errors.push("'slug' is required and must be a non-empty string");
  } else if (!SLUG_RE.test(config.slug)) {
    errors.push(`'slug' must match /^[a-z0-9-]+$/ (got "${config.slug}")`);
  }

  // coupleNames
  if (!config.coupleNames || typeof config.coupleNames !== 'string' || !config.coupleNames.trim()) {
    errors.push("'coupleNames' is required and must be a non-empty string (e.g., \"Amanda & Boris\")");
  }

  // weddingDate
  if (!config.weddingDate || typeof config.weddingDate !== 'string' || !config.weddingDate.trim()) {
    errors.push("'weddingDate' is required and must be a non-empty string (e.g., \"August 31, 2025\")");
  } else if (!/\b(\d{4})\b/.test(config.weddingDate)) {
    errors.push(`'weddingDate' must contain a 4-digit year (got "${config.weddingDate}")`);
  }

  // videos
  let videosArray = null;
  if (!config.videos) {
    errors.push("'videos' is required");
  } else if (Array.isArray(config.videos)) {
    if (config.videos.length === 0) {
      errors.push("'videos' must be a non-empty array");
    } else {
      videosArray = config.videos;
    }
  } else if (typeof config.videos === 'object') {
    // Object-keyed legacy form (supported but discouraged per spec Section 5)
    const entries = Object.entries(config.videos);
    if (entries.length === 0) {
      errors.push("'videos' object must have at least one entry");
    } else {
      videosArray = entries.map(([id, v], i) => ({
        id,
        title: v && v.title,
        category: v && v.category,
        duration: v && v.duration,
        order: v && v.order != null ? v.order : i,
        ...(v && v.featured ? { featured: true } : {}),
      }));
    }
  } else {
    errors.push("'videos' must be an array or object");
  }

  if (videosArray) {
    const seenIds = new Set();
    let heroCount = 0;
    let legacyFeaturedCount = 0;
    videosArray.forEach((v, i) => {
      if (!v || typeof v !== 'object') {
        errors.push(`videos[${i}] must be an object`);
        return;
      }
      if (!v.id || typeof v.id !== 'string') {
        errors.push(`videos[${i}].id is required and must be a non-empty string`);
      } else if (seenIds.has(v.id)) {
        errors.push(`videos[${i}].id "${v.id}" is duplicated`);
      } else {
        seenIds.add(v.id);
      }
      if (!v.category) {
        errors.push(`videos[${i}].category is required (one of ${CATEGORY_ENUM.join(', ')})`);
      } else if (!CATEGORY_ENUM.includes(v.category)) {
        errors.push(`videos[${i}].category "${v.category}" must be one of ${CATEGORY_ENUM.join(', ')}`);
      }
      if (v.order == null || typeof v.order !== 'number') {
        errors.push(`videos[${i}].order is required and must be a number`);
      }
      if (v.hero === true) heroCount++;
      if (v.featured === true) legacyFeaturedCount++;
    });
    if (heroCount > HERO_MAX) {
      errors.push(`at most ${HERO_MAX} videos may have hero: true (got ${heroCount}). Hero deliverables are the cinematic top-of-page cluster (teaser, highlight, story session). Day-of cuts and bonus content belong in the Collection grid below.`);
    }
    if (legacyFeaturedCount > 0) {
      console.warn(`  warning: ${legacyFeaturedCount} video(s) still carry the deprecated 'featured: true' field. Migrate to 'hero: true' per delivery-page-standard.md Section 4.5. The field is preserved in the output but no longer drives rendering.`);
    }
  }

  if (errors.length > 0) {
    console.error(`Config validation failed for ${configPath}:`);
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  return videosArray;
}

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

function defaultTitleFromId(id) {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
}

function main() {
  const { configPath, workerBase, outputRoot } = parseArgs(process.argv);
  if (!configPath) printUsageAndExit();

  const absConfigPath = path.resolve(configPath);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(absConfigPath, 'utf-8'));
  } catch (e) {
    console.error(`Failed to read or parse config at ${absConfigPath}: ${e.message}`);
    process.exit(1);
  }

  const config = { ...raw };
  let videosArray = validateConfig(config, absConfigPath);

  // Normalize: fill default titles, ensure duration is a string.
  // Preserve hero: true (drives the inline player stack above the Collection grid;
  // see delivery-page-standard.md Section 4.5). Preserve playlist: false on entries
  // that opt out of the Watch the Full Day playlist (Section 3.4). The legacy
  // featured: true is preserved as a passthrough but is no longer wired to any
  // template behavior; migrate to hero: true.
  videosArray = videosArray.map(v => ({
    id: v.id,
    title: v.title || defaultTitleFromId(v.id),
    category: v.category,
    duration: v.duration || '',
    order: v.order,
    ...(v.hero === true ? { hero: true } : {}),
    ...(v.featured === true ? { featured: true } : {}),
    ...(v.playlist === false ? { playlist: false } : {}),
  }));

  // Hero row: entries with hero: true, sorted by order. May be empty (page renders
  // Collection-only). At most HERO_MAX entries (enforced in validateConfig).
  const heroArray = videosArray
    .filter(v => v.hero === true)
    .sort((a, b) => a.order - b.order);

  // OG image source: first hero entry by order, else first video in catalog.
  // The legacy {{FEATURED_VIDEO_ID}} token name is retained for template
  // backward-compat; the value now points to the hero/lead thumbnail.
  const ogVideoId = heroArray.length > 0 ? heroArray[0].id : videosArray[0].id;

  const dateShort = dateToShort(config.weddingDate);
  const year = new Date().getFullYear().toString();

  // Playlist: archival + bonus, exclude explicit playlist: false opt-outs,
  // chronological order. See delivery-page-standard.md Section 3.4 for ordering.
  // Hero entries are NOT excluded from the playlist by default; if a hero clip
  // is also archival/bonus, it appears both in the hero row and (if not opted
  // out via playlist: false) in the Watch the Full Day sequence. Typical hero
  // entries (teaser, highlight, story-session) are auto-excluded by category
  // or by playlist: false on the paired-deliverable pattern.
  const playlistArray = videosArray
    .filter(v =>
      (v.category === 'archival' || v.category === 'bonus') &&
      v.playlist !== false
    )
    .sort((a, b) => a.order - b.order)
    .map(v => ({ id: v.id, title: v.title, duration: v.duration }));

  // Read templates
  const templateDir = path.join(__dirname, 'templates');
  const htmlTemplate = fs.readFileSync(path.join(templateDir, 'couple-page.html'), 'utf-8');
  const manifestTemplate = fs.readFileSync(path.join(templateDir, 'manifest.json'), 'utf-8');
  const swContent = fs.readFileSync(path.join(templateDir, 'sw.js'), 'utf-8');

  // Token replacement
  let html = htmlTemplate
    .replace(/\{\{COUPLE_NAMES\}\}/g, config.coupleNames)
    .replace(/\{\{DATE_LONG\}\}/g, config.weddingDate)
    .replace(/\{\{DATE_SHORT\}\}/g, dateShort)
    .replace(/\{\{SLUG\}\}/g, config.slug)
    .replace(/\{\{WORKER_BASE\}\}/g, workerBase)
    .replace(/\{\{VIDEOS_JSON\}\}/g, JSON.stringify(videosArray))
    .replace(/\{\{PLAYLIST_JSON\}\}/g, JSON.stringify(playlistArray))
    .replace(/\{\{HERO_JSON\}\}/g, JSON.stringify(heroArray))
    .replace(/\{\{FEATURED_VIDEO_ID\}\}/g, ogVideoId)
    .replace(/\{\{YEAR\}\}/g, year);

  let manifest = manifestTemplate
    .replace(/\{\{COUPLE_NAMES\}\}/g, config.coupleNames)
    .replace(/\{\{SLUG\}\}/g, config.slug);

  // Write outputs
  const outputBase = outputRoot
    ? path.resolve(outputRoot)
    : path.resolve(__dirname, '..', 'films');
  const outputDir = path.join(outputBase, config.slug);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'index.html'), html, 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), manifest, 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'sw.js'), swContent, 'utf-8');

  console.log(`Film page generated at ${outputDir}/`);
  console.log(`  index.html (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`  manifest.json`);
  console.log(`  sw.js`);
  console.log(`  Delivery URL: https://flyiniris.com/films/${config.slug}/`);
  if (config.password) {
    console.log(`  Download password (set in PASSWORDS KV): ${config.password}`);
  }
}

main();
