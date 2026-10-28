import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotesStore } from '../src/server/store.js';
const stores: NotesStore[] = [];
function store(path = ':memory:') { const s = new NotesStore(path); stores.push(s); return s; }
afterEach(() => { stores.splice(0).forEach(s => s.close()); });
describe('notes and memory tree', () => {
  it('persists notes, metadata and history across two connections; rejects stale writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-notes-'));
    try {
      const a = store(join(dir, 'notes.db')), b = store(join(dir, 'notes.db'));
      const n = a.create({ title: '设计资料', content: '便签正文', color: 'mint', tags: ['项目', '项目'] });
      const updated = b.update(n.id, { content: 'Agent 更新' }, n.version, 'mcp-agent');
      expect(a.get(n.id).content).toBe('Agent 更新');
      expect(a.get(n.id).tags).toEqual(['项目']);
      expect(() => a.update(n.id, { content: '旧窗口' }, n.version)).toThrow('其他窗口');
      expect(a.revision(n.id, 1).content).toBe('便签正文');
      expect(a.history(n.id)).toHaveLength(2);
      expect(updated.version).toBe(2);
    } finally { stores.splice(0).forEach(s => s.close()); rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects cycles and missing links without partial changes', () => {
    const s = store(), root = s.create({ title: '根节点' }), child = s.create({ title: '子节点', parentId: root.id });
    expect(() => s.update(root.id, { parentId: child.id }, 1)).toThrow('子节点');
    expect(s.get(root.id).parentId).toBeNull(); expect(s.get(root.id).version).toBe(1);
    expect(() => s.update(child.id, { links: ['00000000-0000-4000-8000-000000000000'] }, 1)).toThrow('不存在');
    s.update(child.id, { links: [root.id] }, 1);
    expect(s.backlinks(root.id).map(n => n.id)).toEqual([child.id]);
  });
  it('trash is reversible, does not delete descendants and prevents dangling references on purge', () => {
    const s = store(), root = s.create({ title: 'root' }), child = s.create({ title: 'child', parentId: root.id });
    const trashed = s.trash(root.id, 1);
    expect(s.list().items.map(n => n.id)).toEqual([child.id]);
    expect(s.tree()[0].parentId).toBeNull();
    s.purge(root.id, trashed.version);
    expect(s.get(child.id).parentId).toBeNull();
    const t = s.trash(child.id, s.get(child.id).version); s.purge(child.id, t.version);
    expect(() => s.get(child.id)).toThrow('不存在');
  });
  it('queries Chinese content and filters archive, tags, stars, and pages', () => {
    const s = store();
    s.create({ title: '一', content: '品牌设计方案', tags: ['设计'], starred: true });
    s.create({ title: '二', content: '品牌设计方案', archived: true });
    s.create({ title: '三', content: '其他内容' });
    expect(s.list({ q: '品牌 设计', tag: '设计' }).total).toBe(1);
    expect(s.list({ status: 'archived' }).total).toBe(1);
    expect(s.list({ limit: 1 }).items).toHaveLength(1);
    expect(s.list({ limit: 1, offset: 1 }).items[0].title).toBe('三');
    expect(s.list({ starred: true }).items[0].title).toBe('一');
  });
  it('retrieves scoped, bounded, cited knowledge with keyword excerpts and privacy exclusions', () => {
    const s = store(), root = s.create({ title: '项目' });
    const n = s.create({ title: '细节', parentId: root.id, content: 'x'.repeat(8000) + '品牌色 #625bc5' + '尾'.repeat(2000) });
    s.create({ title: '品牌色 已归档', archived: true }); s.create({ title: '品牌色 私人', knowledge: false });
    const removed = s.create({ title: '品牌色 删除' }); s.trash(removed.id, 1);
    s.create({ title: '其他项目的品牌色' });
    const result = s.context('品牌色', root.id, 500);
    expect(result.sources).toHaveLength(1); expect(result.sources[0].id).toBe(n.id);
    expect(result.sources[0].text).toContain('#625bc5'); expect(result.usedChars).toBeLessThanOrEqual(500);
    expect(result.sources[0].truncated).toBe(true); expect(result.sources[0].uri).toBe(`moki-notes://note/${n.id}`);
    expect(s.context('品牌色').sources).toHaveLength(2);
  });
});
