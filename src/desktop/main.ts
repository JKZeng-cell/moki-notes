import { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen, session, clipboard } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createApp } from '../server/app.js';
import { NotesStore } from '../server/store.js';
import { dataPath } from '../server/paths.js';
import { exportNote } from '../server/export.js';
import { createNotesTray, destroyNotesTray, refreshTrayMenu, trayAvailable } from './tray.js';
import { CHECK_UNSAVED, SAVE_FOR_INSTALL, QuitCoordinator } from './quit.js';
import { Attachments } from '../server/attachments.js';
import { importResources, openResource, saveResource } from './resources.js';
import { CacheSettings } from './cache-settings.js';
import { registerDataSettings } from './data-settings.js';
import { APP_DEVELOPER_EMAIL, DEVELOPER_CONTACT_URL } from '../shared/app-metadata.js';
import { copyDeveloperEmail } from './copy-developer-email.js';
import { INSTALL_EXIT_ARG, isInstallExitRequest, installRequestId, reportInstallResult, waitInstallResult } from './install-exit.js';

if (process.env.MOKI_NOTES_PROFILE) app.setPath('userData', process.env.MOKI_NOTES_PROFILE);
else app.setPath('userData', join(app.getPath('appData'), 'moki-notes'));
app.setAppUserModelId('com.moki.notes');
const installExit = process.argv.includes(INSTALL_EXIT_ARG);
const requestId = installExit ? randomUUID() : undefined;
const ownsLock = app.requestSingleInstanceLock({ quitForInstall: installExit, executable: process.execPath, installRequestId: requestId });
// A quit-only helper must never initialize a database, tray or window.
if (installExit && !ownsLock) void waitInstallResult(requestId!).then(code => app.exit(code));
else if (!ownsLock || installExit) app.exit(0);
const cacheSettings = ownsLock && !installExit ? new CacheSettings(app.getPath('userData')) : undefined;
let activeInstallRequest: string | undefined;
let manager: BrowserWindow | undefined, origin = '', quitting = false;
const pins = new Map<string, BrowserWindow>();
type PinState = { id: string; bounds: Electron.Rectangle; top: boolean };
let store: NotesStore, server: Awaited<ReturnType<typeof createApp>>;
const withTimeout = async <T,>(work: Promise<T>, ms = 30000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('保存响应超时，程序保持打开，请检查内容后重试')), ms); })]); }
  finally { clearTimeout(timer!); }
};
const quit = new QuitCoordinator<BrowserWindow>({
  windows: () => BrowserWindow.getAllWindows(),
  isDirty: async w => {
    if (w.isDestroyed() || w.webContents.isDestroyed() || w.webContents.isCrashed()) return false;
    return await w.webContents.executeJavaScript(CHECK_UNSAVED) === true;
  },
  confirm: async windows => {
    const parent = windows.find(w => !w.isDestroyed());
    if (!parent) return true;
    if (parent.isMinimized()) parent.restore();
    parent.show(); parent.focus();
    const result = await dialog.showMessageBox(parent, {
      type: 'question', buttons: ['继续编辑', '保留草稿并退出'], defaultId: 0, cancelId: 0,
      message: `${windows.length} 个窗口中有尚未保存的便签`,
      detail: '退出会结束后台运行。未保存的内容仍保留为本机草稿，下次打开可恢复。',
    });
    return result.response === 1;
  },
  confirmInstall: async windows => {
    const parent = windows.find(w => !w.isDestroyed());
    const options: Electron.MessageBoxOptions = { type: 'question', buttons: ['取消', '保存并关闭'], defaultId: 1, cancelId: 0,
      message: '保存便签并关闭，以继续安装？',
      detail: '将保存主窗口和所有桌面便签中正在编辑的标题、正文与属性，再结束后台运行及便签 MCP 连接。保存失败或存在版本冲突时，程序会保持打开；安装后可在 Agent 中重新连接。' };
    if (parent) { if (parent.isMinimized()) parent.restore(); parent.show(); parent.focus(); }
    const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    return result.response === 1;
  },
  lock: async (windows, locked) => {
    await Promise.all(windows.filter(w => !w.isDestroyed() && !w.webContents.isDestroyed()).map(w => withTimeout(w.webContents.executeJavaScript(`(() => {
      if (${locked}) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        document.body.inert = true;
        const hint = document.createElement('div'); hint.id = 'moki-install-saving'; hint.setAttribute('role', 'status');
        hint.textContent = '正在保存便签，请稍候…';
        hint.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#171d2bcc;color:white;font:14px system-ui;backdrop-filter:blur(2px)';
        document.documentElement.append(hint);
      } else { document.body.inert = false; document.getElementById('moki-install-saving')?.remove(); }
    })()`))));
  },
  save: async w => {
    if (w.isDestroyed() || w.webContents.isDestroyed() || w.webContents.isCrashed()) throw Error('有便签窗口暂不可用，已保留程序，请检查后重试');
    if (new URL(w.webContents.getURL()).origin !== origin) throw Error('便签窗口尚未就绪，请稍后重试');
    const ok = await withTimeout(w.webContents.executeJavaScript(SAVE_FOR_INSTALL));
    if (ok !== true) { w.show(); w.focus(); }
    return ok === true;
  },
  installResult: result => reportInstallResult(activeInstallRequest, result),
  commit: () => { savePins(); quitting = true; app.quit(); },
  error: error => { dialog.showErrorBox('暂时无法退出 MOKI便签', `请保存当前内容后重试。\n${String(error)}`); },
});
function savePins() {
  if (!store || quitting) return;
  store.setPreference('desktopPins', [...pins].filter(([id, w]) => { try { return !w.isDestroyed() && !store.get(id).deletedAt; } catch { return false; } }).map(([id, w]) => ({ id, bounds: w.getBounds(), top: w.isAlwaysOnTop() })));
}
function makeWindow(sticky = false, state?: PinState) {
  const bounds = state?.bounds;
  const visible = bounds && screen.getAllDisplays().some(d => bounds.x + 80 > d.workArea.x && bounds.x < d.workArea.x + d.workArea.width && bounds.y + 60 > d.workArea.y && bounds.y < d.workArea.y + d.workArea.height);
  const w = new BrowserWindow({
    width: sticky ? 390 : 1360, height: sticky ? 470 : 880, minWidth: sticky ? 300 : 860, minHeight: sticky ? 280 : 600,
    ...(visible ? bounds : {}), show: false, title: 'MOKI便签', frame: !sticky,
    alwaysOnTop: state?.top ?? sticky, backgroundColor: '#f8f8fc', icon: fileURLToPath(new URL('../web/icon.png', import.meta.url)),
    webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) { event.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url); } });
  w.webContents.on('will-prevent-unload', event => {
    if (quitting && quit.approved) { event.preventDefault(); return; }
    const answer = dialog.showMessageBoxSync(w, { type: 'question', buttons: ['继续编辑', '关闭窗口'], defaultId: 0, cancelId: 0, message: '便签尚未保存', detail: '关闭后本机草稿仍会保留；下次打开可恢复。' });
    if (answer === 1) event.preventDefault();
  });
  w.once('ready-to-show', () => w.show());
  return w;
}
function showManager(noteId?: string) {
  if (manager && !manager.isDestroyed()) { if (manager.isMinimized()) manager.restore(); manager.show(); manager.focus(); if (noteId) manager.webContents.send('notes:select', noteId); return; }
  manager = makeWindow(); void manager.loadURL(origin + (noteId ? `/?note=${encodeURIComponent(noteId)}` : ''));
  manager.on('close', event => {
    if (!quitting && trayAvailable()) { event.preventDefault(); manager?.hide(); }
  });
  manager.on('closed', () => { manager = undefined; });
}
function hideManager() { if (trayAvailable() && manager && !manager.isDestroyed()) manager.hide(); }
function setCardsVisible(visible: boolean) {
  for (const w of pins.values()) {
    if (w.isDestroyed()) continue;
    if (visible) { if (w.isMinimized()) w.restore(); w.showInactive(); }
    else w.hide();
  }
}
function pin(id: string, state?: PinState, edit = false) {
  const note = store.get(id);
  if (note.deletedAt) throw new Error('回收站便签不能固定到桌面');
  const existing = pins.get(id); if (existing) { existing.show(); existing.focus(); return; }
  const w = makeWindow(true, state); pins.set(id, w);
  void w.loadURL(`${origin}/?sticky=${encodeURIComponent(id)}${edit ? '&edit=1' : ''}`);
  w.on('moved', savePins); w.on('resized', savePins);
  w.on('closed', () => { pins.delete(id); savePins(); refreshTrayMenu(); });
  savePins(); refreshTrayMenu();
}
app.on('second-instance', (_event, _argv, _cwd, data) => {
  if (isInstallExitRequest(data, process.execPath)) {
    const id = installRequestId(data);
    if (quit.pending || quit.approved) { void reportInstallResult(id, quit.approved ? 'saved' : 'failed'); return; }
    activeInstallRequest = id; void quit.request('install'); return;
  }
  if (origin) showManager();
});
app.on('activate', () => { if (origin) showManager(); });
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); void quit.request();
});
app.on('window-all-closed', () => { if (!trayAvailable()) app.quit(); });
let finalizing = false;
let stopDataSettings: (() => Promise<void>) | undefined;
app.on('will-quit', event => {
  if (finalizing) return;
  event.preventDefault(); finalizing = true; destroyNotesTray();
  void (async () => { try { await stopDataSettings?.(); await server?.close(); } finally { store?.close(); app.exit(0); } })();
});

if (ownsLock && !installExit) void app.whenReady().then(async () => {
  session.defaultSession.setCodeCachePath(join(cacheSettings!.activePath, 'Code Cache'));
  // Embedded pages do not inherit device, notification or clipboard access.
  const allowPermission = (permission: string, requestingUrl: string) => {
    if (permission === 'fullscreen') return true;
    try { return permission === 'clipboard-sanitized-write' && new URL(requestingUrl).origin === origin; } catch { return false; }
  };
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => callback(allowPermission(permission, details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => allowPermission(permission, requestingOrigin));
  store = new NotesStore(dataPath());
  store.ensureDemo();
  const attachments = new Attachments(`${store.path}.attachments`);
  server = await createApp(store, { attachments, webRoot: fileURLToPath(new URL('../web', import.meta.url)), mcpCommand: process.execPath, mcpEnv: { ELECTRON_RUN_AS_NODE: '1' }, onPurged: ids => {
    for (const id of ids) pins.get(id)?.destroy();
  } });
  // A stable origin retains renderer drafts and theme across application restarts.
  origin = await server.listen({ host: '127.0.0.1', port: Number(process.env.MOKI_NOTES_PORT ?? 4332) });
  try {
    createNotesTray({ openManager: () => showManager(), hideManager, showCards: () => setCardsVisible(true), hideCards: () => setCardsVisible(false), quit: () => app.quit(), cardCount: () => pins.size });
  } catch (error) { destroyNotesTray(); console.error('系统托盘初始化失败，关闭主窗口时将使用正常退出行为。', error); }
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('无效调用来源');
    const w = BrowserWindow.fromWebContents(event.sender); if (!w) throw new Error('窗口已关闭'); return w;
  };
  stopDataSettings = registerDataSettings(store, attachments, trusted, () => {
    for (const state of store.preference<PinState[]>('desktopPins', [])) { try { if (!pins.has(state.id)) pin(state.id, state); } catch { /* Deleted or invalid pin is not opened. */ } }
  });
  ipcMain.handle('notes:app-version', e => { trusted(e); return app.getVersion(); });
  ipcMain.handle('notes:copy-developer-email', async e => { trusted(e); await copyDeveloperEmail(clipboard); });
  ipcMain.handle('notes:contact-developer', async e => {
    trusted(e);
    try { await shell.openExternal(DEVELOPER_CONTACT_URL); }
    catch { throw Error(`无法打开默认邮件应用，请复制邮箱联系：${APP_DEVELOPER_EMAIL}`); }
  });
  ipcMain.handle('notes:resource-import', (e, video) => importResources(trusted(e), attachments, z.boolean().parse(video)));
  ipcMain.handle('notes:resource-open', (e, resource) => { trusted(e); return openResource(attachments, resource); });
  ipcMain.handle('notes:resource-save', (e, resource) => saveResource(trusted(e), attachments, resource));
  ipcMain.handle('notes:pin', (e, id, edit) => { trusted(e); pin(z.string().uuid().parse(id), undefined, z.boolean().optional().parse(edit)); return true; });
  ipcMain.handle('notes:unpin', (e, id) => { trusted(e); pins.get(z.string().uuid().parse(id))?.close(); return true; });
  ipcMain.handle('notes:pins', e => { const w = trusted(e); return { ids: [...pins.keys()], top: w.isAlwaysOnTop() }; });
  ipcMain.handle('notes:top', (e, value) => { trusted(e).setAlwaysOnTop(z.boolean().parse(value)); savePins(); });
  ipcMain.handle('notes:manager', (e, id) => { trusted(e); showManager(id === undefined ? undefined : z.string().uuid().parse(id)); });
  ipcMain.handle('notes:fullscreen', e => { const w = trusted(e); w.setFullScreen(!w.isFullScreen()); return w.isFullScreen(); });
  ipcMain.handle('notes:close', e => { trusted(e).close(); });
  const cacheInfo = async () => cacheSettings!.info(await session.defaultSession.getCacheSize());
  ipcMain.handle('notes:cache-info', async e => { trusted(e); return cacheInfo(); });
  ipcMain.handle('notes:cache-choose', async (e, reset) => {
    const w = trusted(e);
    if (z.boolean().parse(reset)) cacheSettings!.choose(null);
    else {
      const result = await dialog.showOpenDialog(w, { title: '选择缓存文件夹', properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled && result.filePaths[0]) cacheSettings!.choose(result.filePaths[0]);
    }
    return cacheInfo();
  });
  ipcMain.handle('notes:cache-clear', async e => {
    trusted(e); await session.defaultSession.clearCache(); await session.defaultSession.clearCodeCaches({}); return cacheInfo();
  });
  ipcMain.handle('notes:export', async (e, id, format) => {
    const w = trusted(e), result = await exportNote(store.get(z.string().uuid().parse(id)), z.enum(['txt', 'md', 'docx']).parse(format));
    const selection = await dialog.showSaveDialog(w, { defaultPath: result.name, filters: [{ name: String(format).toUpperCase(), extensions: [format] }] });
    if (selection.canceled || !selection.filePath) return false;
    await writeFile(selection.filePath, result.bytes); return true;
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'MOKI便签', submenu: [{ label: '打开便签管理', click: () => showManager() }, { label: '收起到系统托盘', enabled: trayAvailable(), click: hideManager }, { type: 'separator' }, { label: '退出 MOKI便签', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ]));
  const restored = store.preference<PinState[]>('desktopPins', []);
  showManager();
  for (const state of restored) { try { pin(state.id, state); } catch { /* Deleted notes are not restored. */ } }
  savePins();
}).catch(error => { dialog.showErrorBox('MOKI便签启动失败', String(error)); app.quit(); });
