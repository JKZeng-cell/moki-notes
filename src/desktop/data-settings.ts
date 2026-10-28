import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NotesStore } from '../server/store.js';
import { Attachments } from '../server/attachments.js';
import { exportTransfer, importTransfer, inspectTransfer, localKey } from '../server/transfer.js';
import { locateFeishuCli, makeCliRunner } from '../server/feishu-cli.js';
import { FeishuSync } from '../server/feishu-sync.js';
import { FeishuAuth } from '../server/feishu-auth.js';
import { AutoSyncSettings, defaultAutoSync, FeishuScheduler } from '../server/feishu-scheduler.js';
import type { FeishuOverview, SyncDirection } from '../shared/feishu.js';

export function registerDataSettings(store: NotesStore, assets: Attachments, trusted: (event: IpcMainInvokeEvent) => BrowserWindow, onImported?: () => void) {
  let busy = false, service: FeishuSync | undefined, servicePath = '', serviceProfile = '', auth: FeishuAuth | undefined;
  let closing = false, syncing = false, activeOperation: Promise<unknown> | undefined;
  const lifetime = new AbortController();
  const bundled = app.isPackaged ? join(process.resourcesPath, 'feishu-cli', 'lark-cli.exe') : fileURLToPath(new URL('../../vendor/feishu-cli/win32-x64/lark-cli.exe', import.meta.url));
  const tickets = new Map<string, { path: string; fingerprint: string; sender: number }>();
  const exclusive = async <T,>(action: () => Promise<T>) => { if (closing) throw Error('应用正在退出'); if (busy) throw Error('正在导入、导出或同步，请稍后'); busy = true; const operation = Promise.resolve().then(action); activeOperation = operation; try { return await operation; } finally { busy = false; activeOperation = undefined; } };
  const cli = () => {
    const path = locateFeishuCli(store.preference<string>('feishuCliPath', ''), bundled), profile = store.preference<string>('feishuCliProfile', '');
    if (!service || path !== servicePath || profile !== serviceProfile) { servicePath = path; serviceProfile = profile;
      auth?.cancel();
      const rawRunner = makeCliRunner(path, { cwd: app.getPath('userData'), profile });
      const runner: typeof rawRunner = (args, options = {}) => rawRunner(args, { ...options, signal: options.signal ? AbortSignal.any([lifetime.signal, options.signal]) : lifetime.signal });
      service = new FeishuSync(store, assets, runner); auth = new FeishuAuth(runner); }
    return service;
  };
  const localState = async (w: BrowserWindow) => {
    const local = await w.webContents.executeJavaScript("Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('moki-notes:')).map(k=>[k,localStorage.getItem(k)]))");
    return Object.fromEntries(Object.entries(z.record(z.string(), z.string()).parse(local)).filter(([key]) => localKey(key)));
  };
  const autoSettings = () => { const value = AutoSyncSettings.safeParse(store.preference('feishuAutoSync', defaultAutoSync)); return value.success ? value.data : defaultAutoSync; };
  const ensureNoAuth = () => { if (auth?.progress().state === 'pending') throw Error('正在等待飞书授权，请完成或取消授权后再操作'); };
  const sync = async (direction: SyncDirection) => exclusive(async () => {
    syncing = true;
    try {
      ensureNoAuth(); store.setPreference('feishuLastAttempt', new Date().toISOString()); store.setPreference('feishuLastError', '');
      const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && /^http:\/\/127\.0\.0\.1:\d+\//.test(w.webContents.getURL()));
      if (!windows.length) throw Error('编辑窗口暂不可用，已跳过同步以保护未保存内容');
      const locals = await Promise.all(windows.map(localState));
      const protectedIds = [...new Set(locals.flatMap(local => Object.keys(local).filter(k => k.startsWith('moki-notes:draft:')).map(k => k.split(':')[2])))];
      return await cli().sync(direction, protectedIds);
    } catch (e) { store.setPreference('feishuLastError', (e as Error).message); throw e; }
    finally { syncing = false; }
  });
  const scheduler = new FeishuScheduler(autoSettings, () => !busy && auth?.progress().state !== 'pending', sync,
    error => store.setPreference('feishuLastError', error.message));
  scheduler.reset();
  const overview = (): FeishuOverview => ({ connected: cli().status().connected, settings: autoSettings(), running: syncing || !!service?.busy || scheduler.running, nextRun: scheduler.nextRun,
    lastAttempt: store.preference<string | undefined>('feishuLastAttempt', undefined), lastError: store.preference<string>('feishuLastError', ''),
    report: store.preference('feishuLastReport', undefined), records: cli().records() });
  ipcMain.handle('notes:transfer-export', async e => { const w = trusted(e); return exclusive(async () => {
    const selected = await dialog.showSaveDialog(w, { title: '导出全部便签数据', defaultPath: `MOKI便签-${new Date().toISOString().slice(0, 10)}.mokinotes`, filters: [{ name: 'MOKI便签迁移包', extensions: ['mokinotes'] }] });
    if (selected.canceled || !selected.filePath) return null;
    const path = selected.filePath.toLowerCase().endsWith('.mokinotes') ? selected.filePath : selected.filePath + '.mokinotes';
    return { ...await exportTransfer(store, assets, path, await localState(w)), path };
  }); });
  ipcMain.handle('notes:transfer-preview', async e => { const w = trusted(e); return exclusive(async () => {
    const selected = await dialog.showOpenDialog(w, { title: '选择 MOKI便签迁移包', properties: ['openFile'], filters: [{ name: 'MOKI便签迁移包', extensions: ['mokinotes'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const checked = await inspectTransfer(selected.filePaths[0]), ticket = randomUUID();
    for (const [key, value] of tickets) if (value.sender === e.sender.id) tickets.delete(key);
    tickets.set(ticket, { path: selected.filePaths[0], fingerprint: checked.fingerprint, sender: e.sender.id });
    return { ticket, notes: checked.manifest.notes.length, revisions: checked.manifest.revisions.length, attachments: checked.manifest.assets.length,
      drafts: Object.keys(checked.manifest.local).filter(k => k.startsWith('moki-notes:draft:')).length, exportedAt: checked.manifest.exportedAt, bytes: checked.bytes };
  }); });
  ipcMain.handle('notes:transfer-import', async (e, token) => { trusted(e); return exclusive(async () => {
    const ticket = z.string().uuid().parse(token), selected = tickets.get(ticket);
    if (!selected || selected.sender !== e.sender.id) throw Error('请重新选择迁移包');
    const result = await importTransfer(store, assets, selected.path, selected.fingerprint); tickets.delete(ticket); onImported?.(); return result;
  }); });
  const feishuStatus = async () => {
    try { const state = cli().status(); const source = servicePath === bundled ? 'bundled' as const : store.preference<string>('feishuCliPath', '') ? 'custom' as const : 'system' as const;
      const info = { ...state, cliPath: servicePath, cliSource: source, ...(source === 'bundled' ? { cliVersion: '1.0.98' } : {}) };
      try { return { ...info, ...await auth!.status() }; } catch (e) { return { ...info, loggedIn: false, error: (e as Error).message }; }
    } catch (e) { return { connected: false, error: (e as Error).message }; }
  };
  ipcMain.handle('notes:feishu-status', e => { trusted(e); return feishuStatus(); });
  ipcMain.handle('notes:feishu-login', e => { trusted(e); return exclusive(async () => { cli(); return auth!.begin(); }); });
  ipcMain.handle('notes:feishu-auth-progress', e => { trusted(e); return auth?.progress() ?? { state: 'idle' }; });
  ipcMain.handle('notes:feishu-auth-cancel', e => { trusted(e); auth?.cancel(); });
  ipcMain.handle('notes:feishu-overview', e => { trusted(e); return overview(); });
  ipcMain.handle('notes:feishu-auto-save', (e, value) => { trusted(e); const settings = AutoSyncSettings.parse(value);
    if (settings.enabled && !cli().status().connected) throw Error('请先连接飞书云盘');
    store.setPreference('feishuAutoSync', settings); scheduler.reset(); return overview(); });
  ipcMain.handle('notes:feishu-configure', (e, value) => { trusted(e); return exclusive(async () => {
    ensureNoAuth();
    const data = z.object({ appId: z.string().regex(/^cli_[a-zA-Z0-9]+$/), secret: z.string().min(8).max(1024) }).strict().parse(value);
    const path = locateFeishuCli(store.preference<string>('feishuCliPath', ''), bundled);
    try { await makeCliRunner(path, { cwd: app.getPath('userData') })(['config', 'init', '--app-id', data.appId, '--app-secret-stdin', '--brand', 'feishu', '--name', 'moki-notes'], { input: data.secret + '\n', text: true }); }
    catch { throw Error('保存飞书应用配置失败，请检查 App ID 与 App Secret。'); }
    store.setPreference('feishuCliProfile', 'moki-notes'); return feishuStatus();
  }); });
  ipcMain.handle('notes:feishu-cli-reset', e => { trusted(e); return exclusive(async () => { ensureNoAuth(); auth?.cancel(); store.setPreference('feishuCliPath', ''); service = undefined; return feishuStatus(); }); });
  ipcMain.handle('notes:feishu-cli', async e => { const w = trusted(e); return exclusive(async () => {
    ensureNoAuth();
    const selected = await dialog.showOpenDialog(w, { title: '选择 lark-cli 可执行文件', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'CLI 可执行文件', extensions: ['exe'] }] } : {}) });
    if (!selected.canceled && selected.filePaths[0]) { locateFeishuCli(selected.filePaths[0]); store.setPreference('feishuCliPath', selected.filePaths[0]); }
    return feishuStatus();
  }); });
  ipcMain.handle('notes:feishu-connect', async (e, folder) => { trusted(e); return exclusive(async () => { ensureNoAuth(); await cli().connect(z.string().max(200).optional().parse(folder) || undefined); return feishuStatus(); }); });
  ipcMain.handle('notes:feishu-sync', async (e, direction) => { trusted(e); const result = await sync(z.enum(['both', 'push', 'pull']).parse(direction)); scheduler.reset(); return result; });
  return async () => { closing = true; scheduler.stop(); auth?.cancel(); lifetime.abort(); try { await activeOperation; } catch { /* Operation errors are already shown/persisted. */ } };
}
