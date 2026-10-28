import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { NotesStore } from '../src/server/store.js';
import { Attachments } from '../src/server/attachments.js';
import { exportTransfer, importTransfer, inspectTransfer } from '../src/server/transfer.js';
import type { ListCommand } from '../src/shared/list-organization.js';

const dirs: string[] = [], stores: NotesStore[] = [];
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'moki-transfer-test-')); dirs.push(dir); const store = new NotesStore(join(dir, 'notes.db')); stores.push(store); return { dir, store, assets: new Attachments(join(dir, 'assets')) }; }
afterEach(async () => { stores.splice(0).forEach(s => s.close()); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
it('migrates list groups, collapsed state and independent order without overwriting local organization', async () => {
  const a = await fixture(), b = await fixture();
  const act = (s: NotesStore, command: ListCommand) => s.organizeList({ ...command, expectedVersion: s.listOrganization().version });
  const one = a.store.create({ title: 'one' }), two = a.store.create({ title: 'two', parentId: one.id });
  const group = act(a.store, { kind: 'create', name: '工作' }).groups[0];
  act(a.store, { kind: 'move', noteIds: [one.id, two.id], groupId: group.id, targetId: null, placement: 'before' });
  act(a.store, { kind: 'collapse', groupId: group.id, collapsed: true });
  const path = join(a.dir, 'groups.mokinotes'); await exportTransfer(a.store, a.assets, path); const check = await inspectTransfer(path);
  await importTransfer(b.store, b.assets, path, check.fingerprint);
  expect(b.store.listOrganization().groups).toEqual(a.store.listOrganization().groups);
  expect(b.store.listOrganization().order).toEqual(a.store.listOrganization().order);
  expect(b.store.listOrganization().membership).toEqual(a.store.listOrganization().membership);
  act(b.store, { kind: 'move', noteIds: [one.id], groupId: null, targetId: null, placement: 'before' });
  a.store.update(two.id, { content: 'import conflict copy' }, 1);
  await exportTransfer(a.store, a.assets, path); const next = await inspectTransfer(path); await importTransfer(b.store, b.assets, path, next.fingerprint);
  expect(b.store.listOrganization().membership[one.id]).toBeUndefined();
  const copy = b.store.list({ status: 'all', q: 'import conflict copy' }).items[0];
  expect(copy.id).not.toBe(two.id); expect(b.store.listOrganization().membership[copy.id]).toBe(group.id);
  expect(b.store.get(two.id).parentId).toBe(one.id);
});
it('round-trips every note state, history, binary attachment, draft, hierarchy and settings', async () => {
  const a = await fixture(), b = await fixture();
  const file = await a.assets.importStream('图文.bin', Readable.from([Buffer.from([0, 255, 42, 10])]));
  const root = a.store.create({ title: 'root', tags: ['历史标签'] });
  const child = a.store.create({ title: 'child', parentId: root.id, links: [root.id], content: `![图](${file.src})`, starred: true, archived: true });
  const trash = a.store.create({ title: 'trash' }); a.store.trash(trash.id, 1);
  a.store.update(root.id, { tags: ['新标签'] }, 1);
  a.store.setPreference('appearance', { fontSize: 20 }); a.store.setPreference('autoSave', { enabled: false, delayMs: 1500 }); a.store.setPreference('graphPositions', { [child.id]: { x: 80, y: 40 } });
  a.store.setPreference('feishuCliPath', 'secret-local-path');
  const local = { [`moki-notes:draft:${child.id}:window`]: JSON.stringify({ ...child, content: 'draft ' + file.src }), 'moki-notes:theme': 'dark' };
  const path = join(a.dir, 'data.mokinotes'); await exportTransfer(a.store, a.assets, path, local);
  const checked = await inspectTransfer(path); expect(checked.manifest.preferences.feishuCliPath).toBeUndefined();
  const result = await importTransfer(b.store, b.assets, path, checked.fingerprint);
  expect(result.imported).toBe(3); expect(b.store.get(child.id)).toMatchObject({ parentId: root.id, links: [root.id], starred: true, archived: true });
  expect(b.store.get(trash.id).deletedAt).toBeTruthy(); expect(b.store.history(root.id)).toHaveLength(2);
  expect(b.store.preference('appearance', {})).toEqual({ fontSize: 20 }); expect(b.store.tagHistory().map(t => t.tag)).toContain('历史标签');
  const id = /\/api\/assets\/([^/]+)/.exec(b.store.get(child.id).content)![1];
  expect(await readFile(await b.assets.contentPath(id))).toEqual(Buffer.from([0, 255, 42, 10]));
  expect(Object.values(result.local).join(' ')).toContain(id);
  expect((await importTransfer(b.store, b.assets, path, checked.fingerprint)).alreadyImported).toBe(true);
  // A newly exported snapshot of identical notes also reuses attachment IDs.
  const again = join(a.dir, 'again.mokinotes'); await exportTransfer(a.store, a.assets, again, local); const second = await inspectTransfer(again);
  expect((await importTransfer(b.store, b.assets, again, second.fingerprint)).imported).toBe(0);
});
it('preserves existing edits and remaps imported links, history and drafts consistently', async () => {
  const a = await fixture(), b = await fixture(); const root = a.store.create({ title: 'root' }), child = a.store.create({ title: 'child', parentId: root.id, content: `[](/?note=${root.id})` });
  const path = join(a.dir, 'data.mokinotes'); await exportTransfer(a.store, a.assets, path); const checked = await inspectTransfer(path);
  await importTransfer(b.store, b.assets, path, checked.fingerprint); b.store.update(root.id, { title: 'local edit' }, 1);
  a.store.update(root.id, { title: 'remote edit' }, 1); await exportTransfer(a.store, a.assets, path); const next = await inspectTransfer(path);
  const result = await importTransfer(b.store, b.assets, path, next.fingerprint); expect(result.imported).toBe(2);
  expect(b.store.get(root.id).title).toBe('local edit');
  const all = b.store.list({ status: 'all' }).items, importedRoot = all.find(n => n.title === 'remote edit')!;
  const importedChild = all.find(n => n.parentId === importedRoot.id)!; expect(importedChild.id).not.toBe(child.id); expect(b.store.get(importedChild.id).content).toContain(importedRoot.id);
  expect(b.store.history(importedRoot.id)).toHaveLength(2);
});
it('rejects corrupt or changed packages before modifying the target', async () => {
  const a = await fixture(), b = await fixture(); const file = await a.assets.importStream('a.txt', Readable.from(['payload'])); a.store.create({ content: file.src });
  const path = join(a.dir, 'data.mokinotes'); await exportTransfer(a.store, a.assets, path); const checked = await inspectTransfer(path);
  const bytes = await readFile(path); bytes[bytes.length - 1] ^= 1; await writeFile(path, bytes);
  await expect(importTransfer(b.store, b.assets, path, checked.fingerprint)).rejects.toThrow('校验失败'); expect(b.store.list({ status: 'all' }).total).toBe(0);
});
it('rejects invalid font preferences through the API', async () => {
  const a = await fixture(); const { createApp } = await import('../src/server/app.js'); const app = await createApp(a.store);
  try { expect((await app.inject({ method: 'PUT', url: '/api/settings/appearance', payload: { fontSize: 99 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/settings/appearance', payload: { fontSize: 18 } })).json()).toEqual({ fontSize: 18 }); }
  finally { await app.close(); }
});
