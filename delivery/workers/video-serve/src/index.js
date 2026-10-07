// fi-video-serve: Cloudflare Worker.
// Serves HLS video from R2 with JWT-gated downloads, and photo galleries
// (board #24) under /photos/<kind>/<slug>.

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'OPTIONS') {
        return handleOptions(request);
      }

      const url = new URL(request.url);
      const path = url.pathname;

      // Route: POST /couples/{slug}/auth
      const authMatch = path.match(/^\/couples\/([^/]+)\/auth$/);
      if (authMatch && request.method === 'POST') {
        return handleAuth(request, env, authMatch[1]);
      }

      // Photo galleries: /photos/{kind}/{slug}[/...]
      const photosMatch = path.match(/^\/photos\/([^/]+)\/([^/]+)(\/.*)?$/);
      if (photosMatch) {
        return handlePhotos(request, env, ctx, url, photosMatch[1], photosMatch[2], photosMatch[3] || '');
      }

      // Route: POST /couples/{slug}/download/{videoId}
      const downloadMatch = path.match(/^\/couples\/([^/]+)\/download\/([^/]+)$/);
      if (downloadMatch && request.method === 'POST') {
        return handleDownload(request, env, downloadMatch[1], downloadMatch[2]);
      }

      // Route: GET /couples/{slug}/file/{videoId}?t=<jwt>&name=<filename>
      // Same JWT as the POST download, carried in the query so the browser's
      // own download manager saves the file straight to disk. The POST route
      // makes the page hold the whole file in memory first, which fails for
      // 400+ MB 4K masters on phones.
      const fileMatch = path.match(/^\/couples\/([^/]+)\/file\/([^/]+)$/);
      if (fileMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        return handleFileDownload(request, env, fileMatch[1], fileMatch[2], url);
      }

      // Route: GET /couples/{slug}/hls/{videoId}/*
      const hlsMatch = path.match(/^\/couples\/([^/]+)\/hls\/(.+)$/);
      if (hlsMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        return handleHLS(request, env, hlsMatch[0]);
      }

      // Route: GET /couples/{slug}/thumbs/{filename}
      const thumbMatch = path.match(/^\/couples\/([^/]+)\/thumbs\/(.+)$/);
      if (thumbMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        return handleThumb(request, env, thumbMatch[0]);
      }

      return jsonResponse({ error: 'Not found' }, 404, request);
    } catch (err) {
      return jsonResponse({ error: 'Internal server error' }, 500, request);
    }
  },
};

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleHLS(request, env, matchedPath) {
  // R2 key is the URL path without the leading slash
  const key = matchedPath.replace(/^\//, '');
  const object = await env.FI_FILMS.get(key);

  if (!object) {
    return jsonResponse({ error: 'Not found' }, 404, request);
  }

  const ext = key.split('.').pop().toLowerCase();
  const contentType =
    ext === 'm3u8' ? 'application/vnd.apple.mpegurl' :
    ext === 'ts'   ? 'video/MP2T' :
    'application/octet-stream';

  // Playlists get short cache (quality switching). Segments keep the same
  // filenames across re-encodes, so a year-long cache can serve a returning
  // viewer a scrambled mix of old and new video after a re-delivery. Keep
  // segment cache at one day until upload paths are versioned (e.g. v2/).
  const cacheControl =
    ext === 'm3u8'
      ? 'public, max-age=3600'
      : 'public, max-age=86400';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      ...cors(request),
    },
  });
}

const DEFAULT_SHARE_IMAGE = 'https://www.flyiniris.com/Cody-Sarah-og.jpg';

async function handleThumb(request, env, matchedPath) {
  const key = matchedPath.replace(/^\//, '');
  const object = await env.FI_FILMS.get(key);

  if (!object) {
    // Couple shells point og:image at thumbs/teaser.jpg before the teaser
    // lands, so link previews showed no picture (board #182). Send the
    // site share image instead, short-cached so the real teaser takes over
    // as soon as it is uploaded.
    if (key.endsWith('/thumbs/teaser.jpg')) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: DEFAULT_SHARE_IMAGE,
          'Cache-Control': 'public, max-age=300',
          ...cors(request),
        },
      });
    }
    return jsonResponse({ error: 'Not found' }, 404, request);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000',
      ...cors(request),
    },
  });
}

// Shared by /couples/<slug>/auth (authSlug = slug) and
// /photos/<kind>/<slug>/auth (authSlug = slug for couples, gallery:<slug> for
// business and one-off galleries). The KV password key, the rate limit key and
// the signed-link HMAC are all keyed by authSlug, and the JWT carries it as
// { slug: authSlug }, so a couple's films token also opens their photos.
async function handleAuth(request, env, authSlug) {
  const slug = authSlug;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, request);
  }

  // Either the typed password or the key from a signed download link
  // (flyiniris.com/films/<slug>/#dl=<key>, board #65).
  const password = typeof body.password === 'string' ? body.password : '';
  const linkKey = typeof body.link_key === 'string' ? body.link_key : '';
  if (!password && !linkKey) {
    return jsonResponse({ error: 'Password required' }, 400, request);
  }

  // Brute-force backoff: max 10 failed attempts per slug+IP per 15 minutes.
  // Counter lives in the PASSWORDS namespace under an "rl:" prefix so it can
  // never collide with a slug key.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:${slug}:${ip}`;
  const attempts = parseInt((await env.PASSWORDS.get(rlKey)) || '0', 10);
  if (attempts >= 10) {
    return jsonResponse({ error: 'Too many attempts. Try again in a few minutes.' }, 429, request);
  }

  const stored = await env.PASSWORDS.get(slug);
  let ok = false;
  if (stored) {
    if (linkKey) {
      // Same HMAC iris-automation signs in src/lib/delivery-password.ts. The
      // key is bound to the CURRENT password, so changing it revokes old links.
      ok = !!env.DELIVERY_LINK_SECRET &&
        timingSafeEqual(linkKey, await signDownloadKey(env.DELIVERY_LINK_SECRET, slug, stored));
    } else {
      ok = timingSafeEqual(password, stored);
    }
  }
  if (!ok) {
    await env.PASSWORDS.put(rlKey, String(attempts + 1), { expirationTtl: 900 });
    return jsonResponse({ error: 'Invalid password' }, 401, request);
  }

  const token = await signJWT({ slug }, env.JWT_SECRET);
  return jsonResponse({ token }, 200, request);
}

async function handleDownload(request, env, slug, videoId) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authorization required' }, 401, request);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, env.JWT_SECRET);

  if (!payload) {
    return jsonResponse({ error: 'Token expired or invalid' }, 403, request);
  }

  if (payload.slug !== slug) {
    return jsonResponse({ error: 'Token expired or invalid' }, 403, request);
  }

  const key = `couples/${slug}/originals/${videoId}.mp4`;
  const object = await env.FI_FILMS.get(key);

  if (!object) {
    return jsonResponse({ error: 'Not found' }, 404, request);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${videoId}.mp4"`,
      'Content-Length': object.size,
      ...cors(request),
    },
  });
}

async function handleFileDownload(request, env, slug, videoId, url) {
  const token = url.searchParams.get('t') || '';
  if (!(await queryTokenOk(env, token, slug))) return expiredLinkResponse(request);

  const key = `couples/${slug}/originals/${videoId}.mp4`;
  // Readable filename from ?name= (ASCII-safe fallback plus RFC 5987 form).
  const wanted = (url.searchParams.get('name') || `${videoId}.mp4`).slice(0, 150);
  return streamR2Download(request, env, key, wanted, `${videoId}.mp4`, 'video/mp4');
}

async function queryTokenOk(env, token, authSlug) {
  const payload = token ? await verifyJWT(token, env.JWT_SECRET) : null;
  return !!payload && payload.slug === authSlug;
}

function expiredLinkResponse(request) {
  return new Response('This download link has expired. Go back to the page and tap Download again.', {
    status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors(request) },
  });
}

// RFC 6266 attachment header: ASCII-safe filename plus the RFC 5987 UTF-8 form.
function attachmentDisposition(wanted, fallback) {
  const ascii = wanted.replace(/[^A-Za-z0-9 ._()&-]/g, '').trim() || fallback;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(wanted)}`;
}

// Streams one R2 object as an attachment with Range and HEAD support, so the
// browser's own download manager can save and resume it. key may be a list:
// the first key that exists is served (photo originals: archive, then the
// pre-archive prefix).
async function streamR2Download(request, env, key, wanted, fallbackName, contentType) {
  // Range support lets phones resume and lets players seek a partial file.
  let object = null;
  for (const k of Array.isArray(key) ? key : [key]) {
    object = request.method === 'HEAD'
      ? await env.FI_FILMS.head(k)
      : await env.FI_FILMS.get(k, { range: request.headers });
    if (object) break;
  }
  if (!object) {
    return jsonResponse({ error: 'Not found' }, 404, request);
  }

  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': attachmentDisposition(wanted, fallbackName),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    ...cors(request),
  };
  if (request.method === 'HEAD') {
    return new Response(null, { headers: { ...headers, 'Content-Length': String(object.size) } });
  }
  if (object.range && request.headers.get('Range')) {
    const offset = object.range.offset || 0;
    const length = object.range.length != null ? object.range.length : object.size - offset;
    return new Response(object.body, {
      status: 206,
      headers: { ...headers, 'Content-Length': String(length), 'Content-Range': `bytes ${offset}-${offset + length - 1}/${object.size}` },
    });
  }
  return new Response(object.body, { headers: { ...headers, 'Content-Length': String(object.size) } });
}

// ---------------------------------------------------------------------------
// Photo galleries (board #24)
// ---------------------------------------------------------------------------
// Everything 404s until the Worker's approve step writes the live pointer
// photo-live/<kind>/<slug>.json. The pointer names the gallery id; the
// pipeline's manifest at galleries/<gid>/manifest.json lists the photos.

const PHOTO_KINDS = ['couple', 'gallery'];
const PHOTO_SLUG_RE = /^[a-z0-9-]{1,80}$/;
const GALLERY_ID_RE = /^[0-9a-f-]{36}$/;
// One zip streams every original through this request, one R2 read each.
// Bigger sets are offered per chapter so a large wedding never hits the
// per-request subrequest ceiling halfway through a multi-GB download.
// fi-photos.js mirrors this number.
const ZIP_MAX_ENTRIES = 950;

function photoAuthSlug(kind, slug) {
  return kind === 'couple' ? slug : `gallery:${slug}`;
}

async function loadLivePointer(env, kind, slug) {
  const ptrObj = await env.FI_FILMS.get(`photo-live/${kind}/${slug}.json`);
  if (!ptrObj) return null;
  try {
    const pointer = await ptrObj.json();
    return pointer && GALLERY_ID_RE.test(String(pointer.gallery_id || '')) ? pointer : null;
  } catch {
    return null;
  }
}

async function loadLiveGallery(env, kind, slug) {
  const pointer = await loadLivePointer(env, kind, slug);
  if (!pointer) return null;
  const manObj = await env.FI_FILMS.get(`galleries/${pointer.gallery_id}/manifest.json`);
  if (!manObj) return null;
  let manifest;
  try { manifest = await manObj.json(); } catch { return null; }
  if (!manifest || !Array.isArray(manifest.photos)) return null;
  return { pointer, manifest };
}

async function handlePhotos(request, env, ctx, url, kind, slug, rest) {
  const method = request.method;
  if (!PHOTO_KINDS.includes(kind) || !PHOTO_SLUG_RE.test(slug)) {
    return jsonResponse({ error: 'Not found' }, 404, request);
  }
  const isRead = method === 'GET' || method === 'HEAD';

  if ((rest === '' || rest === '/') && isRead) return handlePhotoListing(request, env, kind, slug);

  const img = rest.match(/^\/(web|thumb)\/(p\d{5})\.jpg$/);
  if (img && isRead) return handlePhotoImage(request, env, kind, slug, img[1], img[2]);

  if (rest === '/auth' && method === 'POST') {
    if (!(await loadLivePointer(env, kind, slug))) return jsonResponse({ error: 'Not found' }, 404, request);
    return handleAuth(request, env, photoAuthSlug(kind, slug));
  }

  const orig = rest.match(/^\/original\/(p\d{5})$/);
  if (orig && isRead) return handlePhotoOriginal(request, env, url, kind, slug, orig[1]);

  if (rest === '/zip' && isRead) return handlePhotoZip(request, env, ctx, url, kind, slug);

  return jsonResponse({ error: 'Not found' }, 404, request);
}

async function handlePhotoListing(request, env, kind, slug) {
  const live = await loadLiveGallery(env, kind, slug);
  if (!live) return jsonResponse({ error: 'Not found' }, 404, request);
  const { pointer, manifest } = live;
  // Public shape only: never the R2 key, sha256 or crc32.
  const photos = manifest.photos.map((p) => ({
    id: p.id, chapter: p.chapter || '', name: p.name,
    w: p.w, h: p.h, web_w: p.web_w, web_h: p.web_h, thumb_w: p.thumb_w, thumb_h: p.thumb_h,
    bytes: p.bytes,
  }));
  const body = {
    v: 1,
    kind,
    slug,
    title: pointer.title || '',
    cover: manifest.cover || (photos[0] && photos[0].id) || null,
    count: photos.length,
    total_bytes: photos.reduce((n, p) => n + (Number(p.bytes) || 0), 0),
    chapters: Array.isArray(manifest.chapters)
      ? manifest.chapters.map((c) => ({ name: c.name || '', count: c.count }))
      : [],
    photos,
  };
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      ...cors(request),
    },
  });
}

async function handlePhotoImage(request, env, kind, slug, size, pid) {
  const pointer = await loadLivePointer(env, kind, slug);
  if (!pointer) return jsonResponse({ error: 'Not found' }, 404, request);
  const key = `galleries/${pointer.gallery_id}/${size}/${pid}.jpg`;
  const object = request.method === 'HEAD' ? await env.FI_FILMS.head(key) : await env.FI_FILMS.get(key);
  if (!object) return jsonResponse({ error: 'Not found' }, 404, request);
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(object.size),
      'Cache-Control': 'public, max-age=86400',
      ...cors(request),
    },
  });
}

const PHOTO_CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif',
  tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp', gif: 'image/gif', dng: 'image/x-adobe-dng',
};

function originalsPrefix(manifest, gid) {
  const p = typeof manifest.originals_prefix === 'string' ? manifest.originals_prefix : '';
  // Only the two prefixes the pipeline writes, and only for this gallery id.
  if (p === `photo-originals/${gid}/` || p === `photo-originals-test/${gid}/`) return p;
  return `photo-originals/${gid}/`;
}

// Where an original can be, best first. After Sean approves a gallery the
// pipeline copies its originals to photo-archive/<gid>/ (the prefix under the
// R2 bucket lock; photo-archive-test/<gid>/ for test galleries), checks them,
// and only then deletes the upload copy. So an original is in the archive,
// in the upload prefix, or (while the copy runs) in both: try the archive
// first and fall back, and downloads keep working through the whole move.
function originalsPrefixes(manifest, gid) {
  const upload = originalsPrefix(manifest, gid);
  const archive = upload.replace(/^photo-originals(-test)?\//, (_m, t) => `photo-archive${t || ''}/`);
  return [archive, upload];
}

async function handlePhotoOriginal(request, env, url, kind, slug, pid) {
  const live = await loadLiveGallery(env, kind, slug);
  if (!live) return jsonResponse({ error: 'Not found' }, 404, request);
  if (!(await queryTokenOk(env, url.searchParams.get('t') || '', photoAuthSlug(kind, slug)))) {
    return expiredLinkResponse(request);
  }
  const photo = live.manifest.photos.find((p) => p.id === pid);
  if (!photo || typeof photo.key !== 'string') return jsonResponse({ error: 'Not found' }, 404, request);
  const name = String(photo.name || `${pid}.jpg`).slice(0, 150);
  const ext = name.split('.').pop().toLowerCase();
  const keys = originalsPrefixes(live.manifest, live.pointer.gallery_id).map((p) => p + photo.key);
  return streamR2Download(request, env, keys, name, `${pid}.jpg`,
    PHOTO_CONTENT_TYPES[ext] || 'application/octet-stream');
}

// --- Streaming ZIP64, store only ---------------------------------------------
// Every size and CRC comes from the manifest, so each header is known before
// its data and every original's R2 body is piped straight through: no
// per-byte work in JS, and an exact Content-Length before the first byte.

const ZIP_VERSION = 45; // 4.5, ZIP64
const ZIP_FLAGS = 0x0800; // bit 11: names are UTF-8
const LOCAL_FIXED = 30;
const LOCAL_EXTRA = 20; // id, size, uncompressed u64, compressed u64
const CENTRAL_FIXED = 46;
const CENTRAL_EXTRA = 28; // id, size, uncompressed u64, compressed u64, offset u64
const EOCD64_LEN = 56;
const LOCATOR_LEN = 20;
const EOCD_LEN = 22;

function dosDateTime(iso) {
  const d = new Date(iso);
  const t = isNaN(d.getTime()) ? new Date(Date.UTC(2026, 0, 1)) : d;
  const year = Math.min(Math.max(t.getUTCFullYear(), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((t.getUTCMonth() + 1) << 5) | t.getUTCDate(),
    time: (t.getUTCHours() << 11) | (t.getUTCMinutes() << 5) | Math.floor(t.getUTCSeconds() / 2),
  };
}

function splitExt(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

// Entry names: <chapter>/<name>, or <name> for the root chapter. A clash
// (compared case-insensitively, so Windows and macOS never overwrite one
// photo with another on extract) gets " (2)", " (3)" before the extension.
function zipEntryNames(photos) {
  const used = new Set();
  const clean = (s) => String(s || '').replace(/[\\/]+/g, '_').replace(/^\.+$/, '_');
  return photos.map((p) => {
    const chapter = clean(p.chapter);
    const base = clean(p.name) || `${p.id}.jpg`;
    const prefix = chapter ? `${chapter}/` : '';
    let candidate = prefix + base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      const [stem, ext] = splitExt(base);
      candidate = `${prefix}${stem} (${n})${ext}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

function planZip(photos, isoDate) {
  const enc = new TextEncoder();
  const names = zipEntryNames(photos);
  const { date, time } = dosDateTime(isoDate);
  let offset = 0;
  const entries = photos.map((p, i) => {
    const nameBytes = enc.encode(names[i]);
    const size = Number(p.bytes);
    const crc = parseInt(String(p.crc32), 16) >>> 0;
    const e = { photo: p, nameBytes, size, crc, offset };
    offset += LOCAL_FIXED + nameBytes.length + LOCAL_EXTRA + size;
    return e;
  });
  const cdOffset = offset;
  const cdSize = entries.reduce((n, e) => n + CENTRAL_FIXED + e.nameBytes.length + CENTRAL_EXTRA, 0);
  const total = cdOffset + cdSize + EOCD64_LEN + LOCATOR_LEN + EOCD_LEN;
  return { entries, cdOffset, cdSize, total, date, time };
}

function setU64(view, at, n) {
  view.setUint32(at, n % 0x100000000, true);
  view.setUint32(at + 4, Math.floor(n / 0x100000000), true);
}

function zipLocalHeader(e, plan) {
  const buf = new Uint8Array(LOCAL_FIXED + e.nameBytes.length + LOCAL_EXTRA);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, ZIP_VERSION, true);
  v.setUint16(6, ZIP_FLAGS, true);
  v.setUint16(8, 0, true); // method: stored
  v.setUint16(10, plan.time, true);
  v.setUint16(12, plan.date, true);
  v.setUint32(14, e.crc, true);
  v.setUint32(18, 0xFFFFFFFF, true); // sizes live in the ZIP64 extra field
  v.setUint32(22, 0xFFFFFFFF, true);
  v.setUint16(26, e.nameBytes.length, true);
  v.setUint16(28, LOCAL_EXTRA, true);
  buf.set(e.nameBytes, LOCAL_FIXED);
  const x = LOCAL_FIXED + e.nameBytes.length;
  v.setUint16(x, 0x0001, true);
  v.setUint16(x + 2, 16, true);
  setU64(v, x + 4, e.size);
  setU64(v, x + 12, e.size);
  return buf;
}

function zipCentralDirectory(plan) {
  const buf = new Uint8Array(plan.cdSize + EOCD64_LEN + LOCATOR_LEN + EOCD_LEN);
  const v = new DataView(buf.buffer);
  let at = 0;
  for (const e of plan.entries) {
    v.setUint32(at, 0x02014b50, true);
    v.setUint16(at + 4, ZIP_VERSION, true); // made by: MS-DOS host, 4.5
    v.setUint16(at + 6, ZIP_VERSION, true);
    v.setUint16(at + 8, ZIP_FLAGS, true);
    v.setUint16(at + 10, 0, true);
    v.setUint16(at + 12, plan.time, true);
    v.setUint16(at + 14, plan.date, true);
    v.setUint32(at + 16, e.crc, true);
    v.setUint32(at + 20, 0xFFFFFFFF, true);
    v.setUint32(at + 24, 0xFFFFFFFF, true);
    v.setUint16(at + 28, e.nameBytes.length, true);
    v.setUint16(at + 30, CENTRAL_EXTRA, true);
    v.setUint16(at + 32, 0, true); // comment length
    v.setUint16(at + 34, 0, true); // disk number
    v.setUint16(at + 36, 0, true); // internal attributes
    v.setUint32(at + 38, 0, true); // external attributes
    v.setUint32(at + 42, 0xFFFFFFFF, true); // offset lives in the extra field
    buf.set(e.nameBytes, at + CENTRAL_FIXED);
    const x = at + CENTRAL_FIXED + e.nameBytes.length;
    v.setUint16(x, 0x0001, true);
    v.setUint16(x + 2, 24, true);
    setU64(v, x + 4, e.size);
    setU64(v, x + 12, e.size);
    setU64(v, x + 20, e.offset);
    at = x + CENTRAL_EXTRA;
  }
  const n = plan.entries.length;
  const eocd64At = plan.cdOffset + plan.cdSize;
  // ZIP64 end of central directory record
  v.setUint32(at, 0x06064b50, true);
  setU64(v, at + 4, EOCD64_LEN - 12);
  v.setUint16(at + 12, ZIP_VERSION, true);
  v.setUint16(at + 14, ZIP_VERSION, true);
  v.setUint32(at + 16, 0, true);
  v.setUint32(at + 20, 0, true);
  setU64(v, at + 24, n);
  setU64(v, at + 32, n);
  setU64(v, at + 40, plan.cdSize);
  setU64(v, at + 48, plan.cdOffset);
  at += EOCD64_LEN;
  // ZIP64 end of central directory locator
  v.setUint32(at, 0x07064b50, true);
  v.setUint32(at + 4, 0, true);
  setU64(v, at + 8, eocd64At);
  v.setUint32(at + 16, 1, true);
  at += LOCATOR_LEN;
  // Classic end of central directory, every field deferring to ZIP64
  v.setUint32(at, 0x06054b50, true);
  v.setUint16(at + 4, 0, true);
  v.setUint16(at + 6, 0, true);
  v.setUint16(at + 8, 0xFFFF, true);
  v.setUint16(at + 10, 0xFFFF, true);
  v.setUint32(at + 12, 0xFFFFFFFF, true);
  v.setUint32(at + 16, 0xFFFFFFFF, true);
  v.setUint16(at + 20, 0, true);
  return buf;
}

async function writeChunk(writable, bytes) {
  const w = writable.getWriter();
  try { await w.write(bytes); } finally { w.releaseLock(); }
}

// One R2 read per photo in the steady state: prefixes are tried in order and
// whichever one answered last goes first for the next photo, so a gallery
// not yet archived costs one extra read for the whole zip, not one per photo.
async function getOriginal(env, prefixes, key, size) {
  for (let i = 0; i < prefixes.length; i++) {
    const obj = await env.FI_FILMS.get(prefixes[i] + key);
    if (obj && obj.size === size) {
      if (i > 0) prefixes.unshift(...prefixes.splice(i, 1));
      return obj;
    }
    if (obj && obj.body) { try { await obj.body.cancel(); } catch { /* ignore */ } }
  }
  return null;
}

async function pumpZip(env, plan, prefixes, writable) {
  const order = [...prefixes];
  try {
    for (const e of plan.entries) {
      await writeChunk(writable, zipLocalHeader(e, plan));
      const obj = await getOriginal(env, order, e.photo.key, e.size);
      if (!obj) throw new Error(`original missing or changed size: ${e.photo.id}`);
      await obj.body.pipeTo(writable, { preventClose: true });
    }
    await writeChunk(writable, zipCentralDirectory(plan));
    await writable.close();
  } catch (err) {
    // A short body makes the browser report a failed download instead of
    // saving a zip with a hole in it.
    try { await writable.abort(err); } catch { /* already errored */ }
  }
}

async function handlePhotoZip(request, env, ctx, url, kind, slug) {
  const live = await loadLiveGallery(env, kind, slug);
  if (!live) return jsonResponse({ error: 'Not found' }, 404, request);
  if (!(await queryTokenOk(env, url.searchParams.get('t') || '', photoAuthSlug(kind, slug)))) {
    return expiredLinkResponse(request);
  }
  const { pointer, manifest } = live;
  const hasChapter = url.searchParams.has('chapter');
  const chapter = url.searchParams.get('chapter') || '';
  const photos = manifest.photos.filter((p) =>
    typeof p.key === 'string' && /^[0-9a-f]{8}$/.test(String(p.crc32)) && Number.isFinite(Number(p.bytes)) &&
    (!hasChapter || (p.chapter || '') === chapter));
  if (photos.length === 0) return jsonResponse({ error: 'Not found' }, 404, request);
  if (photos.length > ZIP_MAX_ENTRIES) {
    return jsonResponse({ error: 'Too many photos for one zip. Download one chapter at a time.', max: ZIP_MAX_ENTRIES }, 413, request);
  }

  const plan = planZip(photos, pointer.approved_at);
  const title = String(pointer.title || slug).slice(0, 100);
  const wanted = hasChapter && chapter ? `${title} Photos (${chapter.slice(0, 60)}).zip` : `${title} Photos.zip`;
  const headers = {
    'Content-Type': 'application/zip',
    'Content-Disposition': attachmentDisposition(wanted, 'Photos.zip'),
    'Content-Length': String(plan.total),
    'Cache-Control': 'private, no-store',
    ...cors(request),
  };
  if (request.method === 'HEAD') return new Response(null, { headers });

  // FixedLengthStream (Workers runtime) keeps the exact Content-Length on a
  // streamed body instead of falling back to chunked encoding. A plain
  // TransformStream stands in where it does not exist (the node tests).
  const stream = typeof FixedLengthStream === 'function'
    ? new FixedLengthStream(plan.total)
    : new TransformStream();
  const done = pumpZip(env, plan, originalsPrefixes(manifest, pointer.gallery_id), stream.writable);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(done);
  return new Response(stream.readable, { headers });
}

// ---------------------------------------------------------------------------
// JWT helpers. HMAC-SHA256 via Web Crypto API.
// ---------------------------------------------------------------------------

function base64urlEncode(data) {
  const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlEncodeBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function getSigningKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// Signed download link key: base64url(HMAC-SHA256(secret, "fi-dl-v1:<slug>:<password>")).
// Must stay byte-identical to signDownloadKey in iris-automation.
async function signDownloadKey(secret, slug, password) {
  const key = await getSigningKey(secret);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`fi-dl-v1:${slug}:${password}`));
  return base64urlEncodeBytes(mac);
}

// Constant-time string compare so response timing does not leak how much of
// a guess matched.
function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i % (x.length || 1)] || 0) ^ (y[i % (y.length || 1)] || 0);
  }
  return diff === 0;
}

async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  const fullPayload = { ...payload, iat: Math.floor(Date.now() / 1000), exp };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64urlEncodeBytes(signature)}`;
}

async function verifyJWT(token, secret) {
  // Malformed tokens (bad base64, bad JSON) must read as invalid (null),
  // not throw up to the catch-all as a 500.
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await getSigningKey(secret);
    // Decode the signature from base64url to ArrayBuffer
    const sigStr = base64urlDecode(encodedSignature);
    const sigBytes = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) {
      sigBytes[i] = sigStr.charCodeAt(i);
    }

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(signingInput)
    );

    if (!valid) return null;

    const payload = JSON.parse(base64urlDecode(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function cors(request) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: {
      ...cors(request),
      'Access-Control-Max-Age': '86400',
    },
  });
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (request) Object.assign(headers, cors(request));
  return new Response(JSON.stringify(data), { status, headers });
}
