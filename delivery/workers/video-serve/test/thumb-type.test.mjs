// handleThumb labels each thumbnail by its real type (2026-11-18): stored image
// type first, then the extension, JPEG for everything else as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function env(objects) {
  return {
    FI_FILMS: {
      async get(key) { return objects[key] ? { body: 'x', httpMetadata: objects[key] } : null; },
      async head(key) { return objects[key] ? {} : null; },
    },
  };
}
async function typeOf(path, objects) {
  const res = await worker.fetch(new Request('https://video.flyiniris.com/' + path), env(objects), { waitUntil() {} });
  return [res.status, res.headers.get('Content-Type')];
}

test('webp poster with stored type is image/webp', async () => {
  assert.deepEqual(await typeOf('couples/a-b/thumbs/teaser-640.webp', { 'couples/a-b/thumbs/teaser-640.webp': { contentType: 'image/webp' } }), [200, 'image/webp']);
});
test('webp poster without stored type is image/webp by extension', async () => {
  assert.deepEqual(await typeOf('couples/a-b/thumbs/teaser-640.webp', { 'couples/a-b/thumbs/teaser-640.webp': {} }), [200, 'image/webp']);
});
test('jpg thumbs stay image/jpeg', async () => {
  assert.deepEqual(await typeOf('couples/a-b/thumbs/highlight.jpg', { 'couples/a-b/thumbs/highlight.jpg': { contentType: 'image/jpeg' } }), [200, 'image/jpeg']);
  assert.deepEqual(await typeOf('couples/a-b/thumbs/highlight.jpg', { 'couples/a-b/thumbs/highlight.jpg': {} }), [200, 'image/jpeg']);
});
test('a non-image stored type never leaks through', async () => {
  assert.deepEqual(await typeOf('couples/a-b/thumbs/x.jpg', { 'couples/a-b/thumbs/x.jpg': { contentType: 'text/html' } }), [200, 'image/jpeg']);
});
