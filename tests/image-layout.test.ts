// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { richExtensions } from '../src/web/rich-extensions.js';
import { MarkdownPreview } from '../src/web/markdown.js';
import { imageWidth, readImageTitle, writeImageTitle } from '../src/shared/image-size.js';
import { commitLayout, layoutBlocks, moveLayoutBlock } from '../src/web/block-layout.js';
import { parseColumnsMarkdown } from '../src/shared/columns.js';

it('retains image size and original title across Markdown and preview, and clears size cleanly', () => {
  const e = new Editor({ extensions: richExtensions(), content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/a.png', alt: '示例', title: '原始 "标题"', width: 320 } }] } });
  try {
    const before = e.getJSON(), md = e.getMarkdown(); expect(md).toContain('moki-image:320:');
    e.commands.setContent(md, { contentType: 'markdown' }); expect(e.getJSON()).toEqual(before);
    const html = renderToStaticMarkup(createElement(MarkdownPreview, { content: md }));
    expect(html).toContain('width:320px'); expect(html).not.toContain('moki-image:320:');
    e.commands.updateAttributes('image', { width: null, title: null }); expect(e.getMarkdown()).not.toContain('moki-image:');
  } finally { e.destroy(); }
  expect(readImageTitle(writeImageTitle(240, '原始标题'))).toEqual({ width: 240, title: '原始标题' });
  expect(readImageTitle('moki-image:99999:bad').width).toBeNull(); expect(imageWidth('320;display:none')).toBeNull();
});
it('adds six side-by-side blocks, round-trips the row, and undoes only the last move', () => {
  const e = new Editor({ extensions: richExtensions(), content: 'A\n\nB\n\nC\n\nD\n\nE\n\nF', contentType: 'markdown' });
  try {
    for (const value of ['B', 'C', 'D', 'E', 'F']) {
      const blocks = layoutBlocks(e.state.doc), source = blocks.find(b => b.node.textContent === value)!, target = blocks.find(b => b.node.textContent === String.fromCharCode(value.charCodeAt(0) - 1))!;
      expect(commitLayout(e, moveLayoutBlock(e.state.doc, source.pos, target.pos, 'right'))).toBe(true);
    }
    expect(e.state.doc.firstChild?.childCount).toBe(6); const json = e.getJSON(), md = e.getMarkdown();
    expect(parseColumnsMarkdown(md)?.columns).toHaveLength(6);
    expect(renderToStaticMarkup(createElement(MarkdownPreview, { content: md }))).toContain('--moki-column-count:6');
    e.commands.undo(); expect(e.state.doc.firstChild?.childCount).toBe(5); expect(e.state.doc.lastChild?.textContent).toBe('F');
    e.commands.redo(); expect(e.getJSON()).toEqual(json);
    e.commands.setContent(md, { contentType: 'markdown' }); expect(e.getJSON()).toEqual(json);
    const first = layoutBlocks(e.state.doc)[0]; expect(commitLayout(e, moveLayoutBlock(e.state.doc, first.pos, first.pos, 'belowRow'))).toBe(true);
    expect(e.state.doc.firstChild?.childCount).toBe(5); expect(e.state.doc.lastChild?.textContent).toBe('A');
  } finally { e.destroy(); }
});
