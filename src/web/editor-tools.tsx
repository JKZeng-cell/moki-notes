import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import type { Editor } from '@tiptap/react';
import { insertColumns } from './block-layout.js';
import { Globe, Film, Paperclip, Bold, Italic, Underline, Strikethrough, Highlighter, Code2, Heading1, Heading2, Heading3, Pilcrow, List, ListOrdered, ListChecks, Quote, Minus, Link, Image, Table2, Sigma, Plus, Palette, Eraser, ChevronDown, Check, type LucideIcon } from 'lucide-react';

type Tool = { label: string; icon: LucideIcon; active?: boolean; action(): void };
export function EditorTools({ editor, openForm, openResource, disabled = false }: { editor: Editor; openForm(type: 'link' | 'image'): void; openResource(kind: import('../shared/resources.js').ResourceKind): void; disabled?: boolean }) {
  const [menu, setMenu] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), anchor = useRef<HTMLButtonElement | null>(null);
  const focusMenu = useRef(false);
  const mark = (label: string, icon: LucideIcon, name: string): Tool => ({ label, icon, active: editor.isActive(name), action: () => { editor.chain().focus().toggleMark(name).run(); } });
  const groups: { label: string; icon: LucideIcon; items: Tool[] }[] = [
    { label: '文字格式', icon: Bold, items: [mark('加粗', Bold, 'bold'), mark('斜体', Italic, 'italic'), mark('下划线', Underline, 'underline'), mark('删除线', Strikethrough, 'strike'), mark('高亮', Highlighter, 'highlight'), mark('行内代码', Code2, 'code')] },
    { label: '段落格式', icon: Heading1, items: [
      { label: '正文', icon: Pilcrow, active: editor.isActive('paragraph'), action: () => { editor.chain().focus().setParagraph().run(); } },
      ...([1, 2, 3] as const).map((level, i) => ({ label: `标题 ${level}`, icon: [Heading1, Heading2, Heading3][i], active: editor.isActive('heading', { level }), action: () => { editor.chain().focus().setHeading({ level }).run(); } })),
    ] },
    { label: '列表格式', icon: List, items: [
      { label: '无序列表', icon: List, active: editor.isActive('bulletList'), action: () => { editor.chain().focus().toggleBulletList().run(); } },
      { label: '有序列表', icon: ListOrdered, active: editor.isActive('orderedList'), action: () => { editor.chain().focus().toggleOrderedList().run(); } },
      { label: '任务清单', icon: ListChecks, active: editor.isActive('taskList'), action: () => { editor.chain().focus().toggleTaskList().run(); } },
    ] },
    { label: '插入内容', icon: Plus, items: [
      { label: '左右分栏', icon: Table2, action: () => { insertColumns(editor, 2); } },
      { label: '三栏布局', icon: Table2, action: () => { insertColumns(editor, 3); } },
      { label: '引用', icon: Quote, active: editor.isActive('blockquote'), action: () => { editor.chain().focus().toggleBlockquote().run(); } },
      { label: '代码块', icon: Code2, active: editor.isActive('codeBlock'), action: () => { editor.chain().focus().toggleCodeBlock().run(); } },
      { label: '分隔线', icon: Minus, action: () => { editor.chain().focus().setHorizontalRule().run(); } },
      { label: '链接', icon: Link, active: editor.isActive('link'), action: () => openForm('link') },
      { label: '网页', icon: Globe, action: () => openResource('web') },
      { label: '视频', icon: Film, action: () => openResource('video') },
      { label: '文件附件', icon: Paperclip, action: () => openResource('file') },
      { label: '其他便签', icon: Paperclip, action: () => openResource('note') },
      { label: '图片', icon: Image, action: () => openForm('image') },
      { label: '表格', icon: Table2, action: () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
      { label: '公式', icon: Sigma, action: () => { editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: 'E=mc^2' } }).run(); } },
    ] },
  ];
  const colors = [['紫色', '#625bc5'], ['蓝色', '#2563eb'], ['绿色', '#21805e'], ['橙色', '#b96513'], ['红色', '#d33c53'], ['灰色', '#737987']];
  const restoreFocus = () => { setMenu(null); anchor.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    if (!menu || !panel.current || !anchor.current) return;
    const floating = panel.current, trigger = anchor.current;
    if (focusMenu.current) { focusMenu.current = false; floating.querySelector<HTMLButtonElement>('button')?.focus(); }
    return autoUpdate(trigger, floating, () => { void computePosition(trigger, floating, { placement: 'bottom-start', strategy: 'fixed', middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8, crossAxis: true })] }).then(({ x, y }) => { floating.style.left = `${x}px`; floating.style.top = `${y}px`; }); });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target) && !panel.current?.contains(event.target)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); restoreFocus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [menu]);
  useEffect(() => { if (disabled) setMenu(null); }, [disabled]);
  function toggle(label: string, button: HTMLButtonElement, keyboard: boolean) {
    anchor.current = button; focusMenu.current = keyboard; setMenu(current => current === label ? null : label);
  }
  const active = groups.find(group => group.label === menu);
  return <div ref={root} className="editor-tool-groups" data-moki-tools="" onBlur={event => {
    if (event.relatedTarget instanceof Node && !root.current?.contains(event.relatedTarget) && !panel.current?.contains(event.relatedTarget)) setMenu(null);
  }}>
    {groups.map(({ label, icon: Icon }) => <button key={label} type="button" disabled={disabled} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={menu === label} onClick={e => toggle(label, e.currentTarget, e.detail === 0)}><Icon size={16} /><ChevronDown size={10} /></button>)}
    <span className="editor-tool-separator" />
    <button type="button" disabled={disabled} aria-label="文字颜色" title="文字颜色" aria-haspopup="menu" aria-expanded={menu === '文字颜色'} onClick={e => toggle('文字颜色', e.currentTarget, e.detail === 0)}><Palette size={16} /></button>
    <button type="button" disabled={disabled} aria-label="清除格式" title="清除文字格式" onClick={() => { setMenu(null); editor.chain().focus().unsetAllMarks().run(); }}><Eraser size={16} /></button>
    {menu && !disabled && createPortal(<div ref={panel} className="editor-popup editor-tool-menu" data-moki-tools="" role="menu" aria-label={menu} onMouseDown={e => e.preventDefault()} onKeyDown={event => {
      const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
      if (event.key === 'Tab') setMenu(null);
    }} onBlur={event => { if (event.relatedTarget instanceof Node && !panel.current?.contains(event.relatedTarget) && !root.current?.contains(event.relatedTarget)) setMenu(null); }}>
      {active?.items.map(({ label, icon: Icon, active: pressed, action }) => <button key={label} type="button" role="menuitemcheckbox" aria-checked={!!pressed} onClick={() => { setMenu(null); action(); }}><Icon size={16} /><span>{label}</span>{pressed && <Check size={14} />}</button>)}
      {menu === '文字颜色' && <>
        <button type="button" role="menuitem" onClick={() => { setMenu(null); editor.chain().focus().unsetMark('textColor').run(); }}><Eraser size={16} /><span>默认颜色</span></button>
        {colors.map(([label, color]) => <button key={color} type="button" role="menuitemcheckbox" aria-checked={editor.isActive('textColor', { color })} onClick={() => { setMenu(null); editor.chain().focus().setMark('textColor', { color }).run(); }}><span className="editor-color-dot" style={{ background: color }} /><span>{label}</span>{editor.isActive('textColor', { color }) && <Check size={14} />}</button>)}
        <label className="editor-custom-color">自定义颜色<input type="color" aria-label="自定义文字颜色" value={editor.getAttributes('textColor').color ?? '#625bc5'} onMouseDown={event => event.stopPropagation()} onChange={event => { editor.chain().focus().setMark('textColor', { color: event.target.value }).run(); }} /></label>
      </>}
    </div>, document.body)}
  </div>;
}
