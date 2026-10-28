import { z } from 'zod';
import type { FeishuAutoSettings } from '../shared/feishu.js';

export const AutoSyncSettings = z.object({ enabled: z.boolean(), intervalMinutes: z.number().int().min(1).max(1440), direction: z.enum(['both', 'push', 'pull']) }).strict();
export const defaultAutoSync: FeishuAutoSettings = { enabled: false, intervalMinutes: 15, direction: 'both' };

/** One desktop-owned timer. Pauses while another data/auth operation owns the lock. */
export class FeishuScheduler {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private revision = 0;
  running = false;
  nextRun?: string;
  constructor(private readonly settings: () => FeishuAutoSettings, private readonly available: () => boolean,
    private readonly execute: (direction: FeishuAutoSettings['direction']) => Promise<unknown>, private readonly failed: (error: Error) => void) {}
  reset(delay = this.settings().intervalMinutes * 60000) {
    this.revision++; clearTimeout(this.timer); this.nextRun = undefined;
    if (this.stopped || !this.settings().enabled) return;
    this.nextRun = new Date(Date.now() + delay).toISOString();
    const revision = this.revision;
    this.timer = setTimeout(() => void this.tick(revision), delay); this.timer.unref?.();
  }
  private async tick(revision: number) {
    if (this.stopped || revision !== this.revision || !this.settings().enabled) return;
    if (this.running || !this.available()) { this.reset(10000); return; }
    this.nextRun = undefined; this.running = true;
    try { await this.execute(this.settings().direction); } catch (e) { this.failed(e as Error); }
    finally { this.running = false; if (!this.stopped && revision === this.revision) this.reset(); }
  }
  stop() { this.stopped = true; this.revision++; clearTimeout(this.timer); this.nextRun = undefined; }
}
