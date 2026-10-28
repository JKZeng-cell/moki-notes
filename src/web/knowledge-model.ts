import type { NoteSummary } from '../shared/model.js';
export type KnowledgeEdge = { from: string; to: string; kind: 'parent' | 'link' };
export type KnowledgeCamera = { zoom: number; pan: { x: number; y: number } };
// Numerical guardrails only: continuous zoom, without the former 35%–400% UI limits.
export const MIN_KNOWLEDGE_ZOOM = 1e-4;
export const MAX_KNOWLEDGE_ZOOM = 1e4;
export function scaleKnowledgeZoom(zoom: number, factor: number) {
  return Math.max(MIN_KNOWLEDGE_ZOOM, Math.min(MAX_KNOWLEDGE_ZOOM, zoom * factor));
}
export function knowledgeZoomLabel(zoom: number) {
  const percent = zoom * 100;
  return `${Number(percent.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}
export function zoomKnowledgeAt(camera: KnowledgeCamera, extent: number, bounds: { left: number; top: number; width: number; height: number }, pointer: { x: number; y: number }, delta: number): KnowledgeCamera {
  const size = Math.min(bounds.width, bounds.height);
  if (size <= 0 || !Number.isFinite(delta)) return camera;
  const zoom = scaleKnowledgeZoom(camera.zoom, Math.exp(-Math.max(-240, Math.min(240, delta)) * .002));
  if (zoom === camera.zoom) return camera;
  // SVG uses a square viewBox with xMidYMid meet. Account for its centered
  // letterboxing so the world point beneath the pointer stays fixed.
  const shift = (extent * 2 / camera.zoom - extent * 2 / zoom) / size;
  return { zoom, pan: { x: camera.pan.x + (pointer.x - bounds.left - bounds.width / 2) * shift, y: camera.pan.y + (pointer.y - bounds.top - bounds.height / 2) * shift } };
}
export function knowledgeEdges(nodes: NoteSummary[]): KnowledgeEdge[] {
  const ids = new Set(nodes.map(n => n.id));
  const edges: KnowledgeEdge[] = [];
  for (const n of nodes) {
    if (n.parentId && n.parentId !== n.id && ids.has(n.parentId)) edges.push({ from: n.parentId, to: n.id, kind: 'parent' });
    for (const id of new Set(n.links)) if (id !== n.id && ids.has(id)) edges.push({ from: n.id, to: id, kind: 'link' });
  }
  return edges;
}
export function knowledgeLayout(nodes: NoteSummary[], edges: KnowledgeEdge[]) {
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const points = new Map(sorted.map((n, i) => { const angle = i * 2.399963; const radius = 90 * Math.sqrt(i + 1); return [n.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }]; }));
  // Deterministic, bounded force layout. Isolated notes remain visible and no
  // implied semantic links are invented by the layout.
  for (let step = 0; step < 100; step++) {
    const force = new Map(sorted.map(n => [n.id, { x: 0, y: 0 }]));
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
      const a = points.get(sorted[i].id)!, b = points.get(sorted[j].id)!;
      const dx = a.x - b.x, dy = a.y - b.y, d = Math.max(20, Math.hypot(dx, dy));
      const f = Math.min(28, 17000 / (d * d)); const fa = force.get(sorted[i].id)!, fb = force.get(sorted[j].id)!;
      fa.x += dx / d * f; fa.y += dy / d * f; fb.x -= dx / d * f; fb.y -= dy / d * f;
    }
    for (const e of edges) {
      const a = points.get(e.from), b = points.get(e.to); if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy)), f = (d - 230) * .025;
      force.get(e.from)!.x += dx / d * f; force.get(e.from)!.y += dy / d * f; force.get(e.to)!.x -= dx / d * f; force.get(e.to)!.y -= dy / d * f;
    }
    for (const n of sorted) { const p = points.get(n.id)!, f = force.get(n.id)!; p.x += Math.max(-15, Math.min(15, f.x - p.x * .002)); p.y += Math.max(-15, Math.min(15, f.y - p.y * .002)); }
  }
  return separateKnowledgePoints(points);
}

// Reserve the complete node + title rectangle, including saved manual positions.
// A bounded nearest-free-grid pass removes residual force-layout collisions.
export function separateKnowledgePoints(input: Map<string, { x: number; y: number }>, anchor?: string | null) {
  const placed = new Map<string, { x: number; y: number }>();
  const entries = [...input].sort(([a],[b]) => Number(b === anchor) - Number(a === anchor) || a.localeCompare(b));
  const free = (p: { x: number; y: number }) => [...placed.values()].every(q => Math.abs(p.x-q.x) >= 190 || Math.abs(p.y-q.y) >= 130);
  for (const [id, original] of entries) {
    let point = { ...original };
    if (!free(point)) {
      search: for (let ring = 1; ring <= entries.length; ring++) {
        const choices: Array<{ x: number; y: number }> = [];
        for (let x = -ring; x <= ring; x++) for (let y = -ring; y <= ring; y++) if (Math.max(Math.abs(x),Math.abs(y)) === ring) choices.push({ x: original.x+x*200, y: original.y+y*140 });
        choices.sort((a,b) => Math.hypot(a.x-original.x,a.y-original.y)-Math.hypot(b.x-original.x,b.y-original.y));
        for (const candidate of choices) if (free(candidate)) { point = candidate; break search; }
      }
    }
    placed.set(id, point);
  }
  return placed;
}
