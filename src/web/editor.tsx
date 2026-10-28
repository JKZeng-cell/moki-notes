import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NoteDetails } from './note-details.js';
import { NoteSelect } from './note-select.js';
import { hierarchyChoices } from './note-choice.js';
import { TagEditor } from './tag-editor.js';
import { RichEditor } from './rich-editor.js';
import { Archive, Bold, Check, Code2, Copy, Download, FileText, History, Image, Italic, Link, List, ListTodo, Maximize, Maximize2, Minimize, MoreHorizontal, Pin, PinOff, Quote, Save, Settings2, Star, Table2, Trash2, X } from 'lucide-react';
import { Colors, type Note, type NotePatch, type NoteSummary } from '../shared/model.js';
import { api, windowId } from './api.js';
import { announcePurged, draftAssets, purgeMessage } from './trash-data.js';
import type { PurgeResult } from '../shared/settings.js';
import { MarkdownPreview } from './markdown.js';
import { useAutoSave } from './use-autosave.js';
import { useInstallSave } from './use-install-save.js';

const editable = (n: Note): NotePatch => ({ title: n.title, content: n.content, color: n.color, tags: n.tags, parentId: n.parentId, links: n.links, starred: n.starred, archived: n.archived, knowledge: n.knowledge, source: n.source });
const colors = { violet: '浅紫', amber: '琥珀', mint: '薄荷', rose: '玫瑰', sky: '天空' };
type Props = { id: string; tree: NoteSummary[]; dark: boolean; sticky: boolean; readingPosition?: { top: number }; onChange(): void; onSelect(id: string): void; onError(message: string): void; onClose(): void };
export function NoteEditor({ id, tree, dark, sticky, readingPosition, onChange, onSelect, onError, onClose }: Props) {
  const autoSave = useAutoSave();
  const [note, setNote] = useState<Note | null>(null), [dirty, setDirty] = useState(false), [status, setStatus] = useState('加载中…');
  const [focus, setFocus] = useState(false), [meta, setMeta] = useState(false), [history, setHistory] = useState(false), [exportMenu, setExportMenu] = useState(false);
  const [revisions, setRevisions] = useState<Array<{ version: number; actor: string; action: string; at: string }>>([]), [historic, setHistoric] = useState<Note | null>(null);
  const [backlinks, setBacklinks] = useState<NoteSummary[]>([]), [pinned, setPinned] = useState(false), [top, setTop] = useState(true), [conflict, setConflict] = useState(false), [latest, setLatest] = useState<Note | null>(null);
  const current = useRef<Note | null>(null), dirtyRef = useRef(false), blocked = useRef(false), pending = useRef<Promise<boolean> | null>(null), alive = useRef(true);
  const draftPrefix = `moki-notes:draft:${id}:`;
  const draftKey = `${draftPrefix}${windowId}`;
  const [recoverable, setRecoverable] = useState<{ key: string; note: Note } | null>(null);
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!note || !readingPosition) return;
    const frame = requestAnimationFrame(() => {
      const scroll = root.current?.querySelector<HTMLElement>('.rich-scroll, .preview-panel');
      if (scroll) scroll.scrollTop = readingPosition.top;
    });
    return () => cancelAnimationFrame(frame);
  }, [note?.id, readingPosition]);
  const setCurrent = (n: Note) => { current.current = n; if (alive.current) setNote(n); };
  const change = useCallback((patch: NotePatch) => {
    if (!current.current || current.current.deletedAt) return;
    const n = { ...current.current, ...patch };
    current.current = n; setNote(n); dirtyRef.current = true; setDirty(true); setStatus(autoSave?.enabled ? '等待保存…' : '未保存 · 请手动保存');
    try { localStorage.setItem(draftKey, JSON.stringify(n)); } catch { onError('浏览器草稿空间不足，请及时保存或导出。'); }
  }, [draftKey, onError, autoSave]);
  const save = useCallback(async (): Promise<boolean> => {
    if (pending.current) { const ok = await pending.current; return ok && dirtyRef.current ? save() : ok; }
    if (!dirtyRef.current || !current.current) return true;
    if (blocked.current) return false;
    const snapshot = current.current;
    if (!snapshot.title.trim()) { setStatus('请填写标题'); return false; }
    setStatus('保存中…');
    pending.current = (async () => {
      try {
        const result = await api<Note>(`/notes/${id}`, 'PATCH', { expectedVersion: snapshot.version, patch: editable(snapshot) });
        if (current.current === snapshot) {
          setCurrent(result); dirtyRef.current = false; if (alive.current) setDirty(false); localStorage.removeItem(draftKey);
        } else if (current.current) { setCurrent({ ...current.current, version: result.version, updatedAt: result.updatedAt }); localStorage.setItem(draftKey, JSON.stringify(current.current)); }
        if (alive.current) setStatus(dirtyRef.current ? '等待保存…' : '已保存');
        onChange(); return true;
      } catch (e) {
        if ((e as { code?: string }).code === 'VERSION_CONFLICT') { blocked.current = true; if (alive.current) setConflict(true); }
        if (alive.current) setStatus(e instanceof Error ? e.message : '保存失败，草稿已保留');
        return false;
      } finally { pending.current = null; }
    })();
    const ok = await pending.current;
    return ok && dirtyRef.current ? save() : ok;
  }, [id, draftKey, onChange]);
  useInstallSave(save);
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    void api<Note>(`/notes/${id}`).then(n => {
      if (disposed) return;
      let draft: Note | null = null;
      try {
        const stored = localStorage.getItem(draftKey);
        if (stored) draft = JSON.parse(stored);
        else {
          const key = Object.keys(localStorage).find(k => k.startsWith(draftPrefix));
          if (key) setRecoverable({ key, note: JSON.parse(localStorage.getItem(key)!) });
        }
      } catch { /* Invalid browser draft is ignored. */ }
      if (draft && draft.id === id && !n.deletedAt) {
        setCurrent({ ...n, ...editable(draft) }); dirtyRef.current = true; setDirty(true);
        blocked.current = draft.version !== n.version; setConflict(blocked.current); setStatus('已恢复本机草稿');
      } else { setCurrent(n); setStatus('已保存'); }
    }).catch(e => { if (disposed) return; if (e.code === 'NOT_FOUND') { announcePurged([id]); onClose(); } else onError(e.message); });
    const poll = async () => {
      try {
        const n = await api<Note>(`/notes/${id}`);
        if (disposed || pending.current || !current.current) return;
        if (n.version !== current.current.version) {
          if (dirtyRef.current) { blocked.current = true; setConflict(true); setStatus('其他窗口或 Agent 已更新，草稿已保留'); }
          else { setCurrent(n); setStatus('已同步'); onChange(); }
        }
        setBacklinks(await api<NoteSummary[]>(`/notes/${id}/backlinks`));
        if (window.mokiDesktop) { const state = await window.mokiDesktop.pins(); if (!disposed) { setPinned(state.ids.includes(id)); setTop(state.top); } }
      } catch (e) {
        if (!disposed && (e as { code?: string }).code === 'NOT_FOUND') {
          dirtyRef.current = false; blocked.current = true; current.current = null;
          announcePurged([id]); onClose();
        }
        // Temporary disconnects keep the visible document and draft.
      }
    };
    void poll(); const timer = setInterval(() => void poll(), 1800);
    return () => { disposed = true; alive.current = false; clearInterval(timer); };
  }, [id]);
  useEffect(() => { if (!dirty || conflict || !autoSave?.enabled) return; const timer = setTimeout(() => void save(), autoSave.delayMs); return () => clearTimeout(timer); }, [note, dirty, conflict, save, autoSave]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    const keyboard = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
      if (e.key === 'Escape') { setFocus(false); setMeta(false); setHistory(false); setExportMenu(false); }
    };
    window.addEventListener('beforeunload', prevent); window.addEventListener('keydown', keyboard);
    return () => { window.removeEventListener('beforeunload', prevent); window.removeEventListener('keydown', keyboard); };
  }, [save]);
  async function action(kind: 'trash' | 'restore' | 'purge') {
    if (!current.current) return;
    if (kind === 'purge' && !confirm('永久删除这条便签、历史和本机草稿，并清理独占附件？其他便签保留，相关父级和关联会解除。此操作无法撤销。')) return;
    if (!(await save())) return;
    try {
      const n = await api<Note & { attachments?: PurgeResult['attachments'] }>(kind === 'purge' ? `/notes/${id}` : `/notes/${id}/${kind}`, kind === 'purge' ? 'DELETE' : 'POST', { expectedVersion: current.current.version, ...(kind === 'purge' ? { protectedAssets: draftAssets([id]) } : {}) });
      if (kind === 'purge') { announcePurged([id]); onClose(); if (n.attachments?.failed.length) onError(purgeMessage({ ids: [id], count: 1, attachments: n.attachments })); } else setCurrent(n);
      onChange();
    } catch (e) { onError((e as Error).message); }
  }
  async function exportFile(format: 'txt' | 'md' | 'docx') {
    if (!(await save())) { onError('请先解决保存问题，再导出当前版本。'); return; }
    setExportMenu(false);
    setStatus('正在导出…');
    try {
      if (window.mokiDesktop) { setStatus(await window.mokiDesktop.export(id, format) ? '已导出' : '已取消导出'); }
      else { const link = document.createElement('a'); link.href = `/api/notes/${id}/export/${format}`; link.download = `${note?.title}.${format}`; link.click(); setStatus('已请求下载'); }
    } catch (e) { onError((e as Error).message); }
  }
  async function togglePin() {
    if (!window.mokiDesktop) { onError('请在 MOKI便签桌面客户端中使用桌面固定功能。'); return; }
    if (!(await save())) return;
    try { if (pinned) await window.mokiDesktop.unpin(id); else await window.mokiDesktop.pin(id); setPinned(!pinned); } catch (e) { onError((e as Error).message); }
  }
  async function duplicateDraft() {
    if (!current.current) return;
    const n = await api<Note>('/notes', 'POST', { ...editable(current.current), title: `${current.current.title} · 草稿副本`.slice(0, 200) });
    localStorage.removeItem(draftKey); dirtyRef.current = false; setDirty(false); blocked.current = false; onChange(); onSelect(n.id);
  }
  if (!note) return <div className="empty editor-empty"><FileText size={36} /><p>{status}</p></div>;
  return <section ref={root} onScrollCapture={e => { if (readingPosition && e.target instanceof HTMLElement && e.target.matches('.rich-scroll, .preview-panel')) readingPosition.top = e.target.scrollTop; }} className={`editor ${focus ? 'focus' : ''} ${sticky ? 'sticky-editor' : ''}`} data-color={note.color}>
    {sticky && <div className="sticky-titlebar"><span className="drag-title">MOKI便签</span><button title={top ? '取消窗口置顶' : '窗口置顶'} aria-label="切换窗口置顶" onClick={() => { void window.mokiDesktop?.top(!top); setTop(!top); }}>{top ? <Pin size={14} /> : <PinOff size={14} />}</button><button title="打开便签管理" onClick={() => void window.mokiDesktop?.manager()}><Maximize2 size={14} /></button><button title="关闭桌面便签" onClick={() => void window.mokiDesktop?.close()}><X size={15} /></button></div>}
    <div className="editor-topbar">
      <div className="breadcrumb"><span className={`color-dot ${note.color}`} /><span>{note.parentId ? tree.find(n => n.id === note.parentId)?.title ?? '父便签' : '我的便签'}</span><span>/</span><span>{note.knowledge ? '知识便签' : '私人便签'}</span></div>
      <div className="actions">
        <button className={note.starred ? 'active' : ''} aria-label="收藏便签" title="收藏便签" onClick={() => change({ starred: !note.starred })}><Star size={17} fill={note.starred ? 'currentColor' : 'none'} /></button>
        {!sticky && <button className={pinned ? 'active' : ''} aria-label="固定到桌面" title="固定到桌面" onClick={() => void togglePin()}><Pin size={17} /></button>}
        <button title="属性与关联" aria-label="属性与关联" onClick={() => setMeta(true)}><Settings2 size={17} /></button>
        {!sticky && <button title={focus ? '退出专注编辑' : '全屏专注编辑'} aria-label={focus ? '退出专注编辑' : '全屏专注编辑'} aria-pressed={focus} onClick={() => setFocus(!focus)}>{focus ? <Minimize size={17} /> : <Maximize size={17} />}</button>}
        <div className="menu-anchor"><button title="导出便签" aria-label="导出便签" onClick={() => setExportMenu(!exportMenu)}><Download size={17} /></button>{exportMenu && <div className="dropdown">{(['md', 'txt', 'docx'] as const).map(f => <button key={f} onClick={() => void exportFile(f)}>导出为 {f.toUpperCase()}</button>)}</div>}</div>
      </div>
    </div>
    <div className="document-heading"><input aria-label="便签标题" placeholder="未命名便签" maxLength={200} value={note.title} readOnly={!!note.deletedAt || note.archived} onChange={e => change({ title: e.target.value })} /></div>
    {note.deletedAt ? <div className="notice">这条便签在回收站中。<button onClick={() => void action('restore')}>恢复便签</button><button className="danger" onClick={() => void action('purge')}>永久删除</button></div> : <>
      {recoverable && <div className="notice">发现其他窗口留下的草稿。<button onClick={() => { const recovered = { ...note, ...editable(recoverable.note) }; change(editable(recovered)); blocked.current = recoverable.note.version !== note.version; setConflict(blocked.current); setRecoverable(null); }}>恢复草稿</button><button onClick={() => setRecoverable(null)}>暂不恢复</button></div>}
      {conflict && <div className="notice conflict">检测到其他版本，自动保存已暂停。<button onClick={() => void api<Note>(`/notes/${id}`).then(setLatest).catch(e => onError(e.message))}>查看最新版本</button><button onClick={() => void duplicateDraft().catch(e => onError(e.message))}>草稿另存为新便签</button></div>}
    </>}
    {note.archived && !note.deletedAt && <div className="notice">已归档 · 只读预览<button onClick={() => { change({ archived: false }); void save(); }}>取消归档并编辑</button></div>}
    <div className="document-body unified-body">
      <RichEditor key={`${note.id}:${!!note.deletedAt || note.archived}`} disabled={!!note.deletedAt || note.archived} label={note.deletedAt || note.archived ? '便签只读预览' : '便签正文'} noteId={note.id} value={note.content} onChange={content => { if (!note.deletedAt && !note.archived) change({ content }); }} />
      <NoteDetails note={note} onPatch={change} onSave={save} readOnly={!!note.deletedAt} />
    </div>
    <footer className="editor-footer"><div className="editor-footer-summary"><span className={`save-state ${dirty ? 'pending' : ''}`} title={status}><Check size={13} /><span>{status}</span></span><div className="document-info" role="group" aria-label="便签信息" tabIndex={0}><span className="info-date">{new Date(note.updatedAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span><span className="info-divider">·</span><span className="info-count">{note.content.length.toLocaleString()} 字符</span>{note.tags.map(t => <span className="tag" key={t} title={t}>#{t}</span>)}</div></div><div className="actions"><button title="保存 Ctrl+S" aria-label="保存便签" disabled={!!note.deletedAt} onClick={() => void save()}><Save size={15} /></button><button title="版本历史" aria-label="版本历史" onClick={() => { setHistory(true); void api<typeof revisions>(`/notes/${id}/history`).then(setRevisions).catch(e => onError(e.message)); }}><History size={15} /></button><button title="复制便签" onClick={() => { void api<Note>('/notes', 'POST', { ...editable(note), title: `${note.title} · 副本`.slice(0, 200) }).then(n => { onChange(); onSelect(n.id); }).catch(e => onError(e.message)); }}><Copy size={15} /></button>{!note.deletedAt && <><button title={note.archived ? '取消归档' : '归档便签'} aria-label="归档便签" onClick={() => change({ archived: !note.archived })}><Archive size={15} /></button><button title="移入回收站" aria-label="移入回收站" onClick={() => void action('trash')}><Trash2 size={15} /></button></>}<span className="version">v{note.version}</span></div></footer>
    {meta && <div className="modal-backdrop" onClick={() => setMeta(false)}><section className="dialog" role="dialog" aria-modal="true" aria-label="便签属性" onClick={e => e.stopPropagation()}><header><h2>便签属性</h2><button autoFocus aria-label="关闭属性" onClick={() => setMeta(false)}><X size={18} /></button></header><div className="dialog-body"><label>便签颜色<div className="color-picker">{Colors.map(c => <button key={c} title={colors[c]} aria-label={colors[c]} aria-pressed={note.color === c} className={`swatch ${c} ${note.color === c ? 'picked' : ''}`} onClick={() => change({ color: c })}>{note.color === c && <Check size={16} />}</button>)}</div></label><label>父级便签<NoteSelect label="父级便签" value={note.parentId ?? ''} nodes={hierarchyChoices(tree, id, 'parent')} context={tree} emptyOption="无 · 根节点" disabled={!!note.deletedAt} onChange={value => change({ parentId: value || null })} /></label><div className="property-tags"><label>标签</label><TagEditor value={note.tags} onChange={tags => change({ tags })} disabled={!!note.deletedAt} /></div><label>资料来源<input value={note.source} placeholder="网址、作者或原始资料说明" onChange={e => change({ source: e.target.value })} /></label><label className="check-label"><input type="checkbox" checked={note.knowledge} onChange={e => change({ knowledge: e.target.checked })} />允许 Agent 检索此知识节点</label><p className="muted">关闭后不参与知识检索；已连接的 Agent 仍可通过便签 ID 直接读取。</p><div className="property-links"><label>关联便签</label><div className="property-linked-notes">{note.links.map(linkId => <span key={linkId}><span>{tree.find(n => n.id === linkId)?.title ?? '未找到便签'}</span><button type="button" disabled={!!note.deletedAt} aria-label={`解除关联：${tree.find(n => n.id === linkId)?.title ?? linkId}`} onClick={() => change({ links: note.links.filter(value => value !== linkId) })}><X size={13} /></button></span>)}</div><NoteSelect label="添加关联便签" value="" nodes={tree.filter(n => n.id !== id && !note.links.includes(n.id))} context={tree} disabled={!!note.deletedAt || note.links.length >= 100} onChange={value => { if (value) change({ links: [...note.links, value] }); }} /></div><label>反向关联</label>{backlinks.length ? backlinks.map(n => <button className="link-row" key={n.id} onClick={() => { setMeta(false); onSelect(n.id); }}><Link size={14} />{n.title}</button>) : <p className="muted">暂无其他便签关联到这里</p>}<details className="property-advanced"><summary>便签标识</summary><code className="note-id">{id}</code></details></div><footer><button className="primary" onClick={async () => { if (await save()) setMeta(false); }}>保存属性</button></footer></section></div>}
    {history && <div className="modal-backdrop" onClick={() => setHistory(false)}><section className="dialog wide" role="dialog" aria-modal="true" aria-label="版本历史" onClick={e => e.stopPropagation()}><header><h2>版本历史</h2><button autoFocus aria-label="关闭历史" onClick={() => setHistory(false)}><X size={18} /></button></header><div className="history-layout"><div className="history-list">{revisions.map(r => <button key={r.version} className={historic?.version === r.version ? 'selected' : ''} aria-pressed={historic?.version === r.version} onClick={() => void api<Note>(`/notes/${id}/revision/${r.version}`).then(setHistoric)}><strong>版本 {r.version}</strong><span>{r.actor === 'mcp-agent' ? 'Agent' : r.actor.includes('feishu') ? '飞书同步' : '本机编辑'} · {({ create: '新建', update: '修改', trash: '移入回收站', restore: '恢复' } as Record<string, string>)[r.action] ?? '内容更新'}</span><small>{new Date(r.at).toLocaleString('zh-CN')}</small></button>)}</div><div className="history-preview">{historic ? <><h2>{historic.title}</h2><MarkdownPreview content={historic.content} /><button className="primary" disabled={!!note.deletedAt} onClick={() => { change(editable(historic)); setHistory(false); }}>将此版本恢复为当前草稿</button></> : <p className="muted">选择一个版本查看</p>}</div></div></section></div>}
    {latest && <div className="modal-backdrop"><section className="dialog wide" role="dialog" aria-modal="true" aria-label="版本冲突"><header><h2>最新保存版本 · v{latest.version}</h2><button onClick={() => setLatest(null)}><X size={18} /></button></header><div className="dialog-body"><h3>{latest.title}</h3><MarkdownPreview content={latest.content} /></div><footer><button onClick={() => setLatest(null)}>保留当前草稿</button><button className="primary" onClick={() => { if (!confirm('读取最新版本将丢弃当前本机草稿，确认继续？')) return; setCurrent(latest); blocked.current = false; setConflict(false); dirtyRef.current = false; setDirty(false); localStorage.removeItem(draftKey); setLatest(null); setStatus('已读取最新版本'); }}>放弃草稿并读取最新版本</button></footer></section></div>}
  </section>;
}
