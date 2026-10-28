import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, MoreHorizontal, Download, Copy, Trash2, LoaderCircle } from 'lucide-react';
import { assetIdFromSource, noteIdFromSource, remotePreview, videoEmbedSource, viewLabels, type AttachmentInfo, type ResourceData, type ResourceViewMode } from '../shared/resources.js';
import { api } from './api.js';
import { ResourceFileIcon } from './resource-file-icon.js';
import { ImageSurface } from './image-surface.js';
import type { Note } from '../shared/model.js';
import { NoteAttachmentExcerpt, openNoteAttachment, referencedNote } from './note-attachment.js';

function sizeLabel(size: number) { return size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`; }
export async function openEmbeddedResource(resource: ResourceData) {
  if (resource.kind === 'note') return openNoteAttachment(resource);
  if (window.mokiDesktop) return window.mokiDesktop.openResource(resource);
  const link = document.createElement('a'); link.href = resource.src; link.target = '_blank'; link.rel = 'noopener noreferrer';
  if (assetIdFromSource(resource.src)) { link.href += '?download=1'; link.download = resource.title; }
  link.click();
}
async function saveEmbeddedResource(resource: ResourceData) {
  if (resource.kind === 'note') {
    const note = await referencedNote(resource);
    if (window.mokiDesktop) return window.mokiDesktop.export(note.id, 'md');
    const link = document.createElement('a'); link.href = `/api/notes/${note.id}/export/md`; link.download = `${note.title}.md`; link.click(); return true;
  }
  if (window.mokiDesktop) return window.mokiDesktop.saveResource(resource);
  const link = document.createElement('a'), local = assetIdFromSource(resource.src);
  if (!local && (resource.kind === 'web' || videoEmbedSource(resource.src))) {
    const url = URL.createObjectURL(new Blob([`[InternetShortcut]\r\nURL=${resource.src}\r\n`], { type: 'application/octet-stream' }));
    link.href = url; link.download = `${resource.title}.url`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else { link.href = resource.src + (local ? '?download=1' : ''); link.download = resource.title; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.click(); }
  return true;
}

export function ResourceView({ resource, onChange, onRemove, imageOnly = false, imageWidth, onImageResize }: { resource: ResourceData; onChange?(next: ResourceData): void | Promise<void>; onRemove?(): void | Promise<void>; imageOnly?: boolean; imageWidth?: number | null; onImageResize?(width: number | null): void }) {
  const [mode, setMode] = useState(resource.view), [info, setInfo] = useState<AttachmentInfo | null>(null);
  const [linkedNote, setLinkedNote] = useState<Note | null>(null);
  const [error, setError] = useState(''), [missing, setMissing] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const [text, setText] = useState<{ text: string; truncated: boolean } | null>(null), [previewFailed, setPreviewFailed] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null), menuRef = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null), id = assetIdFromSource(resource.src), noteId = noteIdFromSource(resource.src);
  useEffect(() => { setMode(resource.view); }, [resource.view]);
  useEffect(() => {
    let live = true; setInfo(null); setMissing(false); setError(''); setPreviewFailed(false); setText(null);
    if (id) void api<AttachmentInfo>(`/assets/${id}`).then(value => { if (live) setInfo(value); }).catch(e => { if (live) { setMissing(true); setError(e.message); } });
    return () => { live = false; };
  }, [id, resource.src]);
  useEffect(() => {
    setLinkedNote(null);
    if (!noteId) return;
    let live = true, reading = false;
    const refresh = async () => {
      if (reading) return; reading = true;
      try {
        const note = await api<Note>(`/notes/${noteId}`);
        if (live) { setLinkedNote(note); setMissing(!!note.deletedAt); setError(note.deletedAt ? '这条便签已移入回收站，恢复后可打开' : ''); }
      } catch (e) { if (live) { setMissing(true); setError((e as { status?: number }).status === 404 ? '引用的便签已不存在' : '暂时无法读取这条便签'); } }
      finally { reading = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener('focus', refresh);
    return () => { live = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [noteId]);
  const preview = imageOnly ? 'image' : noteId ? 'note' : id ? info?.preview ?? 'none' : remotePreview(resource);
  const displayImage = imageOnly || preview === 'image' && mode === 'preview';
  useEffect(() => {
    let live = true;
    if (mode === 'preview' && preview === 'text' && id) void api<{ text: string; truncated: boolean }>(`/assets/${id}/text`).then(value => { if (live) setText(value); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [mode, preview, id]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 2500); return () => clearTimeout(timer); }, [message]);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current, b = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - b.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - b.height - 8))}px`;
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => { if (e.target instanceof Node && !menuRef.current?.contains(e.target)) setMenu(null); };
    const scroll = (e: Event) => { if (!(e.target instanceof Node && menuRef.current?.contains(e.target))) setMenu(null); };
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', scroll); window.addEventListener('wheel', scroll, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', scroll); window.removeEventListener('wheel', scroll, true); };
  }, [menu]);
  async function action(fn: () => Promise<unknown>, success?: string) {
    if (pending) return; setPending(true); setError(''); setMenu(null);
    try { const result = await fn(); if (success && result !== false) setMessage(success); } catch (e) { setError((e as Error).message); } finally { setPending(false); }
  }
  const changeMode = (view: ResourceViewMode) => action(async () => { await onChange?.({ ...resource, title: linkedNote?.title ?? resource.title, view }); setMode(view); });
  const canPreview = !missing && (preview !== 'none' || !!id && !info);
  const source = noteId ? linkedNote ? `${linkedNote.archived ? '已归档便签' : '便签'} · ${new Date(linkedNote.updatedAt).toLocaleDateString('zh-CN')}更新` : '便签引用' : info ? `${info.name} · ${sizeLabel(info.size)}` : id ? '本地附件' : imageOnly ? '图片' : new URL(resource.src).hostname;
  const title = linkedNote?.title ?? resource.title, openLabel = noteId ? '打开便签' : '使用默认应用打开';
  const open = () => void action(() => openEmbeddedResource(resource));
  const copy = () => action(() => navigator.clipboard.writeText(new URL(resource.src, location.origin).href), '链接已复制');
  const context = (x: number, y: number) => setMenu({ x, y });
  return <div ref={card} className={`resource-block resource-${mode}${displayImage ? ' resource-image' : ''}`} data-resource-id={imageOnly ? undefined : resource.id} data-resource-view={mode} data-menu-open={!!menu} contentEditable={false} onDoubleClick={e => e.stopPropagation()} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); context(e.clientX, e.clientY); }}>
    <div className="resource-bar">
      {!displayImage && <button type="button" className="resource-main" title={openLabel} disabled={pending || missing || info?.canOpen === false} onClick={open}><ResourceFileIcon resource={resource} info={info} compact={mode === 'title' || mode === 'link'} /><span className="resource-label"><strong>{mode === 'link' ? resource.src : title}</strong>{(mode === 'card' || mode === 'preview') && <small>{source}</small>}</span></button>}
      <div className="resource-controls"><button type="button" title="更多操作（也可右键）" aria-label={`${displayImage ? '图片' : '附件'}操作：${title}`} disabled={pending} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); context(rect.right - 216, rect.bottom + 5); }}><MoreHorizontal size={16} /></button></div>
    </div>
    {mode === 'preview' && <div className="resource-preview">
      {missing ? null : preview === 'note' ? <div className="note-resource-preview">{linkedNote ? <NoteAttachmentExcerpt content={linkedNote.content} /> : <p>正在读取便签…</p>}<button onClick={open}>打开完整便签<ExternalLink size={13} /></button></div> : previewFailed ? <p>此内容暂时无法预览。<button onClick={open}>使用默认应用打开<ExternalLink size={13} /></button></p> : preview === 'image' ? <ImageSurface src={resource.src} title={resource.title} width={imageWidth} onResize={onImageResize} onError={() => setPreviewFailed(true)} />
        : preview === 'video' ? <video src={resource.src} controls preload="metadata" playsInline onError={() => setPreviewFailed(true)} />
          : preview === 'audio' ? <audio src={resource.src} controls preload="metadata" onError={() => setPreviewFailed(true)} />
            : preview === 'pdf' ? <iframe src={resource.src} title={`预览：${title}`} loading="lazy" />
              : preview === 'text' ? <><pre>{text?.text ?? '正在读取…'}</pre>{text?.truncated && <small>预览前 256 KB，打开文件可查看全部内容。</small>}</>
                : preview === 'web' ? <><iframe src={videoEmbedSource(resource.src) ?? resource.src} sandbox="allow-scripts allow-same-origin allow-presentation" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" title={`预览：${title}`} loading="lazy" /><div className="resource-preview-hint">网站可能限制内嵌显示<button onClick={open}>在浏览器打开<ExternalLink size={12} /></button></div></>
                  : <p>{id && !info ? '正在读取附件…' : '此格式请通过默认应用查看。'}</p>}
    </div>}
    {pending && <div className="resource-feedback" role="status"><LoaderCircle size={13} />正在处理…</div>}{message && <div className="resource-feedback" role="status">{message}</div>}{error && <div className="resource-error" role="alert">{error}</div>}
    {menu && createPortal(<div ref={menuRef} className="editor-popup resource-context" role="menu" aria-label="资源操作" style={{ left: menu.x, top: menu.y }} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); card.current?.querySelector<HTMLButtonElement>('.resource-controls button')?.focus(); }
      if (e.key === 'Tab') setMenu(null);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const list = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])], current = list.indexOf(document.activeElement as HTMLButtonElement); list[e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
    }}>
      <button role="menuitem" disabled={missing || info?.canOpen === false} onClick={open}><ExternalLink size={14} />{openLabel}</button>
      <button role="menuitem" disabled={missing} onClick={() => void action(() => saveEmbeddedResource(resource), '已另存为')}><Download size={14} />{noteId ? '导出便签为 Markdown…' : '另存为…'}</button>
      <button role="menuitem" onClick={() => void copy()}><Copy size={14} />复制链接</button>
      {!displayImage && <><div className="resource-menu-caption">显示方式</div><div className="resource-view-options" role="group" aria-label="显示方式">{Object.entries(viewLabels).map(([view, label]) => <button role="menuitemradio" aria-checked={mode === view} key={view} disabled={view === 'preview' && !canPreview} onClick={() => void changeMode(view as ResourceViewMode)}>{label}</button>)}</div></>}
      {onRemove && <button role="menuitem" className="resource-remove" onClick={() => void action(async () => { await onRemove(); })}><Trash2 size={14} />从便签中移除</button>}
    </div>, document.body)}
  </div>;
}
