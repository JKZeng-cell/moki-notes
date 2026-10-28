import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type CliRunner = (args: string[], options?: { cwd?: string; input?: string; timeoutMs?: number; text?: boolean; signal?: AbortSignal }) => Promise<any>;
export function locateFeishuCli(configured?: string, bundled?: string, globals?: string[]) {
  const valid = (p: string | undefined): p is string => !!p && existsSync(p) && statSync(p).isFile() && (process.platform !== 'win32' || p.toLowerCase().endsWith('.exe'));
  if (configured) { if (!valid(configured)) throw Error('自定义飞书 CLI 已不可用，请恢复使用内置 CLI 或重新选择。'); return configured; }
  const candidates = [bundled, ...(globals ?? [process.env.FEISHU_CLI_BIN,
    join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm/node_modules/@larksuite/cli/bin/lark-cli.exe'),
    '/usr/local/lib/node_modules/@larksuite/cli/bin/lark-cli', '/opt/homebrew/lib/node_modules/@larksuite/cli/bin/lark-cli'])];
  const result = candidates.find(valid);
  if (!result) throw Error('内置飞书 CLI 缺失，请重新安装完整安装包，或选择已安装的 lark-cli 程序。');
  return result;
}
export function parseCliOutput(code: number | null, stdout: string, stderr: string, text = false): any {
  let data;
  try { data = JSON.parse(code === 0 ? stdout : stderr || stdout); }
  catch {
    if (code === 0 && text) return stdout;
    throw Error(`飞书 CLI 返回无法解析（退出码 ${code}），请检查网络、CLI 登录状态或版本`);
  }
  if (code !== 0 || data.ok === false) {
    if (code === 10) throw Error('飞书 CLI 要求额外确认，本次未继续执行。');
    const issue = data.error ?? {};
    if (issue.subtype === 'not_configured') throw Object.assign(Error('尚未配置飞书应用，请先完成“首次应用配置”，再登录飞书。'), { code: 'not_configured' });
    const missing = Array.isArray(issue.missing_scopes) ? issue.missing_scopes.join('、') : '';
    throw Error(`${issue.message ?? '飞书操作失败'}${missing ? `；缺少权限：${missing}。请重新授权飞书。` : ''}`);
  }
  return data.ok === true ? data.data : data;
}
export function makeCliRunner(path: string, defaults: { cwd?: string; profile?: string; env?: NodeJS.ProcessEnv } = {}): CliRunner {
  return (args, options = {}) => new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(Error('操作已取消')); return; }
    const child = spawn(path, [...(defaults.profile ? ['--profile', defaults.profile] : []), ...args], { cwd: options.cwd ?? defaults.cwd, shell: false, windowsHide: true,
      env: { ...process.env, ...defaults.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [], stderr: Buffer[] = []; let bytes = 0, stopped = false;
    const stop = (message: string) => { if (stopped) return; stopped = true; child.kill(); reject(Error(message)); };
    const timer = setTimeout(() => stop('飞书 CLI 响应超时；请检查连接后重试。已完成的同步记录会保留。'), options.timeoutMs ?? 120000);
    const abort = () => stop('操作已取消');
    options.signal?.addEventListener('abort', abort, { once: true });
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on('data', (b: Buffer) => { bytes += b.length; if (bytes > 24 * 1024 ** 2) stop('飞书返回内容过大，请拆分文档后重试'); else chunks.push(b); });
    child.on('error', error => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); if (!stopped) reject(Error(`无法启动飞书 CLI：${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort); if (stopped) return;
      try { resolve(parseCliOutput(code, Buffer.concat(stdout).toString('utf8'), Buffer.concat(stderr).toString('utf8'), options.text)); }
      catch (e) { reject(e); }
    });
    child.stdin.on('error', () => {}); child.stdin.end(options.input ?? '');
  });
}
