import { describe, expect, it, vi } from 'vitest';
import { QuitCoordinator } from '../src/desktop/quit.js';

describe('background application exit', () => {
  it('checks every window before prompting and keeps all windows when quit is cancelled', async () => {
    const commit = vi.fn(), confirm = vi.fn(async () => false), error = vi.fn();
    const controller = new QuitCoordinator({ windows: () => ['manager', 'card'], isDirty: async w => w === 'card', confirm, commit, error });
    await controller.request();
    expect(confirm).toHaveBeenCalledWith(['card']); expect(commit).not.toHaveBeenCalled();
    expect(controller.approved).toBe(false); expect(controller.pending).toBe(false);
    confirm.mockResolvedValueOnce(true); await controller.request();
    expect(commit).toHaveBeenCalledOnce(); expect(controller.approved).toBe(true);
  });
  it('does not show duplicate prompts or commit a second exit', async () => {
    let resolve!: (value: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>(r => { resolve = r; })), commit = vi.fn();
    const controller = new QuitCoordinator({ windows: () => [1], isDirty: async () => true, confirm, commit, error: vi.fn() });
    const first = controller.request(); await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await controller.request(); resolve(true); await first; await controller.request();
    expect(confirm).toHaveBeenCalledOnce(); expect(commit).toHaveBeenCalledOnce();
  });
  it('quits clean windows immediately and retains the app if a draft check fails', async () => {
    const commit = vi.fn(), confirm = vi.fn(), error = vi.fn();
    const clean = new QuitCoordinator({ windows: () => [1, 2], isDirty: async () => false, confirm, commit, error });
    await clean.request(); expect(confirm).not.toHaveBeenCalled(); expect(commit).toHaveBeenCalledOnce();
    const failure = new QuitCoordinator({ windows: () => [1], isDirty: async () => { throw new Error('renderer unavailable'); }, confirm, commit, error });
    await failure.request(); expect(error).toHaveBeenCalledOnce(); expect(commit).toHaveBeenCalledOnce(); expect(failure.approved).toBe(false);
  });
});

describe('save and close for installation', () => {
  it('uses installer consent once but still saves every window and aborts on failure', async () => {
    for (const success of [true, false]) {
      const confirmInstall = vi.fn(), commit = vi.fn(), result = vi.fn(), lock = vi.fn(async () => {});
      const saved: number[] = [];
      const q = new QuitCoordinator({ windows: () => [1, 2], isDirty: async () => !success, confirm: vi.fn(), confirmInstall,
        lock, save: async w => { saved.push(w); return w === 1 || success; }, installResult: result, commit, error: vi.fn() });
      await q.request('install', true);
      expect(confirmInstall).not.toHaveBeenCalled(); expect(saved).toEqual([1, 2]);
      expect(result.mock.calls[0][0]).toBe(success ? 'saved' : 'failed');
      expect(commit).toHaveBeenCalledTimes(success ? 1 : 0);
      if (!success) expect(lock).toHaveBeenLastCalledWith([1, 2], false);
    }
  });
  it('confirms even a clean app, saves every window sequentially and rechecks before closing', async () => {
    const events: string[] = [], dirty = new Set(['main', 'card']);
    const q = new QuitCoordinator({ windows: () => ['main','card'], isDirty: async w => dirty.has(w), confirm: vi.fn(),
      confirmInstall: async () => {events.push('confirm');return true;}, lock: async (_,value)=>{events.push(`lock:${value}`);},
      save: async w=>{events.push(`save:${w}`);dirty.delete(w);return true;}, installResult: async r=>{events.push(r);},
      commit:()=>events.push('close'), error:vi.fn() });
    await q.request('install'); expect(events).toEqual(['confirm','lock:true','save:main','save:card','saved','close']);
    expect(q.approved).toBe(true);
  });
  it('cancellation leaves all windows and notes untouched', async () => {
    const save=vi.fn(), lock=vi.fn(), commit=vi.fn(), result=vi.fn();
    const q=new QuitCoordinator({windows:()=>[1],isDirty:async()=>false,confirm:vi.fn(),confirmInstall:async()=>false,save,lock,installResult:result,commit,error:vi.fn()});
    await q.request('install'); expect(result).toHaveBeenCalledWith('cancelled'); expect(save).not.toHaveBeenCalled(); expect(lock).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
  it('save failure unlocks every window and aborts exit without forcing newer content', async () => {
    const lock=vi.fn(async()=>{}), commit=vi.fn(), error=vi.fn(), result=vi.fn();
    const q=new QuitCoordinator({windows:()=>[1,2],isDirty:async()=>true,confirm:vi.fn(),confirmInstall:async()=>true,lock,
      save:async w=>w===1,installResult:result,commit,error});
    await q.request('install'); expect(commit).not.toHaveBeenCalled(); expect(q.approved).toBe(false);
    expect(result.mock.calls[0][0]).toBe('failed'); expect(result.mock.calls[0][1]).toContain('便签尚未成功保存'); expect(lock).toHaveBeenLastCalledWith([1,2],false); expect(error).toHaveBeenCalledOnce();
  });
  it('refuses to close if edits remain or a new window opened while saving', async () => {
    for(const extra of [false,true]) {
      let saved=false; const commit=vi.fn(), error=vi.fn();
      const q=new QuitCoordinator({windows:()=>extra&&saved?[1,2]:[1],isDirty:async()=>!extra,confirm:vi.fn(),confirmInstall:async()=>true,
        lock:async()=>{},save:async()=>{saved=true;return true;},commit,error});
      await q.request('install');expect(commit).not.toHaveBeenCalled();expect(error).toHaveBeenCalledOnce();
    }
  });
});
