import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotesStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import { moveGraphPoint } from '../src/shared/graph-position.js';

describe('knowledge graph node positioning', () => {
  it('converts screen movement at any zoom without depending on pan and bounds coordinates', () => {
    expect(moveGraphPoint({ x: 80, y: -20 }, 60, -40, 2)).toEqual({ x: 200, y: -100 });
    expect(moveGraphPoint({ x: 80, y: -20 }, 60, -40, .5)).toEqual({ x: 110, y: -40 });
    expect(moveGraphPoint({ x: 99990, y: -99990 }, 100, -100, 2)).toEqual({ x: 100000, y: -100000 });
  });
  it('persists independent node moves across connections without changing notes or relations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-position-')), path = join(dir, 'notes.db'); let a = new NotesStore(path); const b = new NotesStore(path);
    try {
      const root = a.create({ title: 'Root' }), child = a.create({ title: 'Child', parentId: root.id, links: [root.id] });
      a.setGraphPosition(root.id, { x: 220, y: 90 }); b.setGraphPosition(child.id, { x: -10, y: 140 });
      expect(a.get(root.id)).toEqual(root); expect(a.get(child.id)).toEqual(child); expect(a.history(child.id)).toHaveLength(1);
      a.close(); a = new NotesStore(path);
      expect(a.graphPositions()).toEqual({ [root.id]: { x: 220, y: 90 }, [child.id]: { x: -10, y: 140 } });
      a.setGraphPosition(root.id, null); expect(b.graphPositions()).toEqual({ [child.id]: { x: -10, y: 140 } });
    } finally { a.close(); b.close(); rmSync(dir, { force: true, recursive: true }); }
  });
  it('validates API positions and rejects inactive or missing nodes atomically', async () => {
    const store = new NotesStore(':memory:'), app = await createApp(store);
    try {
      const n = store.create({ title: 'Node' }), url = `/api/notes/${n.id}/position`;
      expect((await app.inject({ method: 'PUT', url, payload: { position: { x: 20, y: 40 } } })).statusCode).toBe(200);
      for (const position of [{ x: 100001, y: 0 }, { x: 'bad', y: 0 }, { x: 1 }, { x: 0, y: 0, title: 'No' }]) expect((await app.inject({ method: 'PUT', url, payload: { position } })).statusCode).toBe(400);
      store.trash(n.id, n.version);
      expect((await app.inject({ method: 'PUT', url, payload: { position: { x: 30, y: 40 } } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'GET', url: '/api/knowledge/positions' })).json()).toEqual({ [n.id]: { x: 20, y: 40 } });
      expect(() => store.setGraphPosition('missing', { x: 0, y: 0 })).toThrow('不存在');
    } finally { await app.close(); store.close(); }
  });
});
