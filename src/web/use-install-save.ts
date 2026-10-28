import { useEffect, useRef } from 'react';

/** Keep the normal editor save operation reachable from the desktop quit flow. */
export function useInstallSave(save: () => Promise<boolean>) {
  const current = useRef(save); current.current = save;
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ waitUntil(value: Promise<boolean>): void }>).detail;
      if (typeof detail?.waitUntil === 'function') detail.waitUntil(current.current());
    };
    window.addEventListener('moki:save-for-install', handler);
    return () => window.removeEventListener('moki:save-for-install', handler);
  }, []);
}
