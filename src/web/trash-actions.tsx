import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, RotateCcw, Trash2, X } from 'lucide-react';
import type { NoteSummary } from '../shared/model.js';
import type { PurgeResult, TrashPreview } from '../shared/settings.js';
import { api } from './api.js';
import { announcePurged, draftAssets, purgeMessage } from './trash-data.js';

export function useTrashActions({ onOpen, onChanged, onError }: { onOpen(id: string): void; onChanged(ids: string[]): void; onError(message: string): void }) {
  const [menu, setMenu] = useState<{ note: NoteSummary; notes: NoteSummary[]; x: number; y: number } | null>(null);
  const [confirmation, setConfirmation] = useState<{ preview: TrashPreview; all: boolean; fromList: boolean } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const lock = useRef(false), menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const element = menuRef.current!, previous = document.activeElement as HTMLElement, bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - bounds.width - 8))}px`; element.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - bounds.height - 8))}px`;
    element.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) setMenu(null); };
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', outside); window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); previous?.focus(); };
  }, [menu]);
  useEffect(() => { if (message) { const timer = setTimeout(() => setMessage(''), 7000); return () => clearTimeout(timer); } }, [message]);
  async function restore(notes: NoteSummary[]) {
    if (lock.current) return; lock.current = true; setBusy(true); setMenu(null);
    const done: string[] = [], failures: string[] = [];
    try {
      for (const note of notes) try { await api(`/notes/${note.id}/restore`, 'POST', { expectedVersion: note.version }); done.push(note.id); } catch (e) { failures.push(`${note.title}：${(e as Error).message}`); }
      onChanged(done); setMessage(`已恢复 ${done.length} 条便签`); if (failures.length) onError(failures.join('；'));
    } finally { lock.current = false; setBusy(false); }
  }
  async function prepare(notes?: NoteSummary[]) {
    if (lock.current) return; lock.current = true; setBusy(true); setMenu(null); setError('');
    try {
      const fromList = !!notes?.some(n => !n.deletedAt);
      const preview: TrashPreview = fromList ? { total: notes!.length, protected: 0, revisions: 0, affected: 0, pendingAssets: 0, candidates: notes!.map(n => ({ id: n.id, version: n.version })) } : await api<TrashPreview>('/trash/preview');
      if (notes) {
        const ids = new Set(notes.map(n => n.id)); preview.candidates = preview.candidates.filter(n => ids.has(n.id));
        if (preview.candidates.length !== ids.size) throw new Error('所选便签已变化，请刷新列表后重试');
      }
      if (!preview.candidates.length && !preview.pendingAssets) { setMessage('回收站已经清空'); onChanged([]); return; }
      setConfirmation({ preview, all: !notes, fromList });
    } catch (e) { onError((e as Error).message); onChanged([]); }
    finally { lock.current = false; setBusy(false); }
  }
  async function purge() {
    if (!confirmation || lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const ids = confirmation.preview.candidates.map(n => n.id);
      const result = await api<PurgeResult>(confirmation.fromList ? '/notes/purge' : '/trash/clear', 'POST', { candidates: confirmation.preview.candidates, protectedAssets: draftAssets(ids) });
      announcePurged(result.ids); onChanged(result.ids); setConfirmation(null); setMessage(purgeMessage(result));
      if (result.attachments?.failed.length) onError(purgeMessage(result));
    } catch (e) { setError(`${(e as Error).message}。请取消后重新选择。`); onChanged([]); }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, prepare, restore,
    onMenu: (note: NoteSummary, notes: NoteSummary[], x: number, y: number) => { if (!lock.current) setMenu({ note, notes, x, y }); },
    overlay: <>
      {menu && createPortal(<div className="tree-context" role="menu" aria-label="回收站操作" ref={menuRef} style={{ left: menu.x, top: menu.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
        if (e.key === 'Escape' || e.key === 'Tab') { e.stopPropagation(); setMenu(null); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')], index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
      }}><div className="tree-context-title">{menu.notes.length > 1 ? `已选 ${menu.notes.length} 条便签` : menu.note.title}</div>
        <button role="menuitem" onClick={() => { onOpen(menu.note.id); setMenu(null); }}><ArrowUpRight size={15} />查看便签</button>
        <button role="menuitem" onClick={() => void restore(menu.notes)}><RotateCcw size={15} />{menu.notes.length > 1 ? '恢复所选' : '恢复便签'}</button><hr />
        <button role="menuitem" className="danger" onClick={() => void prepare(menu.notes)}><Trash2 size={15} />{menu.notes.length > 1 ? '彻底删除所选' : '彻底删除'}</button>
      </div>, document.body)}
      {confirmation && <div className="modal-backdrop" onClick={() => { if (!busy) setConfirmation(null); }}><section className="dialog" role="dialog" aria-modal="true" aria-label={confirmation.all ? '清空回收站' : '永久删除便签'} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) setConfirmation(null); } }}>
        <header><h2>{confirmation.all ? '清空回收站' : '永久删除便签'}</h2><button aria-label="关闭删除确认" disabled={busy} onClick={() => setConfirmation(null)}><X size={17} /></button></header>
        <div className="dialog-body"><p>确认永久删除 {confirmation.preview.candidates.length} 条便签？{confirmation.all && '包含所有分页和搜索条件外的回收站内容。'}</p><p>正文、历史版本、桌面固定和本机草稿将被删除，无法恢复。其他便签会保留，指向这些便签的父级和关联将解除。</p><p>无其他便签、历史或草稿使用的附件一并清理；正文中的便签引用将显示失效。</p>{!!confirmation.preview.pendingAssets && <p>同时重试 {confirmation.preview.pendingAssets} 个待处理附件。</p>}{error && <p className="settings-error" role="alert">{error}</p>}</div>
        <footer><button autoFocus disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button className="settings-danger" disabled={busy} onClick={() => void purge()}>{busy ? '正在删除…' : confirmation.all ? '确认清空回收站' : '确认永久删除'}</button></footer>
      </section></div>}
      {message && <div className="tree-feedback" role="status">{message}</div>}
    </> };
}
