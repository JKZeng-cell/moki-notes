import { expect, it } from 'vitest';
import { canRestoreNote } from '../src/web/navigation-state.js';

const note = { deletedAt: null, archived: false, starred: true, tags: ['项目'] };
it('retains valid notes independently of search and paging, but rejects notes moved out of a category', () => {
  expect(canRestoreNote(note, 'active')).toBe(true);
  expect(canRestoreNote(note, 'starred')).toBe(true);
  expect(canRestoreNote({ ...note, starred: false }, 'starred')).toBe(false);
  expect(canRestoreNote({ ...note, archived: true }, 'active')).toBe(false);
  expect(canRestoreNote({ ...note, archived: true }, 'archived')).toBe(true);
  expect(canRestoreNote(note, 'archived')).toBe(false);
});
it('restores trash only while deleted and tag pages only while membership exists', () => {
  expect(canRestoreNote(note, 'trash')).toBe(false);
  for (const view of ['active', 'starred', 'archived'] as const) expect(canRestoreNote({ ...note, deletedAt: new Date().toISOString() }, view)).toBe(false);
  expect(canRestoreNote({ ...note, deletedAt: new Date().toISOString() }, 'trash')).toBe(true);
  expect(canRestoreNote(note, 'active', '项目')).toBe(true);
  expect(canRestoreNote({ ...note, tags: [] }, 'active', '项目')).toBe(false);
});
