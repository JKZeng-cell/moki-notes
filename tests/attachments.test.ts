import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { Attachments, parseByteRange } from '../src/server/attachments.js';
import { NotesStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';

async function fixture() { const root = await mkdtemp(join(tmpdir(), 'moki-attachments-')); return { root, assets: new Attachments(join(root, 'assets')), cleanup: async () => { if (!resolve(root).startsWith(resolve(tmpdir()) + '\\') && !resolve(root).startsWith(resolve(tmpdir()) + '/')) throw new Error('Invalid test path'); await rm(root, { recursive: true, force: true }); } }; }
describe('managed local attachments', () => {
  it('copies files, preserves names/extensions and survives reopening the store', async () => {
    const f = await fixture();
    try {
      const source = join(f.root, '中文文件.txt'); await writeFile(source, '第一版');
      const info = await f.assets.importFile(source); await writeFile(source, '原文件变更');
      const reopened = new Attachments(f.assets.root);
      expect(await readFile(await reopened.contentPath(info.id), 'utf8')).toBe('第一版');
      expect((await reopened.get(info.id)).preview).toBe('text');
      expect(await reopened.openablePath(info.id)).toMatch(/中文文件\.txt$/);
      await writeFile(await reopened.openablePath(info.id), '默认应用编辑');
      expect((await reopened.text(info.id)).text).toBe('默认应用编辑');
      await expect(reopened.get('../metadata')).rejects.toThrow();
      await expect(reopened.get(randomUUID())).rejects.toThrow('不存在');
    } finally { await f.cleanup(); }
  });
  it('cleans incomplete uploads and treats executable/HTML resources as inert files', async () => {
    const f = await fixture();
    try {
      await expect(f.assets.importStream('large.txt', Readable.from(['12345']), 4)).rejects.toThrow('超过');
      expect(await readdir(f.assets.root)).toEqual([]);
      const html = await f.assets.importStream('../../网页.html', Readable.from(['<script>alert(1)</script>']));
      expect(html.name).toBe('网页.html'); expect(html.mime).toContain('text/plain');
      const exe = await f.assets.importStream('test.exe', Readable.from(['not executable']));
      await expect(f.assets.openablePath(exe.id)).rejects.toThrow('不直接运行');
    } finally { await f.cleanup(); }
  });
  it('serves seekable media, downloads and bounded text while rejecting invalid ranges and foreign origins', async () => {
    const f = await fixture(), store = new NotesStore(':memory:'); const app = await createApp(store, { attachments: f.assets });
    try {
      const uploaded = await app.inject({ method: 'POST', url: '/api/assets', headers: { host: 'localhost', 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('测试.mp4') }, payload: Buffer.from('0123456789') });
      expect(uploaded.statusCode).toBe(200); const info = uploaded.json(); expect(info.preview).toBe('video');
      const range = await app.inject({ method: 'GET', url: info.src, headers: { host: 'localhost', range: 'bytes=2-5' } });
      expect(range.statusCode).toBe(206); expect(range.body).toBe('2345'); expect(range.headers['content-range']).toBe('bytes 2-5/10');
      expect((await app.inject({ url: info.src, headers: { host: 'localhost', range: 'bytes=20-' } })).statusCode).toBe(416);
      const download = await app.inject({ url: info.src + '?download=1', headers: { host: 'localhost' } }); expect(download.headers['content-disposition']).toContain('attachment;');
      expect((await app.inject({ url: info.src, headers: { host: 'localhost', origin: 'https://evil.test' } })).statusCode).toBe(403);
      const text = await f.assets.importStream('long.txt', Readable.from(['a'.repeat(300000)])); const preview = await f.assets.text(text.id);
      expect(preview.text.length).toBe(256 * 1024); expect(preview.truncated).toBe(true);
      expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
      expect(() => parseByteRange('bytes=0-1,3-4', 10)).toThrow();
    } finally { await app.close(); store.close(); await f.cleanup(); }
  });
});
