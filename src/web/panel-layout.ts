export type PanelKey = 'sidebar' | 'list' | 'inspector';
export type PanelWidths = Partial<Record<PanelKey, number>>;
export const PANEL_STORAGE = 'moki-notes:panel-widths';
export function parsePanelWidths(raw: string | null): PanelWidths {
  try {
    const value = JSON.parse(raw ?? '{}'), result: PanelWidths = {};
    for (const key of ['sidebar', 'list', 'inspector'] as const) if (typeof value?.[key] === 'number' && Number.isFinite(value[key])) result[key] = Math.max(160, Math.min(520, value[key]));
    return result;
  } catch { return {}; }
}
export function panelLayout(width: number, knowledge: boolean, preferred: PanelWidths) {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const sidebarMax = Math.max(180, Math.min(360, width - (knowledge ? 520 : 540)));
  const sidebar = width <= 860 ? (width <= 620 ? 54 : 65) : clamp(preferred.sidebar ?? (width <= 1150 ? 192 : 224), 180, sidebarMax);
  const listMax = Math.max(220, Math.min(480, width - sidebar - 320));
  const list = width <= 620 ? 0 : clamp(preferred.list ?? (width <= 860 ? 235 : width <= 1150 ? 265 : 306), 220, listMax);
  const inspectorMax = Math.max(200, Math.min(480, width - sidebar - 320));
  const inspector = clamp(preferred.inspector ?? (width <= 860 ? 210 : width <= 1150 ? 235 : 272), 200, inspectorMax);
  return { sidebar, list, inspector, sidebarMax, listMax, inspectorMax };
}
