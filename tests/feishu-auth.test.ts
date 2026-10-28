import { afterEach, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FeishuAuth } from '../src/server/feishu-auth.js';
import type { CliRunner } from '../src/server/feishu-cli.js';

afterEach(() => vi.useRealTimers());
it('starts background device polling without renderer confirmation and keeps code private', async () => {
  const calls: string[][] = []; const url = 'https://accounts.feishu.cn/oauth/device?user_code=hello%20world';
  const cli: CliRunner = async (args, opts) => {
    calls.push(args);
    if (args.includes('--no-wait')) return { verification_url:url, device_code:'private-device-code', expires_in:600 };
    if (args[1] === 'qrcode') { await writeFile(join(opts!.cwd!, 'login.png'), Buffer.from([137,80,78,71])); return {}; }
    if (args.includes('--device-code')) return {};
    return { appId:'app', identities:{user:{available:true, verified:true, userName:'user'}} };
  };
  const auth = new FeishuAuth(cli), login = await auth.begin();
  expect(login.url).toBe(url); expect(login.qr).toMatch(/^data:image\/png;base64,/);
  expect(JSON.stringify(login)).not.toContain('private-device-code');
  await vi.waitFor(() => expect(auth.progress().state).toBe('succeeded'));
  expect(calls.filter(a=>a.includes('--device-code'))).toHaveLength(1);
  expect(JSON.stringify(auth.progress())).not.toContain('private-device-code');
});
it('rejects missing sessions and untrusted authorization URLs before generating QR', async () => {
  const auth = new FeishuAuth(async () => ({ verification_url:'https://feishu.cn.attacker.invalid/login', device_code:'code' }));
  expect(auth.progress().state).toBe('idle');
  await expect(auth.begin()).rejects.toThrow('不受支持');
});
async function waitingAuth(expires = 2) {
  let signal: AbortSignal | undefined, finish: (() => void) | undefined;
  const auth = new FeishuAuth(async (args, opts) => {
    if (args.includes('--no-wait')) return { verification_url:'https://accounts.feishu.cn/device', device_code:'secret', expires_in:expires };
    if (args[1] === 'qrcode') { await writeFile(join(opts!.cwd!, 'login.png'), 'png'); return {}; }
    if (args.includes('--device-code')) { signal = opts?.signal; return new Promise(resolve => { finish = () => resolve({}); }); }
    return { identities:{user:{available:true, verified:true}} };
  });
  await auth.begin(); return { auth, signal: () => signal, finish: () => finish?.() };
}
it('expires at provider deadline, aborts polling, and ignores late success', async () => {
  vi.useFakeTimers(); const task = await waitingAuth(); expect(task.auth.progress().state).toBe('pending');
  await vi.advanceTimersByTimeAsync(2001); expect(task.signal()?.aborted).toBe(true);
  expect(task.auth.progress()).toMatchObject({state:'expired',error:expect.stringContaining('超时')});
  task.finish(); await Promise.resolve(); expect(task.auth.progress().state).toBe('expired');
});
it('cancels/replaces old polling without letting late results change the new session', async () => {
  const task = await waitingAuth(600); const old = task.signal();
  task.auth.cancel(); expect(old?.aborted).toBe(true); task.finish(); await Promise.resolve();
  expect(task.auth.progress().state).toBe('cancelled');
  await task.auth.begin(); expect(task.auth.progress().state).toBe('pending'); task.auth.cancel();
});
it('reports denial without endless retries', async () => {
  const auth = new FeishuAuth(async (args, opts) => {
    if(args.includes('--no-wait')) return {verification_url:'https://feishu.cn/device',device_code:'secret'};
    if(args[1]==='qrcode') { await writeFile(join(opts!.cwd!,'login.png'),'png'); return {}; }
    throw Error('用户拒绝授权');
  });
  await auth.begin(); await vi.waitFor(()=>expect(auth.progress().state).toBe('failed'));
  expect(auth.progress().error).toContain('拒绝');
});
it('reports a clean device as needing application configuration', async () => {
  const auth = new FeishuAuth(async () => { throw Object.assign(Error('not configured'), {code:'not_configured'}); });
  expect(await auth.status()).toEqual({configured:false, loggedIn:false});
});
