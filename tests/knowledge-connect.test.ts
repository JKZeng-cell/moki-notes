// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { connectKnowledgeNotes } from '../src/web/knowledge-connect.js';
import type { api } from '../src/web/api.js';

const note = (id: string, extra = {}) => ({ id, links: [], version: 8, deletedAt: null, archived: false, ...extra });
it('reads current versions and adds a link without overwriting existing relations or content', async () => {
  const source = note('a', { links: ['existing'], content: 'untouched' }), target = note('b');
  const request = vi.fn(async (path: string, method?: string) => method === 'PATCH' ? { ...source, links: ['existing', 'b'], version: 9 } : path === '/notes/a' ? source : target);
  const result = await connectKnowledgeNotes('a', 'b', request as typeof api);
  expect(request).toHaveBeenCalledWith('/notes/a', 'PATCH', { expectedVersion: 8, patch: { links: ['existing', 'b'] } });
  expect(result.version).toBe(9); expect(source.links).toEqual(['existing']);
});
it('does not write self, duplicate, reverse duplicate, unavailable or full targets', async () => {
  for (const [source, target, message] of [
    [note('a'), note('a'), '自身'],
    [note('a', { links: ['b'] }), note('b'), '已经关联'],
    [note('a'), note('b', { links: ['a'] }), '已经关联'],
    [note('a', { archived: true }), note('b'), '归档'],
    [note('a'), note('b', { deletedAt: 'now' }), '回收站'],
    [note('a', { links: Array.from({ length: 100 }, (_, i) => String(i)) }), note('b'), '上限'],
  ] as const) {
    const request = vi.fn(async (path: string) => path === '/notes/a' ? source : target);
    await expect(connectKnowledgeNotes(source.id, target.id, request as typeof api)).rejects.toThrow(message);
    expect(request.mock.calls.every(args => args.length === 1)).toBe(true);
  }
});
it('surfaces a concurrent version conflict without retrying a stale overwrite', async () => {
  const request = vi.fn(async (path: string, method?: string) => {
    if (method === 'PATCH') throw new Error('版本冲突');
    return note(path === '/notes/a' ? 'a' : 'b');
  });
  await expect(connectKnowledgeNotes('a', 'b', request as typeof api)).rejects.toThrow('版本冲突');
  expect(request.mock.calls.filter(args => args[1] === 'PATCH')).toHaveLength(1);
});
