import type { NoteSummary } from '../shared/model.js';
import type { TreeMoveInput } from '../shared/tree.js';
export const NOTE_DRAG = 'application/x-moki-note';
export type DragNote = { id: string; version: number };
let active: DragNote | null = null;
export function startNoteDrag(e: React.DragEvent, note: NoteSummary) {
  active = { id: note.id, version: note.version };
  e.dataTransfer.setData(NOTE_DRAG, JSON.stringify(active)); e.dataTransfer.effectAllowed = 'move';
}
export function endNoteDrag() { active = null; }
export function readNoteDrag(e: React.DragEvent): DragNote | null {
  try { const n = JSON.parse(e.dataTransfer.getData(NOTE_DRAG)); return typeof n.id === 'string' && Number.isInteger(n.version) ? n : null; } catch { return null; }
}
export function dragAllowed(nodes: NoteSummary[], targetId: string | null, placement: TreeMoveInput['placement']) {
  if (!active) return true;
  if (active.id === targetId) return false;
  let parent = placement === 'inside' ? targetId : nodes.find(n => n.id === targetId)?.parentId;
  const seen = new Set<string>();
  while (parent) { if (parent === active.id || seen.has(parent)) return false; seen.add(parent); parent = nodes.find(n => n.id === parent)?.parentId; }
  return true;
}
export function dropPlacement(e: React.DragEvent<HTMLElement>): TreeMoveInput['placement'] {
  const bounds = e.currentTarget.getBoundingClientRect(), y = (e.clientY - bounds.top) / bounds.height;
  return y < .25 ? 'before' : y > .75 ? 'after' : 'inside';
}
