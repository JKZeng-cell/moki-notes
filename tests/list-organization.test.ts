import { afterEach, expect, it } from 'vitest';
import { NotesStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import type { ListCommand } from '../src/shared/list-organization.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const stores: NotesStore[] = [];
const make = (path = ':memory:') => { const s = new NotesStore(path); stores.push(s); return s; };
const act = (s: NotesStore, command: ListCommand) => s.organizeList({ ...command, expectedVersion: s.listOrganization().version });
const ids = (s: NotesStore) => s.list({ sort: 'manual' }, true).items.map(n => n.id);
afterEach(() => stores.splice(0).forEach(s => s.close()));

it('keeps manual list order independent of stars, edits, parentage and new notes', () => {
  const s = make(), root = s.create({ title: 'root', starred: true }), child = s.create({ title: 'child', parentId: root.id }), other = s.create({ title: 'other' });
  expect(ids(s)).toEqual([other.id, child.id, root.id]);
  act(s, { kind: 'move', noteIds: [root.id], targetId: child.id, placement: 'before', groupId: null });
  expect(ids(s)).toEqual([other.id, root.id, child.id]);
  s.update(child.id, { title: 'edited' }, 1);
  s.move(child.id, { targetId: null, placement: 'inside', expectedVersion: 2 });
  expect(ids(s)).toEqual([other.id, root.id, child.id]);
  const fresh = s.create({ parentId: root.id });
  expect(ids(s)[0]).toBe(fresh.id); expect(s.listOrganization().membership[fresh.id]).toBeUndefined();
  expect(s.get(root.id).version).toBe(1);
});
it('moves into empty/collapsed groups, preserves relationships, and removes only the group', () => {
  const s = make(), a = s.create({ title: 'a' }), b = s.create({ title: 'b', parentId: a.id, links: [a.id] });
  const group = act(s, { kind: 'create', name: '工作' }).groups[0];
  act(s, { kind: 'collapse', groupId: group.id, collapsed: true });
  act(s, { kind: 'move', noteIds: [b.id], groupId: group.id, targetId: null, placement: 'before' });
  expect(s.listOrganization().groups[0].collapsed).toBe(false);
  expect(ids(s)).toEqual([a.id, b.id]);
  expect(s.get(b.id)).toMatchObject({ parentId: a.id, links: [a.id], version: 1 });
  act(s, { kind: 'remove', groupId: group.id });
  expect(s.listOrganization().membership).toEqual({}); expect(ids(s)).toEqual([b.id, a.id]);
  expect(s.history(b.id)).toHaveLength(1);
});
it('paginates after collapse and reveals matching notes without changing collapsed state', () => {
  const s = make(), group = act(s, { kind: 'create', name: '收起' }).groups[0];
  const hidden = Array.from({ length: 105 }, (_, i) => s.create({ title: `hidden ${i}`, tags: ['needle'] }).id);
  act(s, { kind: 'move', noteIds: hidden, groupId: group.id, targetId: null, placement: 'before' });
  const top = s.create({ title: 'top' });
  act(s, { kind: 'collapse', groupId: group.id, collapsed: true });
  const page = s.list({ sort: 'manual', limit: 100 }, true);
  expect(page.total).toBe(106); expect(page.visibleTotal).toBe(1); expect(page.items[0].id).toBe(top.id);
  expect(page.groupCounts[group.id]).toBe(105);
  expect(s.list({ q: 'hidden', limit: 100 }, true).items).toHaveLength(100);
  expect(s.list({ tag: 'needle', offset: 100 }, true).items).toHaveLength(5);
  expect(s.listOrganization().groups[0].collapsed).toBe(true);
});
it('rejects stale writes, wrong anchors and duplicate names without partial changes', () => {
  const s = make(), a = s.create({}), b = s.create({});
  const old = s.listOrganization();
  const group = act(s, { kind: 'create', name: 'work' }).groups[0];
  expect(() => s.organizeList({ kind: 'create', name: 'stale', expectedVersion: old.version })).toThrow('其他窗口');
  expect(() => act(s, { kind: 'create', name: 'WORK' })).toThrow('同名');
  const before = s.listOrganization();
  expect(() => act(s, { kind: 'move', noteIds: [a.id], groupId: group.id, targetId: b.id, placement: 'before' })).toThrow('目标位置');
  expect(s.listOrganization()).toEqual(before);
});
it('preserves membership during trash/restore, purges references, and keeps the group', () => {
  const s = make(), note = s.create({}), group = act(s, { kind: 'create', name: 'keep' }).groups[0];
  act(s, { kind: 'move', noteIds: [note.id], groupId: group.id, targetId: null, placement: 'before' });
  s.trash(note.id, 1); expect(s.list({ sort: 'manual' }, true).total).toBe(0);
  expect(() => act(s, { kind: 'move', noteIds: [note.id], groupId: null, targetId: null, placement: 'before' })).toThrow('恢复');
  s.restore(note.id, 2); expect(s.listOrganization().membership[note.id]).toBe(group.id);
  s.trash(note.id, 3); s.purge(note.id, 4);
  expect(s.listOrganization().membership).toEqual({}); expect(s.listOrganization().order).toEqual([]); expect(s.listOrganization().groups).toHaveLength(1);
});
it('persists list organization across reopen and validates API input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'moki-list-'));
  try {
    const s = make(join(dir, 'list.db')), n = s.create({}), g = act(s, { kind: 'create', name: '持久化' }).groups[0];
    act(s, { kind: 'move', noteIds: [n.id], groupId: g.id, targetId: null, placement: 'before' });
    const second = act(s, { kind: 'create', name: '第二组' }).groups[1];
    act(s, { kind: 'reorder-group', groupId: second.id, targetId: g.id, placement: 'before' });
    stores.splice(0).forEach(s => s.close()); const reopened = make(join(dir, 'list.db'));
    expect(reopened.listOrganization().membership[n.id]).toBe(g.id);
    expect(reopened.listOrganization().groups.map(group => group.id)).toEqual([second.id, g.id]);
    const app = await createApp(reopened);
    try { expect((await app.inject({ method: 'POST', url: '/api/list/organize', payload: { kind: 'create', name: '' } })).statusCode).toBe(400);
      const response = await app.inject({ method: 'POST', url: '/api/list/query', payload: { sort: 'manual' } }); expect(response.statusCode).toBe(200); expect(response.json().groupCounts[g.id]).toBe(1); }
    finally { await app.close(); }
  } finally { stores.splice(0).forEach(s => s.close()); rmSync(dir, { recursive: true, force: true }); }
});

it('reorders whole groups in both directions without changing notes, membership, collapse or ungrouped priority', () => {
  const s = make(), a = act(s, { kind: 'create', name: 'A' }).groups[0], b = act(s, { kind: 'create', name: 'B' }).groups[1], c = act(s, { kind: 'create', name: 'C' }).groups[2];
  const n1 = s.create({ title: 'first' }), n2 = s.create({ title: 'second', parentId: n1.id }), top = s.create({ title: 'ungrouped' });
  act(s, { kind: 'move', noteIds: [n1.id], groupId: a.id, targetId: null, placement: 'before' });
  act(s, { kind: 'move', noteIds: [n2.id], groupId: b.id, targetId: null, placement: 'before' });
  act(s, { kind: 'collapse', groupId: c.id, collapsed: true });
  const before = s.listOrganization();
  act(s, { kind: 'reorder-group', groupId: b.id, targetId: a.id, placement: 'before' });
  expect(s.listOrganization().groups.map(g => g.id)).toEqual([b.id, a.id, c.id]);
  expect(ids(s)).toEqual([top.id, n2.id, n1.id]);
  act(s, { kind: 'reorder-group', groupId: b.id, targetId: c.id, placement: 'after' });
  const after = s.listOrganization();
  expect(after.groups.map(g => g.id)).toEqual([a.id, c.id, b.id]);
  expect(after.groups[1].collapsed).toBe(true);
  expect(after.membership).toEqual(before.membership); expect(after.order).toEqual(before.order);
  expect(s.get(n2.id)).toMatchObject({ parentId: n1.id, version: 1 });
});

it('rejects stale, self and missing group sort targets atomically', () => {
  const s = make(), a = act(s, { kind: 'create', name: 'A' }).groups[0], b = act(s, { kind: 'create', name: 'B' }).groups[1];
  const before = s.listOrganization();
  expect(() => s.organizeList({ kind: 'reorder-group', groupId: a.id, targetId: b.id, placement: 'after', expectedVersion: before.version - 1 })).toThrow('其他窗口');
  expect(() => act(s, { kind: 'reorder-group', groupId: a.id, targetId: a.id, placement: 'after' })).toThrow('自身');
  const missing = s.create({}).id;
  const snapshot = s.listOrganization();
  expect(() => act(s, { kind: 'reorder-group', groupId: a.id, targetId: missing, placement: 'before' })).toThrow('目标分组');
  expect(() => act(s, { kind: 'reorder-group', groupId: missing, targetId: a.id, placement: 'before' })).toThrow('分组已不存在');
  expect(s.listOrganization()).toEqual(snapshot);
});
