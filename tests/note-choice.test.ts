import { expect, it } from 'vitest';
import type { NoteSummary } from '../src/shared/model.js';
import { hierarchyChoices, searchNoteChoices } from '../src/web/note-choice.js';
const note = (id: string, parentId: string | null = null, extra: Partial<NoteSummary> = {}) => ({ id, title: id, parentId, tags: [], archived: false, deletedAt: null, ...extra } as NoteSummary);
it('searches titles and tags case insensitively with multiple terms and does not truncate later matches', () => {
  const notes = Array.from({ length: 120 }, (_, i) => note(String(i), null, { title: `资料 ${i}` }));
  notes.push(note('target', null, { title: '项目 Markdown 😀', tags: ['设计'] }));
  expect(searchNoteChoices(notes, '  markdown #设计  ').map(n => n.id)).toEqual(['target']);
  expect(searchNoteChoices(notes, '资料 119').map(n => n.id)).toEqual(['119']);
  expect(searchNoteChoices(notes, '不存在')).toEqual([]); expect(searchNoteChoices(notes, ' ')).toHaveLength(121);
});
it('excludes self and the complete descendant chain from parent choices, and ancestors/current children from child choices', () => {
  const nodes = [note('root'), note('current', 'root'), note('child', 'current'), note('deep', 'child'), note('sibling', 'root'), note('archived', null, { archived: true }), note('trash', null, { deletedAt: 'date' })];
  expect(hierarchyChoices(nodes, 'current', 'parent').map(n => n.id)).toEqual(['root', 'sibling']);
  expect(hierarchyChoices(nodes, 'current', 'child').map(n => n.id)).toEqual(['deep', 'sibling']);
  expect(nodes[2].parentId).toBe('current');
});
it('bounds traversal even if imported hierarchy data contains cycles', () => {
  const nodes = [note('a', 'b'), note('b', 'a'), note('free')];
  expect(hierarchyChoices(nodes, 'a', 'parent').map(n => n.id)).toEqual(['free']);
  expect(hierarchyChoices(nodes, 'a', 'child').map(n => n.id)).toEqual(['free']);
});
