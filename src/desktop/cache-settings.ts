import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { CacheInfo } from '../shared/settings.js';

// Only disposable HTTP / JS caches move. sessionData, Local Storage drafts and
// the SQLite database remain at their original paths. No recursive deletion.
export class CacheSettings {
  private file: string;
  private selected: string;
  readonly activePath: string;
  readonly error: string;
  constructor(readonly profile: string) {
    this.profile = profile = resolve(profile);
    this.file = join(profile, 'cache-settings.json');
    this.selected = profile;
    let error = '';
    try {
      if (existsSync(this.file)) {
        const config = JSON.parse(readFileSync(this.file, 'utf8'));
        if (typeof config.path !== 'string' || !isAbsolute(config.path)) throw new Error('缓存路径设置无效');
        this.selected = resolve(config.path);
      }
      this.activate(this.selected);
    } catch (e) {
      error = `缓存路径未能应用，已尝试使用默认位置：${(e as Error).message}`;
      try { this.activate(profile); } catch { /* Keep startup usable and report the path error in Settings. */ }
    }
    const http = join(profile, 'Cache');
    this.activePath = existsSync(http) ? dirname(realpathSync(http)) : profile;
    this.error = error;
  }
  private writable(path: string) {
    mkdirSync(path, { recursive: true });
    const probe = join(path, `.moki-write-${randomUUID()}`);
    writeFileSync(probe, '', { flag: 'wx' }); unlinkSync(probe);
  }
  private activate(path: string) {
    const link = join(this.profile, 'Cache'), target = join(path, 'Cache');
    this.writable(path);
    if (resolve(link) === resolve(target) && (!existsSync(link) || !lstatSync(link).isSymbolicLink())) return;
    if (existsSync(link) && realpathSync(link) === resolve(target)) return;
    // Refuse a target beneath the directory that will be redirected.
    const rel = relative(link, target);
    if (path !== this.profile && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) throw new Error('请选择应用缓存目录以外的文件夹');
    const staged = join(this.profile, `Cache.next-${randomUUID()}`);
    if (path === this.profile) mkdirSync(staged);
    else { this.writable(target); symlinkSync(target, staged, process.platform === 'win32' ? 'junction' : 'dir'); }
    const backup = join(this.profile, `Cache.previous-${randomUUID()}`);
    let moved = false;
    try {
      // Rename preserves the previous cache, including user-owned junctions.
      // Old directories are intentionally not recursively removed.
      try { lstatSync(link); renameSync(link, backup); moved = true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      renameSync(staged, link);
    } catch (e) { if (moved) renameSync(backup, link); throw e; }
  }
  choose(parent: string | null) {
    const path = parent === null ? this.profile : join(resolve(parent), `MOKI-Notes-Cache-${createHash('sha256').update(this.profile.toLowerCase()).digest('hex').slice(0, 10)}`);
    for (const cache of ['Cache', 'Code Cache']) {
      const rel = relative(join(this.profile, cache), path);
      if (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) throw new Error('请选择当前缓存目录以外的文件夹');
    }
    this.writable(path);
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ path }, null, 2)); renameSync(temp, this.file);
    this.selected = path;
  }
  info(bytes: number): CacheInfo { return { path: this.selected, activePath: this.activePath, defaultPath: this.profile, restartRequired: this.selected !== this.activePath, error: this.error, bytes }; }
}
