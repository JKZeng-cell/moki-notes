import { assetReferences } from '../shared/asset-references.js';
import type { PurgeResult } from '../shared/settings.js';
export function draftAssets(excluding: string[]) {
  const ids = new Set<string>();
  for (const key of Object.keys(localStorage)) if (key.startsWith('moki-notes:draft:') && !excluding.some(id => key.startsWith(`moki-notes:draft:${id}:`))) {
    for (const id of assetReferences(localStorage.getItem(key) ?? '')) ids.add(id);
  }
  return [...ids];
}
export function announcePurged(ids: string[]) {
  for (const key of Object.keys(localStorage)) if (ids.some(id => key.startsWith(`moki-notes:draft:${id}:`))) localStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent('moki:purged', { detail: ids }));
  // A transient notification synchronizes other windows without retaining deleted IDs.
  try { localStorage.setItem('moki-notes:purged', JSON.stringify(ids)); localStorage.removeItem('moki-notes:purged'); } catch { /* Other windows also detect missing notes when polling. */ }
}
export function purgeMessage(result: PurgeResult) {
  const assets = result.attachments;
  return `已永久删除 ${result.count} 条便签及其历史记录` + (assets ? `，清理 ${assets.removed} 个独占附件` + (assets.retained ? `，${assets.retained} 个共用或草稿附件已保留` : '') + (assets.failed.length ? `；${assets.failed.length} 个附件清理失败，可再次清空回收站重试` : '') : '');
}
