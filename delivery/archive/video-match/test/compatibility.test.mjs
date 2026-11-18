import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';

test('public catalog and stateless matches remain available with no storage', async () => {
  const host = 'https://matcher.example';
  const env = new Proxy({}, { get() { throw new Error('Unexpected binding access'); } });
  const request = (path, method = 'GET', data) => worker.fetch(new Request(host + path, {
    method, body: data === undefined ? undefined : JSON.stringify(data),
  }), env);

  const catalog = await request('/films');
  assert.equal(catalog.status, 200);
  const { films } = await catalog.json();
  assert.ok(films.length >= 2);
  const match = { count: 2, vibe: 'romantic' };
  const first = await request('/match', 'POST', match);
  assert.equal(first.status, 200);
  const ranked = await first.json();
  assert.equal(ranked.films.length, 2);
  assert.equal(ranked.viewedCount, 0);

  const compatibility = await request('/match', 'POST', { ...match, email: 'fixture@example.invalid' });
  assert.deepEqual(await compatibility.json(), ranked);
  const omit = ranked.films[0].slug;
  const filtered = await request('/match', 'POST', { ...match, excludeSlugs: [omit] });
  assert.ok((await filtered.json()).films.every(film => film.slug !== omit));
  for (const method of ['GET', 'POST']) {
    const gone = await request('/viewed', method);
    assert.equal(gone.status, 410);
    assert.deepEqual(await gone.json(), { error: 'Viewing history retired' });
  }
});
