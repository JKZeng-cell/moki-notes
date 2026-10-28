import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const port = process.env.MOKI_NOTES_VERIFY_PORT ?? '4338';
const config = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
const spec = config.mcp.mcpServers['moki-notes'];
assert.match(config.dataPath, /[\\/]\.smoke[\\/]/, 'Only run this verifier against an isolated .smoke database');
const client = new Client({ name: 'packaged-notes-verifier', version: '1.0' });
const transport = new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...process.env, ...spec.env }, stderr: 'pipe' });
let stderr = ''; transport.stderr?.on('data', bytes => { stderr += bytes.toString(); });
const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); };
try {
  await client.connect(transport);
  const list = await client.listTools(); assert.equal(list.tools.length, 10);
  const n = await call('notes_create', { title: 'Agent 知识卡片', content: '## 长期记忆\n\n用户偏好：简洁中文、明确来源。\n\n## 项目约定\n\n- 记录可验证的事实\n- 修改前读取版本\n- 保留原有资料\n', tags: ['Agent', '记忆'], color: 'violet' });
  const update = await call('notes_update', { id: n.id, expectedVersion: n.version, patch: { source: '打包客户端 MCP 实际读写验证' } });
  const read = await call('notes_read', { id: n.id }); assert.equal(read.note.version, update.version); assert.deepEqual(read.note.tags, ['Agent', '记忆']);
  const context = await call('notes_context', { query: '长期记忆' }); assert.ok(context.sources.some(s => s.id === n.id));
  const resource = await client.readResource({ uri: 'moki-notes://tree' }); assert.ok(resource.contents.length);
  const viaHttp = await (await fetch(`http://127.0.0.1:${port}/api/notes/${n.id}`)).json(); assert.equal(viaHttp.version, read.note.version);
  await mkdir('docs/testing', { recursive: true });
  const report = { verified: true, packagedCommand: spec.command, entry: spec.args[0], tools: list.tools.length, noteId: n.id, version: update.version, httpReadback: true, resource: true };
  await writeFile('docs/testing/packaged-mcp.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) { console.error(stderr); throw error; }
finally { await client.close(); await transport.close(); }
