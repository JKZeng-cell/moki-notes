import { expect, it, vi } from 'vitest';
import type { LoginItemSettings } from 'electron';
import { setStartup, startupSettings, STARTUP_NAME } from '../src/desktop/startup.js';
function fixture() {
  let enabled = false, present = false;
  const app = {
    isPackaged: true,
    getLoginItemSettings: vi.fn((): LoginItemSettings => ({ openAtLogin: present, executableWillLaunchAtLogin: enabled, launchItems: present ? [{ name: STARTUP_NAME, path: 'C:\\Program Files\\MOKI\\MOKI-Notes.exe', args: [], scope: 'user', enabled }] : [], wasOpenedAtLogin: false, status: 'not-registered' })),
    setLoginItemSettings: vi.fn((value: { openAtLogin?: boolean; enabled?: boolean }) => { present = !!value.openAtLogin; enabled = !!value.enabled; }),
  };
  return { app, disableInSystem: () => { enabled = false; } };
}
it('round-trips native login settings with an exact executable, no MCP arguments, and system disabled state', () => {
  const { app, disableInSystem } = fixture(), exe = 'C:\\Program Files\\MOKI\\MOKI-Notes.exe';
  expect(startupSettings(app, 'win32', exe).enabled).toBe(false);
  expect(setStartup(app, 'win32', exe, true).enabled).toBe(true);
  expect(app.setLoginItemSettings).toHaveBeenCalledWith({ name: STARTUP_NAME, path: exe, args: [], enabled: true, openAtLogin: true });
  disableInSystem(); expect(startupSettings(app, 'win32', exe).enabled).toBe(false);
  expect(setStartup(app, 'win32', exe, false).enabled).toBe(false);
  expect(app.getLoginItemSettings).toHaveBeenLastCalledWith({ path: exe, args: [] });
});
it('does not report success when native registration is rejected', () => {
  const { app } = fixture(); app.setLoginItemSettings.mockImplementation(() => {});
  expect(() => setStartup(app, 'win32', 'app.exe', true)).toThrow('未生效');
});
it('never registers the development runtime or unsupported platforms', () => {
  const { app } = fixture();
  for (const platform of ['linux', 'darwin'] as const) expect(startupSettings(app, platform, 'app.exe').supported).toBe(false);
  app.isPackaged = false;
  expect(() => setStartup(app, 'win32', 'electron.exe', true)).toThrow('安装后的');
  expect(app.setLoginItemSettings).not.toHaveBeenCalled();
});
