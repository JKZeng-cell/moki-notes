import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { CellSelection, findTable } from '@tiptap/pm/tables';
import { Minus, Plus } from 'lucide-react';
import { deleteTableAxis, insertTableAxis, selectedAxisRange, selectTableAxis, tableAt, type TableAxis } from './table-operations.js';

type Hover = { table: HTMLTableElement; axis: TableAxis; side: 'start' | 'end'; index: number; insert: boolean; x: number; y: number };
function context(editor: Editor, table: HTMLTableElement) {
  if (!table.isConnected || !editor.view.dom.contains(table)) return null;
  const found = findTable(editor.state.doc.resolve(editor.view.posAtDOM(table, 0)));
  return found ? tableAt(editor, found.pos) : null;
}
function geometry(table: HTMLTableElement, columns: number) {
  const bounds = table.getBoundingClientRect(), rows = [...table.rows].map(row => row.getBoundingClientRect());
  // Fixed-layout tables normally have equal columns; honor rendered colspan
  // boundaries as well, so imported tables keep correct edge hit targets.
  const edges = [bounds.left];
  for (const cell of table.rows[0]?.cells ?? []) {
    const rect = cell.getBoundingClientRect();
    for (let i = 1; i <= cell.colSpan; i++) edges.push(rect.left + rect.width * i / cell.colSpan);
  }
  if (edges.length !== columns + 1) { edges.length = 0; for (let i = 0; i <= columns; i++) edges.push(bounds.left + bounds.width * i / columns); }
  return { bounds, rows, edges };
}
export function TableEdgeControls({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [hover, setHover] = useState<Hover[]>([]), [, redraw] = useState(0);
  const anchor = useRef<{ table: HTMLTableElement; axis: TableAxis; index: number } | null>(null);
  const dragging = useRef<{ table: HTMLTableElement; axis: TableAxis; index: number; head: number } | null>(null);
  const pointer = useRef({ x: -100, y: -100 });
  const enabled = useRef(!disabled); enabled.current = !disabled;
  useEffect(() => { if (disabled) { setHover([]); dragging.current = null; } }, [disabled]);
  useEffect(() => {
    let frame = 0;
    const clear = () => { setHover([]); dragging.current = null; };
    const locate = () => {
      frame = 0;
      if (!enabled.current || !editor.isEditable || editor.isDestroyed || editor.view.composing || !document.hasFocus() || dragging.current) return;
      const { x, y } = pointer.current;
      const under = document.elementFromPoint(x, y);
      if (under?.closest('[data-table-edge-controls]')) return;
      if (under?.closest('.modal-backdrop,.editor-popup')) { setHover([]); return; }
      const clip = editor.view.dom.closest('.rich-scroll')?.getBoundingClientRect();
      if (!clip || x < clip.left - 20 || x > clip.right + 20 || y < clip.top - 18 || y > clip.bottom + 18) { setHover([]); return; }
      for (const table of editor.view.dom.querySelectorAll<HTMLTableElement>('table')) {
        const ctx = context(editor, table); if (!ctx) continue;
        const { bounds: b, rows, edges } = geometry(table, ctx.map.width);
        if (x < b.left - 24 || x > b.right + 24 || y < b.top - 24 || y > b.bottom + 24 || b.bottom < clip.top || b.top > clip.bottom) continue;
        const left = Math.abs(x - b.left), right = Math.abs(x - b.right), top = Math.abs(y - b.top), bottom = Math.abs(y - b.bottom);
        const vertical = Math.min(left, right) <= 18, horizontal = Math.min(top, bottom) <= 18;
        const sideX = left < right ? 'start' : 'end', sideY = top < bottom ? 'start' : 'end';
        const edgeX = sideX === 'start' ? b.left : b.right, edgeY = sideY === 'start' ? b.top : b.bottom;
        const canX = edgeX >= clip.left - 1 && edgeX <= clip.right + 1;
        const canY = edgeY >= clip.top + 1 && edgeY <= clip.bottom - 1;
        if (vertical && horizontal && canX && canY) {
          setHover([
            { table, axis: 'row', side: sideX, index: sideY === 'start' ? 0 : rows.length, insert: true, x: edgeX + (sideX === 'start' ? -12 : 12), y: edgeY + (sideY === 'start' ? 14 : -14) },
            { table, axis: 'column', side: sideY, index: sideX === 'start' ? 0 : ctx.map.width, insert: true, x: edgeX + (sideX === 'start' ? 14 : -14), y: edgeY + (sideY === 'start' ? -12 : 12) },
          ]); return;
        }
        if (vertical && canX && y >= Math.max(b.top, clip.top) && y <= Math.min(b.bottom, clip.bottom)) {
          const boundaries = [...rows.map(r => r.top), rows.at(-1)?.bottom ?? b.bottom];
          const boundary = boundaries.findIndex(v => Math.abs(y - v) <= 6);
          const index = boundary >= 0 ? boundary : rows.findIndex(r => y >= r.top && y <= r.bottom);
          if (index < 0) continue;
          const center = boundary >= 0 ? boundaries[index] : Math.max(clip.top + 12, Math.min((rows[index].top + rows[index].bottom) / 2, clip.bottom - 12));
          setHover([{ table, axis: 'row', side: sideX, index, insert: boundary >= 0, x: edgeX + (sideX === 'start' ? -12 : 12), y: center }]); return;
        }
        if (horizontal && canY && x >= Math.max(b.left, clip.left) && x <= Math.min(b.right, clip.right)) {
          const boundary = edges.findIndex(v => Math.abs(x - v) <= 6);
          const index = boundary >= 0 ? boundary : edges.findIndex((v, i) => i < edges.length - 1 && x >= v && x <= edges[i + 1]);
          if (index < 0) continue;
          const center = boundary >= 0 ? edges[index] : Math.max(clip.left + 12, Math.min((edges[index] + edges[index + 1]) / 2, clip.right - 12));
          setHover([{ table, axis: 'column', side: sideY, index, insert: boundary >= 0, x: center, y: edgeY + (sideY === 'start' ? -12 : 12) }]); return;
        }
      }
      setHover([]);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(locate); };
    const geometryChanged = () => { setHover([]); schedule(); };
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      const drag = dragging.current;
      if (drag && enabled.current) {
        const ctx = context(editor, drag.table); if (!ctx) { clear(); return; }
        const { rows, edges } = geometry(drag.table, ctx.map.width);
        let index = drag.axis === 'row' ? rows.findIndex(r => event.clientY <= r.bottom) : edges.findIndex((_, i) => i < edges.length - 1 && event.clientX <= edges[i + 1]);
        if (index < 0) index = (drag.axis === 'row' ? ctx.map.height : ctx.map.width) - 1;
        if (index !== drag.head) { drag.head = index; selectTableAxis(editor, ctx.pos, drag.axis, drag.index, index); }
        event.preventDefault(); return;
      }
      schedule();
    };
    const up = () => { dragging.current = null; };
    const changed = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) { clear(); anchor.current = null; schedule(); }
      else { if (!(editor.state.selection instanceof CellSelection)) anchor.current = null; redraw(n => n + 1); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', clear);
    window.addEventListener('resize', geometryChanged); window.addEventListener('scroll', geometryChanged, true); window.addEventListener('blur', clear);
    document.documentElement.addEventListener('pointerleave', clear); editor.on('transaction', changed);
    return () => { cancelAnimationFrame(frame); editor.off('transaction', changed); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', clear); window.removeEventListener('resize', geometryChanged); window.removeEventListener('scroll', geometryChanged, true); window.removeEventListener('blur', clear); document.documentElement.removeEventListener('pointerleave', clear); };
  }, [editor]);
  function select(h: Hover, extend: boolean) {
    const ctx = context(editor, h.table); if (!ctx || !editor.isEditable || editor.view.composing) return;
    const prior = anchor.current;
    const index = extend && prior?.table === h.table && prior.axis === h.axis ? prior.index : h.index;
    anchor.current = { table: h.table, axis: h.axis, index };
    selectTableAxis(editor, ctx.pos, h.axis, index, h.index); editor.view.focus(); return index;
  }
  const position = (x: number, y: number, size = 22) => {
    const handle = editor.view.dom.closest('.desktop-card')?.querySelector('.desktop-card-handle')?.getBoundingClientRect();
    return { left: Math.max(4, Math.min(x - size / 2, innerWidth - size - 4)), top: Math.max(handle ? handle.bottom + 3 : 4, Math.min(y - size / 2, innerHeight - size - 4)) };
  };
  if (disabled || !editor.isEditable || !hover.length) return null;
  return createPortal(<div className="table-edge-controls" data-table-edge-controls="true" aria-label="表格边缘操作" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setHover([]); if (editor.state.selection instanceof CellSelection) editor.commands.setTextSelection(editor.state.selection.$anchorCell.pos + 1); editor.view.focus(); } }}>{hover.map(h => {
    const ctx = context(editor, h.table); if (!ctx) return null;
    const noun = h.axis === 'row' ? '行' : '列', range = selectedAxisRange(editor, ctx.pos, h.axis, h.index), count = range.to - range.from + 1;
    const label = h.insert ? `在第 ${h.index + 1} ${noun}位置添加${noun}` : count > 1 ? `删除所选 ${count} ${noun}` : `删除第 ${h.index + 1} ${noun}`;
    return <div key={`${h.axis}:${h.side}`}>
      {!h.insert && <button className={`table-axis-select ${h.axis}`} aria-label={`选择第 ${h.index + 1} ${noun}`} title={`选择第 ${h.index + 1} ${noun} · Shift 连选或拖动多选`} style={position(h.axis === 'row' ? h.x + (h.side === 'start' ? 17 : -17) : h.x, h.axis === 'column' ? h.y + (h.side === 'start' ? 17 : -17) : h.y, 10)} onMouseDown={e => e.preventDefault()} onPointerDown={e => { e.preventDefault(); const index = select(h, e.shiftKey); if (index !== undefined) { dragging.current = { table: h.table, axis: h.axis, index, head: h.index }; e.currentTarget.setPointerCapture(e.pointerId); } }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(h, e.shiftKey); } }}><i /></button>}
      <button className={`table-edge-button ${h.insert ? 'add' : 'remove'}`} style={position(h.x, h.y)} aria-label={label} title={label + (!h.insert ? ' · Ctrl+Z 撤销' : '')} onMouseDown={e => e.preventDefault()} onClick={() => {
        const fresh = context(editor, h.table); if (!fresh || !editor.isEditable || editor.view.composing) return;
        if (h.insert) insertTableAxis(editor, fresh.pos, h.axis, h.index);
        else { const selected = selectedAxisRange(editor, fresh.pos, h.axis, h.index); deleteTableAxis(editor, fresh.pos, h.axis, selected.from, selected.to); }
        setHover([]);
      }}>{h.insert ? <Plus size={14} /> : <><Minus size={14} />{count > 1 && <span className="table-edge-count">{count}</span>}</>}</button>
    </div>;
  })}</div>, document.body);
}
