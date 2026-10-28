import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';

// Import, change view and remove are deliberate operations. They should not
// merge with each other or with nearby typing in ProseMirror's 500 ms group.
export function resourceEdit(editor: Editor, action: () => void) {
  if (editor.isDestroyed || !editor.isEditable) return;
  editor.view.dispatch(closeHistory(editor.state.tr));
  action();
  if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr));
}
