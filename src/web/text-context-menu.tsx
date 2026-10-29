import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { Copy, Scissors, ClipboardPaste, TextSelect, Trash2, Bold, Italic, Underline, Strikethrough, Highlighter, Code, Link, Eraser } from 'lucide-react';
import './text-context-menu.css';

type SelectionMenu = { x: number; y: number; from: number; to: number };
export function TextContextMenu({ editor, disabled, onOpenChange, onLink }: { editor: Editor; disabled: boolean; onOpenChange(open: boolean): void; onLink(): void }) {
  const [menu, setMenu] = useState<SelectionMenu | null>(null), [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const close = () => { setMenu(null); onOpenChange(false); };
  useEffect(() => {
    const root = editor.view.dom;
    const open = (event: MouseEvent | KeyboardEvent) => {
      if (event.target instanceof Element) {
        const noneditable = event.target.closest('[contenteditable="false"]');
        if (event.target.closest('.resource-block') || noneditable && noneditable !== root) return;
      }
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
      try {
        const from = editor.view.posAtDOM(range.startContainer, range.startOffset), to = editor.view.posAtDOM(range.endContainer, range.endOffset);
        if (from >= to) return;
        event.preventDefault(); event.stopPropagation();
        const rect = range.getBoundingClientRect();
        setError(''); setMenu({ from, to, x: 'clientX' in event ? event.clientX : rect.left, y: 'clientY' in event ? event.clientY : rect.bottom }); onOpenChange(true);
      } catch { /* Ignore selections outside document positions. */ }
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') open(e); };
    root.addEventListener('contextmenu', open); root.addEventListener('keydown', key);
    const changed = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => { if (transaction.docChanged) close(); };
    editor.on('transaction', changed);
    return () => { root.removeEventListener('contextmenu', open); root.removeEventListener('keydown', key); editor.off('transaction', changed); };
  }, [editor, onOpenChange]);
  useEffect(() => { close(); }, [disabled]);
  useLayoutEffect(() => {
    if (!menu || !panel.current) return;
    const el = panel.current, rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - rect.height - 8))}px`;
    el.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => { if (e.target instanceof Node && !panel.current?.contains(e.target)) close(); };
    const scroll = (e: Event) => { if (!(e.target instanceof Node && panel.current?.contains(e.target))) close(); };
    document.addEventListener('pointerdown', outside); window.addEventListener('scroll', scroll, true); window.addEventListener('resize', scroll); window.addEventListener('blur', scroll);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll); window.removeEventListener('blur', scroll); };
  }, [menu]);
  if (!menu) return null;
  const restore = () => { editor.commands.setTextSelection({ from: menu.from, to: menu.to }); editor.view.focus(); };
  const run = (fn: () => void) => { restore(); close(); fn(); };
  async function clipboardAction(action: 'copy' | 'cut' | 'paste') {
    restore(); close();
    try {
      if (window.mokiDesktop) await window.mokiDesktop.textClipboardAction(action);
      else if (action === 'paste') {
        const doc = editor.state.doc, selection = editor.state.selection;
        const text = await navigator.clipboard.readText();
        if (editor.isDestroyed || !editor.isEditable || !editor.state.doc.eq(doc) || !editor.state.selection.eq(selection)) throw new Error('正文或选区已改变，请重新粘贴');
        if (text) editor.commands.insertContent(text, { contentType: 'markdown' });
      } else if (!document.execCommand(action)) throw new Error('请使用键盘快捷键重试');
    } catch (e) { setError((e as Error).message); setMenu(menu); onOpenChange(true); }
  }
  const modifier = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
  return createPortal(<div ref={panel} className="editor-popup text-context-menu" data-moki-tools="" role="menu" aria-label="选中文字操作" style={{ left: menu.x, top: menu.y }} onMouseDown={e => e.preventDefault()} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); restore(); close(); }
    if (e.key === 'Tab') close();
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const buttons = [...panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    <button role="menuitem" onClick={() => void clipboardAction('copy')}><Copy size={15} /><span>复制</span><kbd>{modifier}+C</kbd></button>
    {!disabled && <><button role="menuitem" onClick={() => void clipboardAction('cut')}><Scissors size={15} /><span>剪切</span><kbd>{modifier}+X</kbd></button><button role="menuitem" onClick={() => void clipboardAction('paste')}><ClipboardPaste size={15} /><span>粘贴</span><kbd>{modifier}+V</kbd></button></>}
    <button role="menuitem" onClick={() => run(() => editor.commands.selectAll())}><TextSelect size={15} /><span>全选正文</span><kbd>{modifier}+A</kbd></button>
    {!disabled && <><div className="text-context-formats" role="group" aria-label="文字格式">{([['加粗', 'bold', Bold], ['斜体', 'italic', Italic], ['下划线', 'underline', Underline], ['删除线', 'strike', Strikethrough], ['高亮', 'highlight', Highlighter], ['行内代码', 'code', Code]] as const).map(([label, mark, Icon]) => <button key={mark} role="menuitemcheckbox" aria-label={label} title={label} aria-checked={editor.isActive(mark)} onClick={() => run(() => editor.commands.toggleMark(mark))}><Icon size={16} /></button>)}</div>
      <button role="menuitem" onClick={() => run(onLink)}><Link size={15} /><span>设置链接</span></button>
      <button role="menuitem" onClick={() => run(() => editor.commands.unsetAllMarks())}><Eraser size={15} /><span>清除格式</span></button>
      <button role="menuitem" className="text-context-delete" onClick={() => run(() => editor.commands.deleteSelection())}><Trash2 size={15} /><span>删除所选</span></button></>}
    {error && <p role="alert">{error}</p>}
  </div>, document.body);
}
