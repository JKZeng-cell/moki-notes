import { useRef, useState } from 'react';
import { FolderInput, X } from 'lucide-react';
import type { ListOrganization } from '../shared/list-organization.js';
import type { NoteSummary } from '../shared/model.js';
import { api } from './api.js';

export function ListMoveDialog({ notes, organization, onClose, onChanged }: { notes: NoteSummary[]; organization: ListOrganization; onClose(): void; onChanged(): void }) {
  const [target, setTarget] = useState(organization.membership[notes[0].id] ?? '');
  const [query, setQuery] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false), version = useRef(organization.version);
  async function move() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      await api('/list/organize', 'POST', { kind: 'move', expectedVersion: version.current, noteIds: notes.map(n => n.id), groupId: target || null, targetId: null, placement: 'before' });
      onChanged(); onClose();
    } catch (e) { setError(`${(e as Error).message}。请关闭后重试。`); onChanged(); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}><section className="dialog list-move-dialog" role="dialog" aria-modal="true" aria-label="移动到分组" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); } }}>
    <header><h2><FolderInput size={18} />移动到分组</h2><button aria-label="关闭移动分组" disabled={busy} onClick={onClose}><X size={17} /></button></header>
    <div className="dialog-body"><p>{notes.length > 1 ? `已选 ${notes.length} 条便签` : notes[0].title}</p><input autoFocus aria-label="搜索分组" placeholder="搜索分组…" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="list-move-options" role="radiogroup" aria-label="目标分组">{[{ id: '', name: '未分组' }, ...organization.groups].filter(g => g.name.toLowerCase().includes(query.trim().toLowerCase())).map(g => <label key={g.id}><input type="radio" name="destination-group" value={g.id} checked={target === g.id} disabled={busy} onChange={() => setTarget(g.id)} /><span>{g.name}</span></label>)}</div>
      {!organization.groups.length && <p className="muted">可在便签列表中点击“新建分组”。</p>}{error && <p role="alert" className="settings-error">{error}</p>}</div>
    <footer><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy} onClick={() => void move()}>{busy ? '正在移动…' : '确认移动'}</button></footer>
  </section></div>;
}
