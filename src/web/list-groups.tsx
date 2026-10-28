import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, FolderPlus, GripVertical, Pencil, Trash2, X } from 'lucide-react';
import type { NoteSummary } from '../shared/model.js';
import type { ListCommand, ListOrganization } from '../shared/list-organization.js';
import { api } from './api.js';
import { NOTE_DRAG, endNoteDrag, readNoteDrag } from './tree-drag.js';

type Props = { items: NoteSummary[]; organization: ListOrganization; counts: Record<string, number>; filtered: boolean; checked: Set<string>; renderNote(note: NoteSummary): ReactNode; onChanged(next: ListOrganization, manual: boolean): void; onError(message: string): void; refresh(): void };
type Dialog = { kind: 'create' | 'rename' | 'remove'; id?: string; name: string };
const GROUP_DRAG = 'application/x-moki-list-group';
export function ListGroups({ items, organization, counts, filtered, checked, renderNote, onChanged, onError, refresh }: Props) {
  const [dialog, setDialog] = useState<Dialog | null>(null), [name, setName] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [hover, setHover] = useState(''), [destination, setDestination] = useState('');
  const lock = useRef(false);
  const groupSource = useRef<string | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0, speed = 0;
    const scroll = () => { const el = container.current?.closest('.list-scroll'); if (el && speed) { el.scrollTop += speed; frame = requestAnimationFrame(scroll); } else frame = 0; };
    const stop = (e: Event) => { speed = 0; cancelAnimationFrame(frame); frame = 0; setHover(''); if (e.type === 'dragend') { groupSource.current = null; setDraggingGroup(null); } };
    const over = (e: globalThis.DragEvent) => {
      const el = container.current?.closest('.list-scroll');
      if (!el || !e.dataTransfer?.types.some(type => type === NOTE_DRAG || type === GROUP_DRAG)) return;
      const r = el.getBoundingClientRect();
      speed = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom ? 0 : e.clientY > r.bottom - 48 ? 12 : e.clientY < r.top + 48 ? -12 : 0;
      if (speed && !frame) frame = requestAnimationFrame(scroll);
    };
    document.addEventListener('dragover', over, true); document.addEventListener('drop', stop, true); document.addEventListener('dragend', stop, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('dragover', over, true); document.removeEventListener('drop', stop, true); document.removeEventListener('dragend', stop, true); };
  }, []);
  async function run(command: ListCommand) {
    if (lock.current) return false; lock.current = true; setBusy(true); setError('');
    try { const next = await api<ListOrganization>('/list/organize', 'POST', { ...command, expectedVersion: organization.version }); onChanged(next, command.kind === 'move'); return true; }
    catch (e) { const message = (e as Error).message; if (dialog) setError(message); else onError(message); refresh(); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  function open(next: Dialog) { setDialog(next); setName(next.name); setError(''); }
  function groupPlacement(e: DragEvent<HTMLElement>): 'before' | 'after' {
    const heading = e.currentTarget.querySelector('.note-group-heading')!.getBoundingClientRect();
    return e.clientY < heading.top + heading.height / 2 ? 'before' : 'after';
  }
  function groupOver(e: DragEvent<HTMLElement>, targetId: string) {
    if (!e.dataTransfer.types.includes(GROUP_DRAG)) return;
    e.stopPropagation();
    if (busy || filtered || !groupSource.current || groupSource.current === targetId) { setHover(''); return; }
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setHover(`group:${targetId}:${groupPlacement(e)}`);
  }
  function groupDrop(e: DragEvent<HTMLElement>, targetId: string) {
    if (!e.dataTransfer.types.includes(GROUP_DRAG)) return;
    e.preventDefault(); e.stopPropagation(); const groupId = groupSource.current;
    groupSource.current = null; setDraggingGroup(null); setHover('');
    if (busy || filtered || !groupId || groupId === targetId) return;
    void run({ kind: 'reorder-group', groupId, targetId, placement: groupPlacement(e) });
  }
  function over(e: DragEvent<HTMLElement>, key: string) {
    if (busy || !e.dataTransfer.types.includes(NOTE_DRAG)) return;
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setHover(key);
  }
  function drop(e: DragEvent<HTMLElement>, groupId: string | null, targetId: string | null, placement: 'before' | 'after') {
    if (!e.dataTransfer.types.includes(NOTE_DRAG)) return;
    e.preventDefault(); e.stopPropagation(); const source = readNoteDrag(e); setHover(''); endNoteDrag();
    if (!source || busy || source.id === targetId) return;
    const noteIds = checked.has(source.id) ? [...checked] : [source.id];
    if (targetId && noteIds.includes(targetId)) return;
    void run({ kind: 'move', noteIds, groupId, targetId, placement });
  }
  const groupedItems = useMemo(() => {
    const groups = new Map<string | null, NoteSummary[]>();
    for (const note of items) { const id = organization.membership[note.id] ?? null; const group = groups.get(id) ?? []; group.push(note); groups.set(id, group); }
    return groups;
  }, [items, organization.membership]);
  function cards(groupId: string | null) {
    return (groupedItems.get(groupId) ?? []).map(n => <div className={`list-note-row ${hover.startsWith(n.id + ':') ? 'list-drop-' + hover.split(':')[1] : ''}`} data-list-note={n.id} key={n.id}
      onDragStart={e => { if (busy) e.preventDefault(); }} onDragEnd={() => setHover('')}
      onDragOver={e => { const r = e.currentTarget.getBoundingClientRect(); over(e, `${n.id}:${e.clientY < r.y + r.height / 2 ? 'before' : 'after'}`); }}
      onDrop={e => { const r = e.currentTarget.getBoundingClientRect(); drop(e, groupId, n.id, e.clientY < r.y + r.height / 2 ? 'before' : 'after'); }}>{renderNote(n)}</div>);
  }
  return <div ref={container} className="organized-list" aria-busy={busy} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(''); }}>
    {!!checked.size && <div className="group-bulk-move"><select aria-label="移动所选便签到分组" value={destination} disabled={busy} onChange={e => setDestination(e.target.value)}><option value="">未分组</option>{organization.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select><button disabled={busy} onClick={() => void run({ kind: 'move', noteIds: [...checked], groupId: destination || null, targetId: null, placement: 'before' })}>移动所选</button></div>}
    <section className="note-group" aria-label="未分组">
      <div className={`note-group-heading ${hover === 'ungrouped' ? 'list-drop-group' : ''}`} data-list-group="ungrouped" onDragOver={e => over(e, 'ungrouped')} onDrop={e => drop(e, null, null, 'before')}><span className="group-name">未分组 <small>{counts.ungrouped ?? 0}</small></span><button aria-label="新建分组" title="新建分组" disabled={busy} onClick={() => open({ kind: 'create', name: '' })}><FolderPlus size={14} /><span>新建分组</span></button></div>
      {cards(null)}
      {organization.groups.length > 0 && !counts.ungrouped && <div className={`note-group-empty ${hover === 'ungrouped' ? 'list-drop-group' : ''}`} onDragOver={e => over(e, 'ungrouped')} onDrop={e => drop(e, null, null, 'before')}>拖入便签，移出分组</div>}
    </section>
    {organization.groups.map(group => {
      const children = cards(group.id), count = counts[group.id] ?? 0, collapsed = group.collapsed && !filtered;
      if (filtered && !count) return null;
      // Keep the keyed group header mounted while its lazy-loaded cards arrive.
      return <section className={`note-group ${draggingGroup === group.id ? 'group-dragging' : ''} ${hover === `group:${group.id}:before` ? 'group-drop-before' : hover === `group:${group.id}:after` ? 'group-drop-after' : ''}`} aria-label={`分组：${group.name}`} key={group.id} onDragOver={e => groupOver(e, group.id)} onDrop={e => groupDrop(e, group.id)}>
        <div className={`note-group-heading ${hover === group.id ? 'list-drop-group' : ''}`} data-list-group={group.id} draggable={!busy && !filtered}
          onDragStart={e => { if (busy || filtered || (e.target as HTMLElement).closest('.group-actions')) { e.preventDefault(); return; } e.stopPropagation(); groupSource.current = group.id; setDraggingGroup(group.id); e.dataTransfer.setData(GROUP_DRAG, group.id); e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={e => over(e, group.id)} onDrop={e => drop(e, group.id, null, 'before')}>
          <button className="group-drag-handle" aria-label={`调整分组顺序：${group.name}`} title={filtered ? '清除筛选后调整分组顺序' : '拖动排序，也可按 ↑ / ↓ 移动'} disabled={filtered} aria-disabled={busy || filtered} onKeyDown={e => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault(); const index = organization.groups.findIndex(g => g.id === group.id), up = e.key === 'ArrowUp', target = organization.groups[index + (up ? -1 : 1)];
            if (target) void run({ kind: 'reorder-group', groupId: group.id, targetId: target.id, placement: up ? 'before' : 'after' });
          }}><GripVertical size={13} /></button>
          <button className="group-toggle" aria-label={`${collapsed ? '展开' : '收起'}分组：${group.name}`} aria-expanded={!collapsed} disabled={filtered} aria-disabled={busy || filtered} title={filtered ? '筛选时显示匹配内容' : group.name} onClick={() => void run({ kind: 'collapse', groupId: group.id, collapsed: !group.collapsed })}><ChevronRight size={14} style={{ transform: collapsed ? undefined : 'rotate(90deg)' }} /><span>{group.name}</span><small>{count}</small></button>
          <div className="group-actions"><button aria-label={`重命名分组：${group.name}`} title="重命名分组" disabled={busy} onClick={() => open({ kind: 'rename', id: group.id, name: group.name })}><Pencil size={13} /></button><button aria-label={`删除分组：${group.name}`} title="删除分组" disabled={busy} onClick={() => open({ kind: 'remove', id: group.id, name: group.name })}><Trash2 size={13} /></button></div>
        </div>
        {!collapsed && <>{children}{count > 0 && !children.length && <div className="note-group-placeholder" role="status">内容按需加载</div>}{!count && <div className={`note-group-empty ${hover === group.id ? 'list-drop-group' : ''}`} onDragOver={e => over(e, group.id)} onDrop={e => drop(e, group.id, null, 'before')}>拖入便签到此分组</div>}</>}
      </section>;
    })}
    {dialog && createPortal(<div className="modal-backdrop" onClick={() => { if (!busy) setDialog(null); }}><section className="dialog list-group-dialog" role="dialog" aria-modal="true" aria-label={dialog.kind === 'create' ? '新建分组' : dialog.kind === 'rename' ? '重命名分组' : '删除分组'} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) setDialog(null); } }}>
      <header><h2>{dialog.kind === 'create' ? '新建分组' : dialog.kind === 'rename' ? '重命名分组' : '删除分组'}</h2><button aria-label="关闭分组设置" disabled={busy} onClick={() => setDialog(null)}><X size={17} /></button></header>
      <form onSubmit={e => { e.preventDefault(); void run(dialog.kind === 'create' ? { kind: 'create', name } : dialog.kind === 'rename' ? { kind: 'rename', groupId: dialog.id!, name } : { kind: 'remove', groupId: dialog.id! }).then(ok => { if (ok) setDialog(null); }); }}>
        {dialog.kind === 'remove' ? <p>删除「{dialog.name}」后，便签移回未分组，内容和知识树关系保留。</p> : <label>分组名称<input autoFocus aria-label="分组名称" placeholder="例如：工作、生活、灵感" required maxLength={60} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>}
        {error && <p className="settings-error" role="alert">{error}</p>}<footer><button type="button" autoFocus={dialog.kind === 'remove'} disabled={busy} onClick={() => setDialog(null)}>取消</button><button className={dialog.kind === 'remove' ? 'settings-danger' : 'primary'} disabled={busy || dialog.kind !== 'remove' && !name.trim()}>{busy ? '正在保存…' : dialog.kind === 'remove' ? '删除分组' : '保存'}</button></footer>
      </form>
    </section></div>, document.body)}
  </div>;
}
