import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { addTags, type HistoricalTag } from '../shared/tags.js';
import { api } from './api.js';
import './note-details.css';

export function TagEditor({ value, onChange, disabled = false }: { value: string[]; onChange(tags: string[]): void | Promise<void>; disabled?: boolean }) {
  const [input, setInput] = useState(''), [history, setHistory] = useState<HistoricalTag[]>([]), [error, setError] = useState(''), [historyError, setHistoryError] = useState(''), [busy, setBusy] = useState(false), [limit, setLimit] = useState(8);
  const root = useRef<HTMLDivElement>(null), lock = useRef(false), latest = useRef(value); latest.current = value;
  useEffect(() => { let live = true; void api<HistoricalTag[]>('/tags').then(tags => { if (live) setHistory(tags); }).catch(() => { if (live) setHistoryError('历史标签暂时不可用，仍可手动添加'); }); return () => { live = false; }; }, []);
  async function apply(next: string[], clearInput = false) {
    if (disabled || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const previous = latest.current;
      await onChange(next); latest.current = next;
      setHistory(items => [...new Set([...next, ...previous, ...items.map(item => item.tag)])].map(tag => ({ tag, count: items.find(item => item.tag === tag)?.count ?? 0 })));
      if (clearInput) setInput('');
    }
    catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  function add() {
    if (!input.trim() || lock.current || disabled) return;
    try { void apply(addTags(latest.current, input), true); } catch (e) { setError((e as Error).message); }
  }
  const query = input.trim().replace(/^#/, '').toLocaleLowerCase();
  const candidates = history.filter(item => !value.includes(item.tag) && item.tag.toLocaleLowerCase().includes(query));
  return <div ref={root} className="tag-editor" role="group" aria-label="便签标签设置">
    <div className="tag-capsules" aria-label="已选标签">{value.map(tag => <span className="tag-capsule" key={tag}><span title={tag}>#{tag}</span><button type="button" disabled={disabled || busy} aria-label={`移除标签：${tag}`} onClick={() => void apply(latest.current.filter(t => t !== tag))}><X size={12} /></button></span>)}{!value.length && <span className="tag-empty">尚未设置标签</span>}</div>
    <div className="tag-entry"><input aria-label="添加或搜索标签" value={input} disabled={disabled || busy} placeholder="输入新标签，或搜索历史标签" onChange={e => { setInput(e.target.value); setError(''); setLimit(8); }} onKeyDown={e => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (['Enter', ',', '，', ';', '；'].includes(e.key)) { e.preventDefault(); add(); } }} onBlur={e => { if (!root.current?.contains(e.relatedTarget as Node | null)) add(); }} /><button type="button" title="添加标签" aria-label="添加标签" disabled={disabled || busy || !input.trim()} onClick={add}><Plus size={15} /></button></div>
    <div className="tag-history-heading"><span>历史标签</span><small>Enter 添加 · 可用逗号分隔</small></div>
    <div className="tag-history" aria-label="历史标签">{candidates.slice(0, limit).map(({ tag, count }) => <button type="button" className="tag-capsule" key={tag} disabled={disabled || busy || value.length >= 40} title={`${count} 条便签使用`} onClick={() => void apply([...latest.current, tag], true)}>#{tag}<small>{count || '历史'}</small></button>)}{!candidates.length && <small>{historyError || (query ? '没有匹配的历史标签，可添加为新标签' : '暂无其他历史标签')}</small>}{candidates.length > limit && <button type="button" className="tag-more" onClick={() => setLimit(limit + 24)}>显示更多</button>}</div>
    {error && <p role="alert" className="detail-error">{error}</p>}
  </div>;
}
