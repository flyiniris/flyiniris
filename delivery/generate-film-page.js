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
// api.flyiniris.com, not prep.flyiniris.com: both route to the same Worker,
// but only api.flyiniris.com is in the site CSP connect-src (_headers). A page
// pointed at prep.flyiniris.com has its load-time fetch blocked by CSP and
// silently falls back to the baked videos (found 2026-09-30 on matt-haley).
const DEFAULT_CONFIG_API_BASE = 'https://api.flyiniris.com';
const SLUG_RE = /^[a-z0-9-]+$/;
const CATEGORY_ENUM = ['highlight', 'teaser', 'archival', 'bonus'];
const DEPRECATED_FIELDS = ['names', 'date', 'date_short', 'photos', 'customMessage', 'venueDisplay', 'filmSlug'];
const HERO_MAX = 5;
// Page kinds. 'couple' (default) is the wedding delivery page. 'business' is a
// client film page: clientName in place of couple names, a subtitle in place
// of the wedding date, and no "wedding" anywhere in the output.
const KINDS = ['couple', 'business'];
const BUSINESS_DEFAULT_SUBTITLE = "Films by Flyin' Iris";

// Business theme: a client page wears the client's brand (colors, font,
// logo); Flyin' Iris stays only as the footer signature. Colors are mapped
// from the template's palette ({ "#FFBD1D": "#6EC1F8", ... }), rgba() forms
// of the same colors included. Couple pages never take this path.
function hexToRgbList(hex) {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}
function applyBusinessTheme(html, theme, clientName) {
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let out = html;
  for (const [from, to] of Object.entries(theme.colors || {})) {
    out = out.replace(new RegExp(from, 'gi'), () => to);
    const [r, g, b] = hexToRgbList(from);
    const [r2, g2, b2] = hexToRgbList(to);
    out = out.replace(new RegExp('rgba\\(\\s*' + r + '\\s*,\\s*' + g + '\\s*,\\s*' + b + '\\s*,', 'g'), () => 'rgba(' + r2 + ', ' + g2 + ', ' + b2 + ',');
  }
  if (theme.font) {
    const f = theme.font;
    out = out
      .replace(/'Cormorant Garamond', serif/g, () => "'" + f + "', sans-serif")
      .replace(/'Outfit', sans-serif/g, () => "'" + f + "', sans-serif")
      .replace(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]*/, () =>
        'https://fonts.googleapis.com/css2?family=' + f.replace(/ /g, '+') + ':wght@300;400;500;600;700;800&amp;family=Cormorant+Garamond:wght@500;600&amp;display=swap');
  }
  // Title and share title carry the client, not the studio.
  out = out.replace(/(<title>[^<]*?) \| Flyin' Iris<\/title>/, (m, a) => a + ' | Films</title>')
    .replace(/(<meta property="og:title" content="[^"]*?) \| Flyin' Iris"/, (m, a) => a + ' | Films"');
  if (theme.logo) {
    const logo = esc(theme.logo);
    const alt = esc(theme.logoAlt || clientName);
    out = out.replace(/<span class="nav-logo">Flyin' Iris<\/span>/, () => '<span class="nav-logo"><img src="' + logo + '" alt="' + alt + '"></span>')
      .replace(/<h1 class="hero-names">([^<]*)<\/h1>/, (m, name) => '<h1 class="hero-names"><img class="hero-logo" src="' + logo + '" alt="' + alt + '"><span class="visually-hidden">' + name + '</span></h1>');
  }
  // Footer: the studio signature, in the studio's own type and gold.
  out = out.replace(/<p class="footer-logo">Flyin' Iris<\/p>/, () => '<p class="footer-by">Films by</p><p class="footer-logo">Flyin\' Iris</p>');
  const css = [
    '  <style>',
    '    /* Business theme overrides (generated) */',
    '    .nav-logo img { height: 30px; width: auto; display: block; }',
    '    .hero-names .hero-logo { width: min(340px, 72vw); height: auto; display: block; margin: 0 auto; }',
    '    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }',
    '    .section-title, .event-link-title { font-weight: 700; letter-spacing: -0.01em; }',
    '    .footer-by { font-size: .7rem; letter-spacing: .22em; text-transform: uppercase; opacity: .7; margin: 0 0 4px; }',
    "    .footer-logo { font-family: 'Cormorant Garamond', serif; color: #FFBD1D; }",
    '  </style>',
    '</head>',
  ].join('\n');
  out = out.replace('</head>', () => css);
  return out;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    configPath: null,
    workerBase: DEFAULT_WORKER_BASE,
    outputRoot: null,
    configApiBase: DEFAULT_CONFIG_API_BASE,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--worker-base' && args[i + 1]) {
      out.workerBase = args[i + 1];
      i++;
    } else if (args[i] === '--output-root' && args[i + 1]) {
      out.outputRoot = args[i + 1];
      i++;
    } else if (args[i] === '--config-api-base' && args[i + 1]) {
      out.configApiBase = args[i + 1];
      i++;
    } else if (!out.configPath) {
      out.configPath = args[i];
    }
  }
  return out;
}

function printUsageAndExit() {
  console.error('Usage: node generate-film-page.js <config.json> [--worker-base <url>] [--output-root <dir>] [--config-api-base <url>]');
  console.error('');
  console.error('Config schema (see iris-automation/docs/project-knowledge-2026-05/delivery-page-standard.md Section 5):');
  console.error(JSON.stringify({
    slug: 'jessica-tyler',
    coupleNames: 'Jessica & Tyler',
    weddingDate: 'September 25, 2026',
    password: 'optional, real configs go in delivery/live/ (gitignored)',
    videos: [
      { id: 'teaser', title: 'Teaser', category: 'teaser', duration: '', order: 0, hero: true },
      { id: 'highlight', title: "Jessica & Tyler's Wedding", category: 'highlight', duration: '', order: 1, hero: true },
    ],
  }, null, 2));
  console.error('');
  console.error('Business (client) page: kind "business" with clientName instead of coupleNames;');
  console.error('subtitle and eventDate are optional, videos as above:');
  console.error(JSON.stringify({ kind: 'business', slug: 'window-world', clientName: 'Window World', subtitle: BUSINESS_DEFAULT_SUBTITLE }));
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

  const kind = config.kind === undefined ? 'couple' : config.kind;
  if (!KINDS.includes(kind)) {
    errors.push(`'kind' must be one of ${KINDS.join(', ')} (got "${config.kind}")`);
  }

  if (kind === 'business') {
    // clientName replaces coupleNames; the date is optional for a client.
    if (!config.clientName || typeof config.clientName !== 'string' || !config.clientName.trim()) {
      errors.push("'clientName' is required for kind business (e.g., \"Window World\")");
    }
    if (config.subtitle !== undefined && (typeof config.subtitle !== 'string' || !config.subtitle.trim())) {
      errors.push("'subtitle' must be a non-empty string when set");
    }
    if (config.eventDate !== undefined && config.eventDate !== '' &&
        (typeof config.eventDate !== 'string' || !/\b(\d{4})\b/.test(config.eventDate))) {
      errors.push(`'eventDate' must contain a 4-digit year when set (got "${config.eventDate}")`);
    }
  } else {
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
  }

  // videos
  // A missing or empty videos array is now VALID: it produces a video-empty
  // shell (the batch pre-generation case). The page resolves its real video
  // source at load time from the delivery config API. Non-empty configs keep
  // every existing per-item validation below.
  let videosArray = [];
  if (config.videos === undefined || config.videos === null) {
    videosArray = [];
  } else if (Array.isArray(config.videos)) {
    videosArray = config.videos;
  } else if (typeof config.videos === 'object') {
    // Object-keyed legacy form (supported but discouraged per spec Section 5)
    const entries = Object.entries(config.videos);
    if (entries.length === 0) {
      errors.push("'videos' object must have at least one entry");
    } else {
      // Pass hero and playlist through. Earlier versions dropped both flags
      // here, so legacy-form configs rendered pages with zero hero players
      // (audit 2026-06-09, fi-delivery corr-eff #3).
      videosArray = entries.map(([id, v], i) => ({
        id,
        title: v && v.title,
        category: v && v.category,
        duration: v && v.duration,
        order: v && v.order != null ? v.order : i,
        ...(v && v.hero === true ? { hero: true } : {}),
        ...(v && v.playlist === false ? { playlist: false } : {}),
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

  if (config.theme !== undefined) {
    if (kind !== 'business') errors.push("'theme' is only supported for kind business");
    else if (!config.theme || typeof config.theme !== 'object') errors.push("'theme' must be an object");
    else {
      Object.entries(config.theme.colors || {}).forEach(([a, b]) => {
        if (!/^#[0-9a-fA-F]{6}$/.test(a) || !/^#[0-9a-fA-F]{6}$/.test(b)) errors.push(`theme.colors entries must be #RRGGBB pairs (got ${a}: ${b})`);
      });
      if (config.theme.logo !== undefined && !/^(\/|https:\/\/)/.test(config.theme.logo)) errors.push('theme.logo must start with / or https://');
      if (config.theme.font !== undefined && !/^[A-Za-z ]+$/.test(config.theme.font)) errors.push('theme.font must be a Google Font family name');
    }
  }

  // eventLinks (business only): cards that link to dedicated event pages,
  // e.g. films/window-world/honor-flight-golf/. Each { title, href, subtitle?, image? }.
  if (config.eventLinks !== undefined) {
    if (kind !== 'business') {
      errors.push("'eventLinks' is only supported for kind business");
    } else if (!Array.isArray(config.eventLinks)) {
      errors.push("'eventLinks' must be an array of { title, href, subtitle?, image? }");
    } else {
      config.eventLinks.forEach((l, i) => {
        if (!l || typeof l.title !== 'string' || !l.title.trim()) errors.push(`eventLinks[${i}].title is required`);
        if (!l || typeof l.href !== 'string' || !/^(\/|https:\/\/)/.test(l.href)) errors.push(`eventLinks[${i}].href must start with / or https://`);
        if (l && l.image !== undefined && (typeof l.image !== 'string' || !/^https:\/\//.test(l.image))) errors.push(`eventLinks[${i}].image must be an https URL`);
      });
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
    // 3-letter abbreviations plus the common 4-letter sept.
    jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07',
    aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
  };
  const match = dateStr.match(/(\w+)\.?\s+(\d{1,2}),?\s*(\d{4})/);
  if (!match) return dateStr;
  const [, monthName, day, year] = match;
  const mm = months[monthName.toLowerCase()];
  // Hard fail on unknown month names. The old || '01' fallback silently
  // rendered typos as January in the navbar (audit 2026-06-09, corr-eff #4).
  if (!mm) {
    console.error(`Unrecognized month "${monthName}" in weddingDate "${dateStr}". Use a full month name or 3-letter abbreviation.`);
    process.exit(1);
  }
  const dd = day.padStart(2, '0');
  return `${mm}.${dd}.${year}`;
}

function defaultTitleFromId(id) {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
}

// Hero-entry title defaults. Sean's product brand uses "Film" suffix language
// across hero deliverables for cinematic consistency ("A Film By Flyin' Iris").
// These three ids carry intentional brand-language defaults that take
// precedence over defaultTitleFromId. A config-set title still wins; the
// map only fires when title is missing or empty. See spec doc
// delivery-page-standard.md Section 3.6 for the convention.
const HERO_TITLE_DEFAULTS = {
  'teaser': 'Teaser Film',
  'highlight': 'Highlight Film',
  'story-session': 'Story Session Film',
};

// Derives the Hero (intro) CTA copy from the hero catalog. Single-hero couples
// see a label matching that one deliverable; multi-hero couples and no-hero
// couples see the generic "Watch the Films" / "View Your Films" copy.
// Spec doc Section 11 future ticket #3 captures this.
function deriveHeroCta(heroArray) {
  if (heroArray.length === 0) return 'View Your Films';
  if (heroArray.length >= 2) return 'Watch the Films';
  const only = heroArray[0];
  if (only.category === 'teaser') return 'Watch the Teaser';
  if (only.category === 'highlight') return 'Watch the Highlight';
  if (only.id === 'story-session') return 'Watch the Story Session';
  return 'Watch the Film';
}

function main() {
  const { configPath, workerBase, outputRoot, configApiBase } = parseArgs(process.argv);
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
  //
  // Title fallback order: a config-set title always wins. Otherwise:
  //   1. HERO_TITLE_DEFAULTS map (teaser / highlight / story-session get the
  //      "X Film" brand-language defaults per spec Section 3.6).
  //   2. defaultTitleFromId for any other id (capitalize first letter, replace
  //      hyphens with spaces).
  // The HERO_TITLE_DEFAULTS map is the single source of truth for hero title
  // defaults. To rename "Highlight Film" -> something else later, edit the map
  // here; all couple configs that omit explicit titles pick up the change on
  // their next regen.
  videosArray = videosArray.map(v => ({
    id: v.id,
    title: v.title || HERO_TITLE_DEFAULTS[v.id] || defaultTitleFromId(v.id),
    category: v.category,
    duration: v.duration || '',
    order: v.order,
    ...(v.hero === true ? { hero: true } : {}),
    ...(v.featured === true ? { featured: true } : {}),
    ...(v.playlist === false ? { playlist: false } : {}),
  }));

  // Loud warning when durations are missing. Both live configs shipped with
  // empty durations on all videos, producing blank badge pills everywhere
  // (audit 2026-06-09, fi-delivery #1). Backfill via ffprobe, see
  // delivery/scripts/transcode.ps1 duration backfill block.
  const noDuration = videosArray.filter(v => !v.duration);
  if (noDuration.length > 0) {
    console.warn('');
    console.warn(`  WARNING: ${noDuration.length} of ${videosArray.length} videos have an empty 'duration' (${noDuration.map(v => v.id).join(', ')}).`);
    console.warn('  Duration badges will be omitted on the page. Backfill the config with ffprobe and regenerate.');
    console.warn('');
  }

  // Hero row: entries with hero: true, sorted by order. May be empty (page renders
  // Collection-only). At most HERO_MAX entries (enforced in validateConfig).
  const heroArray = videosArray
    .filter(v => v.hero === true)
    .sort((a, b) => a.order - b.order);

  // OG image source: first hero entry by order, else first video in catalog.
  // The legacy {{FEATURED_VIDEO_ID}} token name is retained for template
  // backward-compat; the value now points to the hero/lead thumbnail.
  // Empty shells point og:image at the teaser thumb: the standard film id
  // every delivery ships first, so link previews resolve once it lands.
  const ogVideoId = heroArray.length > 0
    ? heroArray[0].id
    : (videosArray.length > 0 ? videosArray[0].id : 'teaser');

  // Display copy per page kind. Couple output is byte-identical to before the
  // business kind existed (same strings through the new tokens).
  const isBusiness = config.kind === 'business';
  const displayName = isBusiness ? config.clientName.trim() : config.coupleNames;
  const eventDate = isBusiness ? (config.eventDate || '') : config.weddingDate;
  const dateShort = eventDate ? dateToShort(eventDate) : '';
  const heroSubtitle = isBusiness
    ? (config.subtitle ? config.subtitle.trim() : BUSINESS_DEFAULT_SUBTITLE)
    : config.weddingDate;
  const metaDescription = isBusiness
    ? `Watch ${displayName}'s films, streamed in cinematic quality by Flyin' Iris.`
    : `Watch ${config.coupleNames}'s wedding films, streamed in cinematic quality by Flyin' Iris.`;
  const ogDescription = isBusiness
    ? (eventDate ? `Watch ${displayName}'s films, ${eventDate}` : `Watch ${displayName}'s films by Flyin' Iris`)
    : `Watch ${config.coupleNames}'s wedding films, ${config.weddingDate}`;
  const pendingSub = isBusiness
    ? 'We are putting the finishing touches on your films. Check back soon.'
    : 'We are putting the finishing touches on your wedding films. Check back soon.';
  // The pending line is stamped inside a single-quoted JS string in the template.
  const jsString = (v) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\u003c');
  const year = new Date().getFullYear().toString();
  const heroCta = deriveHeroCta(heroArray);

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

  // Token replacement. Function-form replacements throughout: a plain string
  // second argument lets $-sequences ($&, $', $1...) in couple names, titles,
  // or JSON corrupt the output silently (audit 2026-06-09, corr-eff low #6).
  const stamp = (value) => () => value;
  // Business pages hide the category tag (bonus, highlight, archival) on film
  // cards; it is wedding-delivery vocabulary. Couple pages stamp nothing here,
  // so their output is unchanged. Lines follow the template's line endings.
  const eol = htmlTemplate.includes('\r\n') ? '\r\n' : '\n';
  const kindCss = isBusiness
    ? '    /* Business page: no category tag on film cards */' + eol +
      '    .film-card-tag { display: none; }' + eol
    : '';
  // Business event links: rendered between the hero and the hero row. Empty
  // for every page without eventLinks, so their output is unchanged.
  const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eventLinks = isBusiness && Array.isArray(config.eventLinks) ? config.eventLinks : [];
  const eventLinksHtml = eventLinks.length === 0 ? '' : [
    '  <!-- ========== Event Pages ========== -->',
    '  <style>',
    '    .event-links { padding: 0 24px 8px; }',
    '    .event-links .container { max-width: 1100px; margin: 0 auto; display: grid; gap: 18px; }',
    '    .event-link { position: relative; display: flex; align-items: flex-end; min-height: 260px; border-radius: 16px; overflow: hidden; text-decoration: none; color: #F5F0EB; background: #14161c center / cover no-repeat; border: 1px solid rgba(255, 189, 29, 0.25); transition: transform .35s ease, border-color .35s ease; }',
    '    .event-link::before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,10,10,.15) 0%, rgba(10,10,10,.88) 85%); }',
    '    .event-link:hover { transform: translateY(-3px); border-color: rgba(255, 189, 29, 0.7); }',
    '    .event-link-body { position: relative; padding: 26px 28px; width: 100%; display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; }',
    '    .event-link-label { font-family: "Outfit", sans-serif; font-size: .72rem; letter-spacing: .26em; text-transform: uppercase; color: #FFBD1D; margin: 0 0 8px; }',
    '    .event-link-title { font-family: "Cormorant Garamond", serif; font-weight: 500; font-size: clamp(1.7rem, 4vw, 2.5rem); line-height: 1.08; margin: 0 0 6px; }',
    '    .event-link-sub { font-family: "Outfit", sans-serif; font-size: .95rem; color: rgba(245, 240, 235, .72); margin: 0; }',
    '    .event-link-cta { font-family: "Outfit", sans-serif; font-weight: 500; font-size: .8rem; letter-spacing: .12em; text-transform: uppercase; background: #FFBD1D; color: #0A0A0A; padding: 12px 20px; border-radius: 999px; white-space: nowrap; }',
    '  </style>',
    '  <section class="event-links" id="event-links">',
    '    <div class="container">',
    ...eventLinks.map((l) =>
      '      <a class="event-link reveal" href="' + escHtml(l.href) + '"' +
      (l.image ? ' style="background-image: url(&quot;' + escHtml(l.image) + '&quot;)"' : '') + '>' +
      '<div class="event-link-body"><div><p class="event-link-label">Event Page</p>' +
      '<p class="event-link-title">' + escHtml(l.title) + '</p>' +
      (l.subtitle ? '<p class="event-link-sub">' + escHtml(l.subtitle) + '</p>' : '') +
      '</div><span class="event-link-cta">Open the event page</span></div></a>'),
    '    </div>',
    '  </section>',
    '',
  ].join(eol);

  let html = htmlTemplate
    .replace(/\{\{META_DESCRIPTION\}\}/g, stamp(metaDescription))
    .replace(/\{\{OG_DESCRIPTION\}\}/g, stamp(ogDescription))
    .replace(/\{\{HERO_SUBTITLE\}\}/g, stamp(heroSubtitle))
    .replace(/\{\{PENDING_SUB_JS\}\}/g, stamp(jsString(pendingSub)))
    .replace(/\{\{KIND_CSS\}\}/g, stamp(kindCss))
    .replace(/\{\{EVENT_LINKS\}\}/g, stamp(eventLinksHtml))
    .replace(/\{\{COUPLE_NAMES\}\}/g, stamp(displayName))
    .replace(/\{\{DATE_LONG\}\}/g, stamp(eventDate))
    .replace(/\{\{DATE_SHORT\}\}/g, stamp(dateShort))
    .replace(/\{\{SLUG\}\}/g, stamp(config.slug))
    .replace(/\{\{WORKER_BASE\}\}/g, stamp(workerBase))
    .replace(/\{\{VIDEOS_JSON\}\}/g, stamp(JSON.stringify(videosArray)))
    .replace(/\{\{PLAYLIST_JSON\}\}/g, stamp(JSON.stringify(playlistArray)))
    .replace(/\{\{HERO_JSON\}\}/g, stamp(JSON.stringify(heroArray)))
    .replace(/\{\{HERO_CTA\}\}/g, stamp(heroCta))
    .replace(/\{\{FEATURED_VIDEO_ID\}\}/g, stamp(ogVideoId))
    .replace(/\{\{CONFIG_API_BASE\}\}/g, stamp(configApiBase))
    .replace(/\{\{YEAR\}\}/g, stamp(year));

  if (isBusiness && config.theme) html = applyBusinessTheme(html, config.theme, displayName);

  let manifest = manifestTemplate
    .replace(/\{\{COUPLE_NAMES\}\}/g, stamp(displayName))
    .replace(/\{\{SLUG\}\}/g, stamp(config.slug));

  // Per-slug service worker cache name (audit 2026-06-09, corr-eff low #7:
  // all couples shared one origin-wide cache name and deleted each other's
  // caches during staggered template rollouts).
  const sw = swContent.replace(/\{\{SLUG\}\}/g, stamp(config.slug));

  // Write outputs
  const outputBase = outputRoot
    ? path.resolve(outputRoot)
    : path.resolve(__dirname, '..', 'films');
  const outputDir = path.join(outputBase, config.slug);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'index.html'), html, 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), manifest, 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'sw.js'), sw, 'utf-8');

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
