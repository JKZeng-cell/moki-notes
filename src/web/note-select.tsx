import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { NoteSummary } from '../shared/model.js';
import { searchNoteChoices } from './note-choice.js';
import './note-select.css';

type Props = { label: string; value: string; nodes: NoteSummary[]; context?: NoteSummary[]; onChange(value: string): void; disabled?: boolean; emptyOption?: string; placeholder?: string; currentLabel?: string };
export function NoteSelect({ label, value, nodes, context = nodes, onChange, disabled = false, emptyOption, placeholder = '搜索并选择便签…', currentLabel }: Props) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0), [limit, setLimit] = useState(50);
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const listId = useId(), [position, setPosition] = useState({ left: 8, top: 8, width: 280, maxHeight: 360 });
  const matching = searchNoteChoices(nodes, query), shown = matching.slice(0, limit);
  const options = [...(emptyOption && !query.trim() ? [{ id: '', title: emptyOption }] : []), ...shown.map(note => ({ id: note.id, title: note.title }))];
  const index = Math.min(active, Math.max(0, options.length - 1));
  const title = value ? context.find(note => note.id === value)?.title ?? currentLabel ?? '当前节点（不在可选列表中）' : emptyOption ?? placeholder;
  const close = (focus = true) => { setOpen(false); if (focus) trigger.current?.focus(); };
  const choose = (id: string) => { if (disabled) return; onChange(id); close(); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    input.current?.focus();
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
      const width = Math.min(Math.max(280, rect.width), innerWidth - 16), below = innerHeight - rect.bottom - 16, above = rect.top - 16;
      const down = below >= 260 || below >= above, maxHeight = Math.max(120, Math.min(360, down ? below : above));
      const height = Math.min(popup.current?.offsetHeight ?? maxHeight, maxHeight);
      setPosition({ width, maxHeight, left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)), top: down ? Math.max(8, rect.bottom + 5) : Math.max(8, rect.top - height - 5) });
    };
    place(); const observer = new ResizeObserver(place); if (popup.current) observer.observe(popup.current);
    const outside = (e: PointerEvent) => { if (!popup.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(false); };
    const scroll = (e: Event) => { if (!popup.current?.contains(e.target as Node)) place(); };
    window.addEventListener('resize', place); window.addEventListener('scroll', scroll, true); document.addEventListener('pointerdown', outside);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  useEffect(() => { popup.current?.querySelector(`[id="${listId}-${index}"]`)?.scrollIntoView({ block: 'nearest' }); }, [index, listId]);
  const openPicker = () => { setQuery(''); setActive(0); setLimit(50); setOpen(true); };
  return <div className="note-select">
    <button ref={trigger} type="button" className="note-select-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} title={title} onClick={() => open ? close() : openPicker()} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openPicker(); } }}><span>{title}</span><ChevronDown size={14} /></button>
    {open && createPortal(<div ref={popup} className="note-select-popup" role="dialog" aria-label={`选择${label}`} style={position} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    }}>
      <div className="note-select-search"><Search size={15} /><input ref={input} role="combobox" aria-label={`搜索${label}`} aria-controls={listId} aria-expanded="true" aria-autocomplete="list" aria-activedescendant={options.length ? `${listId}-${index}` : undefined} placeholder="搜索标题或标签…" value={query} onChange={e => { setQuery(e.target.value); setActive(0); setLimit(50); }} onKeyDown={e => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(options.length ? (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0); }
        if (e.key === 'Enter') { e.preventDefault(); if (options[index]) choose(options[index].id); }
      }} /><button type="button" aria-label={`关闭${label}选择`} onClick={() => close()}><X size={15} /></button></div>
      <div className="note-select-results" role="listbox" id={listId} aria-label={`${label}候选`}>
        {options.map((option, i) => { const note = shown.find(n => n.id === option.id), parent = note?.parentId ? context.find(n => n.id === note.parentId)?.title ?? '上级节点' : '根级节点'; return <button type="button" tabIndex={-1} role="option" id={`${listId}-${i}`} key={option.id} aria-selected={value === option.id} className={i === index ? 'highlighted' : ''} onMouseDown={e => e.preventDefault()} onClick={() => choose(option.id)} title={option.title}><span><strong>{option.title}</strong>{note && <small>{parent}{note.tags.length ? ` · ${note.tags.slice(0, 3).map(tag => '#'+tag).join(' ')}` : ''}</small>}</span>{value === option.id && <Check size={14} />}</button>; })}
        {!shown.length && <p className="note-select-empty">{query ? '没有匹配的便签，试试其他标题或标签' : '暂无可选便签'}</p>}
      </div>
      <footer><span>{matching.length} 条匹配{matching.length > limit ? ` · 已显示 ${shown.length} 条` : ''}</span>{matching.length > limit && <button type="button" onClick={() => setLimit(value => value + 50)}>显示更多</button>}</footer>
    </div>, document.body)}
  </div>;
}
