// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { unzipSync, strFromU8 } from 'fflate';
import { richExtensions } from '../src/web/rich-extensions.js';
import { columnsMarkdown, parseColumnsMarkdown } from '../src/shared/columns.js';
import { commitLayout, insertColumns, flattenColumns, layoutBlocks, moveLayoutBlock } from '../src/web/block-layout.js';
import { MarkdownPreview } from '../src/web/markdown.js';
import { exportNote, parseMarkdown, plainText } from '../src/server/export.js';
import { NotesStore } from '../src/server/store.js';
import { resourceMarkdown } from '../src/shared/resources.js';

const edit = (content: string) => new Editor({ extensions: richExtensions(), content, contentType: 'markdown' });
const content = '# 文字\n\n第一段 **粗体**\n\n第二段\n\n> 引用\n\n- [x] 任务\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
const texts = (editor: Editor) => layoutBlocks(editor.state.doc).map(b => b.node.textContent);
describe('block layout persistence and transactions', () => {
  it('updates the mounted row grid immediately when columns are added, removed, undone and redone', () => {
    const editor = edit(columnsMarkdown(['A', 'B']) + '\n\nC\n\nD');
    try {
      const check = (count: number) => {
        const row = editor.view.dom.querySelector<HTMLElement>('.moki-columns')!;
        expect(row.children).toHaveLength(count);
        expect(row.dataset.columns).toBe(String(count));
        expect(row.style.getPropertyValue('--moki-column-count')).toBe(String(count));
      };
      const move = (source: string, target: string, placement: Parameters<typeof moveLayoutBlock>[3]) => {
        const blocks = layoutBlocks(editor.state.doc);
        commitLayout(editor, moveLayoutBlock(editor.state.doc, blocks.find(b => b.node.textContent === source)!.pos, blocks.find(b => b.node.textContent === target)!.pos, placement));
      };
      check(2); move('C', 'B', 'right'); check(3);
      move('D', 'C', 'right'); check(4);
      move('B', 'B', 'belowRow'); check(3);
      editor.commands.undo(); check(4); editor.commands.redo(); check(3);
      move('C', 'C', 'belowRow'); check(2);
      move('A', 'A', 'belowRow'); expect(editor.view.dom.querySelector('.moki-columns')).toBeNull();
      editor.commands.undo(); check(2);
      const json = editor.getJSON(); editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' });
      check(2); expect(editor.getJSON()).toEqual(json);
    } finally { editor.destroy(); }
  });
  it('round trips columns with rich text, tables, code, images and resources; preview keeps source offsets', () => {
    const resource = resourceMarkdown({ id: '22222222-2222-4222-8222-222222222222', kind: 'web', view: 'card', src: 'https://example.com', title: '资料' });
    const markdown = columnsMarkdown([content, '![图片](https://example.com/a.png)\n\n' + resource + '\n\n```md\n:::column\n:::end-columns\n```']);
    const editor = edit(markdown), original = editor.getJSON();
    expect(original.content?.[0].type).toBe('mokiColumns');
    expect(original.content?.[0].content).toHaveLength(2);
    editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' });
    expect(editor.getJSON()).toEqual(original);
    const html = renderToStaticMarkup(createElement(MarkdownPreview, { content: editor.getMarkdown() }));
    expect(html).toContain('class="moki-columns"'); expect(html).toContain('data-resource-id="22222222-2222-4222-8222-222222222222"'); expect(html).toMatch(/<table[ >]/);
    const ast = parseMarkdown(editor.getMarkdown()) as any;
    const resourceNode = ast.children[0].children[1].children.find((n: any) => n.data?.resource);
    expect(editor.getMarkdown().slice(resourceNode.position.start.offset, resourceNode.position.end.offset)).toBe(resource);
    editor.destroy();
  });
  it('preserves invalid containers as text and does not parse examples inside code', () => {
    expect(parseColumnsMarkdown(':::moki-columns\n\n:::column\n\nonly one\n\n:::end-columns')).toBeUndefined();
    const example = '```md\n' + columnsMarkdown(['left', 'right']) + '\n```';
    const editor = edit(example);
    expect(editor.getJSON().content?.[0].type).toBe('codeBlock');
    expect(renderToStaticMarkup(createElement(MarkdownPreview, { content: example }))).not.toContain('class="moki-columns"');
    editor.destroy();
  });
  it('reorders blocks, creates side-by-side content and undoes each layout operation independently', () => {
    const editor = edit(content), original = editor.getJSON();
    let blocks = layoutBlocks(editor.state.doc);
    expect(commitLayout(editor, moveLayoutBlock(editor.state.doc, blocks[2].pos, blocks[1].pos, 'before'))).toBe(true);
    expect(texts(editor).slice(0, 3)).toEqual(['文字', '第二段', '第一段 粗体']);
    blocks = layoutBlocks(editor.state.doc);
    expect(commitLayout(editor, moveLayoutBlock(editor.state.doc, blocks[2].pos, blocks[1].pos, 'right'))).toBe(true);
    expect(editor.getJSON().content?.[1].type).toBe('mokiColumns');
    editor.commands.undo(); expect(texts(editor).slice(0, 3)).toEqual(['文字', '第二段', '第一段 粗体']);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.redo(); editor.commands.redo(); expect(editor.getJSON().content?.[1].type).toBe('mokiColumns');
    editor.destroy();
  });
  it('moves between columns and out of rows, collapsing empty source columns without losing content', () => {
    const editor = edit(columnsMarkdown(['A\n\nB', 'C']) + '\n\nD');
    let blocks = layoutBlocks(editor.state.doc);
    commitLayout(editor, moveLayoutBlock(editor.state.doc, blocks[1].pos, blocks[2].pos, 'after'));
    expect(texts(editor)).toEqual(['A', 'C', 'B', 'D']);
    blocks = layoutBlocks(editor.state.doc);
    commitLayout(editor, moveLayoutBlock(editor.state.doc, blocks[0].pos, blocks[0].pos, 'belowRow'));
    expect(editor.getJSON().content?.every(n => n.type !== 'mokiColumns')).toBe(true);
    expect(texts(editor)).toEqual(['C', 'B', 'A', 'D']);
    editor.commands.undo(); expect(editor.getJSON().content?.[0].type).toBe('mokiColumns');
    expect(flattenColumns(editor, 0)).toBe(true); expect(texts(editor)).toEqual(['A', 'C', 'B', 'D']);
    editor.destroy();
  });
  it('preserves duplicate text blocks and table structure; rejects self-drop and accepts fifth column', () => {
    const editor = edit(columnsMarkdown(['same', 'same', 'C', 'D']) + '\n\nE');
    let blocks = layoutBlocks(editor.state.doc);
    expect(moveLayoutBlock(editor.state.doc, blocks[4].pos, blocks[0].pos, 'right')).not.toBeNull();
    expect(moveLayoutBlock(editor.state.doc, blocks[0].pos, blocks[0].pos, 'after')).toBeNull();
    commitLayout(editor, moveLayoutBlock(editor.state.doc, blocks[0].pos, blocks[2].pos, 'right'));
    expect(texts(editor)).toEqual(['same', 'C', 'same', 'D', 'E']);
    editor.commands.setContent(content, { contentType: 'markdown' }); blocks = layoutBlocks(editor.state.doc);
    const table = blocks.at(-1)!;
    commitLayout(editor, moveLayoutBlock(editor.state.doc, table.pos, blocks[0].pos, 'left'));
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.toJSON()).toEqual(table.node.toJSON());
    editor.destroy();
  });
  it('creates editable empty columns, preserves the selected block and rejects nested UI insertion', () => {
    const editor = edit('正文'); editor.commands.setTextSelection(1);
    expect(insertColumns(editor, 3)).toBe(true);
    expect(Array.from({ length: 3 }, (_, i) => editor.state.doc.firstChild?.child(i).firstChild?.type.name)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(insertColumns(editor, 2)).toBe(false);
    const original = editor.getJSON(); editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' }); expect(editor.getJSON()).toEqual(original);
    editor.destroy();
  });
  it('exports readable TXT, lossless MD and actual DOCX column cells', async () => {
    const store = new NotesStore(':memory:');
    try {
      const content = columnsMarkdown(['## 左侧\n\n**内容**', '右侧\n\n- 事项']);
      const note = store.create({ title: '分栏', content });
      expect(store.summary(note).excerpt).not.toContain(':::'); expect(store.get(note.id).content).toBe(content);
      const txt = (await exportNote(note, 'txt')).bytes.toString();
      expect(txt).toContain('左侧\n\n内容'); expect(txt).toContain('右侧'); expect(txt).not.toContain(':::');
      expect((await exportNote(note, 'md')).bytes.toString()).toContain(content);
      const xml = strFromU8(unzipSync((await exportNote(note, 'docx')).bytes)['word/document.xml']);
      expect(xml).toContain('<w:tbl>'); expect(xml).toContain('左侧'); expect(xml).toContain('右侧'); expect(xml).not.toContain('moki-columns');
      expect(plainText(parseMarkdown(content))).toContain('左侧');
    } finally { store.close(); }
  });
});
