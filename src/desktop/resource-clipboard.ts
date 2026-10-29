import { clipboard, ClipboardItem, nativeImage } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { z } from 'zod';
import { Resource, assetIdFromSource } from '../shared/resources.js';
import type { Attachments } from '../server/attachments.js';

const run = promisify(execFile);
// Paths are data in an environment variable, never interpolated into PowerShell code.
export const FILE_COPY_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$paths = New-Object System.Collections.Specialized.StringCollection
[void]$paths.Add($env:MOKI_CLIPBOARD_FILE)
for ($attempt = 0; $attempt -lt 3; $attempt++) {
  try {
    [System.Windows.Forms.Clipboard]::SetFileDropList($paths)
    $readback = [System.Windows.Forms.Clipboard]::GetFileDropList()
    if ($readback.Count -eq 1 -and $readback[0] -ceq $env:MOKI_CLIPBOARD_FILE) { exit 0 }
  } catch { }
  Start-Sleep -Milliseconds 100
}
throw 'Cannot confirm file clipboard contents'
`;

export async function copyResourceFile(assets: Attachments, value: unknown) {
  const resource = Resource.parse(value), id = assetIdFromSource(resource.src);
  if (!id) throw new Error('仅本地文件附件支持复制文件，请使用复制链接或另存为');
  const path = await assets.contentPath(id);
  if (process.platform !== 'win32') throw new Error('当前系统请使用附件另存为');
  try {
    await run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(FILE_COPY_SCRIPT, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 15_000, env: { ...process.env, MOKI_CLIPBOARD_FILE: path } });
  } catch { throw new Error('文件复制失败，剪贴板可能被占用，请重试'); }
}

export async function copyResourceImage(value: unknown) {
  const data = z.instanceof(Uint8Array).refine(b => b.length > 0 && b.length <= 64 * 1024 ** 2, '图片过大，建议复制原文件').parse(value);
  const image = nativeImage.createFromBuffer(Buffer.from(data));
  if (image.isEmpty()) throw new Error('无法读取图片，请尝试复制原文件');
  const png = image.toPNG();
  for (let attempt = 0; attempt < 3; attempt++) {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    const items = await clipboard.read();
    for (const item of items) if (item.types.includes('image/png')) {
      const copied = nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer()));
      if (!copied.isEmpty() && copied.getSize().width === image.getSize().width && copied.getSize().height === image.getSize().height && copied.toBitmap().equals(image.toBitmap())) return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('无法确认图片已复制，请重试');
}
