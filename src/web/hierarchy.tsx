import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, FolderTree, MoreHorizontal, Plus } from 'lucide-react';
import type { NoteSummary } from '../shared/model.js';
import type { TreeMoveInput } from '../shared/tree.js';
import { NOTE_DRAG, dragAllowed, dropPlacement, endNoteDrag, readNoteDrag, startNoteDrag, type DragNote } from './tree-drag.js';

export type TreeHandlers = {
  onCreate(parentId: string | null): void;
  onMenu(note: NoteSummary, x: number, y: number): void;
  onMove(source: DragNote, target: NoteSummary | null, placement: TreeMoveInput['placement']): void;
};
export function Hierarchy({ nodes, selected, onSelect, onOpen, onCreate, onMenu, onMove, compact = false, busy = false }: TreeHandlers & { nodes: NoteSummary[]; selected: string | null; onSelect(id: string): void; onOpen(id: string): void; compact?: boolean; busy?: boolean }) {
  const [folded, setFolded] = useState<Set<string>>(new Set()), [hover, setHover] = useState<{ id: string; placement: string; valid: boolean } | null>(null);
  const container = useRef<HTMLDivElement>(null), expand = useRef<ReturnType<typeof setTimeout> | null>(null), expandId = useRef('');
  const stopExpand = () => { if (expand.current) clearTimeout(expand.current); expand.current = null; expandId.current = ''; };
  useEffect(() => { const clear = () => { setHover(null); stopExpand(); }; window.addEventListener('dragend', clear); window.addEventListener('drop', clear); return () => { clear(); window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear); }; }, []);
  const ancestry = useMemo(() => { const chain: string[] = [], seen = new Set<string>(); let p = nodes.find(n => n.id === selected)?.parentId; while (p && !seen.has(p)) { seen.add(p); chain.push(p); p = nodes.find(n => n.id === p)?.parentId; } return chain.join(','); }, [nodes, selected]);
  useEffect(() => {
    setFolded(old => { const next = new Set(old); for (const id of ancestry.split(',')) next.delete(id); return next; });
  }, [selected, ancestry]);
  const children = useMemo(() => {
    const map = new Map<string | null, NoteSummary[]>();
    for (const n of nodes) { const list = map.get(n.parentId) ?? []; list.push(n); map.set(n.parentId, list); } return map;
  }, [nodes]);
  const rows: Array<{ note: NoteSummary; depth: number }> = [];
  const stack = [...(children.get(null) ?? [])].reverse().map(note => ({ note, depth: 0 })), visited = new Set<string>();
  while (stack.length) { const row = stack.pop()!; if (visited.has(row.note.id)) continue; visited.add(row.note.id); rows.push(row); if (!folded.has(row.note.id)) stack.push(...[...(children.get(row.note.id) ?? [])].reverse().map(note => ({ note, depth: row.depth + 1 }))); }
  function dragOver(e: React.DragEvent<HTMLElement>, target: NoteSummary | null) {
    if (busy || !e.dataTransfer.types.includes(NOTE_DRAG)) return;
    e.stopPropagation(); e.preventDefault();
    const placement = target ? dropPlacement(e) : 'inside', valid = dragAllowed(nodes, target?.id ?? null, placement);
    e.dataTransfer.dropEffect = valid ? 'move' : 'none'; setHover({ id: target?.id ?? 'root', placement, valid });
    if (target && valid && placement === 'inside' && folded.has(target.id)) {
      if (expandId.current !== target.id) { stopExpand(); expandId.current = target.id; expand.current = setTimeout(() => { setFolded(old => { const next = new Set(old); next.delete(target.id); return next; }); }, 600); }
    } else stopExpand();
  }
  function drop(e: React.DragEvent<HTMLElement>, target: NoteSummary | null) {
    if (!e.dataTransfer.types.includes(NOTE_DRAG)) return;
    e.preventDefault(); e.stopPropagation(); const source = readNoteDrag(e), placement = target ? dropPlacement(e) : 'inside';
    if (!busy && source && dragAllowed(nodes, target?.id ?? null, placement)) { if (target && placement === 'inside') setFolded(old => { const next = new Set(old); next.delete(target.id); return next; }); onMove(source, target, placement); }
    setHover(null); stopExpand(); endNoteDrag();
  }
  function focus(id: string) { container.current?.querySelector<HTMLElement>(`[data-tree-id="${id}"]`)?.focus(); }
  return <div ref={container} className={`hierarchy ${compact ? 'compact' : ''}`}>
    <div className={`hierarchy-root ${hover?.id === 'root' ? 'drop-inside' : ''}`} onDragOver={e => dragOver(e, null)} onDrop={e => drop(e, null)}><span><FolderTree size={14} />根级节点</span><button aria-label="新建根级节点" title="新建根级节点" disabled={busy} onClick={() => onCreate(null)}><Plus size={15} /></button></div>
    <div role="tree" aria-label={compact ? '知识树目录' : '知识树层级'} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setHover(null); stopExpand(); } }}>
      {rows.map(({ note: n, depth }, index) => {
        const hasChildren = !!children.get(n.id)?.length, closed = folded.has(n.id), active = hover?.id === n.id;
        return <div role="treeitem" aria-level={depth + 1} aria-selected={selected === n.id} aria-expanded={hasChildren ? !closed : undefined} aria-label={n.title} tabIndex={selected === n.id || !nodes.some(n => n.id === selected) && index === 0 ? 0 : -1} key={n.id} data-tree-id={n.id} className={`hierarchy-row ${selected === n.id ? 'selected' : ''} ${active ? hover.valid ? `drop-${hover.placement}` : 'drop-invalid' : ''}`} style={{ paddingLeft: 8 + Math.min(depth, 12) * (compact ? 12 : 20) }} draggable={!busy} onDragStart={e => { e.stopPropagation(); startNoteDrag(e, n); }} onDragEnd={endNoteDrag} onDragOver={e => dragOver(e, n)} onDrop={e => drop(e, n)} onClick={() => onSelect(n.id)} onDoubleClick={() => onOpen(n.id)} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onMenu(n, e.clientX, e.clientY); }} onKeyDown={e => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); onMenu(n, r.x + 30, r.bottom); }
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.id); }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const next = rows[index + (e.key === 'ArrowDown' ? 1 : -1)]; if (next) focus(next.note.id); }
          if (e.key === 'ArrowRight') { e.preventDefault(); if (closed) setFolded(old => { const next = new Set(old); next.delete(n.id); return next; }); else if (children.get(n.id)?.[0]) focus(children.get(n.id)![0].id); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); if (hasChildren && !closed) setFolded(old => new Set([...old, n.id])); else if (n.parentId) focus(n.parentId); }
        }}>
          <button tabIndex={-1} className="hierarchy-fold" aria-label={`${closed ? '展开' : '折叠'}：${n.title}`} disabled={!hasChildren} onClick={e => { e.stopPropagation(); setFolded(old => { const next = new Set(old); next.has(n.id) ? next.delete(n.id) : next.add(n.id); return next; }); }}><ChevronRight size={13} style={{ opacity: hasChildren ? 1 : 0, transform: hasChildren && !closed ? 'rotate(90deg)' : undefined }} /></button>
          <FileText size={14} className="hierarchy-icon" /><span className="hierarchy-title" title={n.title}>{n.title}</span>{!compact && <small>{children.get(n.id)?.length ? `${children.get(n.id)!.length} 个下级` : ''}</small>}
          <div className="hierarchy-actions"><button aria-label={`新建下级：${n.title}`} title="新建下级" disabled={busy} onDoubleClick={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onCreate(n.id); }}><Plus size={14} /></button><button aria-label={`节点操作：${n.title}`} title="节点操作" disabled={busy} onDoubleClick={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onMenu(n, r.left, r.bottom); }}><MoreHorizontal size={14} /></button></div>
        </div>;
      })}
    </div>
    {!rows.length && <p className="hierarchy-empty">点击 + 新建节点，或拖入便签卡片。</p>}
    <p className="hierarchy-help">拖到中间放入下级，拖到边缘调整顺序</p>
  </div>;
}
