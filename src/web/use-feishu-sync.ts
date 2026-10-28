import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeishuOverview, SyncDirection } from '../shared/feishu.js';

export type FeishuSession = ReturnType<typeof useFeishuSync>;
// The manager owns this state; closing a settings tab never cancels the IPC job.
export function useFeishuSync(onChanged: () => void, enabled = true) {
  const [overview, setOverview] = useState<FeishuOverview | null>(null), [starting, setStarting] = useState(false), [error, setError] = useState(''), [statusError, setStatusError] = useState('');
  const pending = useRef(false), alive = useRef(true), request = useRef(0), previous = useRef<FeishuOverview | null>(null);
  const changed = useRef(onChanged); changed.current = onChanged;
  const refresh = useCallback(async () => {
    if (!enabled || !window.mokiDesktop) return;
    const token = ++request.current;
    try {
      const next = await window.mokiDesktop.feishuOverview();
      if (!alive.current || token !== request.current) return;
      const old = previous.current; previous.current = next; setOverview(next); setStatusError('');
      if (old && old.report?.at !== next.report?.at && !next.lastError) setError('');
      if (old && (old.running && !next.running || old.report?.at !== next.report?.at)) changed.current();
    } catch (e) { if (alive.current && token === request.current) setStatusError((e as Error).message); }
  }, [enabled]);
  useEffect(() => {
    alive.current = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (alive.current) timer = setTimeout(() => void poll(), 3000); };
    void poll();
    return () => { alive.current = false; request.current++; clearTimeout(timer); };
  }, [refresh]);
  const start = useCallback((direction: SyncDirection) => {
    if (!window.mokiDesktop || pending.current || previous.current?.running) return;
    pending.current = true; request.current++; setStarting(true); setError('');
    void window.mokiDesktop.feishuSync(direction).catch(e => {
      if (alive.current) setError((e as Error).message.replace(/^Error invoking remote method ['"][^'"]+['"]: (?:Error: )?/, ''));
    }).finally(() => {
      pending.current = false;
      if (alive.current) { setStarting(false); void refresh(); changed.current(); }
    });
  }, [refresh]);
  return { overview, running: starting || !!overview?.running, error: error || statusError, refresh, start };
}
