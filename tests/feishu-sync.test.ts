import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { NotesStore } from '../src/server/store.js';
import { Attachments } from '../src/server/attachments.js';
import { FeishuSync, decodeCloudNote } from '../src/server/feishu-sync.js';
import type { CliRunner } from '../src/server/feishu-cli.js';

const stores: NotesStore[] = [], dirs: string[] = [];
afterEach(async () => { stores.splice(0).forEach(s => s.close()); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function cloud(replaceOnOverwrite = false) {
  let serial = 0; const files = new Map<string, { token: string; name: string; type: string; parent: string; content: string; bytes?: Buffer }>();
  const calls: string[][] = [];
  const cli: CliRunner = async (args, options = {}) => {
    calls.push(args); const arg = (key: string) => args[args.indexOf(key) + 1];
    if (args[0] === 'auth') return { appId: 'app', identities: { user: { available: true, verified: true, openId: 'user', userName: '测试用户' } } };
    if (args[1] === 'files') { const params = JSON.parse(arg('--params')); return { files: [...files.values()].filter(f => f.parent === params.folder_token).map(({ content, bytes, parent, ...rest }) => rest), has_more: false }; }
    if (args[1] === '+create-folder') { const token = `folder${++serial}`; files.set(token, { token, name: arg('--name'), type: 'folder', parent: args.includes('--folder-token') ? arg('--folder-token') : '', content: '' }); return { folder_token: token, url: `https://feishu.cn/drive/folder/${token}` }; }
    if (args[0] === 'markdown' && args[1] === '+fetch') { const f = files.get(arg('--file-token'))!; return { content: f.content, file_name: f.name }; }
    if (args[0] === 'markdown') { const previous = args[1] === '+overwrite' ? files.get(arg('--file-token')) : undefined;
      const token = previous && !replaceOnOverwrite ? previous.token : `file${++serial}`;
      if (previous && replaceOnOverwrite) files.delete(previous.token);
      files.set(token, { token, name: arg('--name'), type: 'file', parent: previous?.parent ?? arg('--folder-token'), content: options.input ?? '' }); return { file_token: token }; }
    if (args[1] === '+upload') { const token = `asset${++serial}`; files.set(token, { token, name: arg('--name'), type: 'file', parent: arg('--folder-token'), content: '', bytes: await readFile(join(options.cwd!, arg('--file'))) }); return { file_token: token }; }
    if (args[1] === '+download') { const f = files.get(arg('--file-token'))!; await writeFile(join(options.cwd!, arg('--output')), f.bytes ?? f.content); return { saved_path: arg('--output') }; }
    if (args[0] === 'docs') return { document: { content: files.get(arg('--doc'))!.content } };
    throw Error('Unexpected CLI call: ' + args.join(' '));
  };
  return { cli, calls, files };
}
async function device(cli: CliRunner) { const dir = await mkdtemp(join(tmpdir(), 'moki-sync-test-')); dirs.push(dir); const store = new NotesStore(join(dir, 'notes.db')); stores.push(store); const assets = new Attachments(join(dir, 'assets')); const sync = new FeishuSync(store, assets, cli); return { store, assets, sync }; }

it('creates/reuses one folder, pushes, repeats without duplicates and pulls native markdown', async () => {
  const c = cloud(), a = await device(c.cli); const note = a.store.create({ title: '主题 / 一', content: 'first' });
  await a.sync.connect(); await a.sync.connect(); expect([...c.files.values()].filter(f => f.type === 'folder')).toHaveLength(1);
  expect((await a.sync.sync('both')).uploaded).toBe(1); expect((await a.sync.sync('both')).uploaded).toBe(0);
  const remote = [...c.files.values()].find(f => f.type === 'file')!;
  expect(decodeCloudNote(remote.content, remote.name).data.title).toBe(note.title);
  remote.content = remote.content.replace('first', 'cloud edit');
  expect((await a.sync.sync('both')).downloaded).toBe(1); expect(a.store.get(note.id).content).toBe('cloud edit');
  expect(a.store.list({ status: 'all' }).total).toBe(1);
});

it.each([false, true])('syncs consecutive saved edits and cloud edits without stale mappings (replacement=%s)', async replacement => {
  const c = cloud(replacement), a = await device(c.cli);
  let note = a.store.create({ title: '更新验收', content: '初始正文' });
  await a.sync.connect(); expect((await a.sync.sync('both')).errors).toEqual([]);
  for (let i = 1; i <= 3; i++) {
    note = a.store.update(note.id, { title: `更新验收 ${i}`, content: `第 ${i} 次更新`, tags: [`标签${i}`] }, note.version);
    expect(a.sync.records()).toHaveLength(1); expect(a.sync.records()[0].status).toBe('changed');
    const result = await a.sync.sync(i === 2 ? 'push' : 'both');
    expect(result).toMatchObject({ uploaded: 1, downloaded: 0, errors: [] });
    const files = [...c.files.values()].filter(f => f.type === 'file'); expect(files).toHaveLength(1);
    expect(decodeCloudNote(files[0].content, files[0].name).data).toMatchObject({ title: note.title, content: note.content, tags: note.tags });
    expect(a.sync.records()).toHaveLength(1); expect(a.sync.records()[0].status).toBe('synced');
    expect((await a.sync.sync('both'))).toMatchObject({ uploaded: 0, downloaded: 0, errors: [] });
  }
  const remote = [...c.files.values()].find(f => f.type === 'file')!;
  remote.content = remote.content.replace('第 3 次更新', '飞书更新正文');
  expect(await a.sync.sync('both')).toMatchObject({ uploaded: 0, downloaded: 1, conflicts: 0, errors: [] });
  expect(a.store.get(note.id).content).toBe('飞书更新正文');
  expect(a.store.list({ status: 'all' }).total).toBe(1);
});

it('keeps edits made during upload pending for the next sync', async () => {
  const c = cloud(); let editDuringUpload = () => {};
  const a = await device(async (args, options) => { const result = await c.cli(args, options); if (args[1] === '+overwrite') editDuringUpload(); return result; });
  let n = a.store.create({ title: 'during upload', content: 'base' }); await a.sync.connect(); await a.sync.sync('both');
  n = a.store.update(n.id, { content: 'first edit' }, n.version);
  editDuringUpload = () => { a.store.update(n.id, { content: 'later edit' }, n.version); editDuringUpload = () => {}; };
  expect((await a.sync.sync('both')).uploaded).toBe(1); expect(a.sync.records()[0].status).toBe('changed');
  expect((await a.sync.sync('both')).uploaded).toBe(1); expect(a.sync.records()[0].status).toBe('synced');
  const remote = [...c.files.values()].find(f => f.type === 'file')!;
  expect(decodeCloudNote(remote.content, remote.name).content).toBe('later edit');
});
it('preserves both sides of a conflict and skips unsaved drafts', async () => {
  const c = cloud(), a = await device(c.cli); let note = a.store.create({ title: 'conflict', content: 'base' }); await a.sync.connect(); await a.sync.sync('both');
  const remote = [...c.files.values()].find(f => f.type === 'file')!; remote.content = remote.content.replace('base', 'remote'); note = a.store.update(note.id, { content: 'local' }, note.version);
  const blocked = await a.sync.sync('both', [note.id]); expect(blocked.errors.join('')).toContain('草稿'); expect(a.store.get(note.id).content).toBe('local');
  const result = await a.sync.sync('both'); expect(result.conflicts).toBe(1); expect(result.errors).toEqual([]);
  expect(a.store.get(note.id).content).toBe('remote'); const copy = a.store.list({ status: 'all' }).items.find(n => n.title.includes('冲突副本'))!; expect(a.store.get(copy.id).content).toBe('local');
});
it('moves attachments and restores relationships and note references on a second device', async () => {
  const c = cloud(), a = await device(c.cli), b = await device(c.cli);
  const asset = await a.assets.importStream('hello.txt', Readable.from(['binary\u0000payload']));
  const root = a.store.create({ title: 'root' }), child = a.store.create({ title: 'child', parentId: root.id, links: [root.id], content: `[附件](${asset.src})\n[便签](/?note=${root.id})` });
  await a.sync.connect(); expect((await a.sync.sync('both')).errors).toEqual([]); await b.sync.connect(); const pulled = await b.sync.sync('pull'); expect(pulled.errors).toEqual([]); expect(pulled.downloaded).toBe(2);
  const notes = b.store.list({ status: 'all' }).items, r = notes.find(n => n.title === 'root')!, ch = notes.find(n => n.title === 'child')!;
  expect(ch.parentId).toBe(r.id); expect(ch.links).toEqual([r.id]); expect(b.store.get(ch.id).content).toContain(`?note=${r.id}`);
  const localAsset = /\/api\/assets\/([^/]+)/.exec(b.store.get(ch.id).content)![1]; expect(await readFile(await b.assets.contentPath(localAsset), 'utf8')).toBe('binary\u0000payload');
  b.store.update(ch.id, { title: 'child renamed' }, ch.version); expect((await b.sync.sync('both')).errors).toEqual([]);
  expect((await a.sync.sync('both')).errors).toEqual([]); expect(a.store.get(child.id).title).toBe('child renamed'); expect(a.store.get(child.id).parentId).toBe(root.id);
});
it('does not propagate deletion and refuses duplicate target folders or account changes', async () => {
  const c = cloud(), a = await device(c.cli); const note = a.store.create({ title: 'keep' }); await a.sync.connect(); await a.sync.sync('both');
  const remote = [...c.files.values()].find(f => f.type === 'file')!; c.files.delete(remote.token); await a.sync.sync('both'); expect(a.store.get(note.id).title).toBe('keep');
  c.files.set('folderExtra', { token: 'folderExtra', type: 'folder', name: 'MOKI便签', parent: '', content: '' }); await expect(a.sync.connect()).rejects.toThrow('多个');
  const wrong = new FeishuSync(a.store, a.assets, async (args, opts) => args[0] === 'auth' ? { appId: 'app', identities: { user: { available: true, openId: 'other' } } } : c.cli(args, opts));
  await expect(wrong.sync('both')).rejects.toThrow('帐号已改变');
});
it('reports partial errors and never uploads over a remotely changed file during push-only', async () => {
  const c = cloud(), a = await device(c.cli); const note = a.store.create({ title: 'safe', content: 'base' }); await a.sync.connect(); await a.sync.sync('both');
  const remote = [...c.files.values()].find(f => f.type === 'file')!; remote.content = remote.content.replace('base', 'new remote'); a.store.update(note.id, { content: 'new local' }, 1);
  const result = await a.sync.sync('push'); expect(result.uploaded).toBe(0); expect(result.errors.length).toBeGreaterThan(0); expect(remote.content).toContain('new remote');
});
it('reports blocked new drafts and locally edited notes whose remote file disappeared', async () => {
  const c = cloud(), a = await device(c.cli); const note = a.store.create({ title:'unsaved', content:'base' });
  await a.sync.connect(); const first = await a.sync.sync('both', [note.id]);
  expect(first.uploaded).toBe(0); expect(first.errors.join('')).toContain('草稿');
  await a.sync.sync('both'); const remote = [...c.files.values()].find(f=>f.type==='file')!; c.files.delete(remote.token);
  a.store.update(note.id, {content:'local change'}, 1);
  const result = await a.sync.sync('both'); expect(result.errors.join('')).toContain('本机更改未上传'); expect(a.store.get(note.id).content).toBe('local change');
});

it('persists sync records, marks local changes and missing cloud files, and hides deleted notes', async () => {
  const c=cloud(), a=await device(c.cli); const n=a.store.create({title:'tracked',content:'body'});
  await a.sync.connect(); await a.sync.sync('both');
  expect(a.sync.records()[0]).toMatchObject({id:n.id,title:'tracked',direction:'push',status:'synced',at:expect.any(String)});
  a.store.update(n.id,{content:'edited'},1); expect(a.sync.records()[0].status).toBe('changed');
  await a.sync.sync('both',[n.id]); expect(a.sync.records()[0].status).toBe('error');
  await a.sync.sync('both'); expect(a.sync.records()[0].status).toBe('synced');
  const reopened = new FeishuSync(a.store,a.assets,c.cli); expect(reopened.records()).toEqual(a.sync.records());
  const remote=[...c.files.values()].find(f=>f.type==='file')!; c.files.delete(remote.token);
  await a.sync.sync('pull'); expect(a.sync.records()[0].status).toBe('missing');
  a.store.trash(n.id, a.store.get(n.id).version); expect(a.sync.records()).toEqual([]);
});
it('records imported cloud notes and keeps failed push out of synced status', async () => {
  const c=cloud(), a=await device(c.cli); await a.sync.connect(); const folder=[...c.files.values()][0];
  c.files.set('nativeFile',{token:'nativeFile',name:'from cloud.md',type:'file',parent:folder.token,content:'remote'});
  await a.sync.sync('pull'); const r=a.sync.records()[0]; expect(r).toMatchObject({title:'from cloud',direction:'pull',status:'synced'});
  c.files.get('nativeFile')!.content='remote changed'; await a.sync.sync('push');
  expect(a.sync.records()[0]).toMatchObject({status:'error',error:expect.stringContaining('云端内容已变化')});
});
