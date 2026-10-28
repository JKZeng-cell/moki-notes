import type { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

export type BlockRef = { node: PMNode; pos: number };
type Row = { columns: BlockRef[][]; node: PMNode; pos: number };
type Entry = BlockRef | Row;
export type Placement = 'before' | 'after' | 'left' | 'right' | 'aboveRow' | 'belowRow';
const isRow = (entry: Entry): entry is Row => 'columns' in entry;
function entries(doc: PMNode): Entry[] {
  const result: Entry[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name !== 'mokiColumns') { result.push({ node, pos }); return; }
    const columns: BlockRef[][] = [];
    node.forEach((column, offset) => {
      const blocks: BlockRef[] = [];
      column.forEach((node, childOffset) => blocks.push({ node, pos: pos + offset + childOffset + 2 }));
      columns.push(blocks);
    });
    result.push({ node, pos, columns });
  });
  return result;
}
export function layoutBlocks(doc: PMNode): Array<BlockRef & { row: number | null; column: number | null }> {
  return entries(doc).flatMap<BlockRef & { row: number | null; column: number | null }>(entry => isRow(entry) ? entry.columns.flatMap((column, columnIndex) => column.map(block => ({ ...block, row: entry.pos, column: columnIndex }))) : [{ ...entry, row: null, column: null }]);
}
function rebuild(doc: PMNode, rows: Entry[]) {
  const nodes = rows.flatMap(entry => {
    if (!isRow(entry)) return [entry.node];
    const columns = entry.columns.filter(col => col.length);
    if (columns.length === 1) return columns[0].map(block => block.node);
    if (!columns.length) return [];
    return [entry.node.type.create(entry.node.attrs, columns.map(col => doc.type.schema.nodes.mokiColumn.create(null, col.map(block => block.node))))];
  });
  return doc.copy(Fragment.fromArray(nodes.length ? nodes : [doc.type.schema.nodes.paragraph.create()]));
}
export function moveLayoutBlock(doc: PMNode, source: number, target: number, placement: Placement): PMNode | null {
  if (source === target && placement !== 'aboveRow' && placement !== 'belowRow') return null;
  const rows = entries(doc);
  let sourceList: BlockRef[] | Entry[] | undefined, moving: BlockRef | undefined;
  for (const entry of rows) {
    if (isRow(entry)) for (const col of entry.columns) { const block = col.find(b => b.pos === source); if (block) { moving = block; sourceList = col; } }
    else if (entry.pos === source) { moving = entry; sourceList = rows; }
  }
  if (!sourceList || !moving) return null;
  let targetRow: Row | undefined, targetList: BlockRef[] | Entry[] = rows, targetBlock: BlockRef | undefined;
  for (const entry of rows) {
    if (isRow(entry)) for (const col of entry.columns) { const block = col.find(b => b.pos === target); if (block) { targetRow = entry; targetList = col; targetBlock = block; } }
    else if (entry.pos === target) targetBlock = entry;
  }
  if (!targetBlock) return null;
  if (moving.node.type.name === 'mokiColumns' && targetRow) return null;
  const horizontal = placement === 'left' || placement === 'right';
  // Do not put imported rows inside columns; preserve them as ordinary blocks
  // when reading, but keep interactive layouts one level deep.
  if (horizontal && (moving.node.type.name === 'mokiColumns' || targetBlock.node.type.name === 'mokiColumns')) return null;
  sourceList.splice(sourceList.indexOf(moving), 1);
  if (placement === 'aboveRow' || placement === 'belowRow') {
    if (!targetRow) return null;
    rows.splice(rows.indexOf(targetRow) + (placement === 'belowRow' ? 1 : 0), 0, moving);
  }
  else if (!horizontal) targetList.splice(targetList.indexOf(targetBlock) + (placement === 'after' ? 1 : 0), 0, moving);
  else if (targetRow) targetRow.columns.splice(targetRow.columns.indexOf(targetList as BlockRef[]) + (placement === 'right' ? 1 : 0), 0, [moving]);
  else {
    const columns = placement === 'left' ? [[moving], [targetBlock]] : [[targetBlock], [moving]];
    rows.splice(rows.indexOf(targetBlock), 1, { pos: targetBlock.pos, node: doc.type.schema.nodes.mokiColumns.create(), columns });
  }
  const result = rebuild(doc, rows);
  return result.eq(doc) ? null : result;
}
export function commitLayout(editor: Editor, next: PMNode | null) {
  if (!next || !editor.isEditable || editor.isDestroyed || !next.type.validContent(next.content)) return false;
  const old = editor.state.doc;
  if (old.eq(next)) return false;
  // Replace complete affected rows. A text-level diff can cross isolating
  // column boundaries and ProseMirror's slice fitting would insert empty cells.
  let prefix = 0, suffix = 0, from = 0, oldEnd = old.content.size, nextEnd = next.content.size;
  while (prefix < Math.min(old.childCount, next.childCount) && old.child(prefix).eq(next.child(prefix))) { from += old.child(prefix).nodeSize; prefix++; }
  while (suffix < Math.min(old.childCount, next.childCount) - prefix && old.child(old.childCount - suffix - 1).eq(next.child(next.childCount - suffix - 1))) {
    oldEnd -= old.child(old.childCount - suffix - 1).nodeSize; nextEnd -= next.child(next.childCount - suffix - 1).nodeSize; suffix++;
  }
  const tr = closeHistory(editor.state.tr).replaceWith(from, oldEnd, next.content.cut(from, nextEnd));
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}
export function insertColumns(editor: Editor, count: 2 | 3) {
  if (!editor.isEditable) return false;
  const { $from } = editor.state.selection;
  for (let d = 1; d <= $from.depth; d++) if ($from.node(d).type.name === 'mokiColumn') return false;
  const pos = $from.depth ? $from.before(1) : $from.pos;
  const node = editor.state.doc.nodeAt(pos), schema = editor.schema;
  if (node?.type.name === 'mokiColumns') return false;
  const content = node ? [node] : [schema.nodes.paragraph.create()];
  const columns = schema.nodes.mokiColumns.create(null, Array.from({ length: count }, (_, i) => schema.nodes.mokiColumn.create(null, i === 0 ? content : [schema.nodes.paragraph.create()])));
  const tr = closeHistory(editor.state.tr).replaceWith(pos, pos + (node?.nodeSize ?? 0), columns);
  tr.setSelection(Selection.near(tr.doc.resolve(pos + 2)));
  editor.view.dispatch(tr.scrollIntoView()); editor.view.dispatch(closeHistory(editor.state.tr)); editor.commands.focus(); return true;
}
export function flattenColumns(editor: Editor, rowPos: number) {
  const node = editor.state.doc.nodeAt(rowPos);
  if (node?.type.name !== 'mokiColumns') return false;
  const children: PMNode[] = []; node.forEach(col => col.forEach(block => children.push(block)));
  const tr = closeHistory(editor.state.tr).replaceWith(rowPos, rowPos + node.nodeSize, children);
  editor.view.dispatch(tr.scrollIntoView()); editor.view.dispatch(closeHistory(editor.state.tr)); return true;
}
