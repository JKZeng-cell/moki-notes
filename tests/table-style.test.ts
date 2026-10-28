// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { richExtensions } from '../src/web/rich-extensions.js';
import { tableAt } from '../src/web/table-operations.js';
import { parseStyledTable, styledTableMarkdown } from '../src/shared/table-style.js';
import { parseMarkdown, plainText, exportNote } from '../src/server/export.js';
import { noteExcerpt } from '../src/shared/note-excerpt.js';
import { unzipSync, strFromU8 } from 'fflate';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownPreview } from '../src/web/markdown.js';
const editors: Editor[] = [];
const base = '| A | B |\n| --- | --- |\n| a | b |\n| c | d |';
const make = (content = base) => { const e = new Editor({ extensions: richExtensions(), content, contentType: 'markdown' }); editors.push(e); return e; };
afterEach(() => editors.splice(0).forEach(e => e.destroy()));
it('round-trips column widths, row heights and multiple selected cell fills with content intact', () => {
  const e = make(), table = tableAt(e, 0)!;
  let tr = e.state.tr;
  table.node.forEach((row, rowOffset, r) => {
    tr = tr.setNodeMarkup(1 + rowOffset, undefined, { ...row.attrs, rowHeight: r === 1 ? 100 : null });
    row.forEach((cell, offset, c) => { tr = tr.setNodeMarkup(2 + rowOffset + offset, undefined, { ...cell.attrs, colwidth: [c ? 180 : 240] }); });
  });
  e.view.dispatch(tr);
  e.view.dispatch(e.state.tr.setSelection(new CellSelection(e.state.doc.resolve(1 + table.map.map[2]), e.state.doc.resolve(1 + table.map.map[3]))));
  e.commands.setCellAttribute('backgroundColor', '#dcfce7');
  const before = e.getJSON(), md = e.getMarkdown();
  expect(md).toContain(':::moki-table'); expect(md).toContain('"1:0":"#dcfce7"'); expect(md).toContain('"1:1":"#dcfce7"');
  e.commands.setContent(md, { contentType: 'markdown' }); expect(e.getJSON()).toEqual(before);
  expect(e.getMarkdown()).toBe(md); expect(e.getHTML()).toContain('data-row-height="100"');
  expect(plainText(parseMarkdown(md))).not.toContain('moki-table'); expect(noteExcerpt(md)).not.toContain('widths');
  expect(plainText(parseMarkdown(md))).toContain('a');
});
it('keeps plain tables plain and styles isolated to each table and nested columns', () => {
  expect(make().getMarkdown()).not.toContain('moki-table');
  const styled = styledTableMarkdown(base, { widths: [200, 120], heights: [0, 80], fills: { '1:0': '#fee2e2' } });
  const combined = `${styled}\n\n正文\n\n${base}`;
  const e = make(combined); expect(e.getJSON().content?.filter(n => n.type === 'table')).toHaveLength(2);
  const md = e.getMarkdown(); expect(md.match(/:::moki-table/g)).toHaveLength(1);
  const nested = make(`:::moki-columns\n\n:::column\n\n${styled}\n\n:::column\n\n另一栏\n\n:::end-columns`);
  expect(nested.getJSON().content?.[0].type).toBe('mokiColumns');
  const json = nested.getJSON(); nested.commands.setContent(nested.getMarkdown(), { contentType: 'markdown' }); expect(nested.getJSON()).toEqual(json);
});
it('renders styled previews with sizes and readable text on a dark custom fill', () => {
  const content = styledTableMarkdown(base, { widths: [240, 180], heights: [0, 100], fills: { '1:0': '#123456' } });
  const e = make(content);
  expect(e.getHTML()).toContain('color: rgb(255, 255, 255)');
  const html = renderToStaticMarkup(createElement(MarkdownPreview, { content }));
  expect(html).toContain('height:100px'); expect(html).toContain('width:240px');
  expect(html).toContain('background-color:#123456;color:#ffffff');
  expect(html).not.toContain(':::moki-table');
  const partial = renderToStaticMarkup(createElement(MarkdownPreview, { content: styledTableMarkdown(base, { widths: [377, 0], heights: [], fills: {} }) }));
  expect(partial).toContain('min-width:427px');
});
it('rejects invalid style metadata and does not execute HTML/style strings', () => {
  expect(parseStyledTable(':::moki-table {"fills":{"1:0":"url(javascript:evil)"}}\n\n'+base+'\n\n:::end-table')).toBeUndefined();
  const e = make(); e.commands.setTextSelection(3); e.commands.setCellAttribute('backgroundColor', 'red;background-image:url(evil)');
  expect(e.getHTML()).not.toContain('evil'); expect(e.getMarkdown()).not.toContain('evil');
});
it('preserves table styling in DOCX and clean content in TXT', async () => {
  const content = styledTableMarkdown(base, { widths: [200, 120], heights: [0, 80], fills: { '1:0': '#fee2e2' } });
  const note = { title: '表格', content } as Parameters<typeof exportNote>[0];
  const doc = await exportNote(note, 'docx'); const files = unzipSync(doc.bytes); const xml = strFromU8(files['word/document.xml']);
  expect(xml).toContain('fee2e2'); expect(xml).toContain('w:val="1200"'); expect(xml).toContain('w:w="3000"');
  expect((await exportNote(note, 'txt')).bytes.toString()).not.toContain('moki-table');
  expect((await exportNote(note, 'md')).bytes.toString()).toContain(':::moki-table');
});
