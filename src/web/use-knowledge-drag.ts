import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { moveGraphPoint, type GraphPoint, type GraphPositions } from '../shared/graph-position.js';
import type { KnowledgeCamera } from './knowledge-model.js';
import { api } from './api.js';

type Drag = { pointer: number; button: number; id: string | null; x: number; y: number; origin: GraphPoint; previous?: GraphPoint; scale: number; moved: boolean };
export function useKnowledgeDrag({ displayPoints, points, span, camera, setCamera, onSelect, onError }: { displayPoints?: { current: Map<string, GraphPoint> }; points: Map<string, GraphPoint>; span: number; camera: KnowledgeCamera; setCamera(value: KnowledgeCamera): void; onSelect(id: string): void; onError(message: string): void }) {
  const [positions, setPositions] = useState<GraphPositions>({}), [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false), [dragging, setDragging] = useState<string | null>(null);
  const current = useRef(positions); current.current = positions;
  const [panning, setPanning] = useState(false);
  const drag = useRef<Drag | null>(null), capture = useRef<SVGElement | null>(null), suppressClick = useRef(false), pending = useRef(false), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void api<GraphPositions>('/knowledge/positions').then(value => { if (alive.current) { current.current = value; setPositions(value); setLoaded(true); } }).catch(e => { if (alive.current) onError(`读取节点位置失败：${e.message}，请重新打开知识树`); });
    return () => { alive.current = false; };
  }, []);
  function place(id: string, point?: GraphPoint) {
    const next = { ...current.current }; if (point) next[id] = point; else delete next[id];
    current.current = next; setPositions(next);
  }
  function release() {
    const active = drag.current; drag.current = null; setDragging(null); setPanning(false);
    if (active && capture.current?.hasPointerCapture(active.pointer)) capture.current.releasePointerCapture(active.pointer);
  }
  function cancel() {
    const active = drag.current; if (!active) return;
    if (active.id) place(active.id, active.previous);
    else setCamera({ ...camera, pan: active.origin });
    suppressClick.current = active.moved; release();
  }
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current) { e.preventDefault(); e.stopPropagation(); cancel(); } };
    const blur = () => cancel();
    window.addEventListener('keydown', keyboard, true); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keyboard, true); window.removeEventListener('blur', blur); };
  });
  async function persist(id: string, position: GraphPoint | null, previous?: GraphPoint) {
    pending.current = true; setSaving(true);
    try { await api(`/notes/${id}/position`, 'PUT', { position }); }
    catch (e) { if (alive.current) { place(id, previous); onError(`节点位置未保存，已恢复原位置：${(e as Error).message}`); } }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  }
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if ((e.button !== 0 && e.button !== 1) || !e.isPrimary || drag.current) return;
    suppressClick.current = false;
    // Middle-button dragging always moves the camera, even over a node.
    const id = e.button === 1 ? null : (e.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? null;
    if (id) { onSelect(id); if (!loaded || pending.current) return; }
    const origin = id ? displayPoints?.current.get(id) ?? current.current[id] ?? points.get(id) : camera.pan; if (!origin) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    drag.current = { pointer: e.pointerId, button: e.button, id, x: e.clientX, y: e.clientY, origin: { ...origin }, previous: id ? current.current[id] : undefined, scale: span / Math.max(1, Math.min(bounds.width, bounds.height)), moved: false };
    setPanning(!id);
    capture.current = id ? e.currentTarget.querySelector<SVGGElement>(`[data-node="${id}"]`) : e.currentTarget;
    capture.current?.setPointerCapture(e.pointerId);
    if (id) e.currentTarget.querySelector<SVGGElement>(`[data-node="${id}"]`)?.focus();
    e.preventDefault();
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    const active = drag.current; if (!active || active.pointer !== e.pointerId) return;
    const dx = e.clientX - active.x, dy = e.clientY - active.y;
    if (!active.moved && Math.hypot(dx, dy) < 4) return;
    active.moved = true;
    if (active.id) { setDragging(active.id); place(active.id, moveGraphPoint(active.origin, dx, dy, active.scale)); }
    else setCamera({ ...camera, pan: { x: active.origin.x - dx * active.scale, y: active.origin.y - dy * active.scale } });
  }
  function up(e: ReactPointerEvent<SVGSVGElement>) {
    const active = drag.current; if (!active || active.pointer !== e.pointerId || active.button !== e.button) return;
    move(e); suppressClick.current = active.moved; release();
    if (active.id && active.moved) void persist(active.id, current.current[active.id], active.previous);
  }
  return { positions, loaded, saving, dragging, panning, isDragging: () => !!drag.current,
    resetPosition: (id: string) => { if (pending.current || !loaded) return; const previous = current.current[id]; place(id); void persist(id, null, previous); },
    handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: cancel, onLostPointerCapture: cancel,
      onAuxClick: (e: React.MouseEvent) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } },
      onClickCapture: (e: React.MouseEvent) => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } },
      onDoubleClickCapture: (e: React.MouseEvent) => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } } } };
}
