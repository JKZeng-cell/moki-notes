import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotesStore } from '../src/server/store.js';
import { demoNotes, demoReadingOrder, demoGroupName } from '../src/server/demo-content.js';
import { emptyListOrganization } from '../src/shared/list-organization.js';

const stores: NotesStore[] = [], dirs: string[] = [];
const open = (path = ':memory:') => { const store = new NotesStore(path); stores.push(store); return store; };
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
describe('built-in demo knowledge tree', () => {
  it('seeds an expanded guide group in reading order, leaving new notes at the top', () => {
    const s = open(); s.ensureDemo();
    const state = s.listOrganization(), group = state.groups[0];
    expect(group).toMatchObject({ name: demoGroupName, collapsed: false });
    expect(new Set(demoReadingOrder)).toEqual(new Set(demoNotes.map(n => n.key)));
    const titles = demoReadingOrder.map(key => demoNotes.find(n => n.key === key)!.title);
    expect(s.list({ sort: 'manual' }, true).items.map(n => n.title)).toEqual(titles);
    expect(Object.values(state.membership)).toEqual(demoNotes.map(() => group.id));
    const fresh = s.create({ title: '我的灵感' });
    expect(s.list({ sort: 'manual' }, true).items[0].id).toBe(fresh.id);
    expect(s.listOrganization().membership[fresh.id]).toBeUndefined();
  });
  it('migrates legacy demos by creation history without rewriting notes or existing groups', () => {
    const s = open(), seeded = s.ensureDemo();
    s.setPreference('builtinDemo', { rootId: seeded.rootId, version: 1 });
    s.setPreference('listOrganization', emptyListOrganization());
    const renamed = s.update(seeded.rootId, { title: '我改过的首页', content: '我的笔记' }, 1);
    const lookalike = s.create({ title: demoNotes[2].title, tags: ['内置演示'], source: 'MOKI便签 · 内置演示（可编辑）' });
    const groupedDemo = s.tree().find(n => n.title === demoNotes[1].title)!;
    const groupState = s.organizeList({ kind: 'create', name: demoGroupName, expectedVersion: 0 });
    s.organizeList({ kind: 'move', noteIds: [groupedDemo.id], groupId: groupState.groups[0].id, targetId: null, placement: 'before', expectedVersion: groupState.version });
    const deleted = s.tree().find(n => n.title === demoNotes[5].title)!;
    s.trash(deleted.id, 1);
    const before = s.db.prepare('SELECT * FROM notes ORDER BY id').all();
    const history = s.db.prepare('SELECT * FROM revisions ORDER BY note_id,version').all();
    s.ensureDemo(); const next = s.listOrganization();
    expect(next.groups.map(g => g.name)).toEqual([demoGroupName, `${demoGroupName}（内置）`]);
    expect(next.membership[groupedDemo.id]).toBe(groupState.groups[0].id);
    expect(next.membership[renamed.id]).toBe(next.groups[1].id);
    expect(next.membership[lookalike.id]).toBeUndefined(); expect(next.membership[deleted.id]).toBeUndefined();
    expect(s.db.prepare('SELECT * FROM notes ORDER BY id').all()).toEqual(before);
    expect(s.db.prepare('SELECT * FROM revisions ORDER BY note_id,version').all()).toEqual(history);
    const sorted = next.order.filter(id => next.membership[id] === next.groups[1].id).map(id => s.get(id).title);
    expect(sorted).toEqual(demoNotes.filter((_, i) => i !== 1 && i !== 5).map((n, i) => i === 0 ? renamed.title : n.title));
  });
  it('does not reset subsequent guide sorting, collapsing, renaming or deletion', () => {
    const s = open(); s.ensureDemo(); let state = s.listOrganization(); const id = state.groups[0].id;
    state = s.organizeList({ kind: 'rename', groupId: id, name: '我自己的教程', expectedVersion: state.version });
    state = s.organizeList({ kind: 'move', noteIds: [state.order.at(-1)!], groupId: id, targetId: state.order[0], placement: 'before', expectedVersion: state.version });
    state = s.organizeList({ kind: 'collapse', groupId: id, collapsed: true, expectedVersion: state.version });
    s.ensureDemo(); expect(s.listOrganization()).toEqual(state);
    state = s.organizeList({ kind: 'remove', groupId: id, expectedVersion: state.version });
    s.ensureDemo(); expect(s.listOrganization()).toEqual(state);
  });
  it('installs a connected, searchable tree with local illustration assets and initial history', () => {
    const s = open(), result = s.ensureDemo(), nodes = s.tree();
    expect(result.installed).toBe(true);
    expect(nodes).toHaveLength(demoNotes.length);
    expect(nodes.filter(n => !n.parentId).map(n => n.id)).toEqual([result.rootId]);
    expect(nodes.filter(n => n.links.length).length).toBeGreaterThan(3);
    for (const n of nodes) {
      expect(n.knowledge).toBe(true);
      expect(s.history(n.id)).toHaveLength(1);
      const seen = new Set<string>(); let current = n;
      while (current.parentId) { expect(seen.has(current.id)).toBe(false); seen.add(current.id); current = nodes.find(x => x.id === current.parentId)!; }
      expect(current.id).toBe(result.rootId);
      for (const link of n.links) expect(nodes.some(x => x.id === link)).toBe(true);
    }
    const images = new Set(demoNotes.flatMap(n => [...n.content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1])));
    expect(images.size).toBe(4);
    for (const src of images) {
      expect(src).toMatch(/^\/demo\/[a-z]+\.svg$/);
      expect(readFileSync(new URL(`../public${src}`, import.meta.url), 'utf8')).toContain('<svg');
    }
    const memory = nodes.find(n => n.title.includes('项目记忆示例'))!;
    expect(s.context('项目记忆示例', result.rootId, 3000).sources.some(n => n.id === memory.id)).toBe(true);
  });
  it('preserves existing data/preferences and never restores edited or deleted demo notes on restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-demo-')); dirs.push(dir);
    const path = join(dir, 'notes.db'), s = open(path);
    const own = s.create({ title: '我的真实项目', content: '必须原样保留' });
    s.setPreference('treeOrder', { root: [own.id] });
    s.setAutoSave({ enabled: false, delayMs: 3000 });
    const installed = s.ensureDemo(), root = s.get(installed.rootId);
    s.update(root.id, { content: '我修改的演示首页' }, root.version);
    const leaf = s.tree().find(n => n.title.startsWith('😊'))!;
    s.trash(leaf.id, leaf.version); s.purge(leaf.id, leaf.version + 1);
    const reopened = open(path), second = reopened.ensureDemo();
    expect(second).toEqual({ ...installed, installed: false });
    expect(reopened.get(own.id)).toEqual(own);
    expect(reopened.get(root.id).content).toBe('我修改的演示首页');
    expect(() => reopened.get(leaf.id)).toThrow();
    expect(reopened.tree()).toHaveLength(demoNotes.length);
    expect(reopened.preference('treeOrder', {})).toEqual({ root: [own.id] });
    expect(reopened.autoSave()).toEqual({ enabled: false, delayMs: 3000 });
  });
  it('rolls back partial installation and its history/marker if an insert fails', () => {
    const s = open(), own = s.create({ title: '原有内容' });
    s.db.exec(`CREATE TRIGGER fail_demo BEFORE INSERT ON notes WHEN json_extract(NEW.json, '$.title') LIKE 'Aa%' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
    expect(() => s.ensureDemo()).toThrow('test failure');
    expect(s.tree().map(n => n.id)).toEqual([own.id]);
    expect(s.preference('builtinDemo', null)).toBeNull();
    expect(s.db.prepare('SELECT COUNT(*) AS count FROM revisions').get()!.count).toBe(1);
    s.db.exec('DROP TRIGGER fail_demo');
    expect(s.ensureDemo().installed).toBe(true);
  });
});
