// Node 22 tests for fi-video-serve: photo gallery routes (board #24) and the
// existing film routes. Run: npm test (or node test/photos.test.mjs).
// Everything runs against in-memory fakes; nothing touches real R2 or KV.
// The zip check shells out to Python's zipfile (testzip verifies every CRC).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import worker from '../src/index.js';

// --- fakes -------------------------------------------------------------------

function bodyStream(bytes, chunk = 7000) {
  let at = 0;
  return new ReadableStream({
    pull(c) {
      if (at >= bytes.length) { c.close(); return; }
      c.enqueue(bytes.slice(at, at + chunk));
      at += chunk;
    },
  });
}

function parseRange(headers, size) {
  const h = headers && typeof headers.get === 'function' ? headers.get('Range') : null;
  const m = h && h.match(/^bytes=(\d+)-(\d*)$/);
  if (!m) return null;
  const offset = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return { offset, length: end - offset + 1 };
}

class FakeR2 {
  constructor() { this.map = new Map(); this.gets = []; }
  put(key, value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.map.set(key, bytes);
  }
  async head(key) {
    const b = this.map.get(key);
    return b ? { size: b.length } : null;
  }
  async get(key, opts = {}) {
    this.gets.push(key);
    const full = this.map.get(key);
    if (!full) return null;
    const range = parseRange(opts.range, full.length);
    const bytes = range ? full.slice(range.offset, range.offset + range.length) : full;
    return {
      size: full.length,
      range: range || undefined,
      body: bodyStream(bytes),
      async json() { return JSON.parse(new TextDecoder().decode(full)); },
      async text() { return new TextDecoder().decode(full); },
    };
  }
}

class FakeKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, String(v)); }
}

const GID = '3f1c2a9e-1111-4222-8333-944455556666';
const TEST_GID = '0a0b0c0d-1111-4222-8333-944455556666';
const LINK_SECRET = 'test-link-secret';

function makeEnv() {
  return {
    FI_FILMS: new FakeR2(),
    PASSWORDS: new FakeKV(),
    JWT_SECRET: 'test-jwt-secret',
    DELIVERY_LINK_SECRET: LINK_SECRET,
  };
}

// Photos: chapters "" (root), "Getting Ready" (with a duplicate name and a
// case-only clash), "Ceremony" (UTF-8 name).
const PHOTO_SPECS = [
  { chapter: '', name: 'cover.jpg', key: 'cover.jpg', size: 12000 },
  { chapter: 'Getting Ready', name: 'IMG_0001.jpg', key: 'Getting Ready/IMG_0001.jpg', size: 30001 },
  { chapter: 'Getting Ready', name: 'IMG_0001.jpg', key: 'Getting Ready/sub/IMG_0001.jpg', size: 25000 },
  { chapter: 'Getting Ready', name: 'img_0001.JPG', key: 'Getting Ready/img_0001.JPG', size: 9000 },
  { chapter: 'Ceremony', name: 'Première danse.jpg', key: 'Ceremony/Première danse.jpg', size: 41234 },
  { chapter: 'Ceremony', name: 'IMG_0002.png', key: 'Ceremony/IMG_0002.png', size: 0 },
];

function seedGallery(env, { kind = 'couple', slug = 'ava-ben', gid = GID, test = false, title = 'Ava & Ben' } = {}) {
  const prefix = test ? `photo-originals-test/${gid}/` : `photo-originals/${gid}/`;
  const photos = PHOTO_SPECS.map((s, i) => {
    const bytes = randomBytes(s.size);
    env.FI_FILMS.put(prefix + s.key, bytes);
    const id = 'p' + String(i + 1).padStart(5, '0');
    env.FI_FILMS.put(`galleries/${gid}/web/${id}.jpg`, `web-${id}`);
    env.FI_FILMS.put(`galleries/${gid}/thumb/${id}.jpg`, `thumb-${id}`);
    return {
      id, chapter: s.chapter, name: s.name, key: s.key, bytes: s.size,
      crc32: (crc32(bytes) >>> 0).toString(16).padStart(8, '0'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      w: 6000, h: 4000, web_w: 2048, web_h: 1365, thumb_w: 600, thumb_h: 400,
      _bytes: new Uint8Array(bytes),
    };
  });
  const manifest = {
    v: 1, gallery_id: gid, test, folder: 'Ava & Ben_2026-09-19', originals_prefix: prefix,
    created_at: '2026-10-06T20:00:00Z', cover: 'p00001', count: photos.length,
    total_bytes: photos.reduce((n, p) => n + p.bytes, 0),
    chapters: [{ name: '', count: 1 }, { name: 'Getting Ready', count: 3 }, { name: 'Ceremony', count: 2 }],
    photos: photos.map(({ _bytes, ...p }) => p),
  };
  env.FI_FILMS.put(`galleries/${gid}/manifest.json`, JSON.stringify(manifest));
  env.FI_FILMS.put(`photo-live/${kind}/${slug}.json`, JSON.stringify({
    v: 1, gallery_id: gid, kind, slug, title, approved_at: '2026-10-06T21:14:08Z',
  }));
  return photos;
}

const BASE = 'https://video.flyiniris.com';
function call(env, path, init = {}) {
  const ctx = { waitUntil() {} };
  return worker.fetch(new Request(BASE + path, init), env, ctx);
}
function post(env, path, body, ip = '203.0.113.7') {
  return call(env, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}
async function token(env, path, body) {
  const res = await post(env, path, body);
  assert.equal(res.status, 200, `auth at ${path}`);
  return (await res.json()).token;
}

// Same construction as signDownloadKey in iris-automation and the Worker.
async function linkKey(authSlug, password) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(LINK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(`fi-dl-v1:${authSlug}:${password}`)));
  return Buffer.from(mac).toString('base64url');
}

async function readAll(res) {
  return new Uint8Array(await res.arrayBuffer());
}

// --- listing and images ------------------------------------------------------

test('everything 404s without a live pointer', async () => {
  const env = makeEnv();
  seedGallery(env);
  env.FI_FILMS.map.delete('photo-live/couple/ava-ben.json');
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  for (const p of ['/photos/couple/ava-ben', '/photos/couple/ava-ben/thumb/p00001.jpg',
    '/photos/couple/ava-ben/web/p00001.jpg', '/photos/couple/ava-ben/zip?t=x',
    '/photos/couple/ava-ben/original/p00001?t=x']) {
    assert.equal((await call(env, p)).status, 404, p);
  }
  assert.equal((await post(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' })).status, 404);
  assert.equal((await call(env, '/photos/other/ava-ben')).status, 404);
  assert.equal((await call(env, '/photos/couple/Bad_Slug')).status, 404);
});

test('listing is public, cached 60s and strips key, sha256 and crc32', async () => {
  const env = makeEnv();
  seedGallery(env);
  const res = await call(env, '/photos/couple/ava-ben');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  const body = await res.json();
  assert.equal(body.v, 1);
  assert.equal(body.kind, 'couple');
  assert.equal(body.slug, 'ava-ben');
  assert.equal(body.title, 'Ava & Ben');
  assert.equal(body.count, PHOTO_SPECS.length);
  assert.equal(body.total_bytes, PHOTO_SPECS.reduce((n, s) => n + s.size, 0));
  assert.equal(body.cover, 'p00001');
  assert.equal(body.chapters.length, 3);
  const text = JSON.stringify(body);
  for (const banned of ['"key"', 'sha256', 'crc32', 'photo-originals', GID]) {
    assert.ok(!text.includes(banned), `listing leaks ${banned}`);
  }
  assert.deepEqual(Object.keys(body.photos[0]).sort(),
    ['bytes', 'chapter', 'h', 'id', 'name', 'thumb_h', 'thumb_w', 'w', 'web_h', 'web_w']);
});

test('web and thumb copies serve with a day of cache, HEAD works', async () => {
  const env = makeEnv();
  seedGallery(env);
  const t = await call(env, '/photos/couple/ava-ben/thumb/p00002.jpg');
  assert.equal(t.status, 200);
  assert.equal(t.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(t.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(new TextDecoder().decode(await readAll(t)), 'thumb-p00002');
  const w = await call(env, '/photos/couple/ava-ben/web/p00002.jpg');
  assert.equal(new TextDecoder().decode(await readAll(w)), 'web-p00002');
  const h = await call(env, '/photos/couple/ava-ben/web/p00002.jpg', { method: 'HEAD' });
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('Content-Length'), String('web-p00002'.length));
  assert.equal((await call(env, '/photos/couple/ava-ben/web/p99999.jpg')).status, 404);
  assert.equal((await call(env, '/photos/couple/ava-ben/web/../manifest.json')).status, 404);
});

// --- auth --------------------------------------------------------------------

test('couple auth: password and link key, wrong password 401, rate limit', async () => {
  const env = makeEnv();
  seedGallery(env);
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  assert.ok(await token(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' }));
  assert.ok(await token(env, '/photos/couple/ava-ben/auth', { link_key: await linkKey('ava-ben', 'pw-ava') }));
  // A gallery-scoped key must not open the couple.
  const wrongKey = await post(env, '/photos/couple/ava-ben/auth', { link_key: await linkKey('gallery:ava-ben', 'pw-ava') });
  assert.equal(wrongKey.status, 401);
  assert.equal((await post(env, '/photos/couple/ava-ben/auth', {})).status, 400);
  for (let i = 0; i < 9; i++) {
    assert.equal((await post(env, '/photos/couple/ava-ben/auth', { password: 'nope' })).status, 401);
  }
  // Same counter key shape as the films route: rl:<authSlug>:<ip>
  assert.equal(env.PASSWORDS.map.get('rl:ava-ben:203.0.113.7'), '10');
  assert.equal((await post(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' })).status, 429);
  assert.equal((await post(env, '/couples/ava-ben/auth', { password: 'pw-ava' })).status, 429);
});

test('gallery auth uses gallery:<slug> for password, link key and rate limit', async () => {
  const env = makeEnv();
  seedGallery(env, { kind: 'gallery', slug: 'acme-gala', title: 'Acme Gala' });
  env.PASSWORDS.map.set('gallery:acme-gala', 'pw-acme');
  env.PASSWORDS.map.set('acme-gala', 'films-pw'); // a same-named films key must not count
  assert.equal((await post(env, '/photos/gallery/acme-gala/auth', { password: 'films-pw' })).status, 401);
  assert.equal(env.PASSWORDS.map.get('rl:gallery:acme-gala:203.0.113.7'), '1');
  const tk = await token(env, '/photos/gallery/acme-gala/auth', { password: 'pw-acme' });
  const payload = JSON.parse(Buffer.from(tk.split('.')[1], 'base64url').toString());
  assert.equal(payload.slug, 'gallery:acme-gala');
  assert.ok(await token(env, '/photos/gallery/acme-gala/auth', { link_key: await linkKey('gallery:acme-gala', 'pw-acme') }));
  assert.equal((await post(env, '/photos/gallery/acme-gala/auth', { link_key: await linkKey('acme-gala', 'pw-acme') })).status, 401);
});

test('films token opens couple photos, and never a gallery of the same slug', async () => {
  const env = makeEnv();
  seedGallery(env, { kind: 'couple', slug: 'ava-ben' });
  seedGallery(env, { kind: 'gallery', slug: 'ava-ben', gid: TEST_GID, test: true });
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  const filmsToken = await token(env, '/couples/ava-ben/auth', { password: 'pw-ava' });
  const ok = await call(env, `/photos/couple/ava-ben/original/p00002?t=${filmsToken}`);
  assert.equal(ok.status, 200);
  await ok.arrayBuffer();
  assert.equal((await call(env, `/photos/gallery/ava-ben/original/p00002?t=${filmsToken}`)).status, 403);
  assert.equal((await call(env, `/photos/gallery/ava-ben/zip?t=${filmsToken}`)).status, 403);
});

// --- originals ---------------------------------------------------------------

test('original download: full, ranged, HEAD, bad token', async () => {
  const env = makeEnv();
  const photos = seedGallery(env);
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  const tk = await token(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' });
  const p = photos[4]; // UTF-8 name

  const full = await call(env, `/photos/couple/ava-ben/original/${p.id}?t=${tk}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(full.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(full.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(full.headers.get('Content-Length'), String(p.bytes));
  assert.equal(full.headers.get('Content-Disposition'),
    `attachment; filename="Premire danse.jpg"; filename*=UTF-8''${encodeURIComponent(p.name)}`);
  assert.deepEqual(await readAll(full), p._bytes);

  const part = await call(env, `/photos/couple/ava-ben/original/${p.id}?t=${tk}`, { headers: { Range: 'bytes=100-1099' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('Content-Length'), '1000');
  assert.equal(part.headers.get('Content-Range'), `bytes 100-1099/${p.bytes}`);
  assert.deepEqual(await readAll(part), p._bytes.slice(100, 1100));

  const head = await call(env, `/photos/couple/ava-ben/original/${p.id}?t=${tk}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), String(p.bytes));

  assert.equal((await call(env, `/photos/couple/ava-ben/original/${p.id}?t=garbage`)).status, 403);
  assert.equal((await call(env, `/photos/couple/ava-ben/original/${p.id}`)).status, 403);
  assert.equal((await call(env, `/photos/couple/ava-ben/original/p00099?t=${tk}`)).status, 404);
  const png = await call(env, `/photos/couple/ava-ben/original/p00006?t=${tk}`);
  assert.equal(png.headers.get('Content-Type'), 'image/png');
  await png.arrayBuffer();
});

test('test galleries read originals from photo-originals-test', async () => {
  const env = makeEnv();
  const photos = seedGallery(env, { kind: 'gallery', slug: 'zz-test-one', gid: TEST_GID, test: true });
  env.PASSWORDS.map.set('gallery:zz-test-one', 'pw-t');
  const tk = await token(env, '/photos/gallery/zz-test-one/auth', { password: 'pw-t' });
  const res = await call(env, `/photos/gallery/zz-test-one/original/p00002?t=${tk}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await readAll(res), photos[1]._bytes);
});

// --- zip ---------------------------------------------------------------------

function pyZipCheck(file) {
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const out = execFileSync(py, ['-c',
    'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; '
    + 'print(json.dumps([[i.filename, i.file_size, i.compress_type, i.flag_bits & 0x800] for i in z.infolist()]))',
    file], { encoding: 'utf-8' });
  return JSON.parse(out.trim().split('\n').pop());
}

test('zip: exact Content-Length, valid ZIP64 with CRCs, names deduped, chapter filter', async () => {
  const env = makeEnv();
  const photos = seedGallery(env);
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  const tk = await token(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' });
  const dir = mkdtempSync(join(tmpdir(), 'fi-zip-'));
  try {
    const head = await call(env, `/photos/couple/ava-ben/zip?t=${tk}`, { method: 'HEAD' });
    assert.equal(head.status, 200);

    const res = await call(env, `/photos/couple/ava-ben/zip?t=${tk}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'application/zip');
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(res.headers.get('Content-Disposition'),
      `attachment; filename="Ava & Ben Photos.zip"; filename*=UTF-8''${encodeURIComponent('Ava & Ben Photos.zip')}`);
    const bytes = await readAll(res);
    assert.equal(String(bytes.length), res.headers.get('Content-Length'));
    assert.equal(head.headers.get('Content-Length'), res.headers.get('Content-Length'));
    const file = join(dir, 'all.zip');
    writeFileSync(file, bytes);
    const entries = pyZipCheck(file);
    assert.deepEqual(entries.map((e) => e[0]), [
      'cover.jpg',
      'Getting Ready/IMG_0001.jpg',
      'Getting Ready/IMG_0001 (2).jpg',
      'Getting Ready/img_0001 (3).JPG',
      'Ceremony/Première danse.jpg',
      'Ceremony/IMG_0002.png',
    ]);
    entries.forEach((e, i) => {
      assert.equal(e[1], photos[i].bytes);
      assert.equal(e[2], 0, 'stored, no compression');
      assert.equal(e[3], 0x800, 'UTF-8 flag');
    });
    // The originals were piped in order, one R2 read each.
    const reads = env.FI_FILMS.gets.filter((k) => k.startsWith('photo-originals/'));
    assert.deepEqual(reads, photos.map((p) => `photo-originals/${GID}/${p.key}`));

    const ch = await call(env, `/photos/couple/ava-ben/zip?t=${tk}&chapter=${encodeURIComponent('Getting Ready')}`);
    assert.equal(ch.status, 200);
    assert.match(ch.headers.get('Content-Disposition'), /Ava & Ben Photos \(Getting Ready\)\.zip/);
    const chBytes = await readAll(ch);
    assert.equal(String(chBytes.length), ch.headers.get('Content-Length'));
    writeFileSync(join(dir, 'ch.zip'), chBytes);
    assert.deepEqual(pyZipCheck(join(dir, 'ch.zip')).map((e) => e[0]),
      ['Getting Ready/IMG_0001.jpg', 'Getting Ready/IMG_0001 (2).jpg', 'Getting Ready/img_0001 (3).JPG']);

    const root = await call(env, `/photos/couple/ava-ben/zip?t=${tk}&chapter=`);
    const rootBytes = await readAll(root);
    writeFileSync(join(dir, 'root.zip'), rootBytes);
    assert.deepEqual(pyZipCheck(join(dir, 'root.zip')).map((e) => e[0]), ['cover.jpg']);

    assert.equal((await call(env, `/photos/couple/ava-ben/zip?t=${tk}&chapter=Nope`)).status, 404);
    assert.equal((await call(env, '/photos/couple/ava-ben/zip?t=bad')).status, 403);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('zip: a missing original errors the stream instead of finishing short', async () => {
  const env = makeEnv();
  const photos = seedGallery(env);
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  env.FI_FILMS.map.delete(`photo-originals/${GID}/${photos[2].key}`);
  const tk = await token(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' });
  const res = await call(env, `/photos/couple/ava-ben/zip?t=${tk}`);
  assert.equal(res.status, 200);
  await assert.rejects(res.arrayBuffer());
});

// --- the locked archive (after approval) ---------------------------------------
// The pipeline copies photo-originals/<gid>/ to photo-archive/<gid>/, checks
// it, then deletes the upload copy. Every stage of that move must serve.

function moveToArchive(env, photos, { gid = GID, test = false, copy = () => true, del = () => true } = {}) {
  const from = test ? `photo-originals-test/${gid}/` : `photo-originals/${gid}/`;
  const to = test ? `photo-archive-test/${gid}/` : `photo-archive/${gid}/`;
  photos.forEach((p, i) => {
    if (copy(i)) env.FI_FILMS.put(to + p.key, p._bytes);
    if (copy(i) && del(i)) env.FI_FILMS.map.delete(from + p.key);
  });
}

async function zipEntries(res) {
  const dir = mkdtempSync(join(tmpdir(), 'fi-zip-'));
  try {
    const bytes = await readAll(res);
    assert.equal(String(bytes.length), res.headers.get('Content-Length'));
    writeFileSync(join(dir, 'z.zip'), bytes);
    return pyZipCheck(join(dir, 'z.zip'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('archived gallery: originals and zip come from photo-archive, one read each', async () => {
  const env = makeEnv();
  const photos = seedGallery(env);
  moveToArchive(env, photos);
  assert.equal([...env.FI_FILMS.map.keys()].filter((k) => k.startsWith('photo-originals/')).length, 0);
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  const tk = await token(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' });
  const p = photos[1];
  const full = await call(env, `/photos/couple/ava-ben/original/${p.id}?t=${tk}`);
  assert.equal(full.status, 200);
  assert.deepEqual(await readAll(full), p._bytes);
  const part = await call(env, `/photos/couple/ava-ben/original/${p.id}?t=${tk}`, { headers: { Range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.deepEqual(await readAll(part), p._bytes.slice(10, 20));
  const head = await call(env, `/photos/couple/ava-ben/original/${p.id}?t=${tk}`, { method: 'HEAD' });
  assert.equal(head.headers.get('Content-Length'), String(p.bytes));

  env.FI_FILMS.gets.length = 0;
  const entries = await zipEntries(await call(env, `/photos/couple/ava-ben/zip?t=${tk}`));
  entries.forEach((e, i) => assert.equal(e[1], photos[i].bytes));
  const reads = env.FI_FILMS.gets.filter((k) => /^photo-(archive|originals)\//.test(k));
  assert.deepEqual(reads, photos.map((x) => `photo-archive/${GID}/${x.key}`));
});

test('not yet archived: one extra read for the whole zip, not one per photo', async () => {
  const env = makeEnv();
  const photos = seedGallery(env);
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  const tk = await token(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' });
  env.FI_FILMS.gets.length = 0;
  await zipEntries(await call(env, `/photos/couple/ava-ben/zip?t=${tk}`));
  const reads = env.FI_FILMS.gets.filter((k) => /^photo-(archive|originals)\//.test(k));
  assert.deepEqual(reads, [`photo-archive/${GID}/${photos[0].key}`, ...photos.map((x) => `photo-originals/${GID}/${x.key}`)]);
});

test('mid-move: copy half done, then delete half done, zip and downloads still whole', async () => {
  for (const [label, opts] of [
    ['copy running', { copy: (i) => i % 2 === 0, del: () => false }],
    ['delete running', { copy: () => true, del: (i) => i < 3 }],
    ['odd mix', { copy: (i) => i !== 1, del: (i) => i % 2 === 0 }],
  ]) {
    const env = makeEnv();
    const photos = seedGallery(env);
    moveToArchive(env, photos, opts);
    env.PASSWORDS.map.set('ava-ben', 'pw-ava');
    const tk = await token(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' });
    const entries = await zipEntries(await call(env, `/photos/couple/ava-ben/zip?t=${tk}`));
    assert.equal(entries.length, photos.length, label);
    entries.forEach((e, i) => assert.equal(e[1], photos[i].bytes, label));
    for (const p of photos) {
      const r = await call(env, `/photos/couple/ava-ben/original/${p.id}?t=${tk}`);
      assert.equal(r.status, 200, `${label} ${p.id}`);
      assert.deepEqual(await readAll(r), p._bytes, `${label} ${p.id}`);
    }
  }
});

test('archive copy with a wrong size is skipped for the upload copy', async () => {
  const env = makeEnv();
  const photos = seedGallery(env);
  env.FI_FILMS.put(`photo-archive/${GID}/${photos[1].key}`, new Uint8Array(5));
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  const tk = await token(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' });
  const entries = await zipEntries(await call(env, `/photos/couple/ava-ben/zip?t=${tk}`));
  entries.forEach((e, i) => assert.equal(e[1], photos[i].bytes));
});

test('test galleries archive to photo-archive-test, never photo-archive', async () => {
  const env = makeEnv();
  const photos = seedGallery(env, { kind: 'gallery', slug: 'zz-test-one', gid: TEST_GID, test: true });
  moveToArchive(env, photos, { gid: TEST_GID, test: true });
  env.FI_FILMS.put(`photo-archive/${TEST_GID}/${photos[1].key}`, new Uint8Array(photos[1].bytes));
  env.PASSWORDS.map.set('gallery:zz-test-one', 'pw-t');
  const tk = await token(env, '/photos/gallery/zz-test-one/auth', { password: 'pw-t' });
  const res = await call(env, `/photos/gallery/zz-test-one/original/p00002?t=${tk}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await readAll(res), photos[1]._bytes);
  const entries = await zipEntries(await call(env, `/photos/gallery/zz-test-one/zip?t=${tk}`));
  assert.equal(entries.length, photos.length);
});

test('zip: an original missing from both places still errors the stream', async () => {
  const env = makeEnv();
  const photos = seedGallery(env);
  moveToArchive(env, photos, { del: () => false });
  env.FI_FILMS.map.delete(`photo-originals/${GID}/${photos[3].key}`);
  env.FI_FILMS.map.delete(`photo-archive/${GID}/${photos[3].key}`);
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  const tk = await token(env, '/photos/couple/ava-ben/auth', { password: 'pw-ava' });
  const res = await call(env, `/photos/couple/ava-ben/zip?t=${tk}`);
  await assert.rejects(res.arrayBuffer());
  assert.equal((await call(env, `/photos/couple/ava-ben/original/${photos[3].id}?t=${tk}`)).status, 404);
});

// --- existing film routes ----------------------------------------------------

test('film routes unchanged: auth, signed link, file download with range, POST download', async () => {
  const env = makeEnv();
  env.PASSWORDS.map.set('ava-ben', 'pw-ava');
  const film = randomBytes(50000);
  env.FI_FILMS.put('couples/ava-ben/originals/highlight.mp4', film);
  env.FI_FILMS.put('couples/ava-ben/hls/highlight/master.m3u8', '#EXTM3U');
  env.FI_FILMS.put('couples/ava-ben/thumbs/highlight.jpg', 'jpg');

  assert.equal((await post(env, '/couples/ava-ben/auth', { password: 'wrong' })).status, 401);
  assert.equal(env.PASSWORDS.map.get('rl:ava-ben:203.0.113.7'), '1');
  const tk = await token(env, '/couples/ava-ben/auth', { password: 'pw-ava' });
  assert.ok(await token(env, '/couples/ava-ben/auth', { link_key: await linkKey('ava-ben', 'pw-ava') }));
  const payload = JSON.parse(Buffer.from(tk.split('.')[1], 'base64url').toString());
  assert.equal(payload.slug, 'ava-ben');

  const f = await call(env, `/couples/ava-ben/file/highlight?t=${tk}&name=${encodeURIComponent('Ava & Ben Highlight.mp4')}`);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('Content-Type'), 'video/mp4');
  assert.equal(f.headers.get('Content-Disposition'),
    `attachment; filename="Ava & Ben Highlight.mp4"; filename*=UTF-8''${encodeURIComponent('Ava & Ben Highlight.mp4')}`);
  assert.equal(f.headers.get('Content-Length'), '50000');
  assert.deepEqual(await readAll(f), new Uint8Array(film));

  const r = await call(env, `/couples/ava-ben/file/highlight?t=${tk}`, { headers: { Range: 'bytes=10-19' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('Content-Range'), 'bytes 10-19/50000');
  assert.match(r.headers.get('Content-Disposition'), /filename="highlight\.mp4"/);
  await r.arrayBuffer();

  const bad = await call(env, '/couples/ava-ben/file/highlight?t=nope');
  assert.equal(bad.status, 403);
  assert.equal(await bad.text(), 'This download link has expired. Go back to the page and tap Download again.');

  const p = await call(env, '/couples/ava-ben/download/highlight', { method: 'POST', headers: { Authorization: `Bearer ${tk}` } });
  assert.equal(p.status, 200);
  assert.deepEqual(await readAll(p), new Uint8Array(film));

  assert.equal((await call(env, '/couples/ava-ben/hls/highlight/master.m3u8')).headers.get('Content-Type'), 'application/vnd.apple.mpegurl');
  assert.equal((await call(env, '/couples/ava-ben/thumbs/highlight.jpg')).status, 200);
  assert.equal((await call(env, '/couples/ava-ben/thumbs/teaser.jpg')).status, 302);
  assert.equal((await call(env, '/nothing')).status, 404);
});
