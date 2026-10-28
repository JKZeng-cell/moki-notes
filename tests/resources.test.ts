// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Editor } from '@tiptap/core';
import { richExtensions } from '../src/web/rich-extensions.js';
import { MarkdownPreview } from '../src/web/markdown.js';
import { Resource, resourceMarkdown, videoEmbedSource, type ResourceData } from '../src/shared/resources.js';
import { parseMarkdown, plainText, exportNote } from '../src/server/export.js';
import { NotesStore } from '../src/server/store.js';
import { resourceEdit } from '../src/web/resource-editing.js';

describe('resource Markdown and previews', () => {
  it('undoes a removal independently from a just-imported resource', () => {
    const editor = new Editor({ extensions: richExtensions(), content: '正文', contentType: 'markdown' });
    const resource: ResourceData = { id: randomUUID(), kind: 'web', view: 'card', src: 'https://example.com', title: '网页' };
    resourceEdit(editor, () => { editor.commands.insertContentAt(0, { type: 'resourceEmbed', attrs: resource }); });
    resourceEdit(editor, () => { editor.commands.deleteRange({ from: 0, to: 1 }); });
    expect(editor.getJSON().content?.some(n => n.type === 'resourceEmbed')).toBe(false);
    editor.commands.undo(); expect(editor.getJSON().content?.[0].attrs).toEqual(resource);
    editor.commands.undo(); expect(editor.getMarkdown()).toBe('正文');
    editor.destroy();
  });
  it('round trips every display mode without losing resource identity or following text', () => {
    for (const kind of ['web', 'video', 'file'] as const) for (const view of ['title', 'link', 'card', 'preview'] as const) {
      const resource: ResourceData = { id: randomUUID(), kind, view, src: kind === 'file' ? `/api/assets/${randomUUID()}/content` : 'https://example.com/file.mp4?q=1&x=2', title: '演示 [文件] **字面** &amp; <内容> `a`' };
      const content = '前面的段落\n\n' + resourceMarkdown(resource) + '\n\n后面的 **文字**';
      const editor = new Editor({ extensions: richExtensions(), content, contentType: 'markdown' });
      const nodes = editor.getJSON().content!;
      expect(nodes[1].type).toBe('resourceEmbed'); expect(nodes[1].attrs).toEqual(resource);
      const before = editor.getJSON(); editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' });
      expect(editor.getJSON()).toEqual(before);
      editor.destroy();
    }
  });
  it('shows the resource component in read preview and keeps ordinary links and code unchanged', () => {
    const resource: ResourceData = { id: randomUUID(), kind: 'web', view: 'card', src: 'https://example.com', title: '网页标题' };
    const content = resourceMarkdown(resource);
    const html = renderToStaticMarkup(createElement(MarkdownPreview, { content }));
    expect(html).toContain(`data-resource-id="${resource.id}"`); expect(html).toContain('resource-card'); expect(html).not.toContain('moki-resource:web:');
    const ordinary = renderToStaticMarkup(createElement(MarkdownPreview, { content: '[普通链接](https://example.com)\n\n```md\n' + content + '\n```' }));
    expect(ordinary).not.toContain('data-resource-id='); expect(ordinary).toContain('普通链接');
    expect(plainText(parseMarkdown(content))).toBe('网页标题 (https://example.com)');
  });
  it('rejects active and arbitrary local sources and validates supported video embeds', () => {
    const r = { id: randomUUID(), kind: 'web', view: 'preview', title: 'x' };
    for (const src of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,x', '//evil.test', '/api/assets/../../content', 'https://user:secret@example.com']) expect(Resource.safeParse({ ...r, src }).success).toBe(false);
    expect(videoEmbedSource('https://youtu.be/M7lc1UVf-VE')).toBe('https://www.youtube-nocookie.com/embed/M7lc1UVf-VE');
    expect(videoEmbedSource('https://youtube.com.evil.test/watch?v=M7lc1UVf-VE')).toBeNull();
  });
  it('exports human-readable text and DOCX instead of resource control metadata', async () => {
    const store = new NotesStore(':memory:');
    try {
      const content = resourceMarkdown({ id: randomUUID(), kind: 'web', view: 'preview', title: '网页标题', src: 'https://example.com' });
      const note = store.create({ title: '资源测试', content });
      expect((await exportNote(note, 'txt')).bytes.toString()).toContain('网页标题 (https://example.com)');
      expect((await exportNote(note, 'txt')).bytes.toString()).not.toContain('moki-resource');
      expect((await exportNote(note, 'md')).bytes.toString()).toContain(content);
      expect((await exportNote(note, 'docx')).bytes.length).toBeGreaterThan(1000);
    } finally { store.close(); }
  });
});
