import { APP_DEVELOPER_EMAIL } from '../shared/app-metadata.js';

type TextClipboard = {
  writeText(text: string): void | Promise<void>;
  readText(): string | Promise<string>;
};

// Electron 44 uses asynchronous clipboard methods. A resolved write alone
// does not establish that the OS accepted it (e.g. a locked clipboard).
export async function copyDeveloperEmail(clipboard: TextClipboard): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await clipboard.writeText(APP_DEVELOPER_EMAIL);
      if (await clipboard.readText() === APP_DEVELOPER_EMAIL) return;
    } catch { /* Brief contention may clear before the next attempt. */ }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('无法确认邮箱已复制，请选中邮箱后手动复制');
}
