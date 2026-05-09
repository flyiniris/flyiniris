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
    let featuredCount = 0;
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
      if (v.featured === true) featuredCount++;
    });
    if (featuredCount === 0) {
      errors.push('exactly one video must have featured: true (got 0)');
    } else if (featuredCount > 1) {
      errors.push(`exactly one video must have featured: true (got ${featuredCount})`);
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

  // Normalize: fill default titles, ensure duration is a string
  videosArray = videosArray.map(v => ({
    id: v.id,
    title: v.title || defaultTitleFromId(v.id),
    category: v.category,
    duration: v.duration || '',
    order: v.order,
    ...(v.featured ? { featured: true } : {}),
  }));

  const featuredVideo = videosArray.find(v => v.featured);
  const featuredId = featuredVideo.id;
  const dateShort = dateToShort(config.weddingDate);
  const year = new Date().getFullYear().toString();

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
    .replace(/\{\{FEATURED_VIDEO_ID\}\}/g, featuredId)
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
