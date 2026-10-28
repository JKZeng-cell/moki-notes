import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { GripVertical, ArrowUp, ArrowDown, Columns2, Rows2 } from 'lucide-react';
import { commitLayout, flattenColumns, layoutBlocks, moveLayoutBlock, type Placement } from './block-layout.js';

type Anchor = { pos: number; x: number; y: number; row: number | null };
type Target = { pos: number; placement: Placement; x: number; y: number; width: number; height: number };
export function BlockControls({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null), [menu, setMenu] = useState(false), [target, setTarget] = useState<Target | null>(null), [dragging, setDragging] = useState(false);
  const drag = useRef<{ pos: number; x: number; y: number; doc: PMNode; moved: boolean; target: Target | null } | null>(null);
  const menuOpen = useRef(menu); menuOpen.current = menu;
  const lastDrag = useRef(false), controls = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (disabled) { setAnchor(null); setMenu(false); setTarget(null); drag.current = null; setDragging(false); return; }
    const blocks = () => layoutBlocks(editor.state.doc).flatMap(block => {
      const el = editor.view.nodeDOM(block.pos);
      if (!(el instanceof HTMLElement)) return [];
      return [{ ...block, el, rect: el.getBoundingClientRect() }];
    });
    const setHover = (x: number, y: number) => {
      const viewport = editor.view.dom.closest('.rich-scroll')?.getBoundingClientRect();
      if (!viewport || x < viewport.left || x > viewport.right || y < viewport.top || y > viewport.bottom) { setAnchor(null); return; }
      const candidates = blocks().filter(b => y >= b.rect.top && y <= b.rect.bottom && x >= b.rect.left - 26 && x <= b.rect.right);
      const block = candidates[0];
      if (block) setAnchor({ pos: block.pos, row: block.row, x: Math.max(viewport.left + 2, block.rect.left - 25), y: Math.max(viewport.top + 2, block.rect.top + Math.min(6, block.rect.height / 4)) });
      else setAnchor(null);
    };
    const move = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) {
        if ((event.target as Element)?.closest?.('[data-image-resize], .image-viewer, .image-surface.resizing')) return;
        if (menuOpen.current || controls.current?.contains(event.target as Node)) return;
        setHover(event.clientX, event.clientY); return;
      }
      if (editor.state.doc !== state.doc) { cancel(); return; }
      if (Math.hypot(event.clientX - state.x, event.clientY - state.y) < 5 && !state.moved) return;
      state.moved = true; setDragging(true); setMenu(false); event.preventDefault();
      const scroll = editor.view.dom.closest('.rich-scroll');
      const viewport = scroll?.getBoundingClientRect();
      if (scroll && viewport) {
        if (event.clientY < viewport.top + 30) scroll.scrollTop -= 16;
        if (event.clientY > viewport.bottom - 30) scroll.scrollTop += 16;
      }
      for (const row of editor.view.dom.querySelectorAll<HTMLElement>('.moki-columns')) {
        const r = row.getBoundingClientRect();
        if (event.clientY < r.top || event.clientY > r.bottom || row.scrollWidth <= row.clientWidth) continue;
        if (event.clientX > r.right - 32 && event.clientX <= r.right) row.scrollLeft += 16;
        else if (event.clientX < r.left + 32 && event.clientX >= r.left) row.scrollLeft -= 16;
      }
      const all = blocks().filter(b => b.pos !== state.pos || b.row !== null);
      const distance = (b: typeof all[number]) => Math.max(b.rect.left - event.clientX, 0, event.clientX - b.rect.right) + Math.max(b.rect.top - event.clientY, 0, event.clientY - b.rect.bottom) * 2;
      const block = all.sort((a, b) => distance(a) - distance(b))[0];
      let next: Target | null = null;
      if (block && viewport && event.clientX >= viewport.left && event.clientX <= viewport.right && event.clientY >= viewport.top && event.clientY <= viewport.bottom) {
        const b = block.rect, margin = Math.min(48, b.width * .22), middle = event.clientY > b.top + Math.min(14, b.height * .25) && event.clientY < b.bottom - Math.min(14, b.height * .25);
        let placement: Placement = middle && event.clientX < b.left + margin ? 'left' : middle && event.clientX > b.right - margin ? 'right' : event.clientY < b.top + b.height / 2 ? 'before' : 'after';
        let rect = b;
        const rowDOM = block.row === null ? null : editor.view.nodeDOM(block.row);
        if (rowDOM instanceof HTMLElement) {
          const r = rowDOM.getBoundingClientRect();
          if (event.clientY < r.top + 3) { placement = 'aboveRow'; rect = r; }
          else if (event.clientY > r.bottom - 3) { placement = 'belowRow'; rect = r; }
        }
        if (moveLayoutBlock(state.doc, state.pos, block.pos, placement)) {
          const side = placement === 'left' || placement === 'right';
          next = { pos: block.pos, placement, x: side && placement === 'right' ? rect.right : rect.left, y: side ? rect.top : placement === 'after' || placement === 'belowRow' ? rect.bottom : rect.top, width: side ? 3 : rect.width, height: side ? rect.height : 3 };
        }
      }
      state.target = next; setTarget(next);
    };
    const cancel = () => { drag.current = null; setDragging(false); setTarget(null); };
    const up = () => {
      const state = drag.current;
      if (!state) return;
      lastDrag.current = state.moved;
      if (state.moved && state.target && editor.state.doc === state.doc) commitLayout(editor, moveLayoutBlock(state.doc, state.pos, state.target.pos, state.target.placement));
      if (state.moved) setAnchor(null);
      cancel();
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && (drag.current || menuOpen.current)) { event.preventDefault(); event.stopPropagation(); lastDrag.current = true; cancel(); setMenu(false); } };
    const outside = (event: PointerEvent) => { if (!controls.current?.contains(event.target as Node)) setMenu(false); };
    const changed = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => { if (transaction.docChanged && !drag.current) { setAnchor(null); setMenu(false); } };
    const scrolled = () => { if (!drag.current) { setAnchor(null); setMenu(false); } };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel); document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', scrolled, true); window.addEventListener('resize', scrolled); editor.on('transaction', changed);
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', scrolled); editor.off('transaction', changed); cancel(); };
  }, [editor, disabled]);
  if (disabled) return null;
  const list = layoutBlocks(editor.state.doc), index = list.findIndex(b => b.pos === anchor?.pos);
  const moveRelative = (direction: -1 | 1, placement: Placement) => {
    if (!anchor) return;
    const other = list[index + direction];
    if (other) commitLayout(editor, moveLayoutBlock(editor.state.doc, anchor.pos, other.pos, placement));
    setMenu(false);
  };
  return createPortal(<>
    {anchor && <div ref={controls} className="block-control" data-moki-tools="" style={{ left: anchor.x, top: anchor.y }}>
      <button type="button" className="block-grip" title="拖动模块：上下排序，左右分栏；点击更多操作" aria-label="拖动模块" aria-haspopup="menu" aria-expanded={menu} onPointerDown={event => {
        if (event.button !== 0) return;
        lastDrag.current = false; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pos: anchor.pos, x: event.clientX, y: event.clientY, doc: editor.state.doc, moved: false, target: null };
      }} onClick={() => { if (!lastDrag.current) setMenu(value => !value); }}><GripVertical size={16} /></button>
      {menu && <div role="menu" aria-label="模块排版" className="editor-popup block-menu" onMouseDown={event => event.preventDefault()} style={{ left: Math.min(anchor.x + 25, window.innerWidth - 190), top: Math.max(8, Math.min(anchor.y, window.innerHeight - 230)) }}>
        <button role="menuitem" disabled={index <= 0} onClick={() => moveRelative(-1, 'before')}><ArrowUp size={14} />上移模块</button>
        <button role="menuitem" disabled={index < 0 || index === list.length - 1} onClick={() => moveRelative(1, 'after')}><ArrowDown size={14} />下移模块</button>
        <button role="menuitem" disabled={index <= 0} onClick={() => moveRelative(-1, 'right')}><Columns2 size={14} />与上一模块并排</button>
        {anchor.row !== null && <><button role="menuitem" onClick={() => { commitLayout(editor, moveLayoutBlock(editor.state.doc, anchor.pos, anchor.pos, 'belowRow')); setMenu(false); }}><ArrowDown size={14} />移出分栏</button><button role="menuitem" onClick={() => { flattenColumns(editor, anchor.row!); setMenu(false); }}><Rows2 size={14} />恢复单栏</button></>}
      </div>}
    </div>}
    {dragging && <div className="block-drag-message" role="status">{target ? ['left', 'right'].includes(target.placement) ? '松开添加并排模块' : '松开移动模块' : '拖到模块上下排序，左右分栏 · Esc 取消'}</div>}
    {target && <div className="block-drop-indicator" style={{ left: target.x, top: target.y, width: target.width, height: target.height }} />}
  </>, document.body);
}
