import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ exec: vi.fn(), write: vi.fn(), read: vi.fn(), image: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: (...args: any[]) => { mocks.exec(...args.slice(0, -1)); args.at(-1)(null, '', ''); } }));
vi.mock('electron', () => ({ clipboard: { write: mocks.write, read: mocks.read }, ClipboardItem: class { constructor(public items: unknown) {} }, nativeImage: { createFromBuffer: mocks.image } }));
import { copyResourceFile, copyResourceImage, FILE_COPY_SCRIPT } from '../src/desktop/resource-clipboard.js';
import type { Attachments } from '../src/server/attachments.js';
const resource = { id: '00000000-0000-4000-8000-000000000001', kind: 'file', src: '/api/assets/00000000-0000-4000-8000-000000000002/content', title: '文件', view: 'card' };

it('resolves managed file IDs and passes special filenames as data, with a hidden STA process', async () => {
  if (process.platform !== 'win32') return;
  const filename = "C:\\资料\\$文件 ' (1).pdf", resolve = vi.fn(async () => filename);
  await copyResourceFile({ contentPath: resolve } as unknown as Attachments, resource);
  expect(resolve).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002');
  const [, args, options] = mocks.exec.mock.calls.at(-1)!;
  expect(args).toContain('-STA'); expect(args.join(' ')).not.toContain(filename);
  expect(options.env.MOKI_CLIPBOARD_FILE).toBe(filename); expect(options.windowsHide).toBe(true);
  expect(Buffer.from(args.at(-1), 'base64').toString('utf16le')).toBe(FILE_COPY_SCRIPT);
});
it('rejects arbitrary paths, remote file copies and missing assets before clipboard access', async () => {
  const assets = { contentPath: vi.fn(async () => { throw new Error('附件不存在'); }) } as unknown as Attachments;
  const before = mocks.exec.mock.calls.length;
  await expect(copyResourceFile(assets, { ...resource, src: 'file:///C:/secret.txt' })).rejects.toThrow();
  await expect(copyResourceFile(assets, { ...resource, src: 'https://example.com/file.pdf' })).rejects.toThrow('仅本地');
  await expect(copyResourceFile(assets, resource)).rejects.toThrow('附件不存在');
  expect(mocks.exec.mock.calls.length).toBe(before);
});
it('validates image data and requires matching clipboard pixels before reporting success', async () => {
  await expect(copyResourceImage('not bytes')).rejects.toThrow();
  await expect(copyResourceImage(new Uint8Array())).rejects.toThrow();
  const image = { isEmpty: () => false, toPNG: () => Buffer.from('png'), toBitmap: () => Buffer.from('pixels'), getSize: () => ({ width: 2, height: 3 }) };
  mocks.image.mockReturnValue(image); mocks.read.mockResolvedValue([{ types: ['image/png'], getType: async () => new Blob(['png']) }]);
  await copyResourceImage(new Uint8Array([1, 2, 3])); expect(mocks.write).toHaveBeenCalled();
  mocks.image.mockReturnValueOnce({ isEmpty: () => true });
  await expect(copyResourceImage(new Uint8Array([1]))).rejects.toThrow('无法读取');
});
