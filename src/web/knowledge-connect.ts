import type { Note } from '../shared/model.js';
import { api } from './api.js';

export async function connectKnowledgeNotes(from: string, to: string, request: typeof api = api) {
  if (from === to) throw new Error('不能关联节点自身');
  const [source, target] = await Promise.all([request<Note>(`/notes/${from}`), request<Note>(`/notes/${to}`)]);
  if (source.deletedAt || target.deletedAt || source.archived || target.archived) throw new Error('节点已归档或移入回收站，请刷新后重试');
  if (source.links.includes(to) || target.links.includes(from)) throw new Error('这两个节点已经关联');
  if (source.links.length >= 100) throw new Error('该节点的关联数量已达上限');
  return request<Note>(`/notes/${from}`, 'PATCH', { expectedVersion: source.version, patch: { links: [...source.links, to] } });
}
