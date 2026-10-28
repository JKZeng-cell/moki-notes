import { useEffect } from 'react';
import { api } from './api.js';
import { AppearanceSettings, type Appearance } from '../shared/settings.js';

export function applyAppearance(value: Appearance) {
  const parsed = AppearanceSettings.safeParse(value);
  if (parsed.success) document.documentElement.style.setProperty('--note-font-size', `${parsed.data.fontSize}px`);
}
export function announceAppearance(value: Appearance) {
  applyAppearance(value);
  const channel = new BroadcastChannel('moki-appearance'); channel.postMessage(value); channel.close();
}
export function AppearanceProvider() {
  useEffect(() => {
    let live = true, revision = 0;
    const channel = new BroadcastChannel('moki-appearance');
    channel.onmessage = e => { revision++; applyAppearance(e.data); };
    const read = async () => { const token = revision; try { const value = await api<Appearance>('/settings/appearance'); if (live && token === revision) applyAppearance(value); } catch { /* Keep the last size offline. */ } };
    void read(); const timer = setInterval(() => void read(), 3000);
    return () => { live = false; channel.close(); clearInterval(timer); };
  }, []);
  return null;
}
