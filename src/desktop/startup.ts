import type { App } from 'electron';
import type { StartupSettings } from '../shared/settings.js';

export const STARTUP_NAME = 'MOKI Notes';
type LoginApp = Pick<App, 'isPackaged' | 'getLoginItemSettings' | 'setLoginItemSettings'>;
export function startupSettings(app: LoginApp, platform: NodeJS.Platform, executable: string): StartupSettings {
  if (platform !== 'win32') return { supported: false, enabled: false, reason: '当前系统暂不支持在应用内设置' };
  if (!app.isPackaged) return { supported: false, enabled: false, reason: '请在安装后的桌面应用中设置' };
  const state = app.getLoginItemSettings({ path: executable, args: [] });
  return { supported: true, enabled: state.launchItems.some(item => item.name === STARTUP_NAME && item.scope === 'user' && item.enabled && item.args.length === 0) };
}
export function setStartup(app: LoginApp, platform: NodeJS.Platform, executable: string, enabled: boolean): StartupSettings {
  const before = startupSettings(app, platform, executable);
  if (!before.supported) throw new Error(before.reason);
  app.setLoginItemSettings({ name: STARTUP_NAME, path: executable, args: [], openAtLogin: enabled, enabled });
  const saved = startupSettings(app, platform, executable);
  if (saved.enabled !== enabled) throw new Error('开机自启动设置未生效，请在 Windows 启动应用中检查后重试');
  return saved;
}
