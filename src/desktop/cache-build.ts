import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Run before Electron opens its cache. Preserve old files, never touch drafts. */
export function prepareBuildCache(root: string, revision: string) {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw Error('无效缓存构建标识');
  const marker = join(root, '.moki-cache-build.json');
  try { if (JSON.parse(readFileSync(marker, 'utf8')).revision === revision) return false; }
  catch { /* Existing installations have no build marker. */ }
  const cache = join(root, 'Cache');
  if (existsSync(cache)) {
    const info = lstatSync(cache);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('实际缓存目录不是普通目录，未进行重建');
    renameSync(cache, join(root, `Cache.previous-build-${randomUUID()}`));
  }
  mkdirSync(cache, { recursive: true });
  const staged = `${marker}.${randomUUID()}.tmp`;
  writeFileSync(staged, JSON.stringify({ revision }), { encoding: 'utf8', flag: 'wx' });
  renameSync(staged, marker);
  return true;
}
