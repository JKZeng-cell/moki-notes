import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CliRunner } from './feishu-cli.js';
import type { FeishuLogin, FeishuAuthProgress } from '../shared/feishu.js';

export class FeishuAuth {
  private controller?: AbortController;
  private current: FeishuAuthProgress = { state: 'idle' };
  private generation = 0;
  progress(): FeishuAuthProgress { return this.current; }
  cancel() { this.generation++; this.controller?.abort(); this.controller = undefined; this.current = { state: 'cancelled' }; }
  constructor(private readonly cli: CliRunner) {}
  async status() {
    let data;
    try { data = await this.cli(['auth', 'status', '--json']); }
    catch (e) { if ((e as { code?: string }).code === 'not_configured') return { configured: false, loggedIn: false }; throw e; }
    const user = data.identities?.user;
    return { configured: !!data.appId, loggedIn: !!user?.available && user.verified !== false,
      authUser: typeof user?.userName === 'string' ? user.userName : undefined };
  }
  async begin(): Promise<FeishuLogin> {
    this.cancel(); const generation = this.generation;
    const data = await this.cli(['auth', 'login', '--domain', 'drive,docs,markdown', '--no-wait', '--json']);
    const url = data.verification_url ?? data.verification_uri_complete;
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['feishu.cn', 'larksuite.com'].some(domain => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain))) throw Error('飞书返回的授权地址不受支持');
    if (typeof data.device_code !== 'string' || !data.device_code) throw Error('飞书未返回授权会话，请重试');
    const expires = Date.now() + Math.min(Math.max(Number(data.expires_in) || 600, 1), 1800) * 1000;
    const temp = await mkdtemp(join(tmpdir(), 'moki-feishu-auth-'));
    try {
      await this.cli(['auth', 'qrcode', url, '--output', 'login.png'], { cwd: temp, text: true });
      const bytes = await readFile(join(temp, 'login.png'));
      if (generation !== this.generation) throw Error('授权已取消');
      const login = { url, qr: `data:image/png;base64,${bytes.toString('base64')}`, expiresAt: new Date(expires).toISOString() };
      this.current = { state: 'pending', login };
      const controller = this.controller = new AbortController();
      // The CLI implements device-flow polling (including the provider's polling interval).
      // Run it once in the background, bounded by this session's actual expiry.
      void this.poll(data.device_code, expires, generation, controller);
      return login;
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  private async poll(code: string, expires: number, generation: number, controller: AbortController) {
    const timer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.current = { state: 'expired', error: '授权已超时，已停止等待。请重新登录飞书。' }; controller.abort();
    }, Math.max(0, expires - Date.now()));
    try {
      await this.cli(['auth', 'login', '--device-code', code, '--json'], { timeoutMs: Math.max(1, expires - Date.now()), signal: controller.signal });
      if (controller.signal.aborted || generation !== this.generation) return;
      const status = await this.cli(['auth', 'status', '--json', '--verify'], { signal: controller.signal, timeoutMs: Math.max(1, expires - Date.now()) });
      if (controller.signal.aborted || generation !== this.generation) return;
      if (!status.identities?.user?.available || status.identities.user.verified === false) throw Error('未获取到有效授权，请重新登录飞书');
      this.current = { state: 'succeeded' };
    } catch (e) {
      if (generation === this.generation && !controller.signal.aborted) this.current = Date.now() >= expires
        ? { state: 'expired', error: '授权已超时，已停止等待。请重新登录飞书。' }
        : { state: 'failed', error: `授权未完成：${(e as Error).message}` };
    } finally { clearTimeout(timer); if (generation === this.generation) this.controller = undefined; }
  }
}
