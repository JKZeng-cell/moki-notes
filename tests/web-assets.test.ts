import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotesStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0; });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'moki-web-assets-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets')); await writeFile(join(root, 'index.html'), '<!doctype html><div id="root">便签</div>');
  await writeFile(join(root, 'assets', 'app.js'), 'window.loaded = true;');
  await writeFile(join(root, 'assets', 'app.css'), 'body{color:purple}');
  await writeFile(join(root, 'icon.png'), Buffer.from([0, 128, 255, 42]));
  await writeFile(join(root, '.private'), 'not public');
  const store = new NotesStore(':memory:'); cleanup.push(() => store.close());
  const app = await createApp(store, { webRoot: root, desktopWebAssets: true }); cleanup.push(() => app.close());
  return { root, store, app };
}
it('keeps cold sticky windows and assets usable after the installation files become unavailable', async () => {
  const { root, store, app } = await fixture(); const note = store.create({ title: '保留便签' });
  await rm(root, { recursive: true, force: true });
  for (const url of ['/', `/生僻字`, `/?sticky=${note.id}`, `/?sticky=${note.id}&edit=1`, `/?note=${note.id}`, '/index.html']) {
    const response = await app.inject(url);
    if (url === '/生僻字') { expect(response.statusCode).toBe(404); continue; }
    expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toContain('text/html'); expect(response.body).toContain('便签');
  }
  expect((await app.inject('/assets/app.js')).body).toBe('window.loaded = true;');
  expect((await app.inject('/assets/app.css')).headers['content-type']).toContain('text/css');
  expect((await app.inject('/icon.png')).rawPayload).toEqual(Buffer.from([0, 128, 255, 42]));
  expect((await app.inject(`/api/notes/${note.id}`)).json().title).toBe('保留便签');
  for (const url of ['/.private', '/%2e%2e/package.json', '/assets/missing.js']) expect((await app.inject(url)).statusCode).toBe(404);
});
it('supports HEAD and cache revalidation without reusing another build or bypassing host guards', async () => {
  const { app } = await fixture(); const response = await app.inject('/');
  const head = await app.inject({ method: 'HEAD', url: '/?sticky=test' });
  expect(head.statusCode).toBe(200); expect(head.body).toBe(''); expect(head.headers['content-length']).toBe(response.headers['content-length']);
  expect((await app.inject({ url: '/', headers: { 'if-none-match': `W/${response.headers.etag}` } })).statusCode).toBe(304);
  expect((await app.inject({ url: '/', headers: { 'if-none-match': '"old-build"' } })).statusCode).toBe(200);
  expect((await app.inject({ url: '/', headers: { host: 'evil.example' } })).statusCode).toBe(403);
});
it('preserves the underlying resource error instead of throwing invalid payload for JSON under an HTML MIME type', async () => {
  const { app } = await fixture();
  app.get('/broken', async (_req, reply) => {
    reply.type('text/html').header('Content-Length', 999).header('Content-Encoding', 'gzip').header('ETag', 'stale');
    throw new Error('resource read failed');
  });
  const response = await app.inject('/broken');
  expect(response.statusCode).toBe(500); expect(response.json()).toEqual({ error: 'ERROR', message: 'resource read failed' });
  expect(response.headers['content-type']).toContain('application/json');
  expect(response.headers['content-encoding']).toBeUndefined(); expect(response.headers.etag).toBeUndefined();
  expect(response.headers['cache-control']).toBe('no-store');
});
