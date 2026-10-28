import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { NoteInput, type Note, type NoteData } from '../shared/model.js';
import { assetReferences } from '../shared/asset-references.js';
import { resourceMarkdown } from '../shared/resources.js';
import type { FeishuStatus, SyncDirection, SyncReport, FeishuRecord } from '../shared/feishu.js';
import { NotesStore } from './store.js';
import { Attachments, safeAttachmentName } from './attachments.js';
import type { CliRunner } from './feishu-cli.js';

const Token = z.string().regex(/^[a-zA-Z0-9_-]{5,200}$/);
type Remote = { token: string; name: string; type: string; url?: string; parent_token?: string; modified_time?: string };
type Entry = { id: string; originId?: string; localHash: string; remoteHash: string; type: string; at?: string; direction?: 'push' | 'pull'; missing?: boolean; error?: string };
type AssetLink = { id: string; token: string; name: string; url: string };
type State = { account: string; user: string; folder: string; url: string; entries: Record<string, Entry>; assets: Record<string, AssetLink>; lastSync?: string };
const Metadata = z.object({ id: z.string().uuid(), note: NoteInput.omit({ content: true }), assets: z.array(z.object({ id: z.string().uuid(), token: Token, name: z.string().max(180), url: z.string().url() })).max(10000) }).strict();
const marker = /\n\n<!-- moki-note:v1 ([A-Za-z0-9+/=]+) -->\s*$/;
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const noteHash = (n: Note | NoteData) => hash(NoteInput.parse(Object.fromEntries(Object.keys(NoteInput.shape).map(k => [k, n[k as keyof NoteData]]))));
export function encodeCloudNote(note: Note, content: string, assets: AssetLink[]) {
  const { content: _content, ...data } = NoteInput.parse(Object.fromEntries(Object.keys(NoteInput.shape).map(k => [k, note[k as keyof NoteData]])));
  return `${content}\n\n<!-- moki-note:v1 ${Buffer.from(JSON.stringify({ id: note.id, note: data, assets })).toString('base64')} -->`;
}
export function decodeCloudNote(content: string, name: string) {
  const found = marker.exec(content);
  if (!found) return { content, meta: null, data: NoteInput.parse({ title: name.replace(/\.(md|txt)$/i, '').slice(0, 200) || '飞书便签', content }) };
  const meta = Metadata.parse(JSON.parse(Buffer.from(found[1], 'base64').toString('utf8'))), body = content.slice(0, found.index);
  // A rename in Drive is also a title edit. The UUID suffix is only a stable identity marker.
  const expected = `${safeAttachmentName(meta.note.title).slice(0, 90)}--${meta.id}.md`;
  const title = name === expected ? meta.note.title : name.replace(/--[a-f0-9-]{36}\.md$/i, '').replace(/\.md$/i, '').slice(0, 200);
  return { content: body, meta, data: NoteInput.parse({ ...meta.note, title: title || meta.note.title, content: body }) };
}
export class FeishuSync {
  busy = false;
  constructor(readonly store: NotesStore, readonly assets: Attachments, readonly cli: CliRunner) {}
  private state() { return this.store.preference<State | null>('feishuSync', null); }
  private save(state: State) { this.store.setPreference('feishuSync', state); }
  status(): FeishuStatus { const s = this.state(); return s ? { connected: true, user: s.user, folder: s.folder, url: s.url, lastSync: s.lastSync } : { connected: false }; }
  records(): FeishuRecord[] {
    const state = this.state(); if (!state) return [];
    return Object.entries(state.entries).flatMap(([token, entry]) => {
      const n = this.get(entry.id); if (!n || n.deletedAt) return [];
      return [{ id: n.id, title: n.title, archived: n.archived, at: entry.at ?? state.lastSync, direction: entry.direction,
        url: `https://feishu.cn/${entry.type === 'docx' ? 'docx' : 'file'}/${encodeURIComponent(token)}`,
        status: entry.missing ? 'missing' as const : entry.error ? 'error' as const : noteHash(n) !== entry.localHash ? 'changed' as const : 'synced' as const, error: entry.error }];
    }).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '') || a.title.localeCompare(b.title));
  }
  private async identity() {
    const status = await this.cli(['auth', 'status', '--json', '--verify']); const user = status.identities?.user;
    if (!user?.available || user.verified === false || !user.openId) throw Error('请先登录飞书 CLI 用户身份：lark-cli auth login --domain drive');
    return { account: String(status.appId) + ':' + String(user.openId), user: String(user.userName ?? '飞书用户') };
  }
  private async list(folder: string): Promise<Remote[]> {
    const files: Remote[] = [], pages = new Set<string>(); let page = '';
    do {
      const data = await this.cli(['drive', 'files', 'list', '--as', 'user', '--params', JSON.stringify({ folder_token: folder, page_size: 200, ...(page ? { page_token: page } : {}) })]);
      for (const file of data.files ?? []) { Token.parse(file.token); files.push(file); }
      if (!data.has_more) break;
      if (!data.next_page_token || pages.has(data.next_page_token)) throw Error('飞书分页未完整返回，本次同步停止');
      page = data.next_page_token; pages.add(page);
    } while (page);
    return files;
  }
  async connect(folderToken?: string) {
    if (this.busy) throw Error('正在同步，请稍后再连接');
    const identity = await this.identity(), old = this.state();
    const roots = (await this.list('')).filter(f => f.type === 'folder' && f.name === 'MOKI便签');
    if (folderToken) Token.parse(folderToken);
    if (!folderToken && roots.length > 1) throw Error('云盘中存在多个 MOKI便签 文件夹，请填写要使用的文件夹 token 后连接');
    let folder = roots.find(f => f.token === folderToken) ?? (!folderToken ? roots[0] : undefined);
    if (folderToken && !folder) throw Error('指定 token 必须是云盘根目录中名为 MOKI便签 的文件夹');
    if (!folder) { const result = await this.cli(['drive', '+create-folder', '--name', 'MOKI便签', '--as', 'user']); folder = { token: Token.parse(result.folder_token), name: 'MOKI便签', type: 'folder', url: result.url }; }
    await this.list(folder.token);
    this.save(old?.account === identity.account && old.folder === folder.token ? { ...old, user: identity.user } : { ...identity, folder: folder.token, url: folder.url ?? `https://feishu.cn/drive/folder/${folder.token}`, entries: {}, assets: {} });
    return this.status();
  }
  private async descendants(folder: string) {
    const files: Remote[] = [], queue = [folder], seen = new Set<string>();
    while (queue.length) { const next = queue.shift()!; if (seen.has(next)) continue; seen.add(next);
      for (const file of await this.list(next)) if (file.type === 'folder') { if (file.name !== '_MOKI附件') queue.push(file.token); } else files.push(file); }
    return files;
  }
  private get(id: string): Note | undefined { try { return this.store.get(id); } catch { return undefined; } }
  async sync(direction: SyncDirection, protectedIds: string[] = []): Promise<SyncReport> {
    if (this.busy) throw Error('已有同步正在进行'); this.busy = true;
    const report: SyncReport = { uploaded: 0, downloaded: 0, conflicts: 0, skipped: 0, errors: [], at: new Date().toISOString() };
    let temp = '';
    try {
      temp = await mkdtemp(join(tmpdir(), 'moki-feishu-'));
      const state = this.state(); if (!state) throw Error('请先连接飞书 CLI');
      const identity = await this.identity(); if (identity.account !== state.account) throw Error('CLI 登录帐号已改变，请重新连接，确认使用当前帐号的云盘');
      const remotes = await this.descendants(state.folder), byToken = new Map(remotes.map(r => [r.token, r]));
      for (const [token, entry] of Object.entries(state.entries)) { entry.missing = !byToken.has(token); entry.error = undefined; }
      const pulled: Array<{ token: string; meta: z.infer<typeof Metadata> | null; id: string; version: number }> = [];
      const blocked = new Set(protectedIds), handled = new Set<string>();
      const persist = () => this.save(state);
      // Native files remain editable in Feishu; no cloud deletion is propagated.
      for (const remote of remotes) {
        if (remote.type !== 'file' && remote.type !== 'docx') { report.skipped++; report.errors.push(`${remote.name}：暂不支持 ${remote.type} 类型`); continue; }
        let entry = state.entries[remote.token], current = entry ? this.get(entry.id) : undefined;
        if (entry && (!current || current.deletedAt)) { report.skipped++; continue; }
        if (entry && blocked.has(entry.id)) { entry.error = '本机存在未保存草稿，请保存后同步'; report.skipped++; report.errors.push(`${remote.name}：${entry.error}`); continue; }
        try {
          let raw: string, generic = false;
          if (remote.type === 'docx') { const result = await this.cli(['docs', '+fetch', '--as', 'user', '--doc', remote.token, '--doc-format', 'markdown']); raw = result.document?.content; if (typeof raw !== 'string') throw Error('云文档未返回正文'); }
          else if (/\.md$/i.test(remote.name)) { const result = await this.cli(['markdown', '+fetch', '--as', 'user', '--file-token', remote.token]); raw = result.content; if (typeof raw !== 'string') throw Error('Markdown 未返回正文'); }
          else if (/\.txt$/i.test(remote.name)) { await this.cli(['drive', '+download', '--as', 'user', '--file-token', remote.token, '--output', 'download.txt'], { cwd: temp }); raw = await readFile(join(temp, 'download.txt'), 'utf8'); await rm(join(temp, 'download.txt')); }
          else { raw = JSON.stringify({ token: remote.token, name: remote.name, modified: remote.modified_time }); generic = true; }
          const remoteHash = hash({ name: remote.name, raw });
          const decoded = generic ? { content: '', meta: null, data: NoteInput.parse({ title: remote.name.slice(0, 200) }) } : decodeCloudNote(raw, remote.name);
          if (!entry && decoded.meta) {
            // Recover a create that succeeded remotely before the local mapping was committed.
            const possible = this.get(decoded.meta.id);
            if (possible && !possible.deletedAt) { current = possible; entry = { id: possible.id, originId: possible.id, localHash: '', remoteHash: '', type: remote.type }; }
          }
          if (entry) handled.add(entry.id);
          if (entry && blocked.has(entry.id)) { report.skipped++; report.errors.push(`${remote.name}：存在未保存草稿`); continue; }
          if (entry?.remoteHash === remoteHash) { if (current && noteHash(current) === entry.localHash) report.skipped++; continue; }
          if (direction === 'push') { if (entry) { entry.error = '云端内容已变化，请先拉取或双向同步'; report.errors.push(`${remote.name}：${entry.error}`); } report.skipped++; continue; }
          // Import attachment binaries before updating the note. Failed downloads leave the note untouched.
          if (generic) {
            await this.cli(['drive', '+download', '--as', 'user', '--file-token', remote.token, '--output', 'attachment.bin'], { cwd: temp });
            const { createReadStream } = await import('node:fs'); const info = await this.assets.importStream(remote.name, createReadStream(join(temp, 'attachment.bin')), 2 * 1024 ** 3); await rm(join(temp, 'attachment.bin'));
            decoded.data.content = resourceMarkdown({ id: randomUUID(), kind: 'file', src: info.src, title: info.name, view: 'card' });
          } else for (const a of decoded.meta?.assets ?? []) {
            // Only fetch files from the configured folder's managed attachment subfolder.
            const key = `remote:${a.token}`, known = state.assets[key]; let info;
            if (known) { try { info = await this.assets.get(known.id); } catch { /* Fetch again if purged. */ } }
            if (!info) {
              const attachmentFolder = (await this.list(state.folder)).find(f => f.type === 'folder' && f.name === '_MOKI附件');
              if (!attachmentFolder || !(await this.list(attachmentFolder.token)).some(f => f.type === 'file' && f.token === a.token)) throw Error('附件不在 MOKI便签 的附件目录中');
              await this.cli(['drive', '+download', '--as', 'user', '--file-token', a.token, '--output', 'attachment.bin'], { cwd: temp });
              const { createReadStream } = await import('node:fs'); info = await this.assets.importStream(a.name, createReadStream(join(temp, 'attachment.bin')), 2 * 1024 ** 3); await rm(join(temp, 'attachment.bin'));
              state.assets[key] = { ...a, id: info.id }; persist();
            }
            decoded.data.content = decoded.data.content.replaceAll(a.url, info.src).replaceAll(`/api/assets/${a.id}/content`, info.src);
            decoded.data.source = decoded.data.source.replaceAll(a.url, info.src).replaceAll(`/api/assets/${a.id}/content`, info.src);
          }
          const data = { ...decoded.data, parentId: current?.parentId ?? null, links: current?.links ?? [] };
          // Version guard protects edits made while the CLI was downloading.
          if (current && this.get(current.id)?.version !== current.version) throw Error('下载期间本机便签已变化，本次未覆盖');
          if (current && entry && noteHash(current) !== entry.localHash && noteHash(current) !== noteHash(data)) {
            this.store.create({ ...NoteInput.parse(Object.fromEntries(Object.keys(NoteInput.shape).map(k => [k, current![k as keyof NoteData]]))), title: `${current.title.slice(0, 180)} · 本地冲突副本` }); report.conflicts++;
          }
          const saved = current ? this.store.update(current.id, data, current.version, 'feishu') : this.store.create(data, 'feishu');
          state.entries[remote.token] = { id: saved.id, originId: decoded.meta?.id, localHash: noteHash(saved), remoteHash, type: remote.type, at: new Date().toISOString(), direction: 'pull' };
          pulled.push({ token: remote.token, meta: decoded.meta, id: saved.id, version: saved.version }); handled.add(saved.id); persist(); report.downloaded++;
        } catch (e) { if (entry) entry.error = (e as Error).message; report.errors.push(`${remote.name}：${(e as Error).message}`); }
        finally { await rm(join(temp, 'download.txt'), { force: true }); await rm(join(temp, 'attachment.bin'), { force: true }); }
      }
      // Restore hierarchy only after every remote note has a local identity.
      const origins = new Map(Object.values(state.entries).filter(e => e.originId).map(e => [e.originId!, e.id]));
      for (const p of pulled) if (p.meta) {
        try { const n = this.store.get(p.id);
          if (n.version !== p.version || n.deletedAt) throw Error('关系恢复期间本机便签已变化，已保留本机编辑，请再次同步');
          const parentId = p.meta.note.parentId ? origins.get(p.meta.note.parentId) ?? null : null, links = p.meta.note.links.map(id => origins.get(id)).filter((id): id is string => !!id && id !== n.id);
          const content = n.content.replace(/(\?note=)([a-f0-9-]{36})/g, (_, prefix, id) => prefix + (origins.get(id) ?? id));
          const next = this.store.update(n.id, { parentId, links, content }, n.version, 'feishu'); state.entries[p.token].localHash = noteHash(next); persist();
        } catch (e) { state.entries[p.token].error = (e as Error).message; report.errors.push(`关系同步：${(e as Error).message}`); }
      }
      if (direction !== 'pull') {
        const local = (this.store.db.prepare('SELECT json FROM notes').all() as { json: string }[]).map(r => JSON.parse(r.json) as Note).filter(n => !n.deletedAt);
        for (const n of local) {
          const mapped = Object.entries(state.entries).find(([, e]) => e.id === n.id), token = mapped?.[0], entry = mapped?.[1];
          if (blocked.has(n.id) && !handled.has(n.id)) { report.skipped++; report.errors.push(`${n.title}：存在未保存草稿，请保存后同步`); }
          if (entry && !byToken.has(token!) && entry.localHash !== noteHash(n)) report.errors.push(`${n.title}：云端对应文件已移出同步目录或删除，本机更改未上传；本地内容已保留`);
          if (blocked.has(n.id) || (entry && (entry.localHash === noteHash(n) || !byToken.has(token!))) || (handled.has(n.id) && !entry)) continue;
          if (entry && (entry.type !== 'file' || !/\.md$/i.test(byToken.get(token!)?.name ?? ''))) { report.errors.push(`${n.title}：本地更改尚未推送；飞书原生文档或非 Markdown 文件仅支持拉取`); continue; }
          try {
            if (token && entry) {
              const remote = byToken.get(token!)!, latest = await this.cli(['markdown', '+fetch', '--as', 'user', '--file-token', token]);
              if (hash({ name: latest.file_name ?? remote.name, raw: latest.content }) !== entry.remoteHash) throw Error('云端版本已变化，本次未覆盖，请再次双向同步');
            }
            let content = n.content, source = n.source; const links: AssetLink[] = [];
            const references = assetReferences(n.content + '\n' + n.source).map(id => ({ id, src: `/api/assets/${id}/content`, key: `local:${id}` }));
            for (const src of new Set((n.content + '\n' + n.source).match(/\/demo\/[A-Za-z0-9_-]+\.svg/g) ?? [])) {
              const key = `demo:${src}`, cached = state.assets[key];
              const id = cached?.id ?? (await this.assets.importFile(fileURLToPath(new URL(`../web${src}`, import.meta.url)))).id;
              references.push({ id, src, key });
            }
            for (const { id, src, key } of references) {
              let a = state.assets[key];
              if (!a) {
                const info = await this.assets.get(id), folders = (await this.list(state.folder)).filter(f => f.type === 'folder' && f.name === '_MOKI附件');
                if (folders.length > 1) throw Error('发现重复的附件文件夹，请先整理');
                const folder = folders[0]?.token ?? Token.parse((await this.cli(['drive', '+create-folder', '--as', 'user', '--folder-token', state.folder, '--name', '_MOKI附件'])).folder_token);
                const name = `${id}-${safeAttachmentName(info.name)}`, known = (await this.list(folder)).find(f => f.name === name && f.type === 'file');
                let file = known?.token;
                if (!file) { await copyFile(await this.assets.contentPath(id), join(temp, 'upload.bin')); const result = await this.cli(['drive', '+upload', '--as', 'user', '--folder-token', folder, '--file', 'upload.bin', '--name', name], { cwd: temp }); file = Token.parse(result.file_token); await rm(join(temp, 'upload.bin')); }
                a = { id, token: file, name: info.name, url: known?.url ?? `https://feishu.cn/file/${file}` }; state.assets[key] = a; persist();
              }
              links.push(a); content = content.replaceAll(src, a.url); source = source.replaceAll(src, a.url);
            }
            const originFor = (id: string) => Object.values(state.entries).find(e => e.id === id)?.originId ?? id;
            const portable = { ...n, source, id: entry?.originId ?? n.id, parentId: n.parentId ? originFor(n.parentId) : null, links: n.links.map(originFor) };
            content = content.replace(/(\?note=)([a-f0-9-]{36})/g, (_, prefix, id) => prefix + originFor(id));
            const cloud = encodeCloudNote(portable, content, links), name = `${safeAttachmentName(n.title).slice(0, 90)}--${portable.id}.md`;
            if (this.get(n.id)?.version !== n.version) throw Error('本机内容在上传前发生变化，请重试');
            const result = await this.cli(['markdown', token ? '+overwrite' : '+create', '--as', 'user', ...(token ? ['--file-token', token] : ['--folder-token', state.folder]), '--name', name, '--content', '-'], { input: cloud });
            const savedToken = Token.parse(result.file_token ?? token);
            const verify = await this.cli(['markdown', '+fetch', '--as', 'user', '--file-token', savedToken]); if (verify.content !== cloud) throw Error('上传回读不一致，请重新同步检查');
            // Keep a single current mapping if the provider replaces the file on overwrite.
            // Commit only after readback succeeds; subsequent edits must target the new file.
            if (token && savedToken !== token) delete state.entries[token];
            state.entries[savedToken] = { id: n.id, originId: portable.id, localHash: noteHash(n), remoteHash: hash({ name: verify.file_name ?? name, raw: cloud }), type: 'file', at: new Date().toISOString(), direction: 'push' }; persist(); report.uploaded++;
          } catch (e) { if (entry) entry.error = (e as Error).message; report.errors.push(`${n.title}：${(e as Error).message}`); }
        }
      }
      state.lastSync = report.at; persist(); this.store.setPreference('feishuLastReport', report); return report;
    } finally { this.busy = false; if (temp) await rm(temp, { recursive: true, force: true }); }
  }
}
