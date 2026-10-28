#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './create-server.js';
import { NotesStore } from '../server/store.js';
import { dataPath } from '../server/paths.js';
import { drainable, listenForInstall } from './install-shutdown.js';
const store = new NotesStore(dataPath()), server = createMcpServer(store);
const requests = drainable(new StdioServerTransport()), transport = requests.transport;
let closed = false, closing: Promise<boolean> | undefined;
async function close(): Promise<boolean> {
  if (closed) return true;
  if (closing) return closing;
  closing = (async () => {
    if (!(await requests.drain())) return false;
    closed = true;
    await server.close(); store.close(); install?.close();
    return true;
  })();
  try { return await closing; } finally { closing = undefined; }
}
const install = listenForInstall(close);
await server.connect(transport);
const previous = transport.onclose;
transport.onclose = () => { previous?.(); void close(); };
process.on('SIGINT', () => void close()); process.on('SIGTERM', () => void close());
process.stdin.once('end', () => void close());
console.error(`MOKI便签 MCP: ${store.path}`);
