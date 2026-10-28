import { describe, expect, it } from 'vitest';
import { connectionJson, connectionPrompt, type McpConnection } from '../src/shared/mcp-connection.js';

function config(command: string, args: string[], env: Record<string, string>): McpConnection {
  return { dataPath: env.MOKI_NOTES_DATA, mcp: { mcpServers: { 'moki-notes': { command, args, env } } } };
}
describe('copyable MCP connection', () => {
  it('preserves packaged executable paths, spaces, Chinese and required Electron environment', () => {
    const value = config('C:\\Apps\\MOKI 便签\\MOKI-Notes.exe', ['C:\\Apps\\MOKI 便签\\resources\\app.asar\\dist\\mcp\\server.js'], { ELECTRON_RUN_AS_NODE: '1', MOKI_NOTES_DATA: 'C:\\Users\\测试用户\\便签 数据\\notes.db' });
    expect(JSON.parse(connectionJson(value))).toEqual(value.mcp);
    const prompt = connectionPrompt(value), block = prompt.match(/```json\n([\s\S]*?)\n```/);
    expect(JSON.parse(block![1])).toEqual(value.mcp);
    expect(prompt).toContain('不要直接覆盖整份配置');
    expect(prompt).toContain('notes_list（limit: 3）');
    expect(prompt).toContain('不要声称已经连接');
    expect(prompt).toContain('不要为测试连接创建、修改或删除便签');
  });
  it('uses actual Node configuration without adding Electron flags or rewriting arguments', () => {
    const value = config('/opt/node/bin/node', ['/home/test/MOKI Notes/dist/mcp/server.js'], { MOKI_NOTES_DATA: '/home/test/data/notes.db' });
    expect(connectionPrompt(value)).not.toContain('ELECTRON_RUN_AS_NODE');
    expect(JSON.parse(connectionJson(value)).mcpServers['moki-notes'].args).toEqual(value.mcp.mcpServers['moki-notes'].args);
  });
});
