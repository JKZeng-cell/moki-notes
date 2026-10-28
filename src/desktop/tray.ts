import { Menu, Tray, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';

export type TrayActions = {
  openManager(): void;
  hideManager(): void;
  showCards(): void;
  hideCards(): void;
  quit(): void;
  cardCount(): number;
};

// Keep both native objects alive while the application has no visible windows.
export let notesTray: Tray | undefined;
export let notesTrayMenu: Menu | undefined;
let actions: TrayActions | undefined;
export function trayAvailable() { return !!notesTray && !notesTray.isDestroyed(); }

export function refreshTrayMenu() {
  if (!actions || !trayAvailable()) return;
  const count = actions.cardCount();
  notesTrayMenu = Menu.buildFromTemplate([
    { id: 'open-manager', label: '打开便签管理', click: actions.openManager },
    { id: 'hide-manager', label: '收起主窗口到托盘', click: actions.hideManager },
    { type: 'separator' },
    { id: 'show-cards', label: `显示桌面便签${count ? `（${count}）` : ''}`, enabled: count > 0, click: actions.showCards },
    { id: 'hide-cards', label: '隐藏桌面便签', enabled: count > 0, click: actions.hideCards },
    { type: 'separator' },
    { id: 'quit', label: '退出 MOKI便签', click: actions.quit },
  ]);
  notesTray!.setContextMenu(notesTrayMenu);
}

export function createNotesTray(callbacks: TrayActions) {
  actions = callbacks;
  const iconPath = fileURLToPath(new URL(process.platform === 'win32' ? '../web/icon.ico' : '../web/icons/moki-notes-32.png', import.meta.url));
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) throw new Error('无法读取 MOKI便签托盘图标');
  notesTray = new Tray(icon);
  notesTray.setToolTip('MOKI便签 · 点击打开，右键查看菜单');
  notesTray.on('click', callbacks.openManager);
  notesTray.on('double-click', callbacks.openManager);
  refreshTrayMenu();
}

export function destroyNotesTray() {
  if (trayAvailable()) notesTray!.destroy();
  notesTray = undefined; notesTrayMenu = undefined; actions = undefined;
}
