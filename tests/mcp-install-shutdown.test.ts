import { expect, it } from 'vitest';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { drainable } from '../src/mcp/install-shutdown.js';

it('drains an in-flight operation and its response before allowing installation', async () => {
  const sent: unknown[] = []; let flush!: () => void;
  const inner: Transport = { start: async () => {}, close: async () => {}, send: async m => {
    sent.push(m); if ('result' in m) await new Promise<void>(resolve => { flush = resolve; });
  } };
  const controlled = drainable(inner); const received: unknown[] = [];
  controlled.transport.onmessage = message => { received.push(message); };
  await controlled.transport.start();
  inner.onmessage?.({ jsonrpc: '2.0', id: 1, method: 'tools/call' });
  let done = false; const waiting = controlled.drain().then(result => { done = result; return result; });
  inner.onmessage?.({ jsonrpc: '2.0', id: 2, method: 'tools/call' });
  expect(received).toHaveLength(1); expect(sent).toMatchObject([{ id: 2, error: { code: -32000 } }]);
  const response = controlled.transport.send({ jsonrpc: '2.0', id: 1, result: { saved: true } });
  expect(done).toBe(false); flush(); await response;
  expect(await waiting).toBe(true);
});

it('keeps a busy MCP available when install drain times out', async () => {
  const inner: Transport = { start: async () => {}, close: async () => {}, send: async () => {} };
  const controlled = drainable(inner); let count = 0;
  controlled.transport.onmessage = () => { count++; }; await controlled.transport.start();
  inner.onmessage?.({ jsonrpc: '2.0', id: 'slow', method: 'tools/call' });
  expect(await controlled.drain(1)).toBe(false);
  inner.onmessage?.({ jsonrpc: '2.0', id: 'next', method: 'tools/call' });
  expect(count).toBe(2);
  await controlled.transport.send({ jsonrpc: '2.0', id: 'slow', result: {} });
  await controlled.transport.send({ jsonrpc: '2.0', id: 'next', error: { code: -32602, message: 'invalid input' } });
  expect(await controlled.drain(1)).toBe(true);
});
