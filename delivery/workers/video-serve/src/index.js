// fi-video-serve: Cloudflare Worker.
// Serves HLS video from R2 with JWT-gated downloads.

export default {
  async fetch(request, env) {
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

async function handleAuth(request, env, slug) {
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
  const payload = token ? await verifyJWT(token, env.JWT_SECRET) : null;
  if (!payload || payload.slug !== slug) {
    return new Response('This download link has expired. Go back to the page and tap Download again.', {
      status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors(request) },
    });
  }

  const key = `couples/${slug}/originals/${videoId}.mp4`;
  // Range support lets phones resume and lets players seek a partial file.
  const object = request.method === 'HEAD'
    ? await env.FI_FILMS.head(key)
    : await env.FI_FILMS.get(key, { range: request.headers });
  if (!object) {
    return jsonResponse({ error: 'Not found' }, 404, request);
  }

  // Readable filename from ?name= (ASCII-safe fallback plus RFC 5987 form).
  const wanted = (url.searchParams.get('name') || `${videoId}.mp4`).slice(0, 150);
  const ascii = wanted.replace(/[^A-Za-z0-9 ._()&-]/g, '').trim() || `${videoId}.mp4`;
  const headers = {
    'Content-Type': 'video/mp4',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(wanted)}`,
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
