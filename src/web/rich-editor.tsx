import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Undo2, Redo2, X, Columns2, Columns3, Bold, Italic, Underline, Strikethrough, Highlighter, Code, Code2, Eraser, Pilcrow, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, Table2, Minus, Sigma, Link, Image, Globe, Film, Paperclip, FileText, type LucideIcon } from 'lucide-react';
import { CellSelection } from '@tiptap/pm/tables';
import { TableEdgeControls } from './table-edge-controls.js';
import { TableStyleControls } from './table-style-controls.js';
import { resourceEdit } from './resource-editing.js';
import { BlockControls } from './block-controls.js';
import { insertColumns } from './block-layout.js';
import './block-layout.css';
import { ResourceInsert, uploadResourceFiles } from './resource-insert.js';
import type { ResourceKind } from '../shared/resources.js';
import { EditorTools } from './editor-tools.js';
import { richExtensions } from './rich-extensions.js';

type Command = { name: string; hint: string; keys: string; icon: LucideIcon; run(editor: Editor): void };
const commands: Command[] = [
  { name: '左右分栏', icon: Columns2, hint: '两栏布局，可拖入模块', keys: 'columns layout 2', run: e => { insertColumns(e, 2); } },
  { name: '三栏布局', icon: Columns3, hint: '三栏并排', keys: 'columns layout 3', run: e => { insertColumns(e, 3); } },
  ...([['加粗', 'bold', Bold], ['斜体', 'italic', Italic], ['下划线', 'underline', Underline], ['删除线', 'strike', Strikethrough], ['高亮', 'highlight', Highlighter], ['行内代码', 'code', Code]] as const).map(([name, mark, icon]) => ({ name, icon, hint: '文字格式', keys: mark, run: (e: Editor) => { e.chain().focus().toggleMark(mark).run(); } })),
  { name: '清除格式', icon: Eraser, hint: '清除文字样式', keys: 'clear format', run: e => { e.chain().focus().unsetAllMarks().run(); } },
  { name: '正文', icon: Pilcrow, hint: '普通段落', keys: 'text paragraph', run: e => { e.chain().focus().setParagraph().run(); } },
  ...([1, 2, 3] as const).map(level => ({ name: `${level} 级标题`, icon: [Heading1, Heading2, Heading3][level - 1], hint: '#'.repeat(level) + ' 空格', keys: `h${level} heading biaoti`, run: (e: Editor) => { e.chain().focus().setHeading({ level }).run(); } })),
  { name: '无序列表', icon: List, hint: '- 空格', keys: 'bullet list', run: e => { e.chain().focus().toggleBulletList().run(); } },
  { name: '有序列表', icon: ListOrdered, hint: '1. 空格', keys: 'ordered list', run: e => { e.chain().focus().toggleOrderedList().run(); } },
  { name: '任务清单', icon: ListChecks, hint: '[ ] 空格', keys: 'todo task checkbox', run: e => { e.chain().focus().toggleTaskList().run(); } },
  { name: '引用', icon: Quote, hint: '> 空格', keys: 'quote', run: e => { e.chain().focus().toggleBlockquote().run(); } },
  { name: '代码块', icon: Code2, hint: '``` 空格', keys: 'code', run: e => { e.chain().focus().toggleCodeBlock().run(); } },
  { name: '表格', icon: Table2, hint: '3 列 × 3 行', keys: 'table', run: e => { e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
  { name: '分隔线', icon: Minus, hint: '---', keys: 'divider hr', run: e => { e.chain().focus().setHorizontalRule().run(); } },
  { name: '公式', icon: Sigma, hint: '点击公式修改', keys: 'math', run: e => { e.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: 'E=mc^2' } }).run(); } },
];
type Popup = { x: number; y: number; from: number; to: number; query: string; kind: 'slash' | 'selection' };
export function RichEditor({ value, onChange, noteId, compact = false, disabled = false, label = '便签正文' }: { value: string; onChange(value: string): void; noteId?: string; compact?: boolean; disabled?: boolean; label?: string }) {
  const popupElement = useRef<HTMLDivElement>(null), imagePicker = useRef<HTMLInputElement>(null);
  const latest = useRef(onChange); latest.current = onChange;
  const emitted = useRef(value), popRef = useRef<Popup | null>(null), itemRef = useRef(0), dismissed = useRef<number | null>(null);
  const echoes = useRef(new Set<string>()), contentGeneration = useRef(0);
  const insertResource = useRef<(kind: ResourceKind) => void>(() => {});
  const [resourceForm, setResourceForm] = useState<{ kind: ResourceKind; from: number; to: number; generation: number } | null>(null);
  const [resourceBusy, setResourceBusy] = useState(false), [resourceError, setResourceError] = useState('');
  const resourceLock = useRef(false);
  const insertForm = useRef<(type: 'link' | 'image') => void>(() => {});
  const [popup, setPopup] = useState<Popup | null>(null), [item, setItem] = useState(0), [, repaint] = useState(0);
  const [form, setForm] = useState<{ type: 'link' | 'image' | 'math'; from: number; to: number; text: string; pos?: number } | null>(null), [url, setUrl] = useState(''), [formError, setFormError] = useState('');
  const close = () => { popRef.current = null; setPopup(null); };
  const readOnly = useRef(disabled); readOnly.current = disabled;
  const extensions = useMemo(() => richExtensions((latex, pos, size) => { if (readOnly.current) return; setUrl(latex); setFormError(''); close(); setForm({ type: 'math', from: pos, to: pos + size, text: '', pos }); }), []);
  const choices = (query: string): Command[] => [...commands,
    { name: '链接', icon: Link, hint: '插入网页链接', keys: 'link url', run: () => insertForm.current('link') },
    { name: '图片', icon: Image, hint: '选择本地图片或使用图片地址', keys: 'image picture', run: () => insertForm.current('image') },
    ...([['网页', 'web', Globe], ['视频', 'video', Film], ['文件附件', 'file', Paperclip], ['其他便签', 'note', FileText]] as const).map(([name, kind, icon]) => ({ name, icon, hint: kind === 'note' ? '引用已有便签，点击跳转' : '标题 · 链接 · 卡片 · 预览', keys: kind + ' attachment', run: () => insertResource.current(kind) })),
  ].filter(c => `${c.name} ${c.keys}`.toLowerCase().includes(query.toLowerCase()));
  const run = (e: Editor, c: Command, p: Popup | null) => {
    if (p?.kind === 'slash') e.chain().focus().deleteRange({ from: p.from, to: p.to }).run();
    close(); c.run(e);
  };
  const sync = (e: Editor) => {
    repaint(v => v + 1);
    if (!e.isFocused || !e.isEditable || e.view.composing) return;
    if (e.state.selection instanceof CellSelection) { close(); return; }
    const { from, to, $from } = e.state.selection;
    const prefix = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc');
    const slash = from === to && !e.isActive('codeBlock') ? /(?:^|\s)\/([^/\s]{0,30})$/.exec(prefix) : null;
    if (dismissed.current !== from) dismissed.current = null;
    if (dismissed.current === from) return;
    if (!slash && (from === to || e.state.doc.textBetween(from, to).length === 0)) { close(); return; }
    const rect = e.view.coordsAtPos(slash ? from : to);
    const kind = slash ? 'slash' : 'selection';
    const width = kind === 'slash' ? 280 : popupElement.current?.offsetWidth ?? 0;
    const height = kind === 'slash' ? Math.min(300, 46 + Math.max(1, choices(slash?.[1] ?? '').length) * 44, window.innerHeight - 40) : 44;
    const next: Popup = { kind, from: slash ? from - slash[1].length - 1 : from, to, query: slash?.[1] ?? '', x: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), y: Math.max(8, rect.bottom + height + 10 > window.innerHeight ? rect.top - height - 8 : rect.bottom + 8) };
    if (next.query !== popRef.current?.query || next.kind !== popRef.current?.kind) { itemRef.current = 0; setItem(0); }
    popRef.current = next; setPopup(next);
  };
  const editor = useEditor({
    extensions, content: value, contentType: 'markdown', editable: !disabled,
    editorProps: {
      attributes: { class: 'markdown rich-document', role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', 'aria-readonly': String(disabled) },
      handleDrop: (view, event) => {
        if (readOnly.current) { event.preventDefault(); return true; }
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        event.preventDefault(); const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
        void importDropped(files, pos); return true;
      },
      handlePaste: (_view, event) => {
        if (readOnly.current) { event.preventDefault(); return true; }
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length) { event.preventDefault(); void importDropped(files); return true; }
        const text = event.clipboardData?.getData('text/plain');
        if (!text || !editor || editor.isActive('codeBlock') || event.clipboardData?.getData('text/html')) return false;
        event.preventDefault(); editor.commands.insertContent(text, { contentType: 'markdown' }); return true;
      },
      handleKeyDown: (view, event) => {
        // Leave native selection/copy/navigation available, but skip editing keymaps.
        if (readOnly.current) return true;
        if (event.isComposing || view.composing) return false;
        const p = popRef.current;
        if (event.key === 'Escape' && view.state.selection instanceof CellSelection) { event.preventDefault(); event.stopPropagation(); editor?.commands.setTextSelection(view.state.selection.$anchorCell.pos + 1); close(); return true; }
        if (event.key === 'Escape' && p) { event.preventDefault(); event.stopPropagation(); dismissed.current = view.state.selection.from; close(); return true; }
        if (p?.kind !== 'slash') return false;
        const list = choices(p.query);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); itemRef.current = (itemRef.current + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, list.length)) % Math.max(1, list.length); setItem(itemRef.current); return true; }
        if (event.key === 'Enter' && list.length) { event.preventDefault(); if (editor) run(editor, list[itemRef.current] ?? list[0], p); return true; }
        return false;
      },
      handleDOMEvents: { compositionend: () => { requestAnimationFrame(() => { if (editor && !editor.isDestroyed) sync(editor); }); return false; } },
      handleDoubleClickOn: (_view, _pos, node, nodePos) => {
        if (readOnly.current) return false;
        if (node.type.name !== 'inlineMath' && node.type.name !== 'blockMath') return false;
        setUrl(node.attrs.latex); setForm({ type: 'math', from: nodePos, to: nodePos + node.nodeSize, text: node.type.name, pos: nodePos }); return true;
      },
    },
    onUpdate: ({ editor: e }) => { const md = e.getMarkdown(); emitted.current = md; echoes.current.add(md); if (echoes.current.size > 100) echoes.current.delete(echoes.current.values().next().value!); latest.current(md); sync(e); },
    onSelectionUpdate: ({ editor: e }) => sync(e), onFocus: ({ editor: e }) => sync(e),
    onBlur: ({ event }) => { if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest('[data-moki-tools]')) close(); },
  });
  useEffect(() => {
    if (echoes.current.has(value)) { echoes.current.delete(value); return; }
    if (!editor || value === emitted.current) return;
    // External updates (Agent, recovery, history) must replace the editor, while
    // our own autosave echoes must never move the cursor or reset undo history.
    contentGeneration.current++; setResourceForm(null);
    emitted.current = value; editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false }); close();
  }, [value, editor]);
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  useEffect(() => {
    const onScroll = () => { if (editor?.isFocused) sync(editor); };
    window.addEventListener('resize', onScroll); window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', onScroll); window.removeEventListener('scroll', onScroll, true); };
  }, [editor]);
  useEffect(() => { document.querySelector('.slash-menu [aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [item]);
  useLayoutEffect(() => {
    const element = popupElement.current;
    if (!element || !popup || !editor) return;
    const place = () => {
      const rect = editor.view.coordsAtPos(popup.kind === 'slash' ? popup.from : popup.to);
      const { width, height } = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      element.style.top = `${Math.max(8, rect.bottom + height + 10 > window.innerHeight ? rect.top - height - 8 : rect.bottom + 8)}px`;
    };
    place(); const observer = new ResizeObserver(place); observer.observe(element);
    return () => observer.disconnect();
  }, [popup, editor]);
  async function importDropped(files: File[], position?: number) {
    if (!editor || !editor.isEditable || resourceLock.current) return;
    resourceLock.current = true; setResourceBusy(true); setResourceError('');
    // Keep the original insertion point mapped through edits made while uploading.
    const generation = contentGeneration.current;
    let pos = position ?? editor.state.selection.from;
    const mapPosition = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => { pos = transaction.mapping.map(pos); };
    editor.on('transaction', mapPosition);
    try {
      const resources = await uploadResourceFiles(files);
      if (generation !== contentGeneration.current) throw new Error('正文已更新，请重新插入附件');
      if (!editor.isDestroyed) resourceEdit(editor, () => { editor.chain().focus().insertContentAt(pos, resources).run(); });
    } catch (e) { setResourceError((e as Error).message); }
    finally { editor.off('transaction', mapPosition); resourceLock.current = false; setResourceBusy(false); }
  }
  if (!editor) return null;
  const openForm = (type: 'link' | 'image') => {
    const { from, to } = editor.state.selection;
    setForm({ type, from, to, text: editor.state.doc.textBetween(from, to) }); setUrl(type === 'link' ? editor.getAttributes('link').href ?? '' : ''); setFormError(''); close();
  };
  insertForm.current = openForm;
  const openResource = (kind: ResourceKind) => { const { from, to } = editor.state.selection; close(); setResourceForm({ kind, from, to, generation: contentGeneration.current }); };
  insertResource.current = openResource;
  const formats = <EditorTools editor={editor} openForm={openForm} openResource={openResource} disabled={disabled} />;
  return <div className={`rich-editor ${compact ? 'compact' : ''}`}>
    {!compact && !disabled && <div className="rich-toolbar" onMouseDown={e => { if (e.target instanceof HTMLElement && !e.target.closest('select')) e.preventDefault(); }}>
      {formats}<span className="rich-hint">/ 插入</span><button disabled={disabled || !editor.can().undo()} aria-label="撤销" title="撤销 Ctrl+Z" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></button><button disabled={disabled || !editor.can().redo()} aria-label="重做" title="重做 Ctrl+Shift+Z" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></button>
    </div>}
    {resourceBusy && <div className="resource-feedback" role="status">正在导入附件…</div>}{resourceError && <div className="resource-error" role="alert">{resourceError}</div>}
    <div className="rich-scroll"><EditorContent editor={editor} /></div>
    <BlockControls editor={editor} disabled={disabled || !!form || !!resourceForm || !!popup} />
    <TableEdgeControls editor={editor} disabled={disabled || !!form || !!resourceForm || popup?.kind === 'slash'} />
    <TableStyleControls editor={editor} disabled={disabled || !!form || !!resourceForm || !!popup} />
    {popup && !form && !resourceForm && !disabled && createPortal(<div ref={popupElement} data-moki-tools="" className={`editor-popup ${popup.kind === 'slash' ? 'slash-menu' : 'selection-tools'}`} style={{ left: popup.x, top: popup.y }} role={popup.kind === 'slash' ? 'listbox' : 'toolbar'} aria-label={popup.kind === 'slash' ? '插入格式' : '选中文字格式'} onMouseDown={e => e.preventDefault()} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissed.current = editor.state.selection.from; editor.commands.focus(); close(); } }}>
      {popup.kind === 'selection' ? formats : <><div className="slash-caption">插入内容 <span>↑ ↓ 选择 · Enter 插入</span></div>{choices(popup.query).map((c, i) => <button key={c.name} role="option" aria-selected={item === i} onMouseEnter={() => { itemRef.current = i; setItem(i); }} onClick={() => run(editor, c, popup)}><span className="slash-icon" aria-hidden="true"><c.icon size={17} strokeWidth={1.75} /></span><span className="slash-copy"><strong>{c.name}</strong><small>{c.hint}</small></span></button>)}{!choices(popup.query).length && <p>没有匹配的格式</p>}</>}
    </div>, document.body)}
    {resourceForm && <ResourceInsert initialKind={resourceForm.kind} excludeNoteId={noteId} onClose={() => { setResourceForm(null); editor.commands.focus(); }} onInsert={(resources) => {
      if (editor.isDestroyed || resourceForm.generation !== contentGeneration.current) { setResourceError('正文已更新，请重新插入附件'); return; }
      resourceEdit(editor, () => { editor.chain().focus().insertContentAt({ from: resourceForm.from, to: resourceForm.to }, [...resources, { type: 'paragraph' }]).run(); }); setResourceForm(null);
    }} />}
    {form && createPortal(<div className="modal-backdrop"><form className="dialog rich-insert-dialog" role="dialog" aria-label={form.type === 'math' ? '编辑公式' : form.type === 'link' ? '插入链接' : '插入图片'} onSubmit={e => {
      e.preventDefault();
      if (form.type !== 'math' && url && !/^(https?:\/\/|mailto:)/i.test(url)) { setFormError('请输入 http、https 或 mailto 地址'); return; }
      const chain = editor.chain().focus().setTextSelection({ from: form.from, to: form.to });
      if (form.type === 'math') chain.command(({ tr }) => { tr.setNodeMarkup(form.pos!, undefined, { latex: url }); return true; }).run();
      else if (form.type === 'image') { if (!/^https?:\/\//i.test(url)) { setFormError('请输入 http 或 https 图片地址'); return; } chain.setImage({ src: url, alt: form.text || '图片' }).run(); }
      else if (!url) chain.unsetLink().run();
      else if (form.from === form.to) chain.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
      else chain.setLink({ href: url }).run();
      setForm(null);
    }}><header><h2>{form.type === 'math' ? '编辑公式' : form.type === 'link' ? '插入链接' : '插入图片'}</h2><button type="button" aria-label="关闭插入" onClick={() => setForm(null)}><X size={18} /></button></header><div className="dialog-body">{form.type === 'image' && <div className="image-file-choice"><button type="button" onClick={() => imagePicker.current?.click()}>选择本地图片</button><input ref={imagePicker} hidden type="file" accept="image/*" multiple aria-label="上传图片" onChange={e => { const files = [...(e.target.files ?? [])]; const pos = form.from; setForm(null); if (files.length) void importDropped(files, pos); }} /><span>或粘贴图片地址</span></div>}<input autoFocus aria-label={form.type === 'math' ? '公式源码' : '地址'} value={url} onChange={e => setUrl(e.target.value)} placeholder={form.type === 'math' ? 'E=mc^2' : 'https://'} />{formError && <p role="alert">{formError}</p>}</div><footer><button type="button" onClick={() => setForm(null)}>取消</button><button className="primary">应用</button></footer></form></div>, document.body)}
  </div>;
}
