import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, CornerDownRight, FilePlus2, FolderInput, Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Note, NoteSummary } from '../shared/model.js';
import type { TreeMoveInput } from '../shared/tree.js';
import type { DragNote } from './tree-drag.js';
import { api } from './api.js';
import { NoteSelect } from './note-select.js';

type ListMenu = { onGroup(): void; onPurge(): void };
type Dialog = { kind: 'create' | 'rename' | 'move' | 'add' | 'trash'; note?: NoteSummary; parentId?: string | null };
export function useTreeActions({ nodes, onOpen, onChanged, onSelected, onError }: { nodes: NoteSummary[]; onOpen(id: string): void; onChanged(): void; onSelected(id: string): void; onError(message: string): void }) {
  const [menu, setMenu] = useState<{ note: NoteSummary; x: number; y: number; list?: ListMenu } | null>(null), [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState(''), [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const lock = useRef(false), menuRef = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), formRef = useRef<HTMLElement>(null);
  function guard(id: string) { if (Object.keys(localStorage).some(k => k.startsWith(`moki-notes:draft:${id}:`))) throw new Error('这条便签有未保存草稿，请先保存或处理草稿，再整理层级。'); }
  async function move(source: DragNote, destination: NoteSummary | null, placement: TreeMoveInput['placement']) {
    guard(source.id);
    return api<Note>(`/notes/${source.id}/move`, 'POST', { expectedVersion: source.version, targetId: destination?.id ?? null, targetVersion: destination?.version, placement });
  }
  function open(next: Dialog) { setMenu(null); setError(''); setName(next.kind === 'rename' ? next.note!.title : ''); setTarget(''); setDialog(next); }
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement, el = menuRef.current!;
    const bounds = el.getBoundingClientRect(); el.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - bounds.width - 8))}px`; el.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - bounds.height - 8))}px`;
    el.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (e: PointerEvent) => { if (!el.contains(e.target as Node)) setMenu(null); };
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', outside); window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); previous?.focus(); };
  }, [menu]);
  useEffect(() => { if (dialog) { input.current?.focus(); input.current?.select(); if (!input.current) formRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); } }, [dialog]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer); }, [message]);
  const handlers = {
    onCreate: (parentId: string | null) => { if (!lock.current) open({ kind: 'create', parentId }); },
    onMenu: (note: NoteSummary, x: number, y: number, list?: ListMenu) => { if (!lock.current) { onSelected(note.id); setMenu({ note, x, y, list }); } },
    onMove: async (source: DragNote, destination: NoteSummary | null, placement: TreeMoveInput['placement']) => {
      if (lock.current) return; lock.current = true; setBusy(true);
      try { await move(source, destination, placement); onSelected(source.id); onChanged(); setMessage('已移动，子节点和跨节点关联已保留'); }
      catch (e) { onError((e as Error).message); onChanged(); }
      finally { lock.current = false; setBusy(false); }
    },
  };
  const excluded = new Set<string>();
  if (dialog?.kind === 'move') {
    const children = new Map<string, string[]>();
    for (const n of nodes) if (n.parentId) { const list = children.get(n.parentId) ?? []; list.push(n.id); children.set(n.parentId, list); }
    const stack = [dialog.note!.id];
    while (stack.length) { const id = stack.pop()!; if (excluded.has(id)) continue; excluded.add(id); stack.push(...(children.get(id) ?? [])); }
  } else if (dialog?.kind === 'add') {
    const parents = new Map(nodes.map(n => [n.id, n.parentId])); let id: string | null = dialog.note!.id;
    while (id && !excluded.has(id)) { excluded.add(id); id = parents.get(id) ?? null; }
  }
  const choices = nodes.filter(n => !excluded.has(n.id));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!dialog || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (dialog.kind === 'create') {
        const n = await api<Note>('/notes', 'POST', { title: name.trim(), parentId: dialog.parentId ?? null });
        onSelected(n.id); setMessage(`已新建「${n.title}」`);
      } else if (dialog.kind === 'rename') {
        guard(dialog.note!.id);
        await api(`/notes/${dialog.note!.id}`, 'PATCH', { expectedVersion: dialog.note!.version, patch: { title: name.trim() } }); setMessage('标题已更新');
      } else if (dialog.kind === 'trash') {
        guard(dialog.note!.id);
        await api(`/notes/${dialog.note!.id}/trash`, 'POST', { expectedVersion: dialog.note!.version }); setMessage('已移入回收站，子便签仍保留');
      } else if (dialog.kind === 'move') {
        const destination = target ? nodes.find(n => n.id === target) : null;
        if (target && !destination) throw new Error('目标已变化，请重新选择');
        await move(dialog.note!, destination ?? null, 'inside'); setMessage('已移动到所选层级');
      } else {
        const source = nodes.find(n => n.id === target); if (!source) throw new Error('请选择要添加的便签');
        await move(source, dialog.note!, 'inside'); onSelected(source.id); setMessage('已将已有便签放入下级');
      }
      setDialog(null); onChanged();
    } catch (e) { setError((e as Error).message); onChanged(); }
    finally { lock.current = false; setBusy(false); }
  }
  const title = dialog?.kind === 'create' ? '新建节点' : dialog?.kind === 'rename' ? '重命名节点' : dialog?.kind === 'move' ? '移动到层级' : dialog?.kind === 'add' ? '添加已有便签' : '移入回收站';
  const overlay = <>
    {menu && createPortal(<div className="tree-context" role="menu" aria-label="节点操作" ref={menuRef} style={{ left: menu.x, top: menu.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
      if (e.key === 'Escape' || e.key === 'Tab') { e.stopPropagation(); setMenu(null); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')], index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    }}><div className="tree-context-title">{menu.note.title}</div>
      <button role="menuitem" onClick={() => { onOpen(menu.note.id); setMenu(null); }}><ArrowUpRight size={15} />打开便签</button>
      <button role="menuitem" onClick={() => open({ kind: 'create', parentId: menu.note.id })}><Plus size={15} />新建下级节点</button>
      <button role="menuitem" onClick={() => open({ kind: 'create', parentId: menu.note.parentId })}><FilePlus2 size={15} />新建同级节点</button>
      <button role="menuitem" onClick={() => open({ kind: 'add', note: menu.note })}><Link2 size={15} />添加已有便签</button><hr />
      <button role="menuitem" onClick={() => open({ kind: 'rename', note: menu.note })}><Pencil size={15} />重命名</button>
      <button role="menuitem" onClick={() => open({ kind: 'move', note: menu.note })}><FolderInput size={15} />移动到知识树层级</button>
      {menu.list && <button role="menuitem" onClick={() => { menu.list!.onGroup(); setMenu(null); }}><FolderInput size={15} />移动到分组</button>}
      <button role="menuitem" onClick={() => { void handlers.onMove(menu.note, null, 'inside'); setMenu(null); }}><CornerDownRight size={15} />移至根级末尾</button><hr />
      <button role="menuitem" className="danger" onClick={() => open({ kind: 'trash', note: menu.note })}><Trash2 size={15} />移入回收站</button>
      {menu.list && <button role="menuitem" className="danger" onClick={() => { menu.list!.onPurge(); setMenu(null); }}><Trash2 size={15} />彻底删除</button>}
    </div>, document.body)}
    {dialog && <div className="modal-backdrop" onClick={() => { if (!busy) setDialog(null); }}><section ref={formRef} className="dialog tree-action-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) setDialog(null); } }}>
      <header><h2>{title}</h2><button aria-label="关闭节点操作" disabled={busy} onClick={() => setDialog(null)}><X size={17} /></button></header><form onSubmit={e => void submit(e)}>
        <p>{dialog.kind === 'create' ? `添加到：${nodes.find(n => n.id === dialog.parentId)?.title ?? '根级节点'}` : dialog.note?.title}</p>
        {(dialog.kind === 'create' || dialog.kind === 'rename') && <label>节点名称<input ref={input} aria-label="节点名称" required maxLength={200} value={name} placeholder="写下一个主题…" disabled={busy} onChange={e => setName(e.target.value)} /></label>}
        {(dialog.kind === 'move' || dialog.kind === 'add') && <><label>{dialog.kind === 'move' ? '目标父级' : '已有便签'}<NoteSelect label="目标便签" value={target} nodes={choices.filter(n => dialog.kind !== 'add' || n.parentId !== dialog.note?.id)} context={nodes} disabled={busy} emptyOption={dialog.kind === 'move' ? '根级节点' : undefined} onChange={setTarget} /></label><small>支持按标题或标签搜索。移动便签时保留其下级结构与跨节点关联。</small></>}
        {dialog.kind === 'trash' && <p>仅将当前便签移入回收站，下级便签仍会保留并显示在根级。可在回收站恢复。</p>}
        {error && <p className="tree-action-error" role="alert">{error}</p>}
        <footer><button type="button" disabled={busy} onClick={() => setDialog(null)}>取消</button><button className="primary" disabled={busy || (dialog.kind === 'create' || dialog.kind === 'rename') && !name.trim() || dialog.kind === 'add' && !target}>{busy ? '正在保存…' : dialog.kind === 'create' ? '新建' : '确认'}</button></footer>
      </form></section></div>}
    {message && <div className="tree-feedback" role="status">{message}</div>}
  </>;
  return { ...handlers, busy, overlay };
}
