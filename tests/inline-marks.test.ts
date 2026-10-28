// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import { richExtensions } from '../src/web/rich-extensions.js';
import { MarkdownPreview } from '../src/web/markdown.js';
import { exportNote, parseMarkdown, plainText } from '../src/server/export.js';
import { NotesStore } from '../src/server/store.js';

const content = '<u>下划线 **粗体**</u> · ==高亮 *斜体*== · {{color:#625bc5}}紫色{{/color}}';
describe('editor menu inline formats', () => {
  it('round trips all added marks, including at the beginning of a paragraph', () => {
    const editor = new Editor({ extensions: richExtensions(), content, contentType: 'markdown' });
    expect(editor.getHTML()).toContain('<u>');
    expect(editor.getHTML()).toContain('<mark>');
    expect(JSON.stringify(editor.getJSON())).toContain('#625bc5');
    const original = editor.getJSON();
    editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' });
    expect(editor.getJSON()).toEqual(original);
    editor.destroy();
  });
  it('formats a selection, clears only its marks and preserves a table', () => {
    const editor = new Editor({ extensions: richExtensions(), content: '| 文字 | 保留 |\n| --- | --- |\n| 单元格 | **格式** |', contentType: 'markdown' });
    let from = 0; editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === '单元格') from = pos; });
    editor.chain().setTextSelection({ from, to: from + 3 }).setMark('underline').setMark('highlight').setMark('textColor', { color: '#625bc5' }).run();
    const md = editor.getMarkdown();
    editor.commands.setContent(md, { contentType: 'markdown' });
    expect(editor.getHTML()).toContain('<mark>');
    editor.chain().setTextSelection({ from, to: from + 3 }).unsetAllMarks().run();
    expect(editor.getHTML()).not.toContain('<u>');
    expect(editor.getHTML()).toContain('<table'); expect(editor.getHTML()).toContain('<strong>格式</strong>');
    editor.destroy();
  });
  it('renders safe preview marks and preserves code, escapes and unknown HTML', () => {
    const html = renderToStaticMarkup(createElement(MarkdownPreview, { content }));
    expect(html).toContain('<u>下划线 <strong>粗体</strong></u>');
    expect(html).toContain('<mark>高亮 <em>斜体</em></mark>');
    expect(html).toContain('color:#625bc5');
    const literal = '\\{\\{color:#625bc5}}字面颜色{{/color}} \\==文字\\== `==代码==`\n\n```\n<u>代码</u>\n```\n\n<script>alert(1)</script>';
    const preview = renderToStaticMarkup(createElement(MarkdownPreview, { content: literal }));
    expect(preview).not.toMatch(/<mark>|<u>|<script>/);
    const editor = new Editor({ extensions: richExtensions(), content: literal, contentType: 'markdown' });
    expect(editor.getHTML()).not.toMatch(/<mark>|<u>|<script>/);
    const original = editor.getJSON();
    editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' });
    expect(editor.getJSON()).toEqual(original);
    editor.destroy();
    expect(plainText(parseMarkdown('==文字 `a==b` 内容=='))).toBe('文字 a==b 内容');
  });
  it('exports text without formatting delimiters and DOCX with underline, highlight and color', async () => {
    const store = new NotesStore(':memory:');
    try {
      const note = store.create({ title: '格式验收', content });
      expect((await exportNote(note, 'txt')).bytes.toString()).toBe('格式验收\n\n下划线 粗体 · 高亮 斜体 · 紫色\n');
      const xml = strFromU8(unzipSync((await exportNote(note, 'docx')).bytes)['word/document.xml']);
      expect(xml).toContain('<w:u'); expect(xml).toContain('w:highlight'); expect(xml).toContain('625bc5');
      expect((await exportNote(note, 'md')).bytes.toString()).toContain(content);
      const linked = store.create({ title: '带样式的链接', content: '[<u>=={{color:#a134ba}}链接{{/color}}==</u>](https://example.com)' });
      const linkXml = strFromU8(unzipSync((await exportNote(linked, 'docx')).bytes)['word/document.xml']);
      expect(linkXml).toContain('<w:hyperlink'); expect(linkXml).toContain('w:highlight'); expect(linkXml).toContain('a134ba');
    } finally { store.close(); }
  });
});
