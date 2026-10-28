import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Note, NoteSummary } from '../shared/model.js';
import type { GraphPoint } from '../shared/graph-position.js';
import { connectKnowledgeNotes } from './knowledge-connect.js';

type Connection = { from: string; pointer: number; start: GraphPoint; end: GraphPoint; target: string | null };
export function useKnowledgeConnect({ nodes, points, onConnected, onError }: { nodes: NoteSummary[]; points: Map<string, GraphPoint>; onConnected(note: Note): void; onError(message: string): void }) {
  const [connection, setConnection] = useState<Connection | null>(null), [saving, setSaving] = useState(false);
  const active = useRef<Connection | null>(null), capture = useRef<SVGGElement | null>(null), pending = useRef(false), alive = useRef(true);
  function cancel() {
    const previous = active.current; active.current = null; setConnection(null);
    if (previous && capture.current?.hasPointerCapture(previous.pointer)) capture.current.releasePointerCapture(previous.pointer);
  }
  useEffect(() => {
    alive.current = true;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && active.current) { e.preventDefault(); e.stopPropagation(); cancel(); } };
    const blur = () => cancel();
    window.addEventListener('keydown', key, true); window.addEventListener('blur', blur);
    return () => { alive.current = false; window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur); };
  }, []);
  useEffect(() => { if (active.current && !nodes.some(n => n.id === active.current!.from)) cancel(); }, [nodes]);
  function start(e: ReactPointerEvent<SVGGElement>, from: string) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (!e.isPrimary || pending.current || active.current) return;
    const point = points.get(from); if (!point) return;
    const next = { from, pointer: e.pointerId, start: { x: point.x + 34, y: point.y }, end: { ...point }, target: null };
    active.current = next; setConnection(next); capture.current = e.currentTarget;
    e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus({ preventScroll: true });
  }
  function move(e: ReactPointerEvent<SVGGElement>) {
    const previous = active.current; if (!previous || previous.pointer !== e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement, matrix = svg?.getScreenCTM(); if (!matrix) return;
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]');
    const target = hit && svg?.contains(hit) ? hit.getAttribute('data-node') : null;
    const next = { ...previous, end: { x: point.x, y: point.y }, target: target !== previous.from ? target : null };
    active.current = next; setConnection(next);
  }
  async function finish(e: ReactPointerEvent<SVGGElement>) {
    if (!active.current || active.current.pointer !== e.pointerId || e.button !== 0) return;
    move(e); const { from, target } = active.current!; cancel();
    if (!target || pending.current) return;
    pending.current = true; setSaving(true);
    try { const updated = await connectKnowledgeNotes(from, target); if (alive.current) onConnected(updated); }
    catch (e) { if (alive.current) onError((e as Error).message); }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  }
  return { connection, saving, isConnecting: () => !!active.current,
    handle: (id: string) => ({ onPointerDown: (e: ReactPointerEvent<SVGGElement>) => start(e, id), onPointerMove: move, onPointerUp: (e: ReactPointerEvent<SVGGElement>) => void finish(e), onPointerCancel: cancel, onLostPointerCapture: cancel, onClick: (e: React.MouseEvent) => { e.stopPropagation(); }, onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); } }) };
}
