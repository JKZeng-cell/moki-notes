import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, realpathSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile, stat, rm, open } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../shared/model.js';
import type { AttachmentInfo, PreviewKind } from '../shared/resources.js';

const types: Record<string, [string, PreviewKind]> = {
  png: ['image/png', 'image'], jpg: ['image/jpeg', 'image'], jpeg: ['image/jpeg', 'image'], gif: ['image/gif', 'image'], webp: ['image/webp', 'image'], avif: ['image/avif', 'image'], bmp: ['image/bmp', 'image'],
  mp4: ['video/mp4', 'video'], webm: ['video/webm', 'video'], ogv: ['video/ogg', 'video'], mov: ['video/quicktime', 'video'],
  mp3: ['audio/mpeg', 'audio'], wav: ['audio/wav', 'audio'], ogg: ['audio/ogg', 'audio'], m4a: ['audio/mp4', 'audio'], flac: ['audio/flac', 'audio'],
  pdf: ['application/pdf', 'pdf'],
};
const textExtensions = new Set(['txt', 'md', 'json', 'csv', 'log', 'yaml', 'yml', 'xml', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'rs', 'go', 'sql', 'sh', 'ps1', 'html', 'svg']);
const executableExtensions = new Set(['exe', 'com', 'msi', 'msp', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'scr', 'hta', 'reg', 'jar', 'lnk', 'url', 'sh', 'app', 'desktop']);
export function safeAttachmentName(value: string) {
  const name = value.split(/[\\/]/).at(-1)!.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 180);
  return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `附件-${name || '文件'}` : name;
}
export function attachmentType(name: string) {
  const ext = extname(name).slice(1).toLowerCase();
  const [mime, preview] = types[ext] ?? (textExtensions.has(ext) ? ['text/plain; charset=utf-8', 'text'] : ['application/octet-stream', 'none']);
  return { mime, preview: preview as PreviewKind, canOpen: !executableExtensions.has(ext) };
}
export class Attachments {
  constructor(readonly root: string) { this.root = resolve(root); }
  remove(id: string) {
    z.string().uuid().parse(id);
    const folder = resolve(this.root, id);
    if (dirname(folder) !== this.root) throw new Error('Invalid attachment directory');
    if (!existsSync(folder)) return;
    // Reject junctions/symlinks escaping the managed attachment directory.
    if (dirname(realpathSync(folder)) !== realpathSync(this.root)) throw new Error('Attachment path escapes storage');
    rmSync(folder, { recursive: true, force: true });
  }
  async importStream(name: string, input: Readable, limit = 256 * 1024 * 1024): Promise<AttachmentInfo> {
    const id = randomUUID(), folder = join(this.root, id);
    name = safeAttachmentName(name);
    if (dirname(folder) !== this.root) throw new Error('Invalid attachment directory');
    await mkdir(join(folder, 'files'), { recursive: true });
    let size = 0;
    try {
      await pipeline(input, new Transform({ transform(chunk, _enc, callback) { size += chunk.length; callback(size > limit ? new AppError('FILE_TOO_LARGE', `文件超过 ${Math.round(limit / 1024 / 1024)} MB 限制`, 413) : null, chunk); } }), createWriteStream(this.filePath(id, name), { flags: 'wx' }));
      const info: AttachmentInfo = { id, name, size, ...attachmentType(name), createdAt: new Date().toISOString(), src: `/api/assets/${id}/content` };
      await writeFile(join(folder, 'metadata.json'), JSON.stringify(info), { flag: 'wx' }); return info;
    } catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
  }
  async importFile(path: string) {
    const s = await stat(path);
    if (!s.isFile()) throw new AppError('NOT_FILE', '请选择文件');
    if (s.size > 2 * 1024 ** 3) throw new AppError('FILE_TOO_LARGE', '单个附件最大支持 2 GB');
    return this.importStream(path, createReadStream(path), 2 * 1024 ** 3);
  }
  async get(id: string): Promise<AttachmentInfo> {
    z.string().uuid().parse(id);
    try {
      const stored = JSON.parse(await readFile(join(this.root, id, 'metadata.json'), 'utf8')) as AttachmentInfo;
      const file = await stat(this.filePath(id, stored.name));
      const name = safeAttachmentName(stored.name);
      return { id, name, size: file.size, ...attachmentType(name), src: `/api/assets/${id}/content`, createdAt: stored.createdAt };
    } catch { throw new AppError('ASSET_NOT_FOUND', '附件不存在或已移走，请重新插入', 404); }
  }
  private filePath(id: string, name: string) { return join(this.root, z.string().uuid().parse(id), 'files', safeAttachmentName(name)); }
  async contentPath(id: string) { const info = await this.get(id); return this.filePath(id, info.name); }
  async openablePath(id: string) {
    const info = await this.get(id);
    if (!info.canOpen) throw new AppError('EXECUTABLE_ATTACHMENT', '此文件类型支持预览或另存为，不直接运行');
    return this.filePath(id, info.name);
  }
  async text(id: string) {
    const info = await this.get(id);
    if (info.preview !== 'text') throw new AppError('NOT_TEXT', '该文件不支持文本预览');
    const handle = await open(this.filePath(id, info.name), 'r');
    try { const buffer = Buffer.alloc(Math.min(info.size, 256 * 1024)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); return { text: buffer.subarray(0, bytesRead).toString('utf8'), truncated: info.size > bytesRead }; }
    finally { await handle.close(); }
  }
}

export function parseByteRange(range: string | undefined, size: number) {
  if (!range) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m || !size || (!m[1] && !m[2])) throw new AppError('INVALID_RANGE', '无效的文件读取范围', 416);
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] ? m[2] ? Math.min(size - 1, Number(m[2])) : size - 1 : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) throw new AppError('INVALID_RANGE', '无效的文件读取范围', 416);
  return { start, end };
}
