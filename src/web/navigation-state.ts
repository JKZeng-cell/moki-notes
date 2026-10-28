import type { Note } from '../shared/model.js';

export type NavigationView = 'active' | 'starred' | 'knowledge' | 'archived' | 'trash';
// Search and pagination do not change the document the user was reading.
// A note moved out of its sidebar category must not be restored there.
export function canRestoreNote(note: Pick<Note, 'deletedAt' | 'archived' | 'starred' | 'tags'>, view: NavigationView, tag = '') {
  if (view === 'trash') return !!note.deletedAt;
  if (note.deletedAt || note.archived !== (view === 'archived')) return false;
  if (view === 'starred' && !note.starred) return false;
  return !tag || note.tags.includes(tag);
}
