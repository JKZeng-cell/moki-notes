import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotesStore } from '../src/server/store.js';
import { addTags } from '../src/shared/tags.js';
import { noteReferences, removeNoteReferences } from '../src/shared/note-references.js';
import { resourceMarkdown, type ResourceData } from '../src/shared/resources.js';
import { columnsMarkdown } from '../src/shared/columns.js';
import { createApp } from '../src/server/app.js';

describe('related notes and tag history', () => {
  it('serves local tag history and bounded resolution with invalid input rejected', async () => {
    const store = new NotesStore(':memory:'), app = await createApp(store);
    try {
      const note = store.create({ title: 'API', tags: ['接口'] });
      expect((await app.inject({ method: 'GET', url: '/api/tags' })).json()).toEqual([{ tag: '接口', count: 1 }]);
      expect((await app.inject({ method: 'POST', url: '/api/notes/resolve', payload: { ids: [note.id] } })).json()).toEqual([expect.objectContaining({ id: note.id, title: 'API' })]);
      for (const ids of [['bad'], Array(201).fill(note.id)]) expect((await app.inject({ method: 'POST', url: '/api/notes/resolve', payload: { ids } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'GET', url: '/api/tags', headers: { origin: 'https://external.test' } })).statusCode).toBe(403);
    } finally { await app.close(); store.close(); }
  });
  it('normalizes pasted tag lists, deduplicates and enforces storage limits', () => {
    expect(addTags(['项目'], ' #设计，项目; Markdown\n😀； ')).toEqual(['项目', '设计', 'Markdown', '😀']);
    expect(() => addTags([], '字'.repeat(61))).toThrow('60');
    expect(() => addTags(Array.from({ length: 40 }, (_, i) => String(i)), 'extra')).toThrow('40');
  });
  it('retains historical tags through removal, trash, purge and reopening without recording rejected changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-tags-')), path = join(dir, 'notes.db'); let store = new NotesStore(path);
    try {
      const n = store.create({ title: 'A', tags: ['历史', '共有'] });
      store.create({ title: 'B', tags: ['共有'], archived: true });
      // Simulate a database created before tag history was introduced.
      store.setPreference('tagHistory', []);
      const updated = store.update(n.id, { tags: [] }, n.version);
      expect(() => store.update(n.id, { tags: ['不应记录'] }, n.version)).toThrow('其他窗口');
      const trashed = store.trash(n.id, updated.version); store.purge(n.id, trashed.version);
      store.close(); store = new NotesStore(path);
      expect(store.tagHistory()).toEqual([{ tag: '历史', count: 0 }, { tag: '共有', count: 1 }]);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('resolves duplicates and missing or trashed targets while protecting concurrent reverse-link edits', () => {
    const store = new NotesStore(':memory:');
    try {
      const target = store.create({ title: 'Target' }), other = store.create({ title: 'Other' });
      const source = store.create({ title: 'Source', content: '正文', links: [target.id, other.id] });
      const snapshot = store.backlinks(target.id)[0];
      store.update(source.id, { content: '新正文' }, source.version);
      expect(() => store.update(source.id, { links: snapshot.links.filter(id => id !== target.id) }, snapshot.version)).toThrow('其他窗口');
      const latest = store.get(source.id); store.update(source.id, { links: latest.links.filter(id => id !== target.id) }, latest.version);
      expect(store.get(source.id)).toMatchObject({ content: '新正文', links: [other.id] }); expect(store.get(target.id).deletedAt).toBeNull();
      store.trash(target.id, target.version);
      const missing = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      expect(store.resolveNotes([target.id, missing, target.id])).toEqual([expect.objectContaining({ id: target.id, deletedAt: expect.any(String) }), { id: missing, missing: true }]);
    } finally { store.close(); }
  });
  it('removes every actual body reference while preserving columns, code examples and other Markdown', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const resource: ResourceData = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', kind: 'note', src: '/?note='+id, title: '正文附件', view: 'card' };
    const md = resourceMarkdown(resource), example = '```md\n'+md+'\n```', ordinary = '[普通链接](/?note='+id+')';
    const content = columnsMarkdown([md+'\n\n保留 **粗体**', example+'\n\n'+ordinary])+'\n\n'+md;
    expect(noteReferences(content).map(ref => ref.id)).toEqual([id, id]);
    const removed = removeNoteReferences(content, id);
    expect(noteReferences(removed)).toHaveLength(0); expect(removed).toContain(example); expect(removed).toContain(ordinary); expect(removed).toContain(':::moki-columns'); expect(removed).toContain('保留 **粗体**');
    expect(removeNoteReferences(content, 'absent')).toBe(content);
  });
});
