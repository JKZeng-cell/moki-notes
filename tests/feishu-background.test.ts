import { expect, it, vi } from 'vitest';
import { NotesStore } from '../src/server/store.js';
import type { Attachments } from '../src/server/attachments.js';

const runtime = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), locals: vi.fn(), sync: vi.fn() }));
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => 'isolated-test-profile' }, dialog: {}, ipcMain: { handle: (key: string, fn: (...args: any[]) => any) => runtime.handlers.set(key, fn) }, BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { getURL: () => 'http://127.0.0.1:4500/', executeJavaScript: runtime.locals } }] } }));
vi.mock('../src/server/feishu-cli.js', () => ({ locateFeishuCli: () => 'isolated-cli.exe', makeCliRunner: () => vi.fn() }));
vi.mock('../src/server/feishu-sync.js', () => ({ FeishuSync: class {
  busy = false;
  status() { return { connected: true }; }
  records() { return []; }
  sync = runtime.sync;
} }));
import { registerDataSettings } from '../src/desktop/data-settings.js';

it('reports manual sync while collecting drafts, keeps the desktop job alive and releases the lock on success/failure', async () => {
  const store = new NotesStore(':memory:');
  let finishDrafts!: (local: Record<string, string>) => void, finishSync!: (report: unknown) => void;
  runtime.locals.mockImplementationOnce(() => new Promise(resolve => { finishDrafts = resolve; }));
  runtime.sync.mockImplementationOnce(() => new Promise(resolve => { finishSync = resolve; }));
  const dispose = registerDataSettings(store, {} as Attachments, () => ({} as any));
  const call = (key: string, ...args: unknown[]) => runtime.handlers.get('notes:' + key)!({}, ...args);
  try {
    const pending = call('feishu-sync', 'both');
    await Promise.resolve(); await Promise.resolve();
    expect(call('feishu-overview').running).toBe(true);
    await expect(call('feishu-sync', 'push')).rejects.toThrow('正在导入、导出或同步');
    finishDrafts({ 'moki-notes:draft:19ddc7bc-1499-49b6-8d64-4295c76379d2:window': 'draft' });
    await vi.waitFor(() => expect(runtime.sync).toHaveBeenCalledWith('both', ['19ddc7bc-1499-49b6-8d64-4295c76379d2']));
    expect(call('feishu-overview').running).toBe(true);
    finishSync({ uploaded: 1, downloaded: 0, conflicts: 0, skipped: 0, errors: [], at: '2026-10-28' });
    await expect(pending).resolves.toMatchObject({ uploaded: 1 });
    expect(call('feishu-overview').running).toBe(false);
    runtime.locals.mockResolvedValue({}); runtime.sync.mockRejectedValueOnce(new Error('模拟云端中断'));
    await expect(call('feishu-sync', 'pull')).rejects.toThrow('模拟云端中断');
    expect(call('feishu-overview')).toMatchObject({ running: false, lastError: '模拟云端中断' });
  } finally { finishDrafts?.({}); finishSync?.({}); await dispose(); store.close(); }
});
