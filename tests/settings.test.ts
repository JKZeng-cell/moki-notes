import { afterEach, expect, it } from 'vitest';
import { NotesStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import { CacheSettings } from '../src/desktop/cache-settings.js';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const stores: NotesStore[] = [], dirs: string[] = [];
function store() { const s = new NotesStore(':memory:'); stores.push(s); return s; }
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });

it('empties linked trash while retaining surviving notes and detaching their hierarchy', () => {
  const s = store(), root = s.create({ title: 'root' }), mid = s.create({ title: 'mid', links: [root.id] }), survivor = s.create({ title: 'survivor', parentId: mid.id });
  const free = s.create({ title: 'free' }), child = s.create({ title: 'child', parentId: free.id });
  for (const n of [root, mid, free, child]) s.trash(n.id, 1);
  const p = s.trashPreview();
  expect(p.total).toBe(4); expect(p.protected).toBe(0); expect(p.affected).toBe(1);
  const r = s.clearTrash(p.candidates); expect(r.count).toBe(4);
  expect(s.db.prepare('SELECT COUNT(*) AS n FROM revisions WHERE note_id=?').get(free.id)!.n).toBe(0);
  expect(s.get(survivor.id)).toMatchObject({ version: 2, parentId: null }); expect(() => s.get(root.id)).toThrow('不存在');
});

it('rejects stale cleanup atomically and never removes trash created after preview', () => {
  const s = store(), a = s.create({ title: 'a' }), b = s.create({ title: 'b' });
  s.trash(a.id, 1); const p = s.trashPreview(); s.trash(b.id, 1);
  s.restore(a.id, 2);
  expect(() => s.clearTrash(p.candidates)).toThrow('变化'); expect(s.get(b.id).deletedAt).toBeTruthy();
  s.trash(a.id, 3); const next = s.trashPreview(); const c = s.create({ title: 'c' }); s.trash(c.id, 1);
  s.clearTrash(next.candidates); expect(s.get(c.id).deletedAt).toBeTruthy();
});

it('persists and validates autosave over HTTP and exposes guarded cleanup', async () => {
  const s = store(), app = await createApp(s);
  try {
    expect((await app.inject({ url: '/api/settings/autosave' })).json()).toEqual({ enabled: true, delayMs: 750 });
    expect((await app.inject({ method: 'PUT', url: '/api/settings/autosave', payload: { enabled: false, delayMs: 3000 } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/settings/autosave' })).json()).toEqual({ enabled: false, delayMs: 3000 });
    expect((await app.inject({ method: 'PUT', url: '/api/settings/autosave', payload: { enabled: true, delayMs: -1 } })).statusCode).toBe(400);
    const n = s.create({ title: 'trash' }); s.trash(n.id, 1);
    const preview = (await app.inject({ url: '/api/trash/preview' })).json();
    expect((await app.inject({ method: 'POST', url: '/api/trash/clear', payload: { candidates: preview.candidates } })).json().count).toBe(1);
    expect((await app.inject({ method: 'POST', url: '/api/trash/clear', payload: { candidates: preview.candidates } })).statusCode).toBe(409);
  } finally { await app.close(); }
});

it('redirects only caches after restart, preserves drafts and old cache, and resets safely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'moki-cache-')); dirs.push(dir);
  const profile = join(dir, 'profile'); mkdirSync(join(profile, 'Cache'), { recursive: true });
  writeFileSync(join(profile, 'Cache', 'old'), 'cache'); writeFileSync(join(profile, 'draft'), 'preserved');
  const a = new CacheSettings(profile); a.choose(join(dir, '自定义 路径'));
  expect(a.info(0).restartRequired).toBe(true); expect(a.activePath).toBe(profile);
  const b = new CacheSettings(profile);
  expect(b.info(0).restartRequired).toBe(false); expect(b.error).toBe('');
  expect(realpathSync(join(profile, 'Cache'))).toBe(resolve(b.activePath, 'Cache'));
  expect(readFileSync(join(profile, 'draft'), 'utf8')).toBe('preserved');
  expect(readdirSync(profile).some(n => n.startsWith('Cache.previous-'))).toBe(true);
  expect(() => b.choose(join(profile, 'Cache'))).toThrow('以外');
  b.choose(null); const c = new CacheSettings(profile);
  expect(c.activePath).toBe(profile); expect(c.info(0).restartRequired).toBe(false);
});
