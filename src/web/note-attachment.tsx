import { useEffect, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { Note, NoteSummary } from '../shared/model.js';
import { noteIdFromSource, type ResourceData } from '../shared/resources.js';
import { api } from './api.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Render a bounded excerpt without resource embeds or active links. Even mutual
// note references stay finite; the full note opens only on an explicit click.
export function NoteAttachmentExcerpt({ content }: { content: string }) {
  const text = content.replace(/^:{3,}(?:moki-columns|column|end-columns)[ \t]*$/gm, '').slice(0, 800);
  return <div className="note-attachment-excerpt"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>〔{alt || '图片'}〕</span> }}>{text || '这条便签还没有正文。'}</Markdown></div>;
}

export function NoteAttachmentPicker({ excludeId, onInsert }: { excludeId?: string; onInsert(resources: ResourceData[]): void }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState<'active' | 'archived'>('active');
  const [items, setItems] = useState<NoteSummary[]>([]), [offset, setOffset] = useState(0), [more, setMore] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    const timer = setTimeout(() => {
      void api<{ items: NoteSummary[]; total: number }>('/notes/query', 'POST', { q: query, status, limit: 50, offset, sort: 'updated' }).then(result => {
        if (!live) return;
        const visible = result.items.filter(note => note.id !== excludeId && !note.deletedAt);
        setItems(previous => offset ? [...previous, ...visible.filter(n => !previous.some(p => p.id === n.id))] : visible);
        setMore(offset + result.items.length < result.total); setLoading(false);
      }).catch(e => { if (live) { setError(e.message); setLoading(false); } });
    }, 160);
    return () => { live = false; clearTimeout(timer); };
  }, [query, status, offset, excludeId]);
  const reset = () => { setOffset(0); setItems([]); setMore(false); };
  return <div className="note-attachment-picker">
    <label className="note-attachment-search"><Search size={15} /><input autoFocus aria-label="搜索其他便签" placeholder="搜索标题、正文、标签…" maxLength={500} value={query} onChange={e => { setQuery(e.target.value); reset(); }} /></label>
    <select aria-label="便签附件范围" value={status} onChange={e => { setStatus(e.target.value as 'active' | 'archived'); reset(); }}><option value="active">全部便签</option><option value="archived">已归档</option></select>
    <p className="note-attachment-hint">选择便签插入引用卡片，点击卡片可跳转。</p>
    <div className="note-attachment-list" aria-label="可插入的便签" aria-busy={loading}>
      {items.map(note => <button type="button" key={note.id} disabled={loading} aria-label={`插入便签：${note.title}`} onClick={() => onInsert([{ id: crypto.randomUUID(), kind: 'note', src: `/?note=${note.id}`, title: note.title, view: 'card' }])}><FileText size={19} /><span><strong>{note.title}</strong><small>{note.tags.length ? note.tags.map(tag => `#${tag}`).join(' ') : note.excerpt.replace(/[\r\n]+/g, ' ').slice(0, 90) || '暂无正文'}</small></span></button>)}
      {loading && <p role="status">正在查找便签…</p>}{!loading && !error && !items.length && <p>没有可插入的便签</p>}{error && <p role="alert" className="resource-error">{error}</p>}
      {more && !loading && <button type="button" onClick={() => setOffset(value => value + 50)}>加载更多</button>}
    </div>
  </div>;
}
export async function referencedNote(resource: ResourceData) {
  const id = noteIdFromSource(resource.src);
  if (resource.kind !== 'note' || !id) throw new Error('无效的便签引用');
  const note = await api<Note>(`/notes/${id}`);
  if (note.deletedAt) throw new Error('这条便签已移入回收站，恢复后可打开');
  return note;
}
export async function openNoteAttachment(resource: ResourceData) {
  const note = await referencedNote(resource);
  if (new URLSearchParams(location.search).has('sticky')) {
    if (window.mokiDesktop) return window.mokiDesktop.manager(note.id);
    location.assign(`/?note=${note.id}`); return;
  }
  window.dispatchEvent(new CustomEvent('moki:open-note', { detail: { id: note.id, archived: note.archived } }));
}
