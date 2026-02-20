// fi-video-serve — Cloudflare Worker
// Serves HLS video from R2 with JWT-gated downloads

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

      // Route: GET /couples/{slug}/hls/{videoId}/*
      const hlsMatch = path.match(/^\/couples\/([^/]+)\/hls\/(.+)$/);
      if (hlsMatch && request.method === 'GET') {
        return handleHLS(request, env, hlsMatch[0]);
      }

      // Route: GET /couples/{slug}/thumbs/{videoId}.jpg
      const thumbMatch = path.match(/^\/couples\/([^/]+)\/thumbs\/([^/]+\.jpg)$/);
      if (thumbMatch && request.method === 'GET') {
        return handleThumb(request, env, thumbMatch[0]);
      }

      return jsonResponse({ error: 'Not found' }, 404, request);
    } catch (err) {
      return jsonResponse({ error: 'Internal server error' }, 500);
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

  // Playlists get short cache (quality switching); segments get long cache
  const cacheControl =
    ext === 'm3u8'
      ? 'public, max-age=3600'
      : 'public, max-age=31536000';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      ...cors(request),
    },
  });
}

async function handleThumb(request, env, matchedPath) {
  const key = matchedPath.replace(/^\//, '');
  const object = await env.FI_FILMS.get(key);

  if (!object) {
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

  const password = body.password;
  if (!password) {
    return jsonResponse({ error: 'Password required' }, 400, request);
  }

  const stored = await env.PASSWORDS.get(slug);
  if (!stored || stored !== password) {
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

// ---------------------------------------------------------------------------
// JWT helpers — HMAC-SHA256 via Web Crypto API
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
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return origin === 'https://flyiniris.com' ||
         (origin.endsWith('.flyiniris.com') && origin.startsWith('https://'));
}

function cors(request) {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : '*',
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
