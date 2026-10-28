import { expect, it } from 'vitest';
import { isInstallExitRequest, installRequestId, reportInstallResult, waitInstallResult } from '../src/desktop/install-exit.js';
import { randomUUID } from 'node:crypto';

it('only accepts a quit handshake from the same executable', () => {
  const exe = 'D:/Program Files/MOKI-Notes/MOKI-Notes.exe';
  expect(isInstallExitRequest({ quitForInstall: true, executable: exe.toLowerCase() }, exe)).toBe(true);
  for (const data of [null, {}, { quitForInstall: false, executable: exe },
    { quitForInstall: true, executable: 'D:/Program Files/MOKI-Notes-other/MOKI-Notes.exe' },
    { quitForInstall: true, executable: 1 }]) expect(isInstallExitRequest(data, exe)).toBe(false);
});
it('reports cancellation and save failure to the installer helper without arbitrary file paths', async () => {
  for (const [status,code] of [['saved',0],['cancelled',2],['failed',3]] as const) {
    const id=randomUUID();await reportInstallResult(id,status); expect(await waitInstallResult(id,500)).toBe(code);
  }
  expect(installRequestId({installRequestId:'../../anything'})).toBeUndefined();
  await expect(reportInstallResult('../../anything','saved')).rejects.toThrow('无效');
  expect(await waitInstallResult(randomUUID(),1)).toBe(3);
});
