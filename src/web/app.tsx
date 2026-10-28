import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Archive, Cloud, LoaderCircle, FileInput, BookOpen, Bot, ChevronRight, FileText, Moon, Pin, PinOff, Plus, Search, Settings2, Star, StickyNote, Sun, Trash2, X } from 'lucide-react';
import { useFeishuSync } from './use-feishu-sync.js';
import { api } from './api.js';
import { syncLabels } from './feishu-activity.js';
import type { FeishuRecord } from '../shared/feishu.js';
import { ListMoveDialog } from './list-move-dialog.js';
import { ListGroups } from './list-groups.js';
import { emptyListOrganization, type ListOrganization } from '../shared/list-organization.js';
import { NoteEditor } from './editor.js';
import { usePanelLayout } from './panel-resize.js';
import { KnowledgeWorkspace } from './knowledge-workspace.js';
import { useTrashActions } from './trash-actions.js';
import { useTreeActions } from './tree-actions.js';
import { startNoteDrag, endNoteDrag } from './tree-drag.js';
import { StickyCard } from './sticky-card.js';
import { Settings } from './settings.js';
import { AgentConnection } from './agent-connection.js';
import type { Note, NoteQuery, NoteSummary } from '../shared/model.js';
import { canRestoreNote, type NavigationView as View } from './navigation-state.js';

type FeedResult = { items: NoteSummary[]; total: number; visibleTotal: number; organization: ListOrganization; groupCounts: Record<string, number>; revision: string; unchanged?: boolean };
type PageState = { selected: string | null; query: string; sort: 'manual' | 'updated' | 'created' | 'title'; offset: number; checked: string[]; scrollTop: number };
const emptyPage = (): PageState => ({ selected: null, query: '', sort: 'manual', offset: 0, checked: [], scrollTop: 0 });
const labels = { active: '全部便签', starred: '我的收藏', knowledge: '知识树', archived: '已归档', trash: '回收站' };
const icons = { active: StickyNote, starred: Star, knowledge: BookOpen, archived: Archive, trash: Trash2 };
const welcome = `## 欢迎使用 MOKI便签\n\n一个安静的地方，收好每个想法。\n\n### 从一条便签开始\n\n- 写下灵感、计划和工作记录\n- 用 **Markdown** 把想法整理清楚\n- 将重要的便签固定到桌面\n\n### 让知识连起来\n\n在右上角的「属性与关联」中设置父级便签、标签和关联，慢慢建立自己的知识树。\n\n> 便签属于你，数据保存在本机。\n\n### 今天的小计划\n\n- [ ] 记录一个新想法\n- [ ] 建立第一条知识笔记\n- [ ] 连接你的 Agent\n\n| 格式 | 适合用途 |\n| --- | --- |\n| Markdown | 继续编辑、交给 Agent |\n| TXT | 纯文本分享 |\n| DOCX | 文档交付 |\n\n\`Ctrl + S\` 保存 · 右上角展开按钮进入专注编辑\n`;
export function App() {
  const stickyId = new URLSearchParams(location.search).get('sticky');
  const [view, setView] = useState<View>('active'), [query, setQuery] = useState(''), [tag, setTag] = useState(''), [sort, setSort] = useState<'manual' | 'updated' | 'created' | 'title'>('manual');
  const [items, setItems] = useState<NoteSummary[]>([]), [tree, setTree] = useState<NoteSummary[]>([]), [total, setTotal] = useState(0), [selected, setSelected] = useState<string | null>(new URLSearchParams(location.search).get('note')), [offset, setOffset] = useState(0);
  const [movingNotes, setMovingNotes] = useState<NoteSummary[] | null>(null);
  const [organization, setOrganization] = useState<ListOrganization>(emptyListOrganization), [groupCounts, setGroupCounts] = useState<Record<string, number>>({}), [visibleTotal, setVisibleTotal] = useState(0);
  const [settingsTab, setSettingsTab] = useState<'general' | 'feishu'>('general');
  const [settings, setSettings] = useState(false);
  const [desktopPins, setDesktopPins] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [treeSelected, setTreeSelected] = useState<string | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem('moki-notes:theme') === 'dark'), [error, setError] = useState(''), [loading, setLoading] = useState(true), [agent, setAgent] = useState(false), [busy, setBusy] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null), feedRevision = useRef<{ scope: string; revision: string } | null>(null), catalogRevision = useRef<string | undefined>(undefined);
  const [listChangeVersion, setListChangeVersion] = useState(0);
  const moreScope = useRef<string | null>(null);
  const refreshing = useRef<{ scope: string; token: number } | null>(null);
  const moreLock = useRef(false), [loadingMore, setLoadingMore] = useState(false), [loadError, setLoadError] = useState('');
  const request = useRef(0), fileInput = useRef<HTMLInputElement>(null), searchInput = useRef<HTMLInputElement>(null);
  const pages = useRef(new Map<string, PageState>()), listScroll = useRef<HTMLDivElement>(null);
  const readingPositions = useRef(new Map<string, { top: number }>());
  const pendingPage = useRef<{ key: string; selected: string | null; explicit: boolean; scrollTop: number; ready: boolean } | null>(null);
  const [navigationVersion, setNavigationVersion] = useState(0), [knowledgeOpened, setKnowledgeOpened] = useState(false);
  const pageKey = JSON.stringify([view, tag]);
  const navigate = useCallback((next: View, nextTag = '', override?: Partial<PageState>) => {
    const key = JSON.stringify([next, nextTag]);
    if (key === pageKey && !override) return;
    const pending = pendingPage.current?.key === pageKey ? pendingPage.current : null;
    pages.current.set(pageKey, { selected: pending ? pending.selected : selected, query, sort, offset, checked: [...checked], scrollTop: pending?.scrollTop ?? listScroll.current?.scrollTop ?? 0 });
    const saved = { ...(pages.current.get(key) ?? emptyPage()), ...override };
    pendingPage.current = { key, selected: saved.selected, explicit: !!override?.selected, scrollTop: saved.scrollTop, ready: false };
    request.current++; setSelected(null); setItems([]); setTotal(0); setVisibleTotal(0); setLoading(true);
    setView(next); setTag(nextTag); setQuery(saved.query); setSort(saved.sort); setOffset(saved.offset); setChecked(new Set(saved.checked));
    if (next === 'knowledge') { setKnowledgeOpened(true); if (!knowledgeOpened && selected) setTreeSelected(selected); }
    setNavigationVersion(n => n + 1);
  }, [pageKey, selected, query, sort, offset, checked, knowledgeOpened]);
  const readingPosition = (id: string) => {
    const key = JSON.stringify([pageKey, id]);
    if (!readingPositions.current.has(key)) readingPositions.current.set(key, { top: 0 });
    return readingPositions.current.get(key)!;
  };
  const showError = useCallback((message: string) => setError(message), []);
  const panels = usePanelLayout(view === 'knowledge', showError);
  const requestScope = JSON.stringify([pageKey, query, sort, navigationVersion, listChangeVersion]);
  const currentScope = useRef(requestScope); currentScope.current = requestScope;
  const refresh = useCallback(async () => {
    if (currentScope.current !== requestScope || moreLock.current && moreScope.current === requestScope || refreshing.current?.scope === requestScope) return;
    const token = ++request.current; refreshing.current = { scope: requestScope, token };
    const params: NoteQuery = { q: query, status: view === 'archived' || view === 'trash' ? view : 'active', sort, limit: 30, offset: 0, ...(tag ? { tag } : {}), ...(view === 'starred' ? { starred: true } : {}), ...(view === 'knowledge' ? { knowledge: true } : {}) };
    try {
      const knownRevision = feedRevision.current?.scope === requestScope ? feedRevision.current.revision : undefined;
      const [first, catalog] = await Promise.all([
        view === 'knowledge' ? Promise.resolve(null) : api<FeedResult>('/list/feed', 'POST', { ...params, knownRevision }),
        api<{ revision: string; unchanged?: boolean; items?: NoteSummary[] }>('/catalog', 'POST', { knownRevision: catalogRevision.current }),
      ]);
      if (token !== request.current || currentScope.current !== requestScope) return;
      catalogRevision.current = catalog.revision; if (catalog.items) setTree(catalog.items);
      if (!first || first.unchanged) { setLoading(false); return; }
      const result = first;
      // Restore only the range already visited; each response remains a small chunk.
      while (result.items.length < Math.min(offset + 30, result.visibleTotal)) {
        const next = await api<FeedResult>('/list/feed', 'POST', { ...params, offset: result.items.length });
        if (token !== request.current || currentScope.current !== requestScope) return;
        if (next.revision !== result.revision) { feedRevision.current = null; return; }
        if (!next.items.length) break;
        result.items.push(...next.items);
        Object.assign(result.organization.membership, next.organization.membership);
        result.organization.order.push(...next.organization.order);
      }
      feedRevision.current = { scope: requestScope, revision: result.revision }; setLoadError('');
      const pending = pendingPage.current;
      let restored = pending?.selected ?? null;
      if (pending?.key === pageKey && restored && !pending.explicit && !result.items.some(n => n.id === restored)) {
        try { if (!canRestoreNote(await api<Note>(`/notes/${restored}`), view, tag)) restored = null; }
        catch (e) { if ((e as { code?: string }).code === 'NOT_FOUND') restored = null; else throw e; }
      }
      if (token !== request.current || currentScope.current !== requestScope) return;
      setOrganization(result.organization); setGroupCounts(result.groupCounts); setVisibleTotal(result.visibleTotal);
      if (offset > Math.max(0, result.items.length - 30)) setOffset(Math.max(0, result.items.length - 30));
      setItems(result.items); setTotal(result.total); setLoading(false);
      if (pending?.key === pageKey) {
        pending.ready = true;
        setSelected(restored ?? result.items[0]?.id ?? null);
        setChecked(old => new Set([...old].filter(id => result.items.some(n => n.id === id))));
      }
    } catch (e) { if (token === request.current && currentScope.current === requestScope) { setLoading(false); showError((e as Error).message); } }
    finally { if (refreshing.current?.token === token) refreshing.current = null; }
  }, [query, view, tag, sort, offset, showError, pageKey, navigationVersion, requestScope]);
  const loadMore = useCallback(async () => {
    if (moreLock.current || loading || view === 'knowledge' || items.length >= visibleTotal || feedRevision.current?.scope !== requestScope) return;
    moreLock.current = true; moreScope.current = requestScope; setLoadingMore(true); setLoadError(''); const token = ++request.current;
    try {
      const result = await api<FeedResult>('/list/feed', 'POST', { q: query, status: view === 'archived' || view === 'trash' ? view : 'active', sort, limit: 30, offset: items.length, ...(tag ? { tag } : {}), ...(view === 'starred' ? { starred: true } : {}) });
      if (token !== request.current || currentScope.current !== requestScope) return;
      if (result.revision !== feedRevision.current?.revision) { feedRevision.current = null; setLoadError('列表已更新，正在刷新…'); return; }
      const ids = new Set(items.map(n => n.id)), next = [...items, ...result.items.filter(n => !ids.has(n.id))];
      setItems(next); setOffset(Math.max(0, next.length - 30)); setVisibleTotal(result.visibleTotal);
      setOrganization(old => ({ ...result.organization, order: next.map(n => n.id), membership: { ...old.membership, ...result.organization.membership } }));
    } catch (e) { if (currentScope.current === requestScope) setLoadError((e as Error).message); }
    finally { moreLock.current = false; setLoadingMore(false); }
  }, [loading, view, items, visibleTotal, requestScope, query, sort, tag]);
  useEffect(() => {
    const el = sentinel.current; if (!el || loadingMore || loadError) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) void loadMore(); }, { root: listScroll.current, rootMargin: '240px' });
    observer.observe(el); return () => observer.disconnect();
  }, [loadMore, loadingMore, loadError]);
  useLayoutEffect(() => {
    if (loading || pendingPage.current?.key !== pageKey || !pendingPage.current.ready) return;
    if (listScroll.current) listScroll.current.scrollTop = pendingPage.current.scrollTop;
    pendingPage.current = null;
  }, [loading, items, pageKey]);
  const changed = useCallback(() => { void refresh(); }, [refresh]);
  const feishu = useFeishuSync(changed, !stickyId);
  const syncRecords: Record<string, FeishuRecord> = Object.fromEntries((feishu.overview?.records ?? []).map(r => [r.id, r]));
  const feishuBadge = { connected: !!feishu.overview?.connected, running: feishu.running, error: !feishu.running && !!(feishu.error || feishu.overview?.lastError || feishu.overview?.report?.errors.length) };
  const invalidateList = useCallback(() => {
    // A saved organization supersedes both older refreshes and pending appends.
    request.current++; setListChangeVersion(value => value + 1);
  }, []);
  const select = useCallback((id: string) => {
    if (view === 'knowledge') navigate('active', '', { ...emptyPage(), selected: id });
    else { if (pendingPage.current?.key === pageKey) { pendingPage.current.selected = id; pendingPage.current.explicit = true; } setSelected(id); }
  }, [view, navigate, pageKey]);
  const treeActions = useTreeActions({ nodes: tree, onOpen: select, onChanged: changed, onSelected: setTreeSelected, onError: showError });
  const cleaned = useCallback((ids: string[]) => {
    for (const state of pages.current.values()) { if (state.selected && ids.includes(state.selected)) state.selected = null; state.checked = state.checked.filter(id => !ids.includes(id)); }
    if (pendingPage.current?.selected && ids.includes(pendingPage.current.selected)) pendingPage.current.selected = null;
    setItems(old => old.filter(n => !ids.includes(n.id))); setSelected(old => old && ids.includes(old) ? null : old); setChecked(new Set()); setOffset(0); changed();
  }, [changed]);
  const trashActions = useTrashActions({ onOpen: select, onChanged: cleaned, onError: showError });
  useEffect(() => {
    const purged = (event: Event) => cleaned((event as CustomEvent<string[]>).detail);
    const sync = (event: StorageEvent) => { if (event.key === 'moki-notes:purged' && event.newValue) { try { cleaned(JSON.parse(event.newValue)); } catch { /* Ignore invalid events. */ } } };
    window.addEventListener('moki:purged', purged); window.addEventListener('storage', sync);
    return () => { window.removeEventListener('moki:purged', purged); window.removeEventListener('storage', sync); };
  }, [cleaned]);
  useEffect(() => window.mokiDesktop?.onSelect(select), [select]);
  useEffect(() => {
    if (stickyId) return;
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; archived: boolean }>).detail;
      if (!detail || !/^[\da-f-]{36}$/i.test(detail.id)) return;
      navigate(detail.archived ? 'archived' : 'active', '', { ...emptyPage(), selected: detail.id });
    };
    window.addEventListener('moki:open-note', open);
    return () => window.removeEventListener('moki:open-note', open);
  }, [stickyId, navigate]);
  useEffect(() => {
    const readPins = () => { void window.mokiDesktop?.pins().then(s => setDesktopPins(old => old.length === s.ids.length && old.every((id, i) => id === s.ids[i]) ? old : s.ids)).catch(() => {}); };
    readPins(); const timer = setInterval(readPins, 1200); return () => clearInterval(timer);
  }, []);
  async function pinCard(id: string) {
    if (!window.mokiDesktop) { showError('请在桌面客户端中将便签卡片固定到桌面。'); return; }
    try {
      if (desktopPins.includes(id)) await window.mokiDesktop.unpin(id); else await window.mokiDesktop.pin(id);
      setDesktopPins((await window.mokiDesktop.pins()).ids);
    } catch (e) { showError((e as Error).message); }
  }
  useEffect(() => { const t = setTimeout(() => void refresh(), 180); return () => clearTimeout(t); }, [refresh]);
  useEffect(() => { const t = setInterval(() => void refresh(), 3500); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { if (!loading && !selected && items.length && view !== 'knowledge') setSelected(items[0].id); }, [items, selected, loading, view]);
  useEffect(() => { const imported = () => setDark(localStorage.getItem('moki-notes:theme') === 'dark'); window.addEventListener('moki-data-imported', imported); return () => window.removeEventListener('moki-data-imported', imported); }, []);
  useEffect(() => { document.documentElement.dataset.colorScheme = dark ? 'dark' : 'light'; localStorage.setItem('moki-notes:theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => {
    const sync = (e: StorageEvent) => { if (e.key === 'moki-notes:theme') setDark(e.newValue === 'dark'); };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInput.current?.focus(); }
      if (e.key === 'Escape') { setAgent(false); setSettings(false); }
      // Keep keyboard focus within the currently open modal.
      if (e.key === 'Tab') {
        const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]'); const dialog = dialogs[dialogs.length - 1];
        if (!dialog) return;
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]')).filter(el => el.getClientRects().length > 0);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  async function create(content = '', title = '未命名便签') {
    try { const n = await api<Note>('/notes', 'POST', { content, title }); navigate('active', '', { ...emptyPage(), selected: n.id }); } catch (e) { showError((e as Error).message); }
  }
  async function bulk(kind: 'archive' | 'trash' | 'restore') {
    if (!checked.size) return;
    setBusy(true); let success = 0; const failures: string[] = [];
    for (const n of items.filter(n => checked.has(n.id))) {
      try {
        if (Object.keys(localStorage).some(k => k.startsWith(`moki-notes:draft:${n.id}:`))) throw new Error('存在未保存草稿，请先保存');
        await api(`/notes/${n.id}${kind === 'archive' ? '' : `/${kind}`}`, kind === 'archive' ? 'PATCH' : 'POST', { expectedVersion: n.version, ...(kind === 'archive' ? { patch: { archived: view !== 'archived' } } : {}) }); success++;
      } catch (e) { failures.push(`${n.title}：${(e as Error).message}`); }
    }
    setBusy(false); setChecked(new Set()); await refresh();
    if (failures.length) showError(`已处理 ${success} 条；${failures.join('；')}`);
  }
  async function importFiles(files: FileList | null) {
    if (!files) return; setBusy(true); let count = 0, lastId: string | null = null;
    try {
      for (const file of Array.from(files)) {
        if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 3_600_000) throw new Error(`${file.name}：只支持不超过 3.6 MB 的 Markdown / TXT 文件`);
        const content = await file.text();
        const n = await api<Note>('/notes', 'POST', { title: file.name.replace(/\.[^.]+$/, '').slice(0, 200), content, source: `导入文件：${file.name}` }); count++; lastId = n.id;
      }
      navigate('active', '', { ...emptyPage(), selected: lastId });
    } catch (e) { showError(`已导入 ${count} 条。${(e as Error).message}`); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  const emptyTitles = { active: '还没有便签', starred: '还没有收藏', knowledge: '还没有节点', archived: '还没有归档便签', trash: '回收站是空的' };
  const emptyHints = { active: '点击新建，记下第一个想法。', starred: '点击便签上的星标，方便下次找到。', knowledge: '新建节点，连接相关想法。', archived: '暂时不用的便签可以归档，随时取回。', trash: '删除的便签会出现在这里，可恢复或彻底删除。' };
  const EmptyIcon = query || tag ? Search : icons[view];
  const tags = [...new Set(tree.flatMap(n => n.tags))].sort();
  function openCardMenu(n: NoteSummary, x: number, y: number) {
    const notes = checked.has(n.id) ? items.filter(item => checked.has(item.id)) : [n];
    if (n.deletedAt) trashActions.onMenu(n, notes, x, y);
    else treeActions.onMenu(n, x, y, { onGroup: () => setMovingNotes(notes), onPurge: () => void trashActions.prepare(notes) });
  }
  const renderCard = (n: NoteSummary) => <article className={`note-card ${selected === n.id ? 'selected' : ''}`} key={n.id} data-color={n.color} draggable={!n.deletedAt && !treeActions.busy} onDragStart={e => startNoteDrag(e, n)} onDragEnd={endNoteDrag} onContextMenu={e => { e.preventDefault(); openCardMenu(n, e.clientX, e.clientY); }} onKeyDown={e => { if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); openCardMenu(n, rect.x, rect.bottom); } }}><input className="card-checkbox" type="checkbox" aria-label={`选择 ${n.title}`} checked={checked.has(n.id)} onChange={e => setChecked(old => { const next = new Set(old); e.target.checked ? next.add(n.id) : next.delete(n.id); return next; })} /><button className="card-main" onClick={() => select(n.id)}><div className="card-title"><strong>{n.title}</strong>{n.starred && <Star size={13} fill="currentColor" />}</div><p>{n.excerpt.trim() || '还没有内容，写下第一个想法…'}</p><div className="card-bottom"><span>{new Date(n.updatedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span>{n.tags[0] && <span className="tag" title={n.tags[0]}>#{n.tags[0]}</span>}{!n.deletedAt && syncRecords[n.id] && <span className={`card-sync ${syncRecords[n.id].status}`} title={`飞书 · ${syncLabels[syncRecords[n.id].status]}${syncRecords[n.id].at ? ` · ${new Date(syncRecords[n.id].at!).toLocaleString('zh-CN')}` : ''}${syncRecords[n.id].error ? ` · ${syncRecords[n.id].error}` : ''}`}><Cloud size={12} /><span className="card-sync-label">{syncLabels[syncRecords[n.id].status]}</span></span>}<span className={`color-dot ${n.color}`} /></div></button>{!n.deletedAt && <button className={`card-pin ${desktopPins.includes(n.id) ? 'pinned' : ''}`} aria-label={`${desktopPins.includes(n.id) ? '取消桌面固定' : '固定到桌面'}：${n.title}`} title={desktopPins.includes(n.id) ? '取消桌面固定' : '固定为桌面便签卡片'} onClick={() => void pinCard(n.id)}>{desktopPins.includes(n.id) ? <PinOff size={15} /> : <Pin size={15} />}</button>}</article>;
  if (stickyId) return <StickyCard id={stickyId} />;
  return <div style={panels.style} className={`app resizable-layout ${view === 'knowledge' ? 'knowledge-mode' : ''} ${stickyId ? 'sticky-app' : ''}`}>
    {!stickyId && <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><img src="/icon.svg" alt="" /></div><div><strong>MOKI<span>便签</span></strong><small>记录想法，连接知识</small></div></div>
      <button className="primary new-note" disabled={busy} onClick={() => void create()}><Plus size={17} />新建便签</button>
      <nav>{(Object.keys(labels) as View[]).map(v => { const Icon = icons[v]; return <button aria-label={labels[v]} title={labels[v]} className={view === v && !tag ? 'selected' : ''} key={v} onClick={() => navigate(v)}><Icon size={17} /><span>{labels[v]}</span>{v === 'active' && <small>{tree.length}</small>}{v === 'starred' && <small>{tree.filter(n => n.starred).length}</small>}</button>; })}</nav>
      {!!tags.length && <><div className="sidebar-divider" /><div className="sidebar-caption"><span>标签</span><span>{tags.length}</span></div><div className="tag-cloud">{tags.map(t => <button key={t} title={t} className={tag === t ? 'selected' : ''} onClick={() => navigate('active', tag === t ? '' : t)}>#{t}</button>)}</div></>}
      <div className="sidebar-bottom"><button aria-label="连接 Agent" title="连接 Agent" className="agent-entry" onClick={() => setAgent(true)}><Bot size={19} /><div><strong>连接 Agent</strong><small>MCP · 你的本地记忆库</small></div><ChevronRight size={16} /></button>{(feishuBadge.connected || feishuBadge.running) && <button className={`sidebar-feishu ${feishuBadge.running ? 'syncing' : feishuBadge.error ? 'warning' : ''}`} aria-label={feishuBadge.running ? '飞书同步中，点击查看进度' : '飞书同步设置'} title={feishuBadge.running ? '飞书同步中，可继续编辑；点击查看进度' : feishuBadge.error ? '同步有待处理项目，点击查看' : '已连接飞书云盘，点击管理同步'} onClick={() => { setSettingsTab('feishu'); setSettings(true); }}>{feishuBadge.running ? <LoaderCircle className="settings-spinner" size={14} /> : <Cloud size={14} />}<span>{feishuBadge.running ? '飞书同步中…' : feishuBadge.error ? '飞书 · 需处理' : '飞书已连接'}</span><i /></button>}<div className="sidebar-bottom-row"><span><i />本地存储</span><div className="sidebar-tools"><button aria-label="设置" title="设置" onClick={() => { setSettingsTab('general'); setSettings(true); }}><Settings2 size={17} /></button><button title={dark ? '切换浅色主题' : '切换深色主题'} aria-label="切换主题" onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div></div><small className="sidebar-credit">Powered by JKZeng</small></div>
      {panels.sidebar}
    </aside>}
    {!stickyId && view !== 'knowledge' && <section className={`note-list ${view === 'trash' ? 'trash-list' : ''}`}>{panels.list}<header className="list-header"><div><h1>{tag ? `#${tag}` : labels[view]}</h1><span>{total} 条便签</span></div><button title="导入 Markdown / TXT" aria-label="导入便签" disabled={busy} onClick={() => fileInput.current?.click()}><FileInput size={18} /></button><input ref={fileInput} hidden type="file" multiple accept=".md,.markdown,.txt" onChange={e => void importFiles(e.target.files)} /></header><label className="search"><Search size={16} /><input ref={searchInput} aria-label="搜索便签" placeholder="搜索想法、内容、标签…" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); setChecked(new Set()); }} /><kbd>{navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K'}</kbd></label><div className="list-controls"><label><input type="checkbox" aria-label="全选当前列表" disabled={!items.length} checked={items.length > 0 && items.every(n => checked.has(n.id))} onChange={e => setChecked(e.target.checked ? new Set(items.map(n => n.id)) : new Set())} />{checked.size ? `已选 ${checked.size}` : '选择'}</label>{view === 'trash' ? <button className="clear-trash-button" aria-label="清空回收站" disabled={!total || busy || trashActions.busy} onClick={() => void trashActions.prepare()}><Trash2 size={14} />清空回收站</button> : <select aria-label="排序方式" value={sort} onChange={e => { setSort(e.target.value as typeof sort); setOffset(0); setChecked(new Set()); }}><option value="manual">手动排序</option><option value="updated">最近更新</option><option value="created">创建时间</option><option value="title">标题排序</option></select>}</div>{checked.size > 0 && <div className="bulk-bar">{view === 'trash' ? <><button disabled={busy || trashActions.busy} onClick={() => void trashActions.restore(items.filter(n => checked.has(n.id)))}>恢复所选</button><button className="danger" disabled={busy || trashActions.busy} onClick={() => void trashActions.prepare(items.filter(n => checked.has(n.id)))}>永久删除所选</button></> : <><button disabled={busy} onClick={() => void bulk('archive')}>{view === 'archived' ? '取消归档' : '归档'}</button><button disabled={busy} onClick={() => void bulk('trash')}>移入回收站</button></>}</div>}
      <div ref={listScroll} className="list-scroll">{view === 'trash' ? items.map(renderCard) : <ListGroups items={items} organization={organization} counts={groupCounts} filtered={!!(query || tag)} checked={checked} renderNote={renderCard} onError={showError} refresh={changed} onChanged={(next, manual) => { setOrganization(next); if (manual) { setSort('manual'); if (sort !== 'manual') setOffset(0); } setChecked(new Set()); invalidateList(); }} />}{!items.length && !total && <div className="empty list-empty"><EmptyIcon size={30} /><p>{loading ? '正在读取便签…' : query || tag ? '没有找到匹配的便签' : emptyTitles[view]}</p><small>{query || tag ? '试试其他关键词，或清除筛选。' : emptyHints[view]}</small>{!loading && (query || tag) && <button onClick={() => { setQuery(''); setTag(''); setOffset(0); setChecked(new Set()); }}>清除筛选</button>}</div>}<div ref={sentinel} className="list-load-more" role="status">{items.length < visibleTotal ? <button disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '正在加载…' : loadError ? '加载失败，点击重试' : '继续加载'}</button> : items.length > 0 ? <small>已显示全部 {items.length} 条便签</small> : null}</div></div>
    </section>}
    <main className="workspace">{knowledgeOpened && <div style={{ height: '100%', display: view === 'knowledge' ? 'block' : 'none' }} inert={view !== 'knowledge'}><KnowledgeWorkspace inspectorResize={panels.inspector} nodes={tree} selected={treeSelected} onSelected={setTreeSelected} onOpen={select} onChange={changed} onError={showError} {...treeActions} /></div>}{view !== 'knowledge' && (selected ? <NoteEditor readingPosition={readingPosition(selected)} key={`${pageKey}:${selected}`} id={selected} tree={tree} dark={dark} sticky={!!stickyId} onChange={changed} onSelect={select} onError={showError} onClose={() => { setItems(old => old.filter(n => n.id !== selected)); setSelected(null); }} /> : view !== 'active' || tree.length > 0 || query || tag ? <div className="workspace-empty"><span className="empty-symbol"><EmptyIcon size={28} /></span><h2>{loading ? '正在读取便签…' : query || tag ? '搜索你的便签' : emptyTitles[view]}</h2><p>{query || tag ? '从列表中打开便签，或更换关键词。' : emptyHints[view]}</p>{view === 'active' && !query && !tag && <button className="primary" onClick={() => void create()}><Plus size={16} />新建便签</button>}</div> : <div className="welcome"><div className="welcome-icon"><img src="/icon.svg" alt="MOKI便签图标" /></div><span className="eyebrow">MOKI NOTES</span><h1>留住灵感，慢慢生长。</h1><p>从一条便签开始，构建属于你的知识与记忆。</p><button className="primary" onClick={() => void create(welcome, '从这里开始 · MOKI便签')}><Plus size={17} />创建第一条便签</button><small>本地优先 · Markdown · Agent 友好</small></div>)}</main>
    {treeActions.overlay}
    {trashActions.overlay}
    {movingNotes && <ListMoveDialog notes={movingNotes} organization={organization} onClose={() => setMovingNotes(null)} onChanged={() => { setChecked(new Set()); invalidateList(); }} />}
    {error && <div className="toast" role="alert"><span>{error}</span><button className="toast-close" title="关闭提示" aria-label="关闭提示" onClick={() => setError('')}><X size={16} /></button></div>}
    {settings && <Settings feishu={feishu} initialTab={settingsTab} onClose={() => setSettings(false)} onClean={ids => { if (selected && ids.includes(selected)) setSelected(null); setChecked(new Set()); setOffset(0); changed(); }} />}
    {agent && <AgentConnection onClose={() => setAgent(false)} onSelect={select} />}
  </div>;
}
