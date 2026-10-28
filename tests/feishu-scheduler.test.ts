import { afterEach, expect, it, vi } from 'vitest';
import { AutoSyncSettings, defaultAutoSync, FeishuScheduler } from '../src/server/feishu-scheduler.js';
afterEach(() => vi.useRealTimers());
it('is opt-in, validates intervals, schedules by selected direction and stops when disabled', async () => {
  vi.useFakeTimers(); let settings = { ...defaultAutoSync, intervalMinutes: 1 }; const run = vi.fn(async () => {});
  const scheduler = new FeishuScheduler(() => settings, () => true, run, vi.fn());
  scheduler.reset(); await vi.advanceTimersByTimeAsync(60000); expect(run).not.toHaveBeenCalled();
  settings = { ...settings, enabled: true, direction: 'pull' }; scheduler.reset();
  await vi.advanceTimersByTimeAsync(59999); expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledWith('pull');
  settings.enabled = false; scheduler.reset(); await vi.advanceTimersByTimeAsync(120000); expect(run).toHaveBeenCalledTimes(1);
  expect(AutoSyncSettings.safeParse({...settings,intervalMinutes:0}).success).toBe(false); scheduler.stop();
});
it('waits for exclusive operations and never overlaps slow runs', async () => {
  vi.useFakeTimers(); let available = false, finish!: () => void;
  const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const scheduler = new FeishuScheduler(() => ({...defaultAutoSync,enabled:true,intervalMinutes:1}), () => available, run, vi.fn());
  scheduler.reset(); await vi.advanceTimersByTimeAsync(60000); expect(run).not.toHaveBeenCalled();
  available=true; await vi.advanceTimersByTimeAsync(10000); expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(180000); expect(run).toHaveBeenCalledTimes(1); expect(scheduler.running).toBe(true);
  finish(); await Promise.resolve(); await Promise.resolve(); scheduler.stop();
});
it('reports failures then retries on next interval and stops at shutdown', async () => {
  vi.useFakeTimers(); const run = vi.fn(async () => { throw Error('offline'); }), failed=vi.fn();
  const scheduler = new FeishuScheduler(() => ({...defaultAutoSync,enabled:true,intervalMinutes:1}), () => true, run, failed);
  scheduler.reset(); await vi.advanceTimersByTimeAsync(120000); expect(run).toHaveBeenCalledTimes(2); expect(failed).toHaveBeenCalledTimes(2);
  scheduler.stop(); await vi.advanceTimersByTimeAsync(120000); expect(run).toHaveBeenCalledTimes(2); expect(scheduler.nextRun).toBeUndefined();
});
it('changing interval during a running sync does not restore the old timer', async () => {
  vi.useFakeTimers(); let settings = {...defaultAutoSync,enabled:true,intervalMinutes:1}, finish!: () => void;
  const run = vi.fn(() => new Promise<void>(resolve => {finish=resolve;}));
  const scheduler=new FeishuScheduler(()=>settings,()=>true,run,vi.fn()); scheduler.reset(); await vi.advanceTimersByTimeAsync(60000);
  settings={...settings,intervalMinutes:5}; scheduler.reset(); const next=scheduler.nextRun; finish(); await Promise.resolve(); await Promise.resolve();
  expect(scheduler.nextRun).toBe(next); await vi.advanceTimersByTimeAsync(60000); expect(run).toHaveBeenCalledTimes(1); scheduler.stop();
});
