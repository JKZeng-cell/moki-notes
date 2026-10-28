import type { NoteSummary } from '../shared/model.js';

export function searchNoteChoices(nodes: NoteSummary[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return nodes.filter(note => terms.every(term => `${note.title} ${note.tags.join(' ')}`.toLocaleLowerCase().includes(term.replace(/^#/, ''))));
}
export function hierarchyChoices(nodes: NoteSummary[], id: string, mode: 'parent' | 'child') {
  const excluded = new Set([id]);
  if (mode === 'parent') {
    const children = new Map<string, string[]>();
    for (const note of nodes) if (note.parentId) children.set(note.parentId, [...(children.get(note.parentId) ?? []), note.id]);
    const stack = [id];
    while (stack.length) for (const child of children.get(stack.pop()!) ?? []) if (!excluded.has(child)) { excluded.add(child); stack.push(child); }
  } else {
    const parents = new Map(nodes.map(note => [note.id, note.parentId])); let parent = parents.get(id);
    while (parent && !excluded.has(parent)) { excluded.add(parent); parent = parents.get(parent); }
  }
  return nodes.filter(note => !excluded.has(note.id) && !note.deletedAt && !note.archived && (mode !== 'child' || note.parentId !== id));
}
