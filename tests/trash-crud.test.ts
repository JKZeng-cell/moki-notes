import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { NotesStore } from '../src/server/store.js';
import { Attachments } from '../src/server/attachments.js';
import { createApp } from '../src/server/app.js';

describe('database CRUD and complete trash deletion', () => {
  it('permanently deletes active and archived selections atomically, preserving children and rejecting stale versions', async () => {
    const store = new NotesStore(':memory:'), app = await createApp(store);
    try {
      const active = store.create({ title: 'active' }), archived = store.create({ title: 'archived', archived: true });
      const child = store.create({ title: 'survivor', parentId: active.id, links: [active.id, archived.id] });
      const candidates = [active, archived].map(n => ({ id: n.id, version: n.version }));
      const stale = await app.inject({ method: 'POST', url: '/api/notes/purge', payload: { candidates: [candidates[0], { ...candidates[1], version: 99 }] } });
      expect(stale.statusCode).toBe(409); expect(store.get(active.id).deletedAt).toBeNull(); expect(store.get(archived.id).archived).toBe(true);
      const ordinary = await app.inject({ method: 'POST', url: '/api/trash/clear', payload: { candidates } });
      expect(ordinary.statusCode).toBe(409);
      const result = await app.inject({ method: 'POST', url: '/api/notes/purge', payload: { candidates } });
      expect(result.statusCode).toBe(200); expect(result.json().count).toBe(2);
      for (const n of [active, archived]) {
        expect((await app.inject(`/api/notes/${n.id}`)).statusCode).toBe(404);
        expect((await app.inject(`/api/notes/${n.id}/history`)).statusCode).toBe(404);
      }
      expect(store.get(child.id)).toMatchObject({ parentId: null, links: [], title: 'survivor' });
      expect(store.listOrganization().order).not.toContain(active.id);
    } finally { await app.close(); store.close(); }
  });
  it('round trips all editable fields through HTTP, query, history, trash, restore and permanent delete', async () => {
    const store = new NotesStore(':memory:'), app = await createApp(store);
    const call = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload: object) => app.inject({ method, url, payload });
    try {
      const parent = store.create({ title: '父级' }), linked = store.create({ title: '关联' });
      const made = await call('POST', '/api/notes', { title: '中文 😀', content: '# Markdown', color: 'mint', tags: ['标签'], parentId: parent.id, links: [linked.id], starred: true, archived: false, knowledge: false, source: '来源' });
      expect(made.statusCode).toBe(200); const n = made.json();
      const updated = await call('PATCH', `/api/notes/${n.id}`, { expectedVersion: 1, patch: { content: '更新关键词', archived: true } });
      expect(updated.json()).toMatchObject({ title: '中文 😀', content: '更新关键词', version: 2, parentId: parent.id, tags: ['标签'], links: [linked.id], color: 'mint', starred: true, knowledge: false, source: '来源' });
      expect((await call('POST', '/api/notes/query', { status: 'archived', q: '关键词', tag: '标签' })).json().total).toBe(1);
      expect((await call('PATCH', `/api/notes/${n.id}`, { expectedVersion: 1, patch: { title: '过期' } })).statusCode).toBe(409);
      expect((await app.inject(`/api/notes/${n.id}/revision/1`)).json().content).toBe('# Markdown');
      expect((await call('DELETE', `/api/notes/${n.id}`, { expectedVersion: 2 })).statusCode).toBe(400);
      expect((await call('POST', `/api/notes/${n.id}/trash`, { expectedVersion: 2 })).statusCode).toBe(200);
      expect((await call('PATCH', `/api/notes/${n.id}`, { expectedVersion: 3, patch: { title: '不允许' } })).statusCode).toBe(400);
      expect((await call('POST', `/api/notes/${n.id}/restore`, { expectedVersion: 3 })).json()).toMatchObject({ deletedAt: null, archived: true });
      await call('POST', `/api/notes/${n.id}/trash`, { expectedVersion: 4 });
      expect((await call('DELETE', `/api/notes/${n.id}`, { expectedVersion: 5 })).statusCode).toBe(200);
      for (const suffix of ['', '/history', '/revision/1', '/export/md']) expect((await app.inject(`/api/notes/${n.id}${suffix}`)).statusCode).toBe(404);
      expect(store.list({ status: 'trash' }).total).toBe(0); expect(store.get(parent.id).title).toBe('父级');
    } finally { await app.close(); store.close(); }
  });
  it('allows ordinary edits when existing relations point to trash, but rejects new trash relations', () => {
    const s = new NotesStore(':memory:');
    try {
      const parent = s.create({ title: 'Parent' }), source = s.create({ title: 'Child', parentId: parent.id, links: [parent.id] });
      s.trash(parent.id, 1);
      expect(s.update(source.id, { title: 'Still editable' }, 1)).toMatchObject({ parentId: parent.id, links: [parent.id] });
      expect(() => s.create({ title: 'New', links: [parent.id] })).toThrow('回收站');
      const prior = s.get(source.id); s.purge(parent.id, 2);
      expect(s.get(source.id)).toMatchObject({ title: prior.title, parentId: null, links: [], version: prior.version + 1 });
      expect(() => s.update(source.id, { content: 'stale' }, prior.version)).toThrow('其他窗口');
    } finally { s.close(); }
  });
  it('removes notes, full history and auxiliary records across restart and empties more than one page atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-purge-')), path = join(dir, 'notes.db'); let s = new NotesStore(path);
    try {
      const notes = Array.from({ length: 105 }, (_, i) => s.create({ title: 'trash '+i }));
      s.setGraphPosition(notes[0].id, { x: 3, y: 4 });
      s.setPreference('desktopPins', [{ id: notes[0].id }]); s.setPreference('treeOrder', { root: notes.map(n => n.id), [notes[0].id]: [notes[1].id] });
      for (const n of notes) s.trash(n.id, 1);
      const preview = s.trashPreview(); expect(s.list({ status: 'trash', limit: 100 }).items).toHaveLength(100);
      s.clearTrash(preview.candidates); s.close(); s = new NotesStore(path);
      expect(s.list({ status: 'trash' }).total).toBe(0);
      expect(s.db.prepare('SELECT COUNT(*) AS n FROM revisions').get()!.n).toBe(0);
      expect(s.graphPositions()).toEqual({}); expect(s.preference('desktopPins', [])).toEqual([]); expect(s.preference('treeOrder', {})).toEqual({ root: [] });
      expect(s.db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
    } finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it.each(['/api/trash/clear', '/api/notes/purge'])('%s removes exclusive historical attachments, protects shared/history/draft references and retries failures', async route => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-purge-assets-')), s = new NotesStore(join(dir, 'notes.db')), assets = new Attachments(join(dir, 'assets'));
    const app = await createApp(s, { attachments: assets });
    try {
      const unique = await assets.importStream('unique.txt', Readable.from(['secret'])), shared = await assets.importStream('shared.txt', Readable.from(['shared'])), draft = await assets.importStream('draft.txt', Readable.from(['draft']));
      const victim = s.create({ title: 'Victim', content: [unique.src, shared.src, draft.src].join('\n') }); s.update(victim.id, { content: '' }, 1);
      const survivor = s.create({ title: 'Survivor', content: shared.src }); s.update(survivor.id, { content: '历史仍引用附件' }, 1);
      if (route === '/api/trash/clear') s.trash(victim.id, 2);
      const result = (await app.inject({ method: 'POST', url: route, payload: { candidates: [{ id: victim.id, version: s.get(victim.id).version }], protectedAssets: [draft.id] } })).json();
      expect(result.attachments).toMatchObject({ removed: 1, retained: 2, pending: 1 });
      expect(existsSync(join(assets.root, unique.id))).toBe(false); expect(existsSync(join(assets.root, shared.id))).toBe(true); expect(existsSync(join(assets.root, draft.id))).toBe(true);
      expect((await app.inject('/api/assets/'+unique.id+'/content')).statusCode).toBe(404);
      expect(s.cleanupPurgedAssets(() => { throw new Error('locked'); }).failed).toEqual([draft.id]);
      expect(s.preference('pendingAssetCleanup', [])).toEqual([draft.id]);
      const retry = (await app.inject({ method: 'POST', url: '/api/trash/clear', payload: { candidates: [] } })).json();
      expect(retry.attachments).toMatchObject({ removed: 1, pending: 0 }); expect(existsSync(join(assets.root, draft.id))).toBe(false);
      expect(existsSync(join(assets.root, shared.id))).toBe(true);
    } finally { await app.close(); s.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('does not partially delete when a candidate was restored, duplicated or modified', () => {
    const s = new NotesStore(':memory:');
    try {
      const a = s.create({ title: 'A' }), b = s.create({ title: 'B' }); s.trash(a.id, 1); s.trash(b.id, 1);
      const snapshot = s.trashPreview(); s.restore(b.id, 2);
      expect(() => s.clearTrash(snapshot.candidates)).toThrow('变化'); expect(s.get(a.id).deletedAt).toBeTruthy(); expect(s.history(a.id)).toHaveLength(2);
      expect(() => s.clearTrash([{ id: a.id, version: 2 }, { id: a.id, version: 2 }])).toThrow('重复'); expect(s.get(a.id)).toBeTruthy();
    } finally { s.close(); }
  });
});
