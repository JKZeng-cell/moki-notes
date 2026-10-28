// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { richExtensions } from '../src/web/rich-extensions.js';
import { deleteTableAxis, insertTableAxis, selectedAxisRange, selectTableAxis, tableAt } from '../src/web/table-operations.js';
const editors: Editor[] = [];
function make() { const e = new Editor({ extensions: richExtensions(), content: '| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n| a3 | b3 | c3 |', contentType: 'markdown' }); editors.push(e); return e; }
afterEach(() => editors.splice(0).forEach(e => e.destroy()));
function expectHeader(e: Editor) {
  const rows = tableAt(e, 0)!.node;
  rows.forEach((row, _, index) => row.forEach(cell => expect(cell.type.name).toBe(index === 0 ? 'tableHeader' : 'tableCell')));
  const dom = document.createElement('div'); dom.innerHTML = e.getHTML();
  expect(dom.querySelectorAll('tr:first-child th')).toHaveLength(3);
  expect(dom.querySelectorAll('tr:not(:first-child) th')).toHaveLength(0);
}
it('moves the header immediately when inserting above it, preserving styles and single-step undo', () => {
  const e = make();
  e.commands.setTextSelection(3); e.commands.setCellAttribute('backgroundColor', '#dcfce7');
  e.commands.setCellAttribute('colwidth', [240]);
  e.view.dispatch(e.state.tr.setNodeMarkup(1, undefined, { rowHeight: 90 }));
  const before = e.getJSON();
  expect(insertTableAxis(e, 0, 'row', 0)).toBe(true); expectHeader(e);
  const original = tableAt(e, 0)!.node.child(1);
  expect(original.textContent).toBe('ABC'); expect(original.attrs.rowHeight).toBe(90);
  expect(original.firstChild!.attrs).toMatchObject({ backgroundColor: '#dcfce7', colwidth: [240] });
  const inserted = e.getJSON();
  e.commands.undo(); expect(e.getJSON()).toEqual(before); expectHeader(e);
  e.commands.redo(); expect(e.getJSON()).toEqual(inserted); expectHeader(e);
  const md = e.getMarkdown(); e.commands.setContent(md, { contentType: 'markdown' }); expectHeader(e);
  expect(insertTableAxis(e, 0, 'row', 0)).toBe(true); expectHeader(e);
});
it('promotes the next row immediately after deleting the header and restores it in one undo', () => {
  const e = make(), before = e.getJSON();
  expect(deleteTableAxis(e, 0, 'row', 0)).toBe(true); expectHeader(e);
  expect(tableAt(e, 0)!.node.firstChild!.textContent).toBe('a1b1c1');
  e.commands.undo(); expect(e.getJSON()).toEqual(before); expectHeader(e);
});
it('inserts at top, internal and trailing boundaries without replacing existing contents', () => {
  const e = make();
  expect(insertTableAxis(e, 0, 'row', 0)).toBe(true); expect(tableAt(e, 0)?.map.height).toBe(5);
  expect(insertTableAxis(e, 0, 'row', 3)).toBe(true); expect(tableAt(e, 0)?.map.height).toBe(6);
  expect(insertTableAxis(e, 0, 'column', 3)).toBe(true); expect(tableAt(e, 0)?.map.width).toBe(4);
  for (const text of ['A', 'b1', 'c2', 'a3']) expect(e.getMarkdown()).toContain(text);
});
it('deletes a contiguous selection of rows and restores it in one undo', () => {
  const e = make(), before = e.getMarkdown();
  selectTableAxis(e, 0, 'row', 1, 2);
  expect(e.state.selection).toBeInstanceOf(CellSelection);
  expect(selectedAxisRange(e, 0, 'row', 2)).toEqual({ from: 1, to: 2 });
  expect(selectedAxisRange(e, 0, 'row', 3)).toEqual({ from: 3, to: 3 });
  expect(deleteTableAxis(e, 0, 'row', 1, 2)).toBe(true);
  expect(tableAt(e, 0)?.map.height).toBe(2); expect(e.getMarkdown()).not.toContain('a1'); expect(e.getMarkdown()).toContain('a3');
  e.commands.undo(); expect(e.getMarkdown()).toBe(before);
});
it('deletes selected columns without interpreting a row selection as all columns', () => {
  const e = make(), before = e.getMarkdown();
  selectTableAxis(e, 0, 'row', 1, 2);
  expect(selectedAxisRange(e, 0, 'column', 0)).toEqual({ from: 0, to: 0 });
  selectTableAxis(e, 0, 'column', 0, 1);
  expect(selectedAxisRange(e, 0, 'column', 1)).toEqual({ from: 0, to: 1 });
  deleteTableAxis(e, 0, 'column', 0, 1);
  expect(tableAt(e, 0)?.map.width).toBe(1); expect(e.getMarkdown()).toContain('c3'); expect(e.getMarkdown()).not.toContain('b3');
  e.commands.undo(); expect(e.getMarkdown()).toBe(before);
});
it('deleting all rows removes the table and is undoable; read-only edits are rejected', () => {
  const e = make(), before = e.getMarkdown();
  expect(deleteTableAxis(e, 0, 'row', 0, 3)).toBe(true); expect(tableAt(e, 0)).toBeNull();
  e.commands.undo(); expect(e.getMarkdown()).toBe(before);
  e.setEditable(false, false);
  expect(deleteTableAxis(e, 0, 'row', 1)).toBe(false); expect(insertTableAxis(e, 0, 'column', 0)).toBe(false); expect(e.getMarkdown()).toBe(before);
});
