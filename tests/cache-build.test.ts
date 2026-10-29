import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { prepareBuildCache } from '../src/desktop/cache-build.js';

it('rebuilds HTTP cache on upgrade, preserves old cache and leaves notes and drafts untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'moki-cache-build-'));
  try {
    mkdirSync(join(root, 'Cache')); writeFileSync(join(root, 'Cache', 'old-entry'), 'old bytes');
    mkdirSync(join(root, 'Local Storage')); writeFileSync(join(root, 'Local Storage', 'draft'), 'unsaved');
    writeFileSync(join(root, 'moki-notes.db'), 'database');
    expect(prepareBuildCache(root, 'a'.repeat(64))).toBe(true);
    const backup = readdirSync(root).find(x => x.startsWith('Cache.previous-build-'))!;
    expect(readFileSync(join(root, backup, 'old-entry'), 'utf8')).toBe('old bytes');
    expect(readdirSync(join(root, 'Cache'))).toEqual([]);
    writeFileSync(join(root, 'Cache', 'new-entry'), 'current bytes');
    expect(prepareBuildCache(root, 'a'.repeat(64))).toBe(false);
    expect(readFileSync(join(root, 'Cache', 'new-entry'), 'utf8')).toBe('current bytes');
    expect(prepareBuildCache(root, 'b'.repeat(64))).toBe(true);
    expect(readdirSync(root).filter(x => x.startsWith('Cache.previous-build-'))).toHaveLength(2);
    expect(readFileSync(join(root, 'Local Storage', 'draft'), 'utf8')).toBe('unsaved');
    expect(readFileSync(join(root, 'moki-notes.db'), 'utf8')).toBe('database');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('rejects invalid markers and non-directory cache entries without moving anything', () => {
  const root = mkdtempSync(join(tmpdir(), 'moki-cache-build-'));
  try {
    writeFileSync(join(root, 'Cache'), 'keep');
    expect(() => prepareBuildCache(root, '../bad')).toThrow('无效');
    expect(() => prepareBuildCache(root, 'a'.repeat(64))).toThrow('普通目录');
    expect(readFileSync(join(root, 'Cache'), 'utf8')).toBe('keep');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
