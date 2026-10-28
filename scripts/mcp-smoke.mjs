import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp(join(tmpdir(), 'moki-notes-mcp-'));
const client = new Client({ name: 'moki-notes-smoke', version: '1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/server.js')], env: { ...process.env, MOKI_NOTES_DATA: join(dir, 'notes.db') }, stderr: 'pipe' });
const call = async (name, args = {}, error = false) => {
  const result = await client.callTool({ name, arguments: args }); assert.equal(!!result.isError, error, JSON.stringify(result)); return JSON.parse(result.content[0].text);
};
try {
  await client.connect(transport); const tools = await client.listTools(); assert.equal(tools.tools.length, 10);
  const parent = await call('notes_create', { title: 'Agent 记忆树', content: '偏好与项目', tags: ['测试'] });
  const child = await call('notes_create', { title: '用户偏好', parentId: parent.id, content: '用户偏好简洁中文回答。', links: [parent.id] });
  assert.equal((await call('notes_list', { q: '中文' })).total, 1);
  const inspected = await call('notes_read', { id: child.id }); assert.equal(inspected.note.version, 1);
  const updated = await call('notes_update', { id: child.id, expectedVersion: 1, patch: { content: '用户偏好简洁中文回答，附来源。' } });
  assert.equal(updated.version, 2);
  assert.equal((await call('notes_update', { id: child.id, expectedVersion: 1, patch: { content: '覆盖' } }, true)).code, 'VERSION_CONFLICT');
  assert.equal((await call('notes_context', { query: '中文', rootId: parent.id })).sources[0].version, 2);
  assert.equal((await call('notes_tree')).nodes.length, 2);
  assert.equal((await call('notes_history', { id: child.id })).length, 2);
  assert.equal((await call('notes_export', { id: child.id, format: 'docx' })).name, '用户偏好.docx');
  const resources = await client.readResource({ uri: `moki-notes://note/${child.id}` }); assert.match(resources.contents[0].text, /附来源/);
  const deleted = await call('notes_delete', { id: child.id, expectedVersion: 2 }); assert.ok(deleted.deletedAt);
  assert.equal((await call('notes_context', { query: '中文' })).sources.length, 0);
  await call('notes_restore', { id: child.id, expectedVersion: deleted.version });
  assert.equal((await call('notes_read', { id: child.id })).note.deletedAt, null);
  await mkdir('docs/testing', { recursive: true });
  const report = { date: new Date().toISOString(), tools: tools.tools.map(t => t.name), verified: true, checks: ['stdio handshake', 'create tree', 'search', 'read', 'update', 'conflict refusal', 'knowledge context', 'tree resource', 'history', 'docx export', 'delete', 'restore', 'readback'] };
  await writeFile('docs/testing/mcp-smoke.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await client.close(); await transport.close(); await rm(dir, { recursive: true, force: true }); }
