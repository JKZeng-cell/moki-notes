import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { closeHistory } from '@tiptap/pm/history';
import { PaintBucket, RotateCcw } from 'lucide-react';
import { cellFill } from '../shared/table-style.js';
import './table-style-controls.css';

const colors = ['#ffffff', '#f1f3f5', '#fee2e2', '#ffedd5', '#fef3c7', '#dcfce7', '#ccfbf1', '#dbeafe', '#e0e7ff', '#ede9fe', '#fae8ff', '#fce7f3'];
type RowHandle = { row: HTMLTableRowElement; x: number; y: number; width: number };
export function TableStyleControls({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [handle, setHandle] = useState<RowHandle | null>(null), [anchor, setAnchor] = useState<{ x: number; y: number; count: number } | null>(null), [open, setOpen] = useState(false);
  const drag = useRef<{ row: HTMLTableRowElement; pos: number; start: number; height: number; next: number; style: string; doc: typeof editor.state.doc } | null>(null);
  const enabled = useRef(!disabled); enabled.current = !disabled;
  useEffect(() => {
    const cancel = () => { if (drag.current) drag.current.row.style.height = drag.current.style; drag.current = null; document.body.classList.remove('resizing-table-row'); setHandle(null); };
    const sync = () => {
      if (!enabled.current || !editor.isEditable || editor.isDestroyed) { setAnchor(null); setOpen(false); return; }
      const selection = editor.state.selection;
      let pos: number | undefined, count = 1;
      if (selection instanceof CellSelection) { pos = selection.$anchorCell.pos; count = 0; selection.forEachCell(() => count++); }
      else if (selection.empty) for (let depth = selection.$from.depth; depth > 0; depth--) {
        if (['cell', 'header_cell'].includes(selection.$from.node(depth).type.spec.tableRole)) { pos = selection.$from.before(depth); break; }
      }
      const cell = pos === undefined ? null : editor.view.nodeDOM(pos) as HTMLElement | null;
      if (!cell) { setAnchor(null); setOpen(false); return; }
      const r = cell.getBoundingClientRect(), clip = editor.view.dom.closest('.rich-scroll')?.getBoundingClientRect();
      if (clip && (r.bottom < clip.top || r.top > clip.bottom || r.right < clip.left || r.left > clip.right)) { setAnchor(null); setOpen(false); return; }
      setAnchor({ x: Math.max(8, Math.min(r.right - 38, innerWidth - 230)), y: Math.max(clip?.top ?? 8, Math.min(r.top - 38, innerHeight - 210)), count });
    };
    const move = (e: PointerEvent) => {
      const active = drag.current;
      if (active) { active.next = Math.round(Math.max(28, Math.min(2000, active.height + e.clientY - active.start))); active.row.style.height = `${active.next}px`; e.preventDefault(); return; }
      if (!enabled.current || !editor.isEditable || editor.isDestroyed) { setHandle(null); return; }
      const element = e.target instanceof Element ? e.target : null;
      if (element?.closest('[data-table-edge-controls]')) return;
      const cell = element?.closest('td,th') as HTMLTableCellElement | null;
      if (!cell || !editor.view.dom.contains(cell)) { setHandle(null); return; }
      const row = cell.parentElement as HTMLTableRowElement, r = cell.getBoundingClientRect(), rr = row.getBoundingClientRect();
      // Leave the corners to the existing +/- controls and column resizing.
      if (Math.abs(e.clientY - rr.bottom) <= 7 && e.clientX > r.left + 12 && e.clientX < r.right - 12) setHandle({ row, x: r.left + 12, y: rr.bottom - 3, width: Math.max(12, r.width - 24) });
      else setHandle(null);
    };
    const up = () => {
      const active = drag.current; if (!active) return;
      active.row.style.height = active.style; drag.current = null; document.body.classList.remove('resizing-table-row'); setHandle(null);
      if (!enabled.current || !editor.isEditable || !active.doc.eq(editor.state.doc) || Math.abs(active.next - active.height) < 1) return;
      const row = editor.state.doc.nodeAt(active.pos); if (row?.type.spec.tableRole !== 'row') return;
      editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(active.pos, undefined, { ...row.attrs, rowHeight: active.next }));
      editor.view.dispatch(closeHistory(editor.state.tr)); sync();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && (drag.current || open)) { e.preventDefault(); e.stopPropagation(); cancel(); setOpen(false); } };
    const outside = (e: PointerEvent) => { if (!(e.target as Element)?.closest?.('.table-cell-tools')) setOpen(false); };
    const changed = () => { if (drag.current && !drag.current.doc.eq(editor.state.doc)) cancel(); sync(); };
    editor.on('transaction', changed); editor.on('focus', sync);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape, true); window.addEventListener('scroll', sync, true); window.addEventListener('resize', sync); window.addEventListener('pointerdown', outside); sync();
    return () => { cancel(); editor.off('transaction', changed); editor.off('focus', sync); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape, true); window.removeEventListener('scroll', sync, true); window.removeEventListener('resize', sync); window.removeEventListener('pointerdown', outside); };
  }, [editor, disabled, open]);
  function fill(value: string | null) {
    if (!editor.isEditable || disabled) return;
    editor.view.dispatch(closeHistory(editor.state.tr)); editor.chain().focus().setCellAttribute('backgroundColor', cellFill(value)).run(); editor.view.dispatch(closeHistory(editor.state.tr));
  }
  if (disabled || !editor.isEditable) return null;
  return createPortal(<>
    {handle && <button data-table-edge-controls="true" className="table-row-resize" aria-label={`调整第 ${handle.row.rowIndex + 1} 行高度`} title="拖动调整行高 · Esc 取消" style={{ left: handle.x, top: handle.y, width: handle.width }} onPointerDown={e => {
      if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
      const $pos = editor.state.doc.resolve(editor.view.posAtDOM(handle.row, 0));
      for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.spec.tableRole === 'row') {
        const height = handle.row.getBoundingClientRect().height;
        drag.current = { row: handle.row, pos: $pos.before(depth), start: e.clientY, height, next: height, style: handle.row.style.height, doc: editor.state.doc };
        e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add('resizing-table-row'); break;
      }
    }} />}
    {anchor && <div className="table-cell-tools" data-table-edge-controls="true" data-moki-tools="" style={{ left: anchor.x, top: anchor.y }} onMouseDown={e => e.preventDefault()}>
      <button aria-label="单元格填充颜色" title={anchor.count > 1 ? `为选中的 ${anchor.count} 个单元格填色` : '单元格填充颜色'} aria-expanded={open} onClick={() => setOpen(!open)}><PaintBucket size={16} />{anchor.count > 1 && <small>{anchor.count}</small>}</button>
      {open && <div className="table-fill-palette" role="dialog" aria-label="单元格填充颜色面板"><span>单元格填充</span><div className="table-fill-swatches">{colors.map(color => <button key={color} title={color} aria-label={`填充 ${color}`} style={{ backgroundColor: color }} onClick={() => fill(color)} />)}</div><div className="table-fill-footer"><button onClick={() => fill(null)}><RotateCcw size={13} />无填充</button><label>自定义<input type="color" aria-label="自定义单元格填充颜色" defaultValue="#ede9fe" onChange={e => fill(e.target.value)} /></label></div></div>}
    </div>}
  </>, document.body);
}
