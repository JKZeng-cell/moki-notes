import { resolve } from 'node:path';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile, rm, writeFile } from 'node:fs/promises';

export const INSTALL_EXIT_ARG = '--quit-for-install';
// Supplied only after the installer has obtained Save and Close consent.
export const INSTALL_CONFIRMED_ARG = '--install-save-confirmed';
export type InstallResult = 'saved' | 'cancelled' | 'failed' | 'busy';
export function installRequestId(data: unknown): string | undefined {
  const id = (data as { installRequestId?: unknown } | null)?.installRequestId;
  return typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ? id : undefined;
}
const resultPath = (id: string) => {
  if (!installRequestId({ installRequestId: id })) throw Error('无效安装请求');
  return join(tmpdir(), `moki-notes-install-${id}.json`);
};
export async function reportInstallResult(id: string | undefined, result: InstallResult) {
  if (id) await writeFile(resultPath(id), JSON.stringify({ result }), 'utf8');
}
export async function waitInstallResult(id: string, timeout = 180000) {
  const path = resultPath(id), deadline = Date.now() + timeout;
  try {
    do {
      try { const { result } = JSON.parse(await readFile(path, 'utf8')); if (result === 'saved') return 0; if (result === 'cancelled') return 2; if (result === 'failed') return 3; if (result === 'busy') return 5; }
      catch { /* The first process has not answered yet. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    // No reply is not evidence that a note failed to save. In particular a
    // stalled desktop may never have received or executed the save request.
    return 4;
  } finally { await rm(path, { force: true }); }
}
export function isInstallExitRequest(data: unknown, executable: string): boolean {
  if (!data || typeof data !== 'object') return false;
  const value = data as Record<string, unknown>;
  return value.quitForInstall === true && typeof value.executable === 'string'
    && resolve(value.executable).toLowerCase() === resolve(executable).toLowerCase();
}
export function isConfirmedInstallExitRequest(data: unknown, executable: string): boolean {
  return isInstallExitRequest(data, executable) && !!installRequestId(data)
    && (data as Record<string, unknown>).installSaveConfirmed === true;
}
