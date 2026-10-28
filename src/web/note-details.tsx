import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Link2, Plus, Unlink, X } from 'lucide-react';
import type { Note, NotePatch, NoteSummary } from '../shared/model.js';
import { noteReferences, removeNoteReferences } from '../shared/note-references.js';
import { api } from './api.js';
import { openNoteAttachment } from './note-attachment.js';
import { TagEditor } from './tag-editor.js';
import './note-details.css';

type Resolved = NoteSummary | { id: string; missing: true };
type Props = { note: Note; onPatch(patch: NotePatch): void | Promise<void>; onSave?(): Promise<boolean>; readOnly?: boolean; onPrepare?(): Promise<boolean> };
export function NoteDetails({ note, onPatch, onSave, readOnly = false, onPrepare }: Props) {
  const [open, setOpen] = useState(false), [tab, setTab] = useState<'links' | 'tags'>('links'), [query, setQuery] = useState('');
  const [resolved, setResolved] = useState<Resolved[]>([]), [incoming, setIncoming] = useState<NoteSummary[]>([]), [candidates, setCandidates] = useState<NoteSummary[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null), lock = useRef(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const refs = useMemo(() => [...new Set(noteReferences(note.content).map(ref => ref.id))], [note.content]);
  const ids = JSON.stringify([...new Set([...note.links, ...refs])]);
  useEffect(() => {
    if (!open) return;
    let live = true; setLoading(true);
    const load = async () => {
      const keys: string[] = JSON.parse(ids), results: Resolved[] = [];
      for (let start = 0; start < keys.length; start += 200) results.push(...await api<Resolved[]>('/notes/resolve', 'POST', { ids: keys.slice(start, start + 200) }));
      const backlinks = await api<NoteSummary[]>(`/notes/${note.id}/backlinks`);
      if (live) { setResolved(results); setIncoming(backlinks); }
    };
    void load().catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, ids, note.id, refresh]);
  useEffect(() => {
    if (!open || readOnly || tab !== 'links') return;
    let live = true; setCandidates([]);
    const timer = setTimeout(() => void api<{ items: NoteSummary[] }>('/notes/query', 'POST', { q: query, status: 'all', limit: 50 }).then(result => { if (live) setCandidates(result.items); }).catch(e => { if (live) setError(e.message); }), 160);
    return () => { live = false; clearTimeout(timer); };
  }, [open, query, tab, readOnly, refresh]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect(), box = panel.current?.getBoundingClientRect();
      if (rect && box) setPosition({ left: Math.max(8, Math.min(rect.right - box.width, innerWidth - box.width - 8)), top: Math.max(8, Math.min(rect.top - box.height - 8, innerHeight - box.height - 8)) });
    };
    place(); const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place);
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [open]);
  async function run(action: () => void | Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); setRefresh(value => value + 1); }
    catch (e) { setError((e as Error).message); setRefresh(value => value + 1); }
    finally { lock.current = false; setBusy(false); }
  }
  async function openNote(id: string) {
    await openNoteAttachment({ id: crypto.randomUUID(), kind: 'note', src: `/?note=${id}`, title: '关联便签', view: 'card' }); setOpen(false);
  }
  function row(id: string, kind: 'outgoing' | 'incoming' | 'body') {
    const target = kind === 'incoming' ? incoming.find(n => n.id === id) : resolved.find(n => n.id === id);
    const missing = !target || 'missing' in target, summary = target && !('missing' in target) ? target : undefined;
    const title = summary?.title ?? (loading ? '加载中…' : '便签不存在');
    const action = kind === 'body' ? '移除正文引用' : kind === 'incoming' ? '解除反向关联' : '解除关联';
    return <div className="detail-note-row" key={id}>
      <button type="button" className="detail-note-open" aria-label={`打开关联便签：${title}`} disabled={busy || missing || !!summary?.deletedAt} title={title} onClick={() => void run(() => openNote(id))}><span>{title}<small>{summary?.deletedAt ? '回收站' : summary?.archived ? '已归档' : ''}</small></span><ArrowUpRight size={14} /></button>
      <button type="button" className="detail-unlink" aria-label={`${action}：${title}`} title={action} disabled={busy || readOnly || (kind === 'incoming' && !summary)} onClick={() => void run(async () => {
        if (kind === 'body') await onPatch({ content: removeNoteReferences(note.content, id) });
        else if (kind === 'outgoing') await onPatch({ links: note.links.filter(key => key !== id) });
        else if (summary) await api(`/notes/${id}`, 'PATCH', { expectedVersion: summary.version, patch: { links: summary.links.filter(key => key !== note.id) } });
      })}><Unlink size={14} /></button>
    </div>;
  }
  return <>
    <button ref={trigger} type="button" className={`note-details-trigger ${open ? 'active' : ''}`} aria-label="关联便签与标签" aria-expanded={open} title="关联便签与标签" onClick={() => { setOpen(value => !value); setError(''); }}><Link2 size={15} /><span>关联与标签</span></button>
    {open && createPortal(<section ref={panel} className="note-details-panel" role="dialog" aria-label="关联便签与标签" style={position}>
      <header><div className="detail-tabs"><button type="button" aria-pressed={tab === 'links'} onClick={() => setTab('links')}>关联便签</button><button type="button" aria-pressed={tab === 'tags'} onClick={() => setTab('tags')}>标签 {note.tags.length || ''}</button></div><button type="button" aria-label="关闭关联面板" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button></header>
      <div className="note-details-scroll">
        {readOnly && <p className="detail-hint">{onPrepare ? <>保存正文后可管理关联和标签。<button type="button" disabled={busy} onClick={() => void run(async () => { if (!await onPrepare()) throw new Error('正文未能保存，请先处理保存提示'); })}>保存正文并管理</button></> : '回收站中的便签仅供查看。'}</p>}
        {error && <p className="detail-error" role="alert">{error}</p>}
        {tab === 'tags' ? <TagEditor value={note.tags} disabled={readOnly || busy} onChange={tags => onPatch({ tags })} /> : <>
          <h4>主动关联 <small>{note.links.length}</small></h4>{note.links.map(id => row(id, 'outgoing'))}{!note.links.length && <p className="detail-empty">暂无主动关联</p>}
          <h4>反向关联 <small>{incoming.length}</small></h4>{incoming.map(n => row(n.id, 'incoming'))}{incoming.length > 0 && <p className="detail-hint">解除后立即保存到来源便签。</p>}{!incoming.length && <p className="detail-empty">{loading ? '正在读取…' : '暂无其他便签关联到这里'}</p>}
          <h4>正文引用 <small>{refs.length}</small></h4>{refs.map(id => row(id, 'body'))}{!refs.length && <p className="detail-empty">暂无便签附件引用</p>}
          {!readOnly && <><h4>添加关联</h4><input className="detail-search" aria-label="搜索可关联便签" placeholder="搜索便签标题、正文或标签…" maxLength={500} value={query} onChange={e => setQuery(e.target.value)} /><div className="detail-candidates">{candidates.filter(n => n.id !== note.id && !note.links.includes(n.id)).map(n => <button type="button" key={n.id} disabled={busy || note.links.length >= 100} aria-label={`添加关联：${n.title}`} title={n.title} onClick={() => void run(() => onPatch({ links: [...note.links, n.id] }))}><Plus size={14} /><span>{n.title}</span>{n.archived && <small>已归档</small>}</button>)}</div><p className="detail-hint">显示前 50 条搜索结果。解除关联不会删除便签；移除正文引用会移除该便签的全部附件引用。</p></>}
        </>}
      </div>
      {onSave && !readOnly && <footer><span>更改沿用便签保存设置</span><button type="button" className="primary" disabled={busy} onClick={() => void run(async () => { if (!await onSave()) throw new Error('未能保存，请先处理便签的保存提示'); })}>保存更改</button></footer>}
    </section>, document.body)}
  </>;
}
