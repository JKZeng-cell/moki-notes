import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileUp, Film, Globe, Paperclip, FileText, X } from 'lucide-react';
import { NoteAttachmentPicker } from './note-attachment.js';
import type { JSONContent } from '@tiptap/core';
import { Resource, viewLabels, type AttachmentInfo, type ResourceData, type ResourceKind, type ResourceViewMode } from '../shared/resources.js';

export function attachmentResource(info: AttachmentInfo): JSONContent {
  if (info.preview === 'image') return { type: 'image', attrs: { src: info.src, alt: info.name } };
  return { type: 'resourceEmbed', attrs: { id: crypto.randomUUID(), src: info.src, title: info.name, kind: info.preview === 'video' ? 'video' : 'file', view: ['video', 'audio'].includes(info.preview) ? 'preview' : 'card' } };
}
export async function uploadResourceFiles(files: File[]) {
  const results: JSONContent[] = [];
  for (const file of files) {
    if (file.size > 256 * 1024 * 1024) throw new Error('拖放或浏览器上传最大支持 256 MB；更大的文件请用桌面客户端“选择本地文件”插入');
    const response = await fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
    const body = await response.json(); if (!response.ok) throw new Error(body.message ?? '附件导入失败');
    results.push(attachmentResource(body));
  }
  return results;
}
export function ResourceInsert({ initialKind, excludeNoteId, onInsert, onClose }: { initialKind: ResourceKind; excludeNoteId?: string; onInsert(resources: JSONContent[]): void; onClose(): void }) {
  const [kind, setKind] = useState(initialKind), [url, setUrl] = useState(''), [title, setTitle] = useState(''), [view, setView] = useState<ResourceViewMode>(initialKind === 'video' ? 'preview' : 'card');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null), lock = useRef(false);
  async function importFiles(files?: File[]) {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const resources = files ? await uploadResourceFiles(files) : (await window.mokiDesktop!.importResources(kind === 'video')).map(attachmentResource);
      if (resources.length) onInsert(resources);
    } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  }
  return createPortal(<div className="modal-backdrop" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); } }}>
    <form className="dialog resource-insert-dialog" role="dialog" aria-modal="true" aria-label="插入网页、视频或附件" onSubmit={event => {
      event.preventDefault(); if (busy || kind === 'note') return;
      try {
        const normalized = new URL(url.trim());
        const resource = Resource.parse({ id: crypto.randomUUID(), kind, src: normalized.href, title: title.trim() || normalized.hostname, view });
        onInsert([{ type: 'resourceEmbed', attrs: resource }]);
      } catch { setError('请输入有效的 http / https 地址和标题'); }
    }}>
      <header><h2>插入内容</h2><button type="button" aria-label="关闭资源插入" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <div className="resource-insert-tabs" role="group" aria-label="资源类型">{([['web', '网页', Globe], ['video', '视频', Film], ['file', '文件附件', Paperclip], ['note', '其他便签', FileText]] as const).map(([id, label, Icon]) => <button type="button" key={id} aria-pressed={kind === id} disabled={busy} onClick={() => { setKind(id); setError(''); setView(id === 'video' ? 'preview' : 'card'); }}><Icon size={16} />{label}</button>)}</div>
      <div className="dialog-body">
        {kind === 'note' && <NoteAttachmentPicker excludeId={excludeNoteId} onInsert={resources => onInsert(resources.map(resource => ({ type: 'resourceEmbed', attrs: resource })))} />}
        {(kind === 'web' || kind === 'video') && <><label>链接地址<input autoFocus aria-label="资源链接地址" placeholder={kind === 'video' ? '视频直链或 YouTube 链接' : 'https://…'} value={url} disabled={busy} onChange={e => setUrl(e.target.value)} /></label><label>显示标题<input aria-label="资源显示标题" placeholder="留空使用网站名称" value={title} maxLength={250} disabled={busy} onChange={e => setTitle(e.target.value)} /></label><label>显示方式<select aria-label="插入资源显示方式" value={view} disabled={busy} onChange={e => setView(e.target.value as ResourceViewMode)}>{Object.entries(viewLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>}
        {(kind === 'file' || kind === 'video') && <div className="resource-file-picker" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) void importFiles([...e.dataTransfer.files]); }}><FileUp size={27} /><p>{kind === 'video' ? '也可以插入本地视频' : '文件会复制到便签附件目录'}</p><button type="button" className="primary" disabled={busy} onClick={() => window.mokiDesktop ? void importFiles() : picker.current?.click()}>{busy ? '正在导入…' : '选择本地文件'}</button><small>支持多选，也可拖放文件到这里</small><input ref={picker} type="file" multiple accept={kind === 'video' ? 'video/*' : undefined} aria-label="上传附件" hidden disabled={busy} onChange={e => { if (e.target.files) void importFiles([...e.target.files]); }} /></div>}
        {error && <p role="alert" className="resource-error">{error}</p>}
      </div><footer><button type="button" disabled={busy} onClick={onClose}>取消</button>{(kind === 'web' || kind === 'video') && <button className="primary" disabled={busy || !url.trim()}>插入</button>}</footer>
    </form>
  </div>, document.body);
}
