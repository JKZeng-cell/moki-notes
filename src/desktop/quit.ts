// Reuse renderer beforeunload guards without closing any window first. This
// prevents a cancelled quit from partially closing the manager or pinned cards.
export const CHECK_UNSAVED = `(() => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
})()`;

// Call the renderer's normal save pipeline, including outstanding autosaves and
// version checks. Never save localStorage snapshots over newer database values.
export const SAVE_FOR_INSTALL = `(async () => {
  const pending = [];
  window.dispatchEvent(new CustomEvent('moki:save-for-install', {
    detail: { waitUntil: value => pending.push(Promise.resolve(value)) }
  }));
  return (await Promise.all(pending)).every(value => value === true);
})()`;

export class QuitCoordinator<T> {
  pending = false;
  approved = false;
  constructor(private readonly handlers: {
    windows(): T[];
    isDirty(window: T): Promise<boolean>;
    confirm(dirty: T[]): Promise<boolean>;
    confirmInstall?(windows: T[]): Promise<boolean>;
    save?(window: T): Promise<boolean>;
    lock?(windows: T[], locked: boolean): Promise<void>;
    installResult?(result: 'saved' | 'cancelled' | 'failed'): Promise<void>;
    commit(): void;
    error(reason: unknown): void;
  }) {}
  async request(reason: 'quit' | 'install' = 'quit') {
    if (this.pending || this.approved) return;
    this.pending = true;
    let locked: T[] = [];
    try {
      const windows = this.handlers.windows();
      if (reason === 'install') {
        if (!this.handlers.confirmInstall || !this.handlers.save || !this.handlers.lock) throw Error('当前版本尚不支持安装前保存，请手动保存后退出');
        if (!(await this.handlers.confirmInstall(windows))) { await this.handlers.installResult?.('cancelled'); return; }
        locked = windows;
        await this.handlers.lock(windows, true);
        // Sequential saves keep two dirty editors for the same note from
        // overwriting each other: the second writer must pass its version guard.
        for (const w of windows) if (!(await this.handlers.save(w))) throw Error('便签尚未成功保存。请检查空标题、版本冲突或保存错误后重试。');
        const remaining = this.handlers.windows();
        if (remaining.length !== windows.length || remaining.some(w => !windows.includes(w))) throw Error('窗口已变化，请重新尝试安装');
        if ((await Promise.all(windows.map(w => this.handlers.isDirty(w)))).some(Boolean)) throw Error('仍有未保存的编辑，已取消关闭');
        await this.handlers.installResult?.('saved');
        this.approved = true; this.handlers.commit(); return;
      }
      const states = await Promise.all(windows.map(w => this.handlers.isDirty(w)));
      const dirty = windows.filter((_, i) => states[i]);
      if (dirty.length && !(await this.handlers.confirm(dirty))) return;
      this.approved = true;
      this.handlers.commit();
    } catch (error) {
      this.approved = false;
      if (reason === 'install') { try { await this.handlers.installResult?.('failed'); } catch { /* Keep the application open even if the helper disappeared. */ } }
      this.handlers.error(error);
    }
    finally {
      if (locked.length && !this.approved) { try { await this.handlers.lock?.(locked, false); } catch (error) { this.handlers.error(error); } }
      this.pending = false;
    }
  }
}
