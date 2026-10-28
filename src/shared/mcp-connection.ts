export type McpService = { command: string; args: string[]; env: Record<string, string> };
export type McpConnection = { dataPath: string; mcp: { mcpServers: { 'moki-notes': McpService } } };

export function connectionJson(config: McpConnection) {
  return JSON.stringify(config.mcp, null, 2);
}

export function connectionPrompt(config: McpConnection) {
  return `请帮我将本机的 MOKI便签连接到你当前使用的 Agent 客户端，作为可检索的知识树与记忆库。

连接方式：本地 MCP stdio。服务名称：moki-notes。
以下是本机应用生成的实际配置，请原样使用 command、args 和 env（包括路径中的空格与中文），不要替换为示例路径，也不要当作 HTTP 地址：

\`\`\`json
${connectionJson(config)}
\`\`\`

请按以下步骤完成：
1. 检查当前客户端是否支持本地 stdio MCP，以及你是否可以修改它的 MCP 配置。
2. 如果可以，按当前客户端要求的格式合并此服务，保留其他已有 MCP 服务；不要直接覆盖整份配置。已有同名服务时先核对其配置，避免重复添加。
3. 如果客户端需要重新加载或重启才能发现工具，请告诉我具体操作。若你无法修改配置或当前环境无法访问这些本机路径，请明确说明，并给我适用于当前客户端的手动添加步骤；不要声称已经连接。
4. 加载后先列出工具，确认存在 notes_list、notes_read、notes_create、notes_update、notes_tree 和 notes_context，再调用 notes_list（limit: 3）做只读连通性验证。不要为测试连接创建、修改或删除便签。
5. 返回实际连接结果和失败原因（如有）。连接成功后，知识查询优先使用 notes_context；修改便签前先 notes_read，并使用 expectedVersion 更新，避免覆盖新版本。

便签数据位于 ${config.dataPath}。请通过 MCP 工具访问，不直接编辑数据库文件。`;
}
