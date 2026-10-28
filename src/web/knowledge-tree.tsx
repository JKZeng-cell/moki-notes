import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Link2, Network, Search, Unlink, ZoomIn, ZoomOut, Scan } from 'lucide-react';
import type { Note, NotePatch, NoteSummary } from '../shared/model.js';
import { api } from './api.js';
import { NoteSelect } from './note-select.js';
import { hierarchyChoices } from './note-choice.js';
import { useKnowledgeDrag } from './use-knowledge-drag.js';
import { useKnowledgeConnect } from './use-knowledge-connect.js';
import type { TreeHandlers } from './hierarchy.js';
import { KnowledgeDirectory } from './knowledge-directory.js';
import { KnowledgePreview } from './knowledge-preview.js';
import { knowledgeEdges, knowledgeLayout, separateKnowledgePoints, zoomKnowledgeAt, scaleKnowledgeZoom, knowledgeZoomLabel, type KnowledgeCamera } from './knowledge-model.js';

export function KnowledgeTree({ nodes, onOpen, onChange, onError, onCreate, onMenu, activeId, onSelected, inspectorResize, treeActions, treeBusy }: { treeActions: TreeHandlers; treeBusy: boolean; inspectorResize: ReactNode; onMenu: TreeHandlers['onMenu']; activeId: string | null; onSelected(id: string): void; nodes: NoteSummary[]; onOpen(id: string): void; onChange(): void; onError(message: string): void; onCreate(): void }) {
  const [query, setQuery] = useState(''), [onlyAgent, setOnlyAgent] = useState(false), [target, setTarget] = useState(''), [child, setChild] = useState(''), [busy, setBusy] = useState(false);
  const [viewport, setViewport] = useState(600), [extent, setExtent] = useState(300);
  const [camera, setCamera] = useState<KnowledgeCamera>({ zoom: 1, pan: { x: 0, y: 0 } });
  const { zoom, pan } = camera;
  const stage = useRef<HTMLDivElement>(null), extentRef = useRef(300);
  const svg = useRef<SVGSVGElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; focusCanvas: boolean } | null>(null);
  const focusedRequest = useRef<typeof focusRequest>(null);
  const rootId = nodes.some(n => n.id === activeId) ? activeId : nodes[0]?.id ?? null;
  const [neighborhood, setNeighborhood] = useState<{ rootId: string | null; items: NoteSummary[]; total: number; hasMore: boolean }>({ rootId: null, items: [], total: 0, hasMore: false });
  const [graphLoading, setGraphLoading] = useState(false), [graphError, setGraphError] = useState(''), [graphLimit, setGraphLimit] = useState(40), [retry, setRetry] = useState(0);
  const [matches, setMatches] = useState<NoteSummary[]>([]);
  useEffect(() => { setGraphLimit(40); }, [rootId]);
  useEffect(() => {
    let cancelled = false;
    if (!rootId) { setNeighborhood({ rootId: null, items: [], total: 0, hasMore: false }); return; }
    setGraphLoading(true); setGraphError('');
    void (async () => {
      let result: typeof neighborhood | null = null;
      for (let offset = 0; offset < graphLimit; offset += 40) {
        const chunk = await api<typeof neighborhood>('/knowledge/neighborhood', 'POST', { id: rootId, offset, limit: 40 });
        if (cancelled) return;
        result = result ? { ...chunk, items: [...result.items, ...chunk.items.filter(n => n.id !== rootId)] } : chunk;
        if (!chunk.hasMore) break;
      }
      if (!cancelled && result) setNeighborhood(result);
    })().catch(e => { if (!cancelled) setGraphError(e.message); }).finally(() => { if (!cancelled) setGraphLoading(false); });
    return () => { cancelled = true; };
  }, [rootId, nodes, graphLimit, retry]);
  useEffect(() => {
    let cancelled = false; setMatches([]);
    if (!query.trim()) return;
    const timer = setTimeout(() => { void api<{ items: NoteSummary[] }>('/list/feed', 'POST', { q: query, limit: 20, status: 'active', ...(onlyAgent ? { knowledge: true } : {}) }).then(r => { if (!cancelled) setMatches(r.items); }).catch(e => { if (!cancelled) onError(e.message); }); }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, onlyAgent]);
  const candidates = neighborhood.rootId === rootId ? neighborhood.items : nodes.filter(n => n.id === rootId);
  const visible = useMemo(() => candidates.filter(n => n.id === rootId || !onlyAgent || n.knowledge), [candidates, rootId, onlyAgent]);
  const selected = rootId;
  const allEdges = useMemo(() => knowledgeEdges(visible), [visible]);
  const setSelected = onSelected;
  useEffect(() => { setTarget(''); setChild(''); }, [selected]);
  const edges = useMemo(() => knowledgeEdges(visible), [visible]);
  const automatic = useMemo(() => knowledgeLayout(visible, edges), [visible, edges]);
  const displayPoints = useRef(automatic);
  const graphDrag = useKnowledgeDrag({ displayPoints, points: automatic, span: extent * 2 / zoom, camera, setCamera, onSelect: () => { setTarget(''); }, onError });
  const points = useMemo(() => { const placed = new Map([...automatic].map(([id, point]) => [id, graphDrag.positions[id] ?? point])); return separateKnowledgePoints(placed, graphDrag.dragging ?? selected); }, [automatic, graphDrag.positions, graphDrag.dragging, selected]);
  const childCounts = useMemo(() => { const counts = new Map<string, number>(); for (const n of nodes) if (n.parentId) counts.set(n.parentId, (counts.get(n.parentId) ?? 0) + 1); return counts; }, [nodes]);
  const graphConnect = useKnowledgeConnect({ nodes: visible, points, onError, onConnected: updated => {
    setNeighborhood(old => ({ ...old, items: old.items.map(n => n.id === updated.id ? { ...n, links: updated.links, version: updated.version, updatedAt: updated.updatedAt } : n) }));
    onChange();
  } });
  displayPoints.current = points;
  const visibleKey = visible.map(n => n.id).sort().join(',');
  const fittedFilter = useRef<string | null>(null);
  useEffect(() => {
    if (!graphDrag.loaded || graphLoading || neighborhood.rootId !== rootId) return;
    const filter = JSON.stringify([rootId, onlyAgent, graphLimit]);
    // Keep the user's camera when background data changes or another sidebar
    // page is open. Fit only the initial view or a deliberately changed filter.
    if (fittedFilter.current === filter) return;
    fittedFilter.current = filter;
    setExtent(Math.max(300, ...[...points.values()].flatMap(p => [Math.abs(p.x) + 140, Math.abs(p.y) + 160])));
    setCamera({ zoom: 1, pan: { x: 0, y: 0 } });
  }, [visibleKey, graphDrag.loaded, rootId, onlyAgent, graphLimit, graphLoading, neighborhood.rootId]);
  const note = visible.find(n => n.id === selected);
  useEffect(() => {
    if (!focusRequest || focusRequest === focusedRequest.current || !graphDrag.loaded || graphLoading || neighborhood.rootId !== rootId) return;
    const point = points.get(focusRequest.id); if (!point) return;
    focusedRequest.current = focusRequest;
    setSelected(focusRequest.id);
    setCamera({ zoom: 1.5, pan: { ...point } });
    if (focusRequest.focusCanvas) svg.current?.querySelector<SVGGElement>(`[data-node="${focusRequest.id}"]`)?.focus({ preventScroll: true });
  }, [focusRequest, graphDrag.loaded, visibleKey, graphLoading, neighborhood.rootId, rootId]);
  function focusNode(id: string, focusCanvas = true) { setQuery(''); setOnlyAgent(false); onSelected(id); setFocusRequest({ id, focusCanvas }); }
  const linked = new Set(allEdges.filter(e => e.from === selected || e.to === selected).flatMap(e => [e.from, e.to]));
  extentRef.current = extent;
  const span = extent * 2 / zoom;
  const unit = span / viewport;
  const labelSize = 14;
  const radius = 23;
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const observer = new ResizeObserver(() => setViewport(Math.max(160, Math.min(el.clientWidth, el.clientHeight))));
    observer.observe(el); return () => observer.disconnect();
  }, [visible.length > 0]);
  useEffect(() => {
    const element = stage.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.neural-graph')) return;
      // React's delegated wheel listener is passive; a native non-passive
      // listener is necessary to suppress Chromium's page zoom here.
      event.preventDefault(); event.stopPropagation();
      const bounds = (svg.current ?? element).getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      if (graphDrag.isDragging() || graphConnect.isConnecting()) return;
      setCamera(current => zoomKnowledgeAt(current, extentRef.current, bounds, { x: event.clientX, y: event.clientY }, delta));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const reset = () => { setExtent(Math.max(300, ...[...points.values()].flatMap(p => [Math.abs(p.x) + 140, Math.abs(p.y) + 160]))); setCamera({ zoom: 1, pan: { x: 0, y: 0 } }); };
  async function patch(p: NotePatch) {
    if (!note || busy) return; setBusy(true);
    try { await api<Note>(`/notes/${note.id}`, 'PATCH', { expectedVersion: note.version, patch: p }); onChange(); return true; }
    catch (e) { onError((e as Error).message); onChange(); }
    finally { setBusy(false); }
  }
  async function addChild() {
    const source = nodes.find(n => n.id === child);
    if (!source || !note || busy) return;
    setBusy(true);
    try {
      if (Object.keys(localStorage).some(key => key.startsWith(`moki-notes:draft:${source.id}:`))) throw new Error('所选便签有未保存草稿，请先保存或处理草稿');
      await api(`/notes/${source.id}/move`, 'POST', { expectedVersion: source.version, targetId: note.id, targetVersion: note.version, placement: 'inside' });
      setChild(''); onChange();
    } catch (e) { onError((e as Error).message); onChange(); }
    finally { setBusy(false); }
  }
  return <section className="knowledge-workspace" aria-label="知识树">
    <div className="knowledge-filters"><label className="search"><Search size={16} /><input aria-label="搜索知识节点" placeholder="搜索节点、内容或标签…" value={query} onChange={e => { setFocusRequest(null); setQuery(e.target.value); reset(); }} /></label><label className="check-label"><input type="checkbox" checked={onlyAgent} onChange={e => { setFocusRequest(null); setOnlyAgent(e.target.checked); reset(); }} />仅 Agent 可检索</label><span>{visible.length} / {neighborhood.rootId === rootId ? neighborhood.total : visible.length} 个相关节点 · {allEdges.length} 条连接</span></div>
    {query.trim() && <div className="knowledge-search-results" role="region" aria-label="知识节点搜索结果">{matches.length ? matches.map(n => <button key={n.id} onClick={() => focusNode(n.id)}>{n.title}</button>) : <span>没有匹配节点，试试其他关键词</span>}</div>}
    <div className="knowledge-body"><div className="neural-stage" ref={stage}>
      <KnowledgeDirectory nodes={nodes} selected={selected} onFocus={id => focusNode(id, false)} onOpen={onOpen} actions={treeActions} busy={treeBusy} />
      {graphError && <div className="graph-load-state" role="alert">{graphError}<button onClick={() => setRetry(n => n + 1)}>重试</button></div>}{graphLoading && <div className="graph-load-state" role="status">正在读取关联…</div>}
      <div className="graph-legend"><span><i className="parent-node-key" />父级节点</span><span><i className="child-node-key" />子级节点</span><span><i />父子关系</span><span><i className="dashed" />跨节点关联</span></div>
      {!visible.length ? <div className="empty graph-empty"><Network size={38} /><p>{nodes.length ? '没有匹配的节点' : '从第一条便签开始，生长你的知识树'}</p><button onClick={nodes.length ? () => { setQuery(''); setOnlyAgent(false); } : onCreate}>{nodes.length ? '清除筛选' : '新建节点'}</button></div> : <svg ref={svg} className={`neural-graph${graphDrag.panning ? ' panning' : ''}`} aria-label="知识关联网络" viewBox={`${-span / 2 + pan.x} ${-span / 2 + pan.y} ${span} ${span}`} {...graphDrag.handlers}>
        <defs><marker id="knowledge-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth={unit*7} markerHeight={unit*7} orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
        {edges.map(e => { const a = points.get(e.from)!, b = points.get(e.to)!; const d = Math.max(1, Math.hypot(b.x-a.x,b.y-a.y)), dx=(b.x-a.x)/d,dy=(b.y-a.y)/d; return <path key={`${e.kind}:${e.from}:${e.to}`} className={`neural-edge ${e.kind} ${e.from === selected || e.to === selected ? 'connected' : ''}`} d={`M ${a.x+dx*(radius+unit*3)} ${a.y+dy*(radius+unit*3)} Q ${(a.x+b.x)/2-dy*20} ${(a.y+b.y)/2+dx*20} ${b.x-dx*(radius+unit*8)} ${b.y-dy*(radius+unit*8)}`} markerEnd="url(#knowledge-arrow)" />; })}
        {visible.map(n => { const p = points.get(n.id)!, children = childCounts.get(n.id) ?? 0, kind = children ? 'parent' : n.parentId ? 'child' : 'standalone'; return <g key={n.id} data-node={n.id} role="button" tabIndex={0} aria-label={`知识节点：${n.title}`} aria-pressed={selected===n.id} data-node-kind={kind} className={`neural-node node-kind-${kind} ${graphConnect.connection?.target === n.id ? 'connection-target' : ''} ${selected===n.id ? 'selected' : ''} ${linked.has(n.id) ? 'connected' : ''} ${graphDrag.dragging === n.id ? 'dragging' : ''}`} transform={`translate(${p.x},${p.y})`} onContextMenu={e => { e.preventDefault(); setSelected(n.id); onMenu(n, e.clientX, e.clientY); }} onClick={() => { setSelected(n.id); setTarget(''); }} onDoubleClick={() => onOpen(n.id)} onKeyDown={e => { if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); onMenu(n, r.x, r.bottom); } if (e.key==='Enter' || e.key===' ') { e.preventDefault(); setSelected(n.id); } }}><title>{n.title} · {children ? `父级节点，${children} 个下级${n.parentId ? '，同时属于上级节点' : ''}` : n.parentId ? '子级节点' : '独立节点'}</title><circle className="node-halo" r={radius+12} /><circle className="node-selection" r={radius+5} /><circle className="node-core" r={radius} /><circle className="node-light" r={radius/4} /><g className="node-connect" aria-label={`拖拽关联：${n.title}`} {...graphConnect.handle(n.id)}><title>从此处拖到另一节点，建立关联</title><circle className="node-connect-hit" cx={34} cy={0} r={12}/><circle className="node-connect-dot" cx={34} cy={0} r={7}/><path d="M 31 0 H 37 M 34 -3 V 3" /></g><text y={radius+labelSize+10} style={{fontSize:labelSize, opacity: zoom < .25 && selected !== n.id ? 0 : 1}} textAnchor="middle">{n.title.length>10 ? n.title.slice(0,10)+'…' : n.title}</text>{!n.knowledge && zoom >= .25 && <text className="node-private" y={radius+labelSize*2+14} style={{fontSize:labelSize*.8}} textAnchor="middle">未加入 Agent 检索</text>}</g>; })}
      {graphConnect.connection && <path className="connection-preview" d={`M ${graphConnect.connection.start.x} ${graphConnect.connection.start.y} L ${graphConnect.connection.end.x} ${graphConnect.connection.end.y}`} />}</svg>}
      <div className="graph-bottom"><span>{graphConnect.connection ? '拖到目标节点建立关联 · Esc 取消' : graphConnect.saving ? '正在保存关联…' : neighborhood.hasMore ? <button disabled={graphLoading || graphLimit >= 160} onClick={() => setGraphLimit(n => n + 40)}>{graphLimit >= 160 ? '更多关联可从层级列表定位' : '展开更多关联'}</button> : (graphDrag.saving ? '正在保存节点位置…' : '拖动节点移动 · 拖动 + 关联 · 中键平移 · 滚轮缩放')}</span><div><button disabled={!!graphDrag.dragging || !!graphConnect.connection} aria-label="缩小知识树" onClick={() => setCamera(c=>({ ...c, zoom: scaleKnowledgeZoom(c.zoom,1/1.25) }))}><ZoomOut size={16}/></button><span aria-label="画布缩放比例">{knowledgeZoomLabel(zoom)}</span><button disabled={!!graphDrag.dragging || !!graphConnect.connection} aria-label="放大知识树" onClick={() => setCamera(c=>({ ...c, zoom: scaleKnowledgeZoom(c.zoom,1.25) }))}><ZoomIn size={16}/></button><button disabled={!!graphDrag.dragging || !!graphConnect.connection} aria-label="居中知识树" onClick={reset}><Scan size={16}/></button></div></div>
    </div>{inspectorResize}<aside className="knowledge-inspector">{note ? <><span className="eyebrow">当前节点</span><h2>{note.title}</h2><KnowledgePreview key={note.id} id={note.id} version={note.version} /><button className="primary" onClick={() => onOpen(note.id)}>打开便签<ArrowUpRight size={15}/></button><button className="reset-node-position" disabled={!graphDrag.loaded || graphDrag.saving || !!graphDrag.dragging || !graphDrag.positions[note.id]} onClick={() => graphDrag.resetPosition(note.id)}>恢复节点自动位置</button><label className="check-label"><input type="checkbox" checked={note.knowledge} disabled={busy} onChange={e=>void patch({knowledge:e.target.checked})}/>允许 Agent 检索</label><label>父级节点<NoteSelect key={'parent-'+note.id} label="父级节点" value={note.parentId ?? ''} nodes={hierarchyChoices(nodes, note.id, 'parent')} context={nodes} emptyOption="无 · 根节点" disabled={busy} onChange={value => void patch({ parentId: value || null })} /></label><label>添加子级<NoteSelect key={'child-'+note.id} label="子级便签" value={child} nodes={hierarchyChoices(nodes, note.id, 'child')} context={nodes} disabled={busy} onChange={setChild} /></label><button disabled={!child || busy} onClick={() => void addChild()}>添加到下级</button><label>添加关联<NoteSelect key={'link-'+note.id} label="关联目标" value={target} nodes={nodes.filter(n => n.id !== note.id && !note.links.includes(n.id))} context={nodes} disabled={busy} onChange={setTarget} /></label><button disabled={!target || busy || note.links.length >= 100} onClick={() => void patch({ links: [...note.links, target] }).then(ok => { if (ok) setTarget(''); })}><Link2 size={14}/>建立连接</button><h3>关联网络</h3>{allEdges.filter(e=>e.from===note.id||e.to===note.id).map(e=>{const other=nodes.find(n=>n.id===(e.from===note.id?e.to:e.from));return <div className="relation-row" key={`${e.kind}:${e.from}:${e.to}`}><button onClick={()=>focusNode(other!.id)}><small>{e.kind==='parent'?(e.to===note.id?'父级':'子级'):(e.from===note.id?'关联':'反向关联')}</small><span>{other?.title}</span></button>{e.kind==='link'&&e.from===note.id&&<button aria-label={`解除关联：${other?.title}`} disabled={busy} onClick={()=>void patch({links:note.links.filter(id=>id!==e.to)})}><Unlink size={13}/></button>}</div>;})}{!linked.size&&<p className="muted">选择父级或添加关联，连接相关想法。</p>}<div className="knowledge-tags">{note.tags.map(t=><span className="tag" key={t}>#{t}</span>)}</div></> : <p className="muted">选择节点，查看内容与关联。</p>}</aside></div>
  </section>;
}
