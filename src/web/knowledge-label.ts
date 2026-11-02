// Split by grapheme so emoji sequences and combining marks stay intact.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const FULL_KNOWLEDGE_TITLE_ZOOM = 1.5;
export function knowledgeTitleLines(title: string, zoom: number): string[] {
  const parts = Array.from(graphemes.segment(title), part => part.segment);
  if (zoom < FULL_KNOWLEDGE_TITLE_ZOOM) return [parts.length > 10 ? parts.slice(0, 10).join('') + '…' : title];
  const lines: string[] = [];
  let line = '', width = 0;
  for (const part of parts) {
    const size = /^[\x20-\x7e]+$/.test(part) ? 1 : 2;
    if (width + size > 24) {
      // Prefer a word boundary for Latin titles, retaining every character.
      const space = line.lastIndexOf(' ');
      const split = /^[\x20-\x7e]+$/.test(part) && space > 0 ? space + 1 : line.length;
      lines.push(line.slice(0, split)); line = line.slice(split);
      width = Array.from(graphemes.segment(line), p => /^[\x20-\x7e]+$/.test(p.segment) ? 1 : 2).reduce<number>((sum, n) => sum + n, 0);
    }
    line += part; width += size;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}
