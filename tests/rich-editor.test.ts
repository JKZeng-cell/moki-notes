// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { richExtensions } from '../src/web/rich-extensions.js';
import { demoNotes } from '../src/server/demo-content.js';

const fixture = '# 标题\n\n**粗体**、*斜体*、~~删除~~、`代码` 和 [链接](https://example.com)\n\n- 无序\n  - 子项\n\n1. 有序\n\n- [ ] 未完成\n- [x] 已完成\n\n> 引用\n\n```js\nconst x = "**literal**";\n```\n\n| 标题 | 内容 |\n| --- | --- |\n| 一 | 二 |\n\n![图片](https://example.com/a.png)\n\n公式 $x^2$\n\n$$\nx+y\n$$\n\n注释[^a]\n\n[^a]: 脚注 **正文**';
describe('live Markdown persistence', () => {
  it('renders the demo component catalogue and preserves its structures and emoji after editing serialization', () => {
    const types = new Set<string>(), headings = new Set<number>();
    for (const note of demoNotes) {
      const editor = new Editor({ extensions: richExtensions(), content: note.content, contentType: 'markdown' });
      editor.state.doc.descendants(node => { types.add(node.type.name); if (node.type.name === 'heading') headings.add(node.attrs.level); node.marks.forEach(m => types.add(m.type.name)); });
      const original = editor.getJSON(), md = editor.getMarkdown();
      editor.commands.setContent(md, { contentType: 'markdown' });
      expect(editor.getJSON(), note.title).toEqual(original);
      if (note.key === 'emoji') for (const emoji of ['😊', '👍🏽', '👩‍💻', '❤️']) expect(md).toContain(emoji);
      editor.destroy();
    }
    for (const type of ['paragraph', 'heading', 'bold', 'italic', 'strike', 'code', 'link', 'image', 'hardBreak', 'horizontalRule', 'bulletList', 'orderedList', 'taskList', 'taskItem', 'blockquote', 'table', 'codeBlock', 'inlineMath', 'blockMath', 'footnoteReference', 'footnoteDefinition', 'rawHtml']) expect(types, type).toContain(type);
    expect([...headings].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('round trips structures, task state, code, math, images and footnotes through rich editing', () => {
    const editor = new Editor({ extensions: richExtensions(), content: fixture, contentType: 'markdown' });
    const json = JSON.stringify(editor.getJSON());
    for (const type of ['heading', 'bold', 'italic', 'strike', 'code', 'link', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'table', 'image', 'inlineMath', 'blockMath', 'footnoteReference', 'footnoteDefinition']) expect(json, type).toContain(`"type":"${type}"`);
    const md = editor.getMarkdown();
    for (const text of ['- [x] 已完成', 'const x = "**literal**";', '$x^2$', 'x+y', '[^a]', '[^a]:', 'https://example.com/a.png']) expect(md).toContain(text);
    editor.commands.setContent(md, { contentType: 'markdown' });
    expect(editor.getMarkdown().trimEnd()).toBe(md.trimEnd());
    editor.destroy();
  });
  it('preserves unexecuted HTML blocks and does not convert escaped syntax into marks', () => {
    const editor = new Editor({ extensions: richExtensions(), content: '<script>alert(1)</script>\n\n\\*literal\\*', contentType: 'markdown' });
    expect(editor.getHTML()).not.toContain('<script>');
    expect(editor.getMarkdown()).toContain('<script>alert(1)</script>');
    expect(editor.getJSON().content?.at(-1)?.content?.[0].marks).toBeUndefined();
    editor.destroy();
  });
  it('external replace and formatting commands keep Markdown as the storage contract', () => {
    const editor = new Editor({ extensions: richExtensions(), content: '选中文字', contentType: 'markdown' });
    editor.chain().setTextSelection({ from: 1, to: 5 }).toggleBold().run();
    expect(editor.getMarkdown()).toBe('**选中文字**');
    editor.commands.setContent('## Agent 更新\n\n- [x] 完成', { contentType: 'markdown', emitUpdate: false });
    expect(editor.getHTML()).toContain('<h2>Agent 更新</h2>');
    expect(editor.getMarkdown()).toContain('- [x] 完成'); editor.destroy();
  });
});
