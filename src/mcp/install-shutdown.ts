import { createServer } from 'node:net';
import { resolve } from 'node:path';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

// Track requests until their responses have been flushed, including async exports.
// During installation reject new requests instead of closing SQLite mid-operation.
export function drainable(transport: Transport) {
  const active = new Set<string | number>();
  let stopping = false;
  const wrapper: Transport = {
    async start() {
      transport.onmessage = (message, extra) => {
        if ('method' in message && 'id' in message) {
          if (stopping) {
            void transport.send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'MOKI便签正在安装更新，请更新完成后重新连接。' } });
            return;
          }
          active.add(message.id);
        }
        wrapper.onmessage?.(message, extra);
      };
      transport.onclose = () => wrapper.onclose?.();
      transport.onerror = error => wrapper.onerror?.(error);
      await transport.start();
    },
    async send(message, options) {
      await transport.send(message, options);
      if ('id' in message && message.id !== undefined && !('method' in message)) active.delete(message.id);
    },
    close: () => transport.close(),
  };
  return {
    transport: wrapper,
    async drain(timeout = 30000) {
      stopping = true;
      const until = Date.now() + timeout;
      while (active.size && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
      if (active.size) { stopping = false; return false; }
      return true;
    },
  };
}

export function installPipeName(pid: number) { return `\\\\.\\pipe\\moki-notes-mcp-install-${pid}`; }
export function listenForInstall(close: () => Promise<boolean>) {
  if (process.platform !== 'win32') return undefined;
  const listener = createServer(socket => {
    socket.setEncoding('utf8'); socket.setTimeout(35000, () => socket.destroy());
    socket.on('error', () => {});
    let input = '', handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      input += chunk;
      if (input.length > 8192) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      handled = true;
      void (async () => {
        try {
          const request = JSON.parse(input.trim());
          if (request.action !== 'prepare-install' || typeof request.executable !== 'string' || resolve(request.executable).toLowerCase() !== resolve(process.execPath).toLowerCase()) throw Error('Wrong executable');
          const ready = await close();
          socket.end(JSON.stringify({ status: ready ? 'closed' : 'busy' }) + '\n');
        } catch { socket.end('{"status":"failed"}\n'); }
      })();
    });
  });
  listener.on('error', error => console.error('MCP 安装退出通道不可用:', error.message));
  listener.listen(installPipeName(process.pid));
  return listener;
}
