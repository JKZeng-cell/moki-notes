import { noteEditTime } from './note-time.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Pin, PinOff, Plus, X } from 'lucide-react';
import { NoteDetails } from './note-details.js';
import type { Note, NotePatch } from '../shared/model.js';
import { api, windowId } from './api.js';
import { RichEditor } from './rich-editor.js';
import { MarkdownPreview } from './markdown.js';
import { useAutoSave } from './use-autosave.js';
import { useInstallSave } from './use-install-save.js';
import { announcePurged } from './trash-data.js';

// Desktop notes are small paper cards. The full editor lives in the manager.
export function StickyCard({ id }: { id: string }) {
  const autoSave = useAutoSave();
  const [note, setNote] = useState<Note | null>(null), [editing, setEditing] = useState(false), [title, setTitle] = useState(''), [content, setContent] = useState('');
  const [top, setTop] = useState(true), [error, setError] = useState(''), [saving, setSaving] = useState(false), [draftFound, setDraftFound] = useState(false);
  const editingRef = useRef(false), dirtyRef = useRef(false);
  const currentNote = useRef<Note | null>(null), fields = useRef({ title: '', content: '' });
  const pending = useRef<Promise<boolean> | null>(null), blocked = useRef(false);
  const startEditing = useRef(new URLSearchParams(location.search).get('edit') === '1');
  const creatingRef = useRef(false), pendingNew = useRef<string | null>(null);
  const [creating, setCreating] = useState(false);
  const key = `moki-notes:draft:${id}:${windowId}`;
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const n = await api<Note>(`/notes/${id}`);
        if (!active) return;
        if (!editingRef.current) {
          currentNote.current = n; setNote(n);
          if (startEditing.current && !n.deletedAt) {
            startEditing.current = false; editingRef.current = true;
            fields.current = { title: n.title, content: n.content }; setTitle(n.title); setContent(n.content); setEditing(true);
          }
        }
        const state = await window.mokiDesktop?.pins(); if (active && state) setTop(state.top);
      } catch (e) {
        if (active && (e as { code?: string }).code === 'NOT_FOUND') {
          dirtyRef.current = false; editingRef.current = false; blocked.current = true; currentNote.current = null;
          announcePurged([id]); setNote(null); setEditing(false);
          setError('便签已永久删除'); void window.mokiDesktop?.close();
        } else if (active) setError((e as Error).message);
      }
    };
    setDraftFound(Object.keys(localStorage).some(k => k.startsWith(`moki-notes:draft:${id}:`)));
    void refresh(); const timer = setInterval(() => void refresh(), 1500);
    const prevent = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent);
    return () => { active = false; clearInterval(timer); window.removeEventListener('beforeunload', prevent); };
  }, [id]);
  function edit() {
    if (!note || note.deletedAt || editingRef.current) return;
    blocked.current = false; fields.current = { title: note.title, content: note.content };
    editingRef.current = true; setEditing(true); setTitle(note.title); setContent(note.content); setError('');
  }
  function draft(nextTitle: string, nextContent: string) {
    fields.current = { title: nextTitle, content: nextContent };
    setTitle(nextTitle); setContent(nextContent); dirtyRef.current = true;
    try { localStorage.setItem(key, JSON.stringify({ ...currentNote.current, title: nextTitle, content: nextContent })); }
    catch { setError('草稿空间不足，请保存当前内容。'); }
  }
  async function save(finish = true): Promise<boolean> {
    if (pending.current) { const ok = await pending.current; return ok ? save(finish) : false; }
    if (!currentNote.current || blocked.current) return false;
    if (dirtyRef.current) {
      const snapshot = fields.current, version = currentNote.current.version;
      if (!snapshot.title.trim()) { setError('请填写标题'); return false; }
      setSaving(true);
      pending.current = (async () => {
        try {
          const n = await api<Note>(`/notes/${id}`, 'PATCH', { expectedVersion: version, patch: snapshot });
          currentNote.current = n; setNote(n);
          if (fields.current === snapshot) { dirtyRef.current = false; localStorage.removeItem(key); setDraftFound(false); }
          else localStorage.setItem(key, JSON.stringify({ ...n, ...fields.current }));
          setError(''); return true;
        } catch (e) {
          if ((e as { code?: string }).code === 'VERSION_CONFLICT') blocked.current = true;
          setError(blocked.current ? '便签已有新版本。草稿已保留，请打开主窗口查看或另存。' : (e as Error).message); return false;
        } finally { pending.current = null; setSaving(false); }
      })();
      if (!(await pending.current)) return false;
      if (dirtyRef.current && finish) return save(true);
    }
    if (finish) { editingRef.current = false; setEditing(false); }
    return true;
  }
  const saveRef = useRef(save); saveRef.current = save;
  useInstallSave(() => !dirtyRef.current && !pending.current ? Promise.resolve(true) : saveRef.current(true));
  useEffect(() => {
    if (!editing || !dirtyRef.current || blocked.current || !autoSave?.enabled) return;
    const timer = setTimeout(() => void saveRef.current(false), autoSave.delayMs);
    return () => clearTimeout(timer);
  }, [editing, title, content, note, autoSave]);
  function cancel() {
    if (pending.current) return;
    if (dirtyRef.current && !confirm('放弃本次编辑？')) return;
    dirtyRef.current = false; editingRef.current = false; setEditing(false); localStorage.removeItem(key); setError('');
  }
  async function openEditor() {
    try { await window.mokiDesktop?.manager(id); } catch (e) { setError((e as Error).message); }
  }
  async function createDesktopNote() {
    if (creatingRef.current) return;
    if (!window.mokiDesktop) { setError('请在桌面客户端中新建桌面便签。'); return; }
    creatingRef.current = true; setCreating(true);
    try {
      // If opening the window fails, retry the same new note instead of
      // creating another one. The current card's unsaved draft is untouched.
      if (!pendingNew.current) {
        const created = await api<Note>('/notes', 'POST', { title: '未命名便签', color: note?.color ?? 'violet' });
        pendingNew.current = created.id;
      }
      await window.mokiDesktop.pin(pendingNew.current, true);
      pendingNew.current = null;
    } catch (e) { setError(`${pendingNew.current ? '新便签已保存，打开失败；点击新建重试。' : '新建失败。'}${(e as Error).message}`); }
    finally { creatingRef.current = false; setCreating(false); }
  }
  async function recover() {
    const foundKey = localStorage.getItem(key) ? key : Object.keys(localStorage).find(k => k.startsWith(`moki-notes:draft:${id}:`));
    if (!foundKey || !note) return;
    try {
      const recovered = JSON.parse(localStorage.getItem(foundKey)!) as Note;
      if (recovered.version !== note.version) { setError('草稿基于旧版本，请打开主窗口恢复或另存。'); return; }
      edit(); draft(recovered.title, recovered.content); setDraftFound(false);
    } catch { setError('无法读取草稿，请在主窗口检查。'); }
  }
  async function patchDetails(patch: NotePatch) {
    const current = currentNote.current;
    if (!current || current.deletedAt || editingRef.current || pending.current) throw new Error('当前便签正在更新，请稍后重试');
    const next = await api<Note>(`/notes/${id}`, 'PATCH', { expectedVersion: current.version, patch });
    currentNote.current = next; setNote(next);
  }
  async function saveCopy() {
    if (!note || saving) return;
    setSaving(true);
    try {
      const n = await api<Note>('/notes', 'POST', { title: `${title || note.title} · 草稿副本`.slice(0, 200), content, color: note.color, tags: note.tags, source: `来自便签 ${id} 的冲突草稿` });
      localStorage.removeItem(key); dirtyRef.current = false; editingRef.current = false; setEditing(false); setError('');
      await window.mokiDesktop?.manager(n.id);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  return <section className="desktop-card" data-color={note?.color ?? 'violet'} aria-label="桌面便签卡片" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (editing) void save(); } if (e.key === 'Escape' && editing && !e.defaultPrevented) cancel(); }}>
    <header className="desktop-card-handle"><span><img className="desktop-app-icon" src="/icon.svg" alt="" />MOKI便签</span><div className="desktop-card-actions"><button aria-label="新建桌面便签" title={creating ? '正在新建…' : '新建桌面便签'} disabled={creating} onClick={() => void createDesktopNote()}><Plus size={16} /></button><button aria-label="切换窗口置顶" title={top ? '取消置顶' : '窗口置顶'} onClick={() => { void window.mokiDesktop?.top(!top); setTop(!top); }}>{top ? <Pin size={14} /> : <PinOff size={14} />}</button><button aria-label="打开完整编辑" title="在主窗口编辑这条便签" onClick={() => void openEditor()}><ArrowUpRight size={16} /></button><button aria-label="取消桌面固定" title="取消桌面固定" onClick={() => void window.mokiDesktop?.close()}><X size={15} /></button></div></header>
    {!note ? <div className="desktop-card-loading">{error || '正在读取便签…'}</div> : <>
      {note.deletedAt ? <div className="desktop-card-message">便签已移入回收站。<button onClick={() => void openEditor()}>到主窗口恢复</button></div> : editing ? <div className="desktop-card-edit"><input className="note-title-input" autoFocus placeholder="给想法起个名字…" aria-label="桌面便签标题" value={title} maxLength={200} onChange={e => draft(e.target.value, content)} /><RichEditor noteId={id} compact label="桌面便签正文" value={content} onChange={next => draft(title, next)} /><footer><span className="card-save-status" role="status">{saving ? '保存中…' : dirtyRef.current ? (autoSave?.enabled ? '等待保存…' : '未保存') : '已保存'}</span><button onClick={cancel} disabled={saving}>{dirtyRef.current ? '放弃修改' : '完成'}</button><button className="card-save" disabled={saving} onClick={() => void save()}><Check size={14} />{saving ? '保存中…' : '保存'}</button></footer></div> : <div className="desktop-card-paper" onDoubleClick={edit}><h1 title="双击编辑">{note.title}</h1><div className="desktop-card-content"><MarkdownPreview content={note.content} onChange={content => patchDetails({ content })} /></div><footer><span title={`最近编辑：${noteEditTime(note.updatedAt, true)}`}>{noteEditTime(note.updatedAt)}</span><button title="简易编辑" aria-label="简易编辑便签" onClick={edit}>双击编辑</button></footer></div>}
      <NoteDetails note={editing ? { ...note, title, content } : note} onPatch={patchDetails} readOnly={editing || !!note.deletedAt} onPrepare={editing ? () => save(true) : undefined} />
      {draftFound && !editing && <div className="desktop-card-message"><button onClick={() => void recover()}>恢复未保存草稿</button></div>}
      {error && <div className="desktop-card-message" role="alert">{error}{editing && <button disabled={saving} onClick={() => void saveCopy()}>草稿另存</button>}<button onClick={() => void openEditor()}>打开主窗口</button></div>}
    </>}
  </section>;
}
