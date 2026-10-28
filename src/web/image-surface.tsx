import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, Scan, RotateCcw } from 'lucide-react';
import { imageWidth } from '../shared/image-size.js';
import './image-surface.css';

function ImageViewer({ src, title, onClose }: { src: string; title: string; onClose(): void }) {
  const [zoom, setZoom] = useState<number | null>(null), [natural, setNatural] = useState({ width: 0, height: 0 });
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault(); buttons[i < 0 ? (e.shiftKey ? buttons.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [onClose]);
  const adjust = (delta: number) => setZoom(current => Math.max(.25, Math.min(4, (current ?? Math.min(1, (innerWidth - 40) / (natural.width || innerWidth), (innerHeight - 96) / (natural.height || innerHeight))) + delta)));
  return createPortal(<div ref={root} className="image-viewer" role="dialog" aria-modal="true" aria-label="图片预览" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    <header><span title={title}>{title}</span><div><button aria-label="缩小图片预览" title="缩小" onClick={() => adjust(-.25)} disabled={zoom === .25}><ZoomOut size={18} /></button><output>{zoom === null ? '适应窗口' : `${Math.round(zoom * 100)}%`}</output><button aria-label="放大图片预览" title="放大" onClick={() => adjust(.25)} disabled={zoom === 4}><ZoomIn size={18} /></button><button aria-label="原始尺寸" title="原始尺寸" onClick={() => setZoom(1)}>1:1</button><button aria-label="适应窗口" title="适应窗口" onClick={() => setZoom(null)}><Scan size={18} /></button><button aria-label="关闭图片预览" title="关闭 Esc" onClick={onClose}><X size={20} /></button></div></header>
    <div className={`image-viewer-stage ${zoom === null ? 'fit' : 'zoomed'}`} onClick={e => { if (e.target === e.currentTarget && e.detail === 1) onClose(); }}><img src={src} alt={title} draggable={false} onLoad={e => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} style={zoom !== null && natural.width ? { width: natural.width * zoom } : undefined} /></div>
  </div>, document.body);
}
export function ImageSurface({ src, title, width, onResize, onError, inline = false }: { src: string; title: string; width?: number | null; onResize?(width: number | null): void; onError?(): void; inline?: boolean }) {
  const [liveWidth, setLiveWidth] = useState(imageWidth(width)), [loaded, setLoaded] = useState(false), [viewer, setViewer] = useState(false), [resizing, setResizing] = useState(false);
  const root = useRef<HTMLDivElement & HTMLSpanElement>(null), picture = useRef<HTMLImageElement>(null);
  const closeViewer = useCallback(() => setViewer(false), []);
  const drag = useRef<{ x: number; y: number; width: number; ratio: number; horizontal: number; vertical: number; max: number; next: number } | null>(null);
  useEffect(() => { setLiveWidth(imageWidth(width)); }, [width]);
  useEffect(() => { setLoaded(!!picture.current?.complete && !!picture.current?.naturalWidth); }, [src]);
  useEffect(() => {
    const cancel = () => { if (drag.current) { drag.current = null; setResizing(false); setLiveWidth(imageWidth(width)); } };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current) { e.preventDefault(); e.stopPropagation(); cancel(); } };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true); };
  }, [width]);
  const Root = inline ? 'span' : 'div';
  return <Root ref={root} className={`image-surface${inline ? ' inline' : ''}${resizing ? ' resizing' : ''}`} style={liveWidth ? { width: liveWidth } : undefined}>
    <img ref={picture} src={src} alt={title} loading="lazy" style={liveWidth ? { width: '100%' } : undefined} onLoad={() => setLoaded(true)} onError={onError} role="button" tabIndex={0} aria-label={`放大预览：${title}`} onClick={e => { e.stopPropagation(); if (!drag.current) setViewer(true); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setViewer(true); } }} />
    {loaded && onResize && <>
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner, i) => <button key={corner} className={`image-resize-handle ${corner}`} data-image-resize="" aria-label={`调整图片大小（${['左上角', '右上角', '左下角', '右下角'][i]}）`} title="拖动等比缩放 · Esc 取消" onClick={e => e.stopPropagation()} onPointerDown={e => {
        if (e.button !== 0 || !picture.current) return; e.preventDefault(); e.stopPropagation();
        const b = picture.current.getBoundingClientRect(), container = root.current?.closest('.moki-column') ?? root.current?.closest('.rich-document');
        const available = container instanceof HTMLElement ? container.clientWidth - (container.classList.contains('rich-document') ? parseFloat(getComputedStyle(container).paddingLeft) + parseFloat(getComputedStyle(container).paddingRight) : 0) : innerWidth - 32;
        drag.current = { x: e.clientX, y: e.clientY, width: b.width, ratio: b.width / Math.max(1, b.height), horizontal: corner.endsWith('w') ? -1 : 1, vertical: corner.startsWith('n') ? -1 : 1, max: Math.max(48, Math.min(8192, available)), next: Math.round(b.width) };
        setResizing(true); e.currentTarget.setPointerCapture(e.pointerId);
      }} onPointerMove={e => {
        const d = drag.current; if (!d) return; e.preventDefault(); e.stopPropagation();
        const dx = (e.clientX - d.x) * d.horizontal, dy = (e.clientY - d.y) * d.vertical * d.ratio;
        d.next = Math.round(Math.max(48, Math.min(d.max, d.width + (Math.abs(dx) >= Math.abs(dy) ? dx : dy)))); setLiveWidth(d.next);
      }} onPointerUp={e => { const d = drag.current; if (!d) return; e.stopPropagation(); drag.current = null; setResizing(false); if (Math.abs(d.next - d.width) >= 1) onResize(d.next); }} onPointerCancel={() => { drag.current = null; setResizing(false); setLiveWidth(imageWidth(width)); }} onKeyDown={e => {
        if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); onResize(Math.round(Math.max(48, Math.min(8192, (liveWidth ?? picture.current?.clientWidth ?? 240) + (e.key === 'ArrowRight' ? 10 : -10))))); }
      }} />)}
      {resizing && <output className="image-size-label">{liveWidth} px</output>}
      {liveWidth && <button className="image-size-reset" aria-label="恢复图片原始大小" title="恢复原始大小" onClick={e => { e.stopPropagation(); onResize(null); }}><RotateCcw size={13} /></button>}
    </>}
    {viewer && <ImageViewer src={src} title={title} onClose={closeViewer} />}
  </Root>;
}
