import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const root=resolve('.'), current=resolve(process.argv[2] ?? 'release-installer-2026-10-28-install-mcp/win-unpacked');
const legacy=resolve('release-installer-2026-10-28-install-save/win-unpacked');
const other=resolve('release-installer-2026-10-28-responsive-density/win-unpacked');
const db=join(root,`.smoke/install-mcp-${Date.now()}.db`), opened=[], evidence={};
assert(current.startsWith(root+'\\release-installer-')); // Never target the real installation.
await mkdir(join(root,'docs/testing/install-mcp'),{recursive:true});
function run(mode,dir) {
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',join(root,'build/installer-process.ps1'),'-InstallDirectory',dir,'-Mode',mode],{windowsHide:true});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    child.once('error',reject);child.once('exit',code=>resolve({code,output}));
  });
}
async function open(dir){
  const transport=new StdioClientTransport({command:join(dir,'MOKI-Notes.exe'),args:[join(dir,'resources/app.asar/dist/mcp/server.js')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',MOKI_NOTES_DATA:db},stderr:'pipe'});
  const client=new Client({name:'install-mcp-qa',version:'1'});await client.connect(transport);
  const result={client,transport,pid:transport.pid};opened.push(result);return result;
}
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const call=async(client,name,args)=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
try{
  const sibling=await open(other), a=await open(current), b=await open(current);
  const note=await call(a.client,'notes_create',{title:'安装 MCP 持久化验证',content:'正在连接的 Agent 不能阻塞更新'});
  const updated=await call(b.client,'notes_update',{id:note.id,expectedVersion:note.version,patch:{content:'保存完成后平滑退出 MCP'}});
  evidence.currentCheck=await run('check',current);assert.equal(evidence.currentCheck.code,11);
  evidence.currentQuit=await run('quit',current);assert.equal(evidence.currentQuit.code,0,evidence.currentQuit.output);
  assert(!alive(a.pid)&&!alive(b.pid),'Both matching MCP processes must exit without client.close');
  assert(alive(sibling.pid),'Sibling install must remain running');
  const reader=new DatabaseSync(db,{readOnly:true});
  const actual=JSON.parse(reader.prepare('SELECT json FROM notes WHERE id=?').get(note.id).json);
  assert.equal(actual.content,updated.content);assert.equal(reader.prepare('PRAGMA quick_check').get().quick_check,'ok');reader.close();
  evidence.persisted={id:actual.id,version:actual.version,content:actual.content};
  const old=await open(legacy);
  const started=Date.now();evidence.legacyQuit=await run('quit',legacy);evidence.legacyQuit.elapsedMs=Date.now()-started;
  assert.equal(evidence.legacyQuit.code,30);assert(alive(old.pid),'Legacy process requires separate consent');
  evidence.legacyConsent=await run('stop-legacy-mcp',legacy);assert.equal(evidence.legacyConsent.code,0,evidence.legacyConsent.output);
  assert(!alive(old.pid));assert(alive(sibling.pid));
  const ending=await open(current);await ending.client.close();
  await new Promise(r=>setTimeout(r,200));assert(!alive(ending.pid),'Closing Agent connection must not leave background process');
  evidence.siblingPreserved=true;evidence.clientDisconnectCleanup=true;evidence.verified=true;
  await writeFile('docs/testing/install-mcp/audit.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await Promise.all(opened.map(async x=>{await x.client.close();await x.transport.close();}));}
