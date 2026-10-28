import { describe, expect, it } from 'vitest';
import { panelLayout, parsePanelWidths } from '../src/web/panel-layout.js';

describe('saved panel layout', () => {
  it('ignores malformed or unrelated stored preferences', () => {
    expect(parsePanelWidths('{')).toEqual({});
    expect(parsePanelWidths('null')).toEqual({});
    expect(parsePanelWidths('{"sidebar":"300","list":340,"inspector":null,"unknown":200}')).toEqual({ list: 340 });
  });
  it('preserves space for content when wide preferences meet a smaller window', () => {
    for (const knowledge of [true, false]) for (const width of [621, 860, 861, 1000, 1344]) {
      const sizes = panelLayout(width, knowledge, { sidebar: 360, list: 480, inspector: 480 });
      expect(width - sizes.sidebar - (knowledge ? sizes.inspector : sizes.list)).toBeGreaterThanOrEqual(320);
    }
  });
  it('restores preferred sizes after temporarily compacting the window', () => {
    const saved = { sidebar: 290, list: 350, inspector: 360 };
    expect(panelLayout(800, true, saved).sidebar).toBe(65);
    expect(panelLayout(600, false, saved).list).toBe(0);
    expect(panelLayout(1344, true, saved)).toMatchObject(saved);
    expect(saved).toEqual({ sidebar: 290, list: 350, inspector: 360 });
  });
});
