import { dialog, shell, type BrowserWindow } from 'electron';
import { copyFile, rename, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { Attachments, safeAttachmentName } from '../server/attachments.js';
import { Resource, assetIdFromSource, videoEmbedSource } from '../shared/resources.js';

export async function openResource(assets: Attachments, value: unknown) {
  const resource = Resource.parse(value), id = assetIdFromSource(resource.src);
  if (resource.kind === 'note') throw new Error('请在便签应用内打开引用');
  if (id) { const error = await shell.openPath(await assets.openablePath(id)); if (error) throw new Error(error); }
  else await shell.openExternal(resource.src);
}
export async function saveResource(window: BrowserWindow, assets: Attachments, value: unknown) {
  const resource = Resource.parse(value), id = assetIdFromSource(resource.src);
  if (resource.kind === 'note') throw new Error('请使用便签导出功能');
  const info = id ? await assets.get(id) : null;
  const shortcut = !id && (resource.kind === 'web' || !!videoEmbedSource(resource.src));
  const name = info?.name ?? (shortcut ? `${safeAttachmentName(resource.title)}.url` : safeAttachmentName(new URL(resource.src).pathname.split('/').at(-1) || resource.title));
  const selected = await dialog.showSaveDialog(window, { title: shortcut ? '网页快捷方式另存为' : '附件另存为', defaultPath: name });
  if (selected.canceled || !selected.filePath) return false;
  const target = selected.filePath, temp = `${target}.moki-${randomUUID()}.tmp`;
  try {
    if (id) await copyFile(await assets.contentPath(id), temp);
    else if (shortcut) await writeFile(temp, `[InternetShortcut]\r\nURL=${new URL(resource.src).href}\r\n`, 'utf8');
    else {
      const response = await fetch(resource.src, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}），请在浏览器打开`);
      let size = 0;
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), new Transform({ transform(chunk, _enc, cb) { size += chunk.length; cb(size > 2 * 1024 ** 3 ? new Error('下载文件超过 2 GB') : null, chunk); } }), createWriteStream(temp, { flags: 'wx' }));
    }
    await rename(temp, target); return true;
  } catch (error) { await rm(temp, { force: true }); throw error; }
}
export async function importResources(window: BrowserWindow, assets: Attachments, video = false) {
  const selected = await dialog.showOpenDialog(window, { title: video ? '插入本地视频' : '插入文件附件', properties: ['openFile', 'multiSelections'], ...(video ? { filters: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'ogv', 'mkv', 'avi'] }] } : {}) });
  const files = [];
  for (const path of selected.filePaths) files.push(await assets.importFile(path));
  return files;
}
