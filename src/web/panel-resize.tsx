import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PANEL_STORAGE, panelLayout, parsePanelWidths, type PanelKey, type PanelWidths } from './panel-layout.js';

type ResizeProps = { name: string; value: number; min: number; max: number; side?: 'left' | 'right'; className: string; onPreview(value: number | null): void; onCommit(value: number | null): void };
export function PanelResize({ name, value, min, max, side = 'right', className, onPreview, onCommit }: ResizeProps) {
  const root = useRef<HTMLDivElement>(null), drag = useRef<{ id: number; x: number; width: number; next: number; moved: boolean } | null>(null);
  const [active, setActive] = useState(false), sign = side === 'left' ? -1 : 1;
  const clamp = (next: number) => Math.round(Math.max(min, Math.min(max, next)));
  function finish(commit: boolean) {
    const started = drag.current; if (!started) return;
    drag.current = null; setActive(false); document.body.classList.remove('resizing-panels');
    if (root.current?.hasPointerCapture(started.id)) root.current.releasePointerCapture(started.id);
    if (commit && started.moved) onCommit(started.next); else onPreview(null);
  }
  useEffect(() => {
    const cancel = () => finish(false);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current) { e.preventDefault(); e.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); };
  });
  useEffect(() => () => { document.body.classList.remove('resizing-panels'); }, []);
  function move(x: number) {
    const started = drag.current; if (!started) return;
    if (!started.moved && Math.abs(x - started.x) < 2) return;
    started.moved = true; started.next = clamp(started.width + (x - started.x) * sign); onPreview(started.next);
  }
  return <div ref={root} className={`panel-resize ${className} ${active ? 'dragging' : ''}`} role="separator" tabIndex={0} aria-label={name} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-valuetext={`${Math.round(value)} 像素`} title={`${name}：拖动调整，方向键微调，双击恢复默认`} onPointerDown={e => {
    if (e.button !== 0 || !e.isPrimary || drag.current) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.focus();
    drag.current = { id: e.pointerId, x: e.clientX, width: value, next: value, moved: false }; setActive(true); document.body.classList.add('resizing-panels'); e.currentTarget.setPointerCapture(e.pointerId);
  }} onPointerMove={e => { if (drag.current?.id === e.pointerId) move(e.clientX); }} onPointerUp={e => { if (drag.current?.id === e.pointerId) { move(e.clientX); finish(true); } }} onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)} onDoubleClick={() => { finish(false); onCommit(null); }} onKeyDown={e => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      onCommit(e.key === 'Home' ? min : e.key === 'End' ? max : clamp(value + (e.key === 'ArrowRight' ? 1 : -1) * sign * (e.shiftKey ? 30 : 10)));
    }
    if (e.key === 'Enter') { e.preventDefault(); onCommit(null); }
  }} />;
}

export function usePanelLayout(knowledge: boolean, onError: (message: string) => void) {
  const [width, setWidth] = useState(window.innerWidth), [preferred, setPreferred] = useState<PanelWidths>(() => parsePanelWidths(localStorage.getItem(PANEL_STORAGE))), [preview, setPreview] = useState<PanelWidths>({});
  const current = useRef(preferred); current.current = preferred;
  useEffect(() => {
    const resize = () => { setWidth(window.innerWidth); setPreview({}); };
    const sync = (event: StorageEvent) => { if (event.key === PANEL_STORAGE) { const next = parsePanelWidths(event.newValue); current.current = next; setPreferred(next); setPreview({}); } };
    window.addEventListener('resize', resize); window.addEventListener('storage', sync);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => { setPreview({}); }, [knowledge]);
  const sizes = panelLayout(width, knowledge, { ...preferred, ...preview });
  function props(key: PanelKey): ResizeProps {
    return { name: { sidebar: '调整侧边栏宽度', list: '调整便签列表宽度', inspector: '调整知识树详情栏宽度' }[key], value: sizes[key], min: key === 'sidebar' ? 180 : key === 'list' ? 220 : 200, max: sizes[`${key}Max`], side: key === 'inspector' ? 'left' : 'right', className: `panel-resize-${key}`,
      onPreview: value => setPreview(previous => { const next = { ...previous }; if (value === null) delete next[key]; else next[key] = value; return next; }),
      onCommit: value => {
        const next = { ...current.current }; if (value === null) delete next[key]; else next[key] = value;
        current.current = next; setPreferred(next); setPreview(previous => { const result = { ...previous }; delete result[key]; return result; });
        try { localStorage.setItem(PANEL_STORAGE, JSON.stringify(next)); } catch { onError('宽度已调整，但无法保存布局设置'); }
      } };
  }
  return { style: { '--sidebar-width': `${sizes.sidebar}px`, '--list-width': `${sizes.list}px`, '--inspector-width': `${sizes.inspector}px` } as CSSProperties,
    sidebar: width > 860 ? <PanelResize {...props('sidebar')} /> : null,
    list: width > 620 ? <PanelResize {...props('list')} /> : null,
    inspector: width > 620 ? <PanelResize {...props('inspector')} /> : null };
}
