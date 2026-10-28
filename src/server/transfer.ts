import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readdir, rename, rm, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { NoteInput, type Note } from '../shared/model.js';
import { AppearanceSettings, AutoSaveSettings } from '../shared/settings.js';
import { NotesStore } from './store.js';
import { Attachments, safeAttachmentName } from './attachments.js';
import { assetReferences } from '../shared/asset-references.js';
import { GraphPosition } from '../shared/graph-position.js';
import { ListOrganization } from '../shared/list-organization.js';

const MAGIC = Buffer.from('MOKINOTES1\n');
const Id = z.string().uuid(), DateString = z.string().datetime();
export const StoredNote = NoteInput.extend({ id: Id, version: z.number().int().positive(), createdAt: DateString, updatedAt: DateString, deletedAt: DateString.nullable() }).strict();
const Revision = z.object({ note_id: Id, version: z.number().int().positive(), json: z.string(), actor: z.string(), action: z.string(), at: DateString }).strict();
const Asset = z.object({ id: Id, name: z.string().min(1).max(180), size: z.number().int().nonnegative().max(2 * 1024 ** 3), sha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: DateString }).strict();
const safeKeys = new Set(['autoSave', 'appearance', 'builtinDemo', 'graphPositions', 'treeOrder', 'desktopPins', 'tagHistory', 'feishuSync', 'listOrganization']);
const CloudToken = z.string().regex(/^[A-Za-z0-9_-]{5,200}$/);
const CloudState = z.object({ account: z.string().max(300), user: z.string().max(200), folder: CloudToken,
  url: z.string().url().refine(v => /^https:\/\/([\w-]+\.)*(feishu\.cn|larksuite\.com)\//.test(v)), lastSync: DateString.optional(),
  entries: z.record(CloudToken, z.object({ id: Id, originId: Id.optional(), localHash: z.string().regex(/^[a-f0-9]{64}$/), remoteHash: z.string().regex(/^[a-f0-9]{64}$/), type: z.string().max(30) }).strict()),
  assets: z.record(z.string().max(250), z.object({ id: Id, token: CloudToken, name: z.string().max(180), url: z.string().url(), source: z.string().max(2000).optional() }).strict()) }).strict();
export const localKey = (key: string) => /^moki-notes:draft:[a-f0-9-]{36}:[\w-]+$/.test(key) || ['moki-notes:theme', 'moki-notes:panel-widths', 'moki-notes:knowledge-view'].includes(key);
const Manifest = z.object({ format: z.literal('moki-notes'), version: z.literal(1), exportedAt: DateString,
  notes: z.array(StoredNote).max(100000), revisions: z.array(Revision).max(1000000),
  preferences: z.record(z.string(), z.unknown()), local: z.record(z.string(), z.string()), assets: z.array(Asset).max(100000) }).strict();
type ManifestData = z.infer<typeof Manifest>;
export type TransferPreview = { ticket: string; notes: number; revisions: number; attachments: number; drafts: number; exportedAt: string; bytes: number };
export type TransferResult = { imported: number; skipped: number; local: Record<string, string>; alreadyImported: boolean };
async function hashFile(path: string, start?: number, size?: number) {
  const h = createHash('sha256');
  if (size !== 0) for await (const chunk of createReadStream(path, start === undefined ? undefined : { start, end: start + size! - 1 })) h.update(chunk);
  return h.digest('hex');
}
async function readExact(file: Awaited<ReturnType<typeof open>>, size: number, position: number) {
  const bytes = Buffer.alloc(size); let done = 0;
  while (done < size) { const r = await file.read(bytes, done, size - done, position + done); if (!r.bytesRead) throw Error('迁移包不完整'); done += r.bytesRead; }
  return bytes;
}
export function validateManifest(input: unknown): ManifestData {
  const m = Manifest.parse(input), byId = new Map(m.notes.map(n => [n.id, n]));
  if (byId.size !== m.notes.length || new Set(m.assets.map(a => a.id)).size !== m.assets.length) throw Error('迁移包存在重复 ID');
  const revisions = new Set<string>();
  for (const r of m.revisions) { const n = StoredNote.parse(JSON.parse(r.json)); const key = `${r.note_id}:${r.version}`;
    if (!byId.has(r.note_id) || n.id !== r.note_id || n.version !== r.version || revisions.has(key)) throw Error('历史版本与便签不匹配'); revisions.add(key); }
  for (const n of m.notes) { const seen = new Set<string>([n.id]); let parent = n.parentId;
    while (parent) { if (!byId.has(parent) || seen.has(parent)) throw Error('迁移包父子关系无效'); seen.add(parent); parent = byId.get(parent)!.parentId; }
    if (n.links.some(id => !byId.has(id))) throw Error('迁移包关联目标缺失'); }
  for (const a of m.assets) if (safeAttachmentName(a.name) !== a.name) throw Error('附件名称无效');
  if (m.preferences.autoSave) AutoSaveSettings.parse(m.preferences.autoSave);
  if (m.preferences.appearance) AppearanceSettings.parse(m.preferences.appearance);
  if (m.preferences.feishuSync) CloudState.parse(m.preferences.feishuSync);
  if (m.preferences.graphPositions) z.record(Id, GraphPosition).parse(m.preferences.graphPositions);
  if (m.preferences.treeOrder) z.record(z.string().refine(k => k === 'root' || Id.safeParse(k).success), z.array(Id)).parse(m.preferences.treeOrder);
  if (m.preferences.listOrganization) {
    const list = ListOrganization.parse(m.preferences.listOrganization);
    if ([...list.order, ...Object.keys(list.membership)].some(id => !byId.has(id))) throw Error('列表分组引用了不存在的便签');
  }
  if (m.preferences.tagHistory) z.array(z.string().min(1).max(60)).max(500).parse(m.preferences.tagHistory);
  if (m.preferences.builtinDemo) z.object({ version: z.number().int().positive(), rootId: Id }).strict().parse(m.preferences.builtinDemo);
  if (m.preferences.desktopPins) z.array(z.object({ id: Id, top: z.boolean(), bounds: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(100).max(20000), height: z.number().int().min(100).max(20000) }).strict() }).strict()).max(1000).parse(m.preferences.desktopPins);
  for (const [key, value] of Object.entries(m.local)) {
    if (!localKey(key)) throw Error('迁移包包含非便签设置');
    if (key.startsWith('moki-notes:draft:')) { const n = StoredNote.parse(JSON.parse(value)); if (!byId.has(n.id) || !key.startsWith(`moki-notes:draft:${n.id}:`)) throw Error('草稿归属无效'); }
  }
  const assetIds = new Set(m.assets.map(a => a.id));
  const contents = [...m.notes.map(n => n.content + '\n' + n.source), ...m.revisions.map(r => { const n = JSON.parse(r.json) as Note; return n.content + '\n' + n.source; }), ...Object.entries(m.local).filter(([k]) => k.startsWith('moki-notes:draft:')).map(([, value]) => { const n = JSON.parse(value) as Note; return n.content + '\n' + n.source; })];
  for (const content of contents) if (assetReferences(content).some(id => !assetIds.has(id))) throw Error('便签、历史或草稿引用的附件缺失，无法完整迁移');
  // These settings contain no executable code, secrets, or machine-specific paths.
  m.preferences = Object.fromEntries(Object.entries(m.preferences).filter(([key]) => safeKeys.has(key)));
  return m;
}
export async function exportTransfer(store: NotesStore, assets: Attachments, target: string, local: Record<string, string> = {}) {
  const db = store.db;
  const snapshot = (() => { db.exec('BEGIN'); try {
    const result = { notes: (db.prepare('SELECT json FROM notes').all() as { json: string }[]).map(r => JSON.parse(r.json)),
      revisions: db.prepare('SELECT * FROM revisions').all(), preferences: Object.fromEntries((db.prepare('SELECT key,json FROM preferences').all() as { key: string; json: string }[]).filter(r => safeKeys.has(r.key)).map(r => [r.key, JSON.parse(r.json)])) };
    db.exec('COMMIT'); return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; } })();
  const attachmentRows: z.infer<typeof Asset>[] = [];
  for (const id of await readdir(assets.root).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return []; throw e; })) {
    if (!Id.safeParse(id).success) continue;
    const info = await assets.get(id); attachmentRows.push({ id, name: info.name, size: info.size, createdAt: info.createdAt, sha256: await hashFile(await assets.contentPath(id)) });
  }
  const m = validateManifest({ ...snapshot, format: 'moki-notes', version: 1, exportedAt: new Date().toISOString(), local: Object.fromEntries(Object.entries(local).filter(([key]) => localKey(key))), assets: attachmentRows });
  const json = Buffer.from(JSON.stringify(m)); if (json.length > 512 * 1024 ** 2) throw Error('便签与历史索引超过512 MB，请分批整理历史后重试');
  const temp = `${target}.${randomUUID()}.tmp`; await mkdir(dirname(target), { recursive: true });
  const output = await open(temp, 'wx');
  try {
    const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(json.length));
    let position = 0;
    const append = async (bytes: Buffer) => { let written = 0; while (written < bytes.length) { const r = await output.write(bytes, written, bytes.length - written, position); written += r.bytesWritten; position += r.bytesWritten; } };
    await append(MAGIC); await append(length); await append(json);
    for (const a of attachmentRows) { const h = createHash('sha256'); let count = 0;
      for await (const bytes of createReadStream(await assets.contentPath(a.id))) { h.update(bytes); count += bytes.length; await append(bytes as Buffer); }
      if (count !== a.size || h.digest('hex') !== a.sha256) throw Error('导出期间附件已变化，请重试'); }
    await output.sync(); await output.close(); await rename(temp, target);
    return { notes: m.notes.length, revisions: m.revisions.length, attachments: m.assets.length, bytes: position };
  } catch (error) { await output.close().catch(() => {}); await rm(temp, { force: true }); throw error; }
}
export async function inspectTransfer(path: string) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat(); if (!stat.isFile()) throw Error('请选择迁移包文件');
    const head = await readExact(file, MAGIC.length + 8, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw Error('不是有效的 MOKI便签迁移包');
    const length = Number(head.readBigUInt64BE(MAGIC.length));
    if (!Number.isSafeInteger(length) || length < 2 || length > 512 * 1024 ** 2 || length > stat.size - head.length) throw Error('迁移包索引大小无效');
    const json = await readExact(file, length, head.length), manifest = validateManifest(JSON.parse(json.toString('utf8')));
    let position = head.length + length; const offsets = new Map<string, number>();
    for (const asset of manifest.assets) { offsets.set(asset.id, position); if (position + asset.size > stat.size) throw Error('附件数据不完整');
      if (await hashFile(path, position, asset.size) !== asset.sha256) throw Error(`附件校验失败：${asset.name}`); position += asset.size; }
    if (position !== stat.size) throw Error('迁移包包含额外数据');
    return { manifest, offsets, fingerprint: createHash('sha256').update(json).digest('hex'), bytes: stat.size };
  } finally { await file.close(); }
}
// Merge is deliberately non-destructive: existing notes and drafts are never overwritten.
export async function importTransfer(store: NotesStore, assets: Attachments, path: string, expectedFingerprint: string): Promise<TransferResult> {
  const checked = await inspectTransfer(path);
  if (checked.fingerprint !== expectedFingerprint) throw Error('文件在预览后发生变化，请重新选择');
  const previous = store.preference<Record<string, TransferResult>>('importedTransfers', {});
  if (previous[checked.fingerprint]) return { ...previous[checked.fingerprint], alreadyImported: true };
  const m = checked.manifest, replacements = new Map<string, string>(), created: string[] = [];
  const assetMap = store.preference<Record<string, string>>('transferAssets', {});
  const rewrite = <T,>(value: T): T => JSON.parse(JSON.stringify(value).replace(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/g, id => replacements.get(id) ?? id)) as T;
  try {
    for (const a of m.assets) {
      const key = `${a.id}:${a.sha256}`;
      const existingId = assetMap[key] ?? a.id;
      try { const info = await assets.get(existingId); if (info.name === a.name && info.size === a.size && await hashFile(await assets.contentPath(existingId)) === a.sha256) { replacements.set(a.id, existingId); assetMap[key] = existingId; continue; } } catch { /* Copy a missing or different asset into a new managed ID. */ }
      const start = checked.offsets.get(a.id)!;
      const input = a.size ? createReadStream(path, { start, end: start + a.size - 1 }) : (await import('node:stream')).Readable.from([]);
      const info = await assets.importStream(a.name, input, 2 * 1024 ** 3); created.push(info.id);
      if (await hashFile(await assets.contentPath(info.id)) !== a.sha256) throw Error('复制附件时文件发生变化，请重新导入');
      replacements.set(a.id, info.id);
      assetMap[key] = info.id;
    }
    const existing = new Map((store.db.prepare('SELECT id,json FROM notes').all() as { id: string; json: string }[]).map(r => [r.id, JSON.parse(r.json) as Note]));
    const skips = new Set<string>();
    // Allocate all IDs first so forward links and parent chains are rewritten consistently.
    for (const n of m.notes) {
      if (existing.has(n.id)) {
        if (JSON.stringify(existing.get(n.id)) === JSON.stringify(rewrite(n))) skips.add(n.id);
        else replacements.set(n.id, randomUUID());
      }
    }
    for (const r of m.revisions) if (skips.has(r.note_id)) {
      const existing = store.db.prepare('SELECT json FROM revisions WHERE note_id=? AND version=?').get(r.note_id, r.version) as { json: string } | undefined;
      if (existing && JSON.stringify(JSON.parse(existing.json)) !== JSON.stringify(JSON.parse(rewrite(r).json))) { skips.delete(r.note_id); replacements.set(r.note_id, randomUUID()); }
    }
    // A skipped node may point at a conflicting imported node; duplicate it too, until stable.
    let changed = true;
    while (changed) { changed = false; for (const n of m.notes) if (skips.has(n.id) && JSON.stringify(existing.get(n.id)) !== JSON.stringify(rewrite(n))) { skips.delete(n.id); replacements.set(n.id, randomUUID()); changed = true; } }
    const local = rewrite(m.local), result = { imported: m.notes.length - skips.size, skipped: skips.size, local, alreadyImported: false };
    store.db.exec('BEGIN IMMEDIATE');
    try {
      // Detect edits that landed while attachment files were being copied.
      for (const [id, n] of existing) { const current = store.get(id); if (JSON.stringify(current) !== JSON.stringify(n)) throw Error('导入期间便签已变化，请重试'); }
      const localList = store.listOrganization();
      for (const n of m.notes) if (!skips.has(n.id)) { const next = rewrite(n); store.db.prepare('INSERT INTO notes VALUES(?,?)').run(next.id, JSON.stringify(next)); }
      for (const r of m.revisions) { const next = rewrite(r); store.db.prepare('INSERT OR IGNORE INTO revisions VALUES(?,?,?,?,?,?)').run(next.note_id, next.version, next.json, next.actor, next.action, next.at); }
      const prefs = rewrite(m.preferences);
      if (prefs.listOrganization) {
        const incoming = ListOrganization.parse(prefs.listOrganization), groupMap = new Map<string, string>();
        for (const group of incoming.groups) {
          const same = localList.groups.find(g => g.id === group.id && g.name === group.name) ?? localList.groups.find(g => g.name.toLocaleLowerCase() === group.name.toLocaleLowerCase());
          if (same) groupMap.set(group.id, same.id);
          else { const id = localList.groups.some(g => g.id === group.id) ? randomUUID() : group.id; groupMap.set(group.id, id); localList.groups.push({ ...group, id }); }
        }
        for (const [id, group] of Object.entries(incoming.membership)) if (!existing.has(id)) localList.membership[id] = groupMap.get(group)!;
        localList.order = [...new Set([...localList.order, ...incoming.order])]; localList.version++;
        ListOrganization.parse(localList); store.setPreference('listOrganization', localList);
      }
      if (Array.isArray(prefs.tagHistory)) store.setPreference('tagHistory', [...new Set([...store.preference<string[]>('tagHistory', []), ...z.array(z.string().min(1).max(60)).max(500).parse(prefs.tagHistory)])].slice(0, 500));
      for (const key of ['autoSave', 'appearance']) if (prefs[key]) store.setPreference(key, prefs[key]);
      if (prefs.graphPositions) store.setPreference('graphPositions', { ...prefs.graphPositions as object, ...store.preference('graphPositions', {}) });
      if (prefs.treeOrder) {
        const order = store.preference<Record<string, string[]>>('treeOrder', {});
        for (const [parent, ids] of Object.entries(prefs.treeOrder as Record<string, string[]>)) order[parent] = [...new Set([...(order[parent] ?? []), ...ids])];
        store.setPreference('treeOrder', order);
      }
      const importedPins = Array.isArray(prefs.desktopPins) ? prefs.desktopPins : [];
      const pins = store.preference<Array<{ id: string }>>('desktopPins', []);
      store.setPreference('desktopPins', [...pins, ...importedPins.filter(p => p && typeof p.id === 'string' && !pins.some(x => x.id === p.id))]);
      if (!store.preference('builtinDemo', null) && prefs.builtinDemo) store.setPreference('builtinDemo', prefs.builtinDemo);
      if (!store.preference('feishuSync', null) && m.preferences.feishuSync) {
        const connection = CloudState.parse(m.preferences.feishuSync);
        for (const entry of Object.values(connection.entries)) entry.id = replacements.get(entry.id) ?? entry.id;
        connection.assets = rewrite(connection.assets);
        store.setPreference('feishuSync', connection);
      }
      store.setPreference('importedTransfers', { ...previous, [checked.fingerprint]: result });
      store.setPreference('transferAssets', assetMap);
      store.db.exec('COMMIT'); return result;
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  } catch (error) { for (const id of created) assets.remove(id); throw error; }
}
