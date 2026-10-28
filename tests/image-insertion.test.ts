// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { attachmentResource } from '../src/web/resource-insert.js';
import { richExtensions } from '../src/web/rich-extensions.js';
import { MarkdownPreview } from '../src/web/markdown.js';
import { type AttachmentInfo, resourceMarkdown } from '../src/shared/resources.js';

const info: AttachmentInfo = { id: '11111111-1111-4111-8111-111111111111', name: '示例图片.png', src: '/api/assets/11111111-1111-4111-8111-111111111111/content', preview: 'image', mime: 'image/png', size: 128, createdAt: new Date().toISOString(), canOpen: true };
it('inserts uploaded images as portable Markdown images and keeps other file types as attachments', () => {
  const image = attachmentResource(info), file = attachmentResource({ ...info, name: '说明.txt', preview: 'text', mime: 'text/plain' });
  expect(image.type).toBe('image'); expect(file.type).toBe('resourceEmbed'); expect(file.attrs?.view).toBe('card');
  const editor = new Editor({ extensions: richExtensions(), content: { type: 'doc', content: [image, { type: 'paragraph', content: [{ type: 'text', text: '图后的正文' }] }, file] } });
  try {
    const json = editor.getJSON(), md = editor.getMarkdown();
    expect(md).toContain('![示例图片.png]'); expect(md.match(/moki-resource/g)).toHaveLength(1);
    editor.commands.setContent(md, { contentType: 'markdown' }); expect(editor.getJSON()).toEqual(json);
  } finally { editor.destroy(); }
});
it('renders standalone images without file headers and preserves surrounding inline text', () => {
  const html = renderToStaticMarkup(createElement(MarkdownPreview, { content: `![图片](${info.src})\n\n前文 ![小图](https://example.com/a.png) 后文` }));
  expect(html).toContain('resource-image'); expect(html).not.toContain('resource-main'); expect(html).not.toContain('本地附件');
  const rendered = document.createElement('div'); rendered.innerHTML = html;
  const paragraph = rendered.querySelector('p')!;
  expect(paragraph.textContent).toBe('前文  后文'); expect(paragraph.querySelector('img')?.getAttribute('alt')).toBe('小图');
  expect(paragraph.querySelector('[aria-label="放大预览：小图"]')).not.toBeNull(); expect(paragraph.querySelector('div')).toBeNull();
});
it('preserves explicit non-image attachment views', () => {
  const content = resourceMarkdown({ id: info.id, kind: 'file', src: 'https://example.com/a.pdf', title: '资料', view: 'card' });
  const html = renderToStaticMarkup(createElement(MarkdownPreview, { content }));
  expect(html).toContain('resource-main'); expect(html).not.toContain('resource-image');
});
