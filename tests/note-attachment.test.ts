// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Resource, noteIdFromSource, resourceMarkdown, type ResourceData } from '../src/shared/resources.js';
import { columnsMarkdown } from '../src/shared/columns.js';
import { richExtensions } from '../src/web/rich-extensions.js';
import { MarkdownPreview } from '../src/web/markdown.js';
import { NoteAttachmentExcerpt, openNoteAttachment } from '../src/web/note-attachment.js';
import { NotesStore } from '../src/server/store.js';
import { exportNote } from '../src/server/export.js';

const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attachment: ResourceData = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', kind: 'note', src: `/?note=${targetId}`, title: '关联 [便签] **原题**', view: 'card' };
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); delete window.mokiDesktop; });
describe('note attachments', () => {
  it('accepts only exact local note IDs, keeping ordinary resources out of internal navigation', () => {
    expect(noteIdFromSource(attachment.src)).toBe(targetId);
    for (const src of ['/?note=bad', '/?note='+targetId+'&url=https://evil.test', 'https://example.com/?note='+targetId, 'javascript:alert(1)', '/api/assets/'+targetId+'/content']) expect(Resource.safeParse({ ...attachment, src }).success).toBe(false);
    expect(Resource.safeParse({ ...attachment, kind: 'web' }).success).toBe(false);
  });
  it('round trips all views inside columns and renders an internal attachment in read preview', () => {
    for (const view of ['title', 'link', 'card', 'preview'] as const) {
      const resource = { ...attachment, view }, content = columnsMarkdown(['正文', resourceMarkdown(resource)]);
      const editor = new Editor({ extensions: richExtensions(), content, contentType: 'markdown' });
      const before = editor.getJSON(); editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' }); expect(editor.getJSON()).toEqual(before);
      expect(editor.state.doc.firstChild?.lastChild?.firstChild?.attrs).toEqual(resource); editor.destroy();
      const html = renderToStaticMarkup(createElement(MarkdownPreview, { content })); expect(html).toContain('title="打开便签"'); expect(html).toContain('data-resource-id="'+resource.id+'"');
    }
  });
  it('keeps a finite formatted excerpt when notes refer to each other and never loads referenced images', () => {
    const html = renderToStaticMarkup(createElement(NoteAttachmentExcerpt, { content: '**摘要**\n\n'+resourceMarkdown(attachment)+'\n\n![图片](https://example.com/a.png)\n\n<script>alert(1)</script>\n\n'+'结尾'.repeat(1000) }));
    expect(html).toContain('<strong>摘要</strong>'); expect(html).not.toContain('resource-block'); expect(html).not.toContain('<img'); expect(html).not.toContain('<script'); expect(html.length).toBeLessThan(1500);
  });
  it('navigates inside the manager and uses the existing manager from desktop cards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: targetId, title: '已改名', archived: true, deletedAt: null }) }));
    const events: unknown[] = [], listener = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener('moki:open-note', listener);
    try {
      await openNoteAttachment(attachment); expect(events).toEqual([{ id: targetId, archived: true }]);
      const manager = vi.fn().mockResolvedValue(undefined); window.mokiDesktop = { manager } as unknown as Window['mokiDesktop'];
      window.history.replaceState({}, '', '/?sticky='+attachment.id); await openNoteAttachment(attachment); expect(manager).toHaveBeenCalledWith(targetId); expect(events).toHaveLength(1);
    } finally { window.removeEventListener('moki:open-note', listener); }
  });
  it('refuses navigation to trashed or permanently missing targets', async () => {
    const manager = vi.fn(); window.mokiDesktop = { manager } as unknown as Window['mokiDesktop']; window.history.replaceState({}, '', '/?sticky='+attachment.id);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: targetId, deletedAt: '2026-10-27' }) }));
    await expect(openNoteAttachment(attachment)).rejects.toThrow('回收站'); expect(manager).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ message: '便签不存在' }) }));
    await expect(openNoteAttachment(attachment)).rejects.toThrow('不存在'); expect(manager).not.toHaveBeenCalled();
  });
  it('exports the stable reference instead of duplicating the other note body', async () => {
    const store = new NotesStore(':memory:');
    try {
      const target = store.create({ title: '目标', content: '目标正文不应被复制' });
      const resource = { ...attachment, src: '/?note='+target.id }, note = store.create({ title: '来源', content: resourceMarkdown(resource) });
      const txt = (await exportNote(note, 'txt')).bytes.toString(); expect(txt).toContain(target.id); expect(txt).not.toContain('目标正文不应被复制'); expect(txt).not.toContain('moki-resource:');
      expect((await exportNote(note, 'md')).bytes.toString()).toContain(resource.src); expect((await exportNote(note, 'docx')).bytes.length).toBeGreaterThan(1000);
    } finally { store.close(); }
  });
});
