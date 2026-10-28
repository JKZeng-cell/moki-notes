import { describe, expect, it } from 'vitest';
import { knowledgeEdges, knowledgeLayout, zoomKnowledgeAt, scaleKnowledgeZoom, knowledgeZoomLabel, MAX_KNOWLEDGE_ZOOM, MIN_KNOWLEDGE_ZOOM } from '../src/web/knowledge-model.js';
import type { NoteSummary } from '../src/shared/model.js';
const n = (id: string, parentId: string | null = null, links: string[] = []) => ({ id, parentId, links } as NoteSummary);
describe('knowledge tree graph', () => {
  it('keeps the pointer world position fixed while zooming in a non-square, panned canvas', () => {
    const bounds = { left: 200, top: 100, width: 800, height: 400 }, pointer = { x: 740, y: 220 };
    const before = { zoom: 1.3, pan: { x: 40, y: -70 } };
    const after = zoomKnowledgeAt(before, 500, bounds, pointer, -120);
    const world = (c: typeof before) => ({ x: c.pan.x + (pointer.x - bounds.left - bounds.width / 2) * 1000 / c.zoom / 400, y: c.pan.y + (pointer.y - bounds.top - bounds.height / 2) * 1000 / c.zoom / 400 });
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(world(after).x).toBeCloseTo(world(before).x, 10); expect(world(after).y).toBeCloseTo(world(before).y, 10);
  });
  it('clamps wheel zoom without pan drift at either limit and ignores zero-sized canvases', () => {
    const bounds = { left: 0, top: 0, width: 400, height: 700 }, p = { x: 320, y: 240 };
    const max = { zoom: MAX_KNOWLEDGE_ZOOM, pan: { x: 12, y: 30 } }, min = { ...max, zoom: MIN_KNOWLEDGE_ZOOM };
    expect(zoomKnowledgeAt(max, 300, bounds, p, -1000)).toBe(max);
    expect(zoomKnowledgeAt(min, 300, bounds, p, 1000)).toBe(min);
    expect(zoomKnowledgeAt(max, 300, { ...bounds, width: 0 }, p, 120)).toBe(max);
  });
  it('zooms continuously beyond the old limits and reverses a fine wheel movement', () => {
    const bounds = { left: 15, top: 30, width: 720, height: 400 }, pointer = { x: 204, y: 321 };
    const camera = { zoom: 4, pan: { x: 100, y: -400 } };
    const bigger = zoomKnowledgeAt(camera, 800, bounds, pointer, -.5);
    expect(bigger.zoom).toBeGreaterThan(4);
    expect(bigger.zoom).toBeLessThan(4.01);
    const restored = zoomKnowledgeAt(bigger, 800, bounds, pointer, .5);
    expect(restored.zoom).toBeCloseTo(camera.zoom, 10);
    expect(restored.pan.x).toBeCloseTo(camera.pan.x, 10);
    expect(restored.pan.y).toBeCloseTo(camera.pan.y, 10);
    expect(scaleKnowledgeZoom(.35, .8)).toBeLessThan(.35);
    expect(knowledgeZoomLabel(MIN_KNOWLEDGE_ZOOM)).toBe('0.01%');
  });
  it('keeps explicit directional relations, filters missing/self links and deduplicates links', () => {
    expect(knowledgeEdges([n('a', null, ['b', 'b', 'a', 'gone']), n('b', 'a', ['a']), n('c', 'gone')])).toEqual([
      { from: 'a', to: 'b', kind: 'link' }, { from: 'a', to: 'b', kind: 'parent' }, { from: 'b', to: 'a', kind: 'link' },
    ]);
  });
  it('lays out disconnected and connected notes deterministically without changing stored nodes', () => {
    const nodes = [n('a'), n('b','a'), n('c')], before = JSON.stringify(nodes), edges = knowledgeEdges(nodes);
    const p = knowledgeLayout(nodes, edges);
    expect(p).toEqual(knowledgeLayout([...nodes].reverse(), edges)); expect(p.size).toBe(3);
    expect([...p.values()].every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y))).toBe(true);
    expect(JSON.stringify(nodes)).toBe(before);
  });
});
