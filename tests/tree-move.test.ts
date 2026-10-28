import { afterEach, expect, it } from 'vitest';
import { NotesStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const stores: NotesStore[] = [];
const make = (path = ':memory:') => { const s = new NotesStore(path); stores.push(s); return s; };
afterEach(() => stores.splice(0).forEach(s => s.close()));
it('moves a complete subtree without modifying content, child revisions or cross-links', () => {
  const s = make(), a = s.create({ title: 'a', content: 'keep', tags: ['tag'] }), child = s.create({ title: 'child', parentId: a.id }), b = s.create({ title: 'b' });
  s.update(a.id, { links: [b.id] }, 1);
  const moved = s.move(a.id, { expectedVersion: 2, targetId: b.id, targetVersion: 1, placement: 'inside' });
  expect(moved.parentId).toBe(b.id); expect(moved.content).toBe('keep'); expect(moved.tags).toEqual(['tag']); expect(moved.links).toEqual([b.id]);
  expect(s.get(child.id).parentId).toBe(a.id); expect(s.get(child.id).version).toBe(1);
  expect(s.history(a.id)[0].action).toBe('move');
});
it('persists before/after sibling positions and root moves across reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'moki-tree-'));
  try {
    const s = make(join(dir, 'notes.db')), root = s.create({ title: 'root' }), a = s.create({ title: 'a', parentId: root.id }), b = s.create({ title: 'b', parentId: root.id }), c = s.create({ title: 'c' });
    s.move(c.id, { expectedVersion: 1, targetId: b.id, targetVersion: 1, placement: 'before' });
    expect(s.tree().filter(n => n.parentId === root.id).map(n => n.id)).toEqual([a.id, c.id, b.id]);
    s.move(a.id, { expectedVersion: 1, targetId: b.id, targetVersion: 1, placement: 'after' });
    expect(s.tree().filter(n => n.parentId === root.id).map(n => n.id)).toEqual([c.id, b.id, a.id]);
    s.move(c.id, { expectedVersion: 2, targetId: null, placement: 'inside' });
    stores.splice(0).forEach(x => x.close());
    const reopened = make(join(dir, 'notes.db'));
    expect(reopened.tree().filter(n => n.parentId === root.id).map(n => n.id)).toEqual([b.id, a.id]);
    expect(reopened.get(c.id).parentId).toBeNull();
  } finally { stores.splice(0).forEach(s => s.close()); rmSync(dir, { recursive: true, force: true }); }
});
it('rejects cycles, inactive targets and stale versions without partial ordering writes', () => {
  const s = make(), a = s.create({ title: 'a' }), child = s.create({ title: 'child', parentId: a.id }), b = s.create({ title: 'b' });
  const move = (targetId: string, targetVersion = 1) => s.move(a.id, { expectedVersion: 1, targetId, targetVersion, placement: 'inside' });
  expect(() => move(child.id)).toThrow('子节点'); expect(() => move(a.id)).toThrow('自身');
  s.update(b.id, { title: 'updated' }, 1); expect(() => move(b.id)).toThrow('目标节点');
  s.update(b.id, { archived: true }, 2); expect(() => move(b.id, 3)).toThrow('目标节点');
  expect(s.get(a.id).version).toBe(1); expect(s.preference('treeOrder', {})).toEqual({});
  s.update(a.id, { content: 'Agent changed' }, 1);
  expect(() => s.move(a.id, { expectedVersion: 1, targetId: null, placement: 'inside' })).toThrow('其他窗口');
  expect(s.get(a.id).content).toBe('Agent changed');
});
it('validates HTTP move inputs and supports nodes whose unrelated links are in trash', async () => {
  const s = make(), linked = s.create({ title: 'linked' }), a = s.create({ title: 'a', links: [linked.id] }), b = s.create({ title: 'b' });
  s.trash(linked.id, 1); const app = await createApp(s);
  try {
    expect((await app.inject({ method: 'POST', url: `/api/notes/${a.id}/move`, payload: { expectedVersion: 1, targetId: b.id, placement: 'inside' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/notes/${a.id}/move`, payload: { expectedVersion: 1, targetId: b.id, targetVersion: 1, placement: 'inside' } })).statusCode).toBe(200);
    expect(s.get(a.id).links).toEqual([linked.id]);
    expect((await app.inject({ method: 'POST', url: `/api/notes/${a.id}/move`, payload: { expectedVersion: 1, targetId: null, placement: 'inside' } })).statusCode).toBe(409);
  } finally { await app.close(); }
});
