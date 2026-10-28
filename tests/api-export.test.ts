import { afterEach, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { NotesStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import { exportNote } from '../src/server/export.js';
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0; });
describe('HTTP and portable documents', () => {
  it('validates requests and rejects cross-site writes / rebinding hosts', async () => {
    const s = new NotesStore(':memory:'); cleanup.push(() => s.close()); const app = await createApp(s); cleanup.push(() => app.close());
    const create = await app.inject({ method: 'POST', url: '/api/notes', payload: { title: 'API' } });
    expect(create.statusCode).toBe(200); const n = create.json();
    expect((await app.inject({ method: 'PATCH', url: `/api/notes/${n.id}`, payload: { patch: { title: 'bad' } } })).statusCode).toBe(400);
    const update = { expectedVersion: 1, patch: { title: 'updated' } };
    expect((await app.inject({ method: 'PATCH', url: `/api/notes/${n.id}`, payload: update })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/notes/${n.id}`, payload: update })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/notes', headers: { origin: 'https://evil.example' }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/tree', headers: { host: 'evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/notes/${n.id}/export/exe` })).statusCode).toBe(400);
  });
  it('exports real DOCX XML with formatted paragraphs, links and tables; txt strips Markdown', async () => {
    const s = new NotesStore(':memory:'); cleanup.push(() => s.close());
    const n = s.create({ title: '中文 / 测试', content: '## 标题\n\n**粗体**、*斜体*与~~删除~~\n\n[链接](https://example.com)\n\n- [x] 完成\n- [ ] 未完成\n\n| 名称 | 内容 |\n| --- | --- |\n| 颜色 | 浅紫 |\n\n```js\nconsole.log(42)\n```' });
    const md = await exportNote(n, 'md'), txt = await exportNote(n, 'txt'), docx = await exportNote(n, 'docx');
    expect(md.bytes.toString()).toContain(n.content); expect(txt.bytes.toString()).toContain('粗体、斜体与删除'); expect(txt.bytes.toString()).not.toContain('**');
    expect(docx.name).toBe('中文 _ 测试.docx');
    const files = unzipSync(docx.bytes); const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain('<w:tbl>'); expect(xml).toContain('Heading2'); expect(xml).toContain('<w:b/>'); expect(xml).toContain('console.log(42)'); expect(xml).toContain('浅紫');
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('https://example.com');
  });
});
