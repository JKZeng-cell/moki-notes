import { z } from 'zod';
import type { Root } from 'mdast';

export const cellFill = (value: unknown): string | null => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
export function cellTextColor(fill: string) {
  const channels = [1, 3, 5].map(i => parseInt(fill.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2] > .179 ? '#202638' : '#ffffff';
}
export const TableStyle = z.object({
  widths: z.array(z.number().int().min(0).max(1000000)).max(200).default([]),
  heights: z.array(z.number().int().min(0).max(2000)).max(2000).default([]),
  fills: z.record(z.string().regex(/^\d{1,4}:\d{1,3}$/), z.string().regex(/^#[\da-f]{6}$/i)).default({}),
}).strict();
export type TableStyle = z.infer<typeof TableStyle>;
export function parseStyledTable(source: string) {
  const match = /^:::moki-table ([^\r\n]{1,100000})\r?\n\s*\n([\s\S]*?)\n\s*\n:::end-table(?:\r?\n|$)/.exec(source);
  if (!match) return;
  try { return { raw: match[0], body: match[2], style: TableStyle.parse(JSON.parse(match[1])) }; } catch { return; }
}
export function styledTableMarkdown(body: string, style: TableStyle) {
  return style.widths.some(Boolean) || style.heights.some(Boolean) || Object.keys(style.fills).length
    ? `:::moki-table ${JSON.stringify(style)}\n\n${body.trim()}\n\n:::end-table` : body;
}
export function remarkTableStyle() {
  return (tree: Root) => {
    const text = (n: any) => n?.type === 'paragraph' && n.children?.length === 1 && n.children[0].type === 'text' ? n.children[0].value as string : '';
    const visit = (parent: any) => {
      if (!parent.children) return;
      const out = [];
      for (let i = 0; i < parent.children.length; i++) {
        const n = parent.children[i], start = /^:::moki-table (.+)$/.exec(text(n));
        const table = parent.children[i + 1];
        if (start && table?.type === 'table' && text(parent.children[i + 2]) === ':::end-table') {
          try {
            const style = TableStyle.parse(JSON.parse(start[1]));
            table.data = { ...table.data, tableStyle: style, hProperties: { ...table.data?.hProperties, 'data-moki-table-style': JSON.stringify(style) } };
            table.children.forEach((row: any, r: number) => {
              if (style.heights[r]) row.data = { ...row.data, hProperties: { style: `height:${style.heights[r]}px` } };
              row.children.forEach((cell: any, c: number) => {
                const fill = cellFill(style.fills[`${r}:${c}`]);
                if (fill) cell.data = { ...cell.data, hProperties: { style: `background-color:${fill};color:${cellTextColor(fill)}` } };
              });
            });
            out.push(table); i += 2; continue;
          } catch { /* Invalid metadata stays inert readable text. */ }
        }
        visit(n); out.push(n);
      }
      parent.children = out;
    };
    visit(tree);
  };
}
