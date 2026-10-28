import { memo, useEffect, useRef, useState } from 'react';
import type { Note } from '../shared/model.js';
import { api } from './api.js';
import { MarkdownPreview } from './markdown.js';
import './knowledge-preview.css';

// The graph only carries summaries. Fetch the selected note, never render a
// truncated excerpt as Markdown (it may end inside a table, fence or image).
export const KnowledgePreview = memo(function KnowledgePreview({ id, version }: { id: string; version: number }) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setError('');
    void api<Note>(`/notes/${id}`).then(value => {
      if (!active) return;
      if (value.deletedAt) { setNote(null); setError('这条便签已移入回收站'); return; }
      setNote(value);
    }).catch(() => { if (active) { setNote(null); setError('暂时无法读取正文'); } });
    return () => { active = false; };
  }, [id, version, attempt]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [id]);
  return <div ref={scroll} className="knowledge-preview" role="region" aria-label="节点正文预览" tabIndex={0} aria-busy={!note && !error}>
    {error ? <div className="knowledge-preview-status" role="status"><p>{error}</p><button onClick={() => setAttempt(n => n + 1)}>重试</button></div>
      : note?.id !== id ? <p className="knowledge-preview-status" role="status">正在读取正文…</p>
      : !note.content.trim() ? <p className="knowledge-preview-status">还没有正文</p>
      : <MarkdownPreview content={note.content} />}
  </div>;
});
