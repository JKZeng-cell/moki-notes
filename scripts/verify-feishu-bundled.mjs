// Explicit live acceptance: two useful sample notes in the user's MOKI便签
// folder, isolated local databases, no deletion and no bulk user-data upload.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { resolve, join } from 'node:path';
import { NotesStore } from '../dist/server/store.js';
import { Attachments } from '../dist/server/attachments.js';
import { FeishuSync } from '../dist/server/feishu-sync.js';
import { makeCliRunner } from '../dist/server/feishu-cli.js';
const root = resolve(import.meta.dirname, '..');
const base = join(root, '.smoke', 'feishu-bundled-live');
await mkdir(base, { recursive: true });
const binary = process.env.MOKI_FEISHU_TEST_CLI || join(root, 'vendor/feishu-cli/win32-x64/lark-cli.exe');
const cli = makeCliRunner(binary, { cwd: base });
function device(name) { const store = new NotesStore(join(base, `${name}.db`)); const assets = new Attachments(join(base, `${name}.assets`)); return {store, assets, sync:new FeishuSync(store, assets, cli)}; }
const a = device('device-a'), b = device('device-b');
const check = (value, message) => { if (!value) throw Error(message); };
const report = {};
async function sync(device, direction, stage) {
  const result = await device.sync.sync(direction); report[stage] = result;
  console.log(stage, JSON.stringify(result)); check(result.errors.length === 0, `${stage}: ${result.errors.join(';')}`); return result;
}
try {
  report.connection = await a.sync.connect(); await sync(a,'pull','initialPull');
  const existing = a.store.list({status:'all'}).items;
  let parent = existing.find(n=>n.title==='内置飞书同步 · 验收与使用说明');
  if (!parent) parent = a.store.create({title:'内置飞书同步 · 验收与使用说明',tags:['飞书同步','使用指南'],content:'# 内置飞书同步 ☁️\n\n安装 MOKI便签后即可使用内置 CLI，无需安装 Node.js。\n\n1. 在设置中登录飞书并连接云盘。\n2. 保存便签后选择双向同步。\n3. 在另一台设备登录同一帐号并拉取。\n\n| 能力 | 支持 |\n| --- | --- |\n| 正文、标签与知识树 | ✅ |\n| 图片与附件 | ✅ |\n| 冲突保留副本 | ✅ |\n\n> 删除不在两端传播；同步前请先保存草稿。'});
  const attachmentText = 'MOKI便签内置 CLI 同步附件验收\n中文、Emoji 🌱 与 Markdown 均可同步。\n';
  let child = existing.find(n=>n.title==='附件与知识树同步示例');
  if (!child) {
    const file = await a.assets.importStream('同步说明.txt', Readable.from([attachmentText]));
    child = a.store.create({title:'附件与知识树同步示例',parentId:parent.id,links:[parent.id],tags:['飞书同步'],content:`# 附件与知识树 🌳\n\n[同步说明.txt](${file.src})\n\n[返回使用说明](/?note=${parent.id})\n\n- [x] 保留父子关系\n- [x] 保留关联便签\n- [x] 附件可以跨设备打开\n`});
  }
  await sync(a,'both','pushSamples');
  await b.sync.connect(); await sync(b,'pull','secondDevicePull');
  let bp = b.store.list({status:'all'}).items.find(n=>n.title===parent.title);
  let bc = b.store.list({status:'all'}).items.find(n=>n.title===child.title);
  check(bp && bc && bc.parentId===bp.id && bc.links.includes(bp.id),'Cross-device hierarchy mismatch');
  bc = b.store.get(bc.id); const assetId = /\/api\/assets\/([^/]+)\/content/.exec(bc.content)?.[1];
  check(assetId, 'Missing downloaded attachment');
  check((await readFile(await b.assets.contentPath(assetId),'utf8'))===attachmentText,'Attachment bytes changed');
  check(bc.content.includes(`?note=${bp.id}`),'Note link was not remapped');
  const revisionText = '\n\n**另一台设备的更新已同步。**';
  if (!bc.content.includes(revisionText)) bc=b.store.update(bc.id,{content:bc.content+revisionText},bc.version);
  await sync(b,'both','secondDevicePush'); await sync(a,'pull','firstDeviceReadback');
  check(a.store.get(child.id).content.includes(revisionText),'Remote update not returned');
  const before=a.store.list({status:'all'}).total;
  const repeated=await sync(a,'both','repeatedSync');
  check(repeated.uploaded===0 && repeated.downloaded===0 && a.store.list({status:'all'}).total===before,'Repeated sync created work or duplicates');
  Object.assign(report,{binary,attachmentVerified:true,relationshipsVerified:true,noteLinkVerified:true,remoteUpdateVerified:true,repeatNoDuplicates:true,localNotes:before});
  report.binarySha256=createHash('sha256').update(await readFile(binary)).digest('hex');
  await writeFile(join(root,'docs/testing/feishu-bundled-live-audit.json'),JSON.stringify(report,null,2)+'\n');
} finally { a.store.close(); b.store.close(); }
