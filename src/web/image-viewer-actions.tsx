import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Download, ExternalLink } from 'lucide-react';
import { assetIdFromSource, type ResourceData } from '../shared/resources.js';
import { openEmbeddedResource, saveEmbeddedResource } from './resource-actions.js';
import { copyEmbeddedImage } from './resource-clipboard.js';

// Keep the menu inside the modal, so its focus, stacking and feedback belong to the preview.
export function ImageViewerActions({ src, title, children }: { src: string; title: string; children: ReactNode }) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState(false), [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null), busy = useRef(false);
  const [resourceId] = useState(() => crypto.randomUUID());
  const resource: ResourceData = { id: resourceId, kind: 'file', view: 'preview', src: new URL(src, location.origin).href, title };
  // Managed attachments must keep their relative source for the native resource resolver.
  if (assetIdFromSource(src)) resource.src = src;
  const close = useCallback(() => { setPoint(null); root.current?.querySelector<HTMLImageElement>('.image-viewer-stage img')?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    if (!point || !menu.current) return;
    const el = menu.current, rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(point.x, innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(point.y, innerHeight - rect.height - 8))}px`;
    (el.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? el).focus({ preventScroll: true });
  }, [point]);
  useEffect(() => {
    if (!point) return;
    const outside = (e: Event) => { if (e.target instanceof Node && !menu.current?.contains(e.target)) setPoint(null); };
    const resize = () => close();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('wheel', outside, true); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('wheel', outside, true); window.removeEventListener('resize', resize); };
  }, [point, close]);
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(null), feedback.error ? 8000 : 3000); return () => clearTimeout(timer); }, [feedback]);
  async function run(fn: () => Promise<unknown>, message?: string) {
    if (busy.current) return;
    busy.current = true; setPending(true); setFeedback(null); close();
    try { const result = await fn(); if (result !== false && message) setFeedback({ text: message }); }
    catch (e) { setFeedback({ text: (e as Error).message || '操作失败，请重试', error: true }); }
    finally { busy.current = false; setPending(false); }
  }
  return <div ref={root} className="image-viewer-content" onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setPoint({ x: e.clientX, y: e.clientY }); }} onKeyDown={e => {
    if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') {
      e.preventDefault(); e.stopPropagation();
      const rect = root.current?.getBoundingClientRect();
      if (rect) setPoint({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
  }}>
    {children}
    {point && <div ref={menu} className="editor-popup resource-context image-viewer-menu" role="menu" tabIndex={-1} aria-label="图片预览操作" style={{ left: point.x, top: point.y }} onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])], i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}>
      <button role="menuitem" disabled={pending} onClick={() => void run(() => copyEmbeddedImage(resource), '图片已复制，可直接粘贴')}><Copy size={14} />复制图片</button>
      {assetIdFromSource(src) && window.mokiDesktop && <button role="menuitem" disabled={pending} onClick={() => void run(() => window.mokiDesktop!.copyResourceFile(resource), '文件已复制，可直接粘贴')}><Copy size={14} />复制原文件</button>}
      <button role="menuitem" disabled={pending} onClick={() => void run(() => saveEmbeddedResource(resource), '已另存为')}><Download size={14} />另存为…</button>
      <button role="menuitem" disabled={pending} onClick={() => void run(() => navigator.clipboard.writeText(new URL(src, location.origin).href), '链接已复制')}><Copy size={14} />复制链接</button>
      <button role="menuitem" disabled={pending} onClick={() => void run(() => openEmbeddedResource(resource))}><ExternalLink size={14} />使用默认应用打开</button>
    </div>}
    {(pending || feedback) && <div className={`image-viewer-feedback${feedback?.error ? ' error' : ''}`} role={feedback?.error ? 'alert' : 'status'}>{pending ? '正在处理…' : feedback?.text}</div>}
  </div>;
}
