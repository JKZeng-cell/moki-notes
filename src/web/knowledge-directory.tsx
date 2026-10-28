import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderTree, Search, X } from 'lucide-react';
import type { NoteSummary } from '../shared/model.js';
import { Hierarchy, type TreeHandlers } from './hierarchy.js';

export function KnowledgeDirectory({ nodes, selected, onFocus, onOpen, busy, actions }: { nodes: NoteSummary[]; selected: string | null; onFocus(id: string): void; onOpen(id: string): void; busy: boolean; actions: TreeHandlers }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    if (!query.trim()) return nodes;
    const included = new Set(nodes.filter(n => `${n.title} ${n.excerpt} ${n.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())).map(n => n.id));
    const parents = new Map(nodes.map(n => [n.id, n.parentId]));
    for (const id of [...included]) { let parent = parents.get(id); while (parent && !included.has(parent)) { included.add(parent); parent = parents.get(parent); } }
    return nodes.filter(n => included.has(n.id));
  }, [nodes, query]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (e: PointerEvent) => { if (!container.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  return <div className="graph-directory" ref={container} onKeyDown={e => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); } }}>
    <button ref={trigger} className="graph-directory-trigger" aria-expanded={open} aria-controls="knowledge-directory" onClick={() => setOpen(value => !value)}><FolderTree size={16} />层级列表</button>
    {open && <section id="knowledge-directory" className="graph-directory-panel" aria-label="层级列表">
      <header><strong>层级列表</strong><button aria-label="关闭层级列表" onClick={close}><X size={16} /></button></header>
      <label className="search"><Search size={15} /><input ref={search} aria-label="搜索层级节点" placeholder="搜索节点标题或标签…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="graph-directory-scroll"><Hierarchy nodes={filtered} selected={selected} onSelect={onFocus} onOpen={onOpen} {...actions} busy={busy} compact /></div>
      <footer>{query && !filtered.length ? '没有匹配的节点，试试其他关键词' : '点击定位节点 · 右键管理 · 拖拽整理层级'}</footer>
    </section>}
  </div>;
}
