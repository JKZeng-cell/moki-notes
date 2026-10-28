import { useEffect, useState } from 'react';
import { api } from './api.js';
import type { AutoSave } from '../shared/settings.js';

export function announceAutoSave(value: AutoSave) {
  window.dispatchEvent(new CustomEvent('moki-autosave', { detail: value }));
  const channel = new BroadcastChannel('moki-settings'); channel.postMessage(value); channel.close();
}
export function useAutoSave() {
  // Do not save before the persisted setting has been read.
  const [value, setValue] = useState<AutoSave | null>(null);
  useEffect(() => {
    let active = true, revision = 0;
    const read = async () => { const token = revision; try { const next = await api<AutoSave>('/settings/autosave'); if (active && token === revision) setValue(old => old?.enabled === next.enabled && old.delayMs === next.delayMs ? old : next); } catch { /* Retain last known setting; never enable saving on failure. */ } };
    const receive = (next: AutoSave) => { revision++; setValue(next); };
    const event = (e: Event) => receive((e as CustomEvent<AutoSave>).detail);
    const channel = new BroadcastChannel('moki-settings'); channel.onmessage = e => receive(e.data);
    window.addEventListener('moki-autosave', event); void read();
    const timer = setInterval(() => void read(), 3000);
    return () => { active = false; clearInterval(timer); channel.close(); window.removeEventListener('moki-autosave', event); };
  }, []);
  return value;
}
