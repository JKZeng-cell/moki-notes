import type { Editor } from '@tiptap/core';
import { CellSelection, TableMap, selectedRect } from '@tiptap/pm/tables';
import { closeHistory } from '@tiptap/pm/history';
import type { Transaction } from '@tiptap/pm/state';
export type TableAxis = 'row' | 'column';
function syncTableHeader(tr: Transaction, pos: number) {
  const table = tr.doc.nodeAt(pos);
  if (table?.type.spec.tableRole !== 'table') return;
  // Markdown always renders the first row as the header. Keep live editing in
  // sync in the same transaction, so insertion/deletion and its undo are atomic.
  table.forEach((row, rowOffset, index) => row.forEach((cell, cellOffset) => {
    const type = tr.doc.type.schema.nodes[index === 0 ? 'tableHeader' : 'tableCell'];
    if (cell.type !== type) tr.setNodeMarkup(pos + 2 + rowOffset + cellOffset, type, cell.attrs, cell.marks);
  }));
}
export function tableAt(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.spec.tableRole !== 'table') return null;
  return { node, pos, start: pos + 1, map: TableMap.get(node) };
}
export function selectTableAxis(editor: Editor, pos: number, axis: TableAxis, from: number, to = from, separateHistory = false) {
  const table = tableAt(editor, pos); if (!table) return false;
  const max = (axis === 'row' ? table.map.height : table.map.width) - 1;
  from = Math.max(0, Math.min(from, max)); to = Math.max(0, Math.min(to, max));
  const cell = (i: number) => editor.state.doc.resolve(table.start + table.map.map[axis === 'row' ? i * table.map.width : i]);
  const selection = axis === 'row' ? CellSelection.rowSelection(cell(from), cell(to)) : CellSelection.colSelection(cell(from), cell(to));
  let tr = editor.state.tr.setSelection(selection); if (separateHistory) tr = closeHistory(tr);
  editor.view.dispatch(tr); return true;
}
export function selectedAxisRange(editor: Editor, pos: number, axis: TableAxis, index: number) {
  const single = { from: index, to: index };
  const selection = editor.state.selection;
  if (!(selection instanceof CellSelection)) return single;
  const rect = selectedRect(editor.state);
  if (rect.tableStart !== pos + 1 || axis === 'row' && selection.isColSelection() && !selection.isRowSelection() || axis === 'column' && selection.isRowSelection() && !selection.isColSelection()) return single;
  const from = axis === 'row' ? rect.top : rect.left, to = (axis === 'row' ? rect.bottom : rect.right) - 1;
  return index >= from && index <= to ? { from, to } : single;
}
export function deleteTableAxis(editor: Editor, pos: number, axis: TableAxis, from: number, to = from) {
  if (!editor.isEditable) return false;
  const table = tableAt(editor, pos); if (!table) return false;
  if (!selectTableAxis(editor, pos, axis, from, to, true)) return false;
  const count = axis === 'row' ? table.map.height : table.map.width;
  const result = Math.abs(to - from) + 1 >= count ? editor.commands.deleteTable() : axis === 'row'
    ? editor.chain().deleteRow().command(({ tr }) => { syncTableHeader(tr, pos); return true; }).run()
    : editor.commands.deleteColumn();
  editor.view.focus(); return result;
}
export function insertTableAxis(editor: Editor, pos: number, axis: TableAxis, boundary: number) {
  if (!editor.isEditable) return false;
  const table = tableAt(editor, pos); if (!table) return false;
  const count = axis === 'row' ? table.map.height : table.map.width;
  const index = Math.max(0, Math.min(boundary, count - 1)), after = boundary >= count;
  const cell = table.start + table.map.map[axis === 'row' ? index * table.map.width : index];
  editor.commands.setTextSelection(cell + 1); editor.view.dispatch(closeHistory(editor.state.tr));
  const chain = editor.chain();
  const result = axis === 'row'
    ? (after ? chain.addRowAfter() : chain.addRowBefore()).command(({ tr }) => { syncTableHeader(tr, pos); return true; }).run()
    : after ? editor.commands.addColumnAfter() : editor.commands.addColumnBefore();
  editor.view.focus(); return result;
}
