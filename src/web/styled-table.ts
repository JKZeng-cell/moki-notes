import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { JSONContent } from '@tiptap/core';
import { cellFill, cellTextColor, parseStyledTable, styledTableMarkdown, type TableStyle } from '../shared/table-style.js';

const background = () => ({ default: null, parseHTML: (el: HTMLElement) => cellFill(el.getAttribute('data-cell-fill')),
  renderHTML: (attrs: Record<string, unknown>) => { const fill = cellFill(attrs.backgroundColor); return fill ? { 'data-cell-fill': fill, style: `background-color:${fill};color:${cellTextColor(fill)}` } : {}; } });
export const StyledCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), backgroundColor: background() }; } });
export const StyledHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), backgroundColor: background() }; } });
export const StyledRow = TableRow.extend({ addAttributes() { return { ...this.parent?.(), rowHeight: { default: null,
  parseHTML: (el: HTMLElement) => { const value = Number(el.getAttribute('data-row-height')); return value >= 28 && value <= 2000 ? value : null; },
  renderHTML: (attrs: Record<string, unknown>) => { const value = Number(attrs.rowHeight); return value >= 28 && value <= 2000 ? { 'data-row-height': value, style: `height:${value}px` } : {}; },
} }; } });
const baseTokenizer = Table.config.markdownTokenizer!;
export const StyledTable = Table.extend({
  markdownTokenizer: { ...baseTokenizer,
    start: src => { const custom = src.indexOf(':::moki-table '); return custom >= 0 ? custom : typeof baseTokenizer.start === 'function' ? baseTokenizer.start(src) : -1; },
    tokenize: (src, tokens, helper) => {
      const parsed = parseStyledTable(src);
      if (parsed) {
        const content = helper.blockTokens(parsed.body);
        if (content.length === 1 && content[0].type === 'table') return { ...content[0], raw: parsed.raw, mokiStyle: parsed.style };
      }
      return baseTokenizer.tokenize(src, tokens, helper);
    },
  },
  parseMarkdown(token, helpers) {
    const node = this.parent!(token, helpers) as JSONContent;
    const style = token.mokiStyle as TableStyle | undefined;
    if (style) node.content?.forEach((row, r) => {
      row.attrs = { ...row.attrs, rowHeight: style.heights[r] || null };
      row.content?.forEach((cell, c) => { cell.attrs = { ...cell.attrs, colwidth: style.widths[c] ? [style.widths[c]] : null, backgroundColor: cellFill(style.fills[`${r}:${c}`]) }; });
    });
    return node;
  },
  renderMarkdown(node, helpers, context) {
    const style: TableStyle = { widths: [], heights: [], fills: {} };
    node.content?.forEach((row, r) => {
      style.heights.push(Number(row.attrs?.rowHeight) || 0);
      row.content?.forEach((cell, c) => {
        style.widths[c] = Math.max(style.widths[c] ?? 0, Number(cell.attrs?.colwidth?.[0]) || 0);
        const fill = cellFill(cell.attrs?.backgroundColor); if (fill) style.fills[`${r}:${c}`] = fill;
      });
    });
    return styledTableMarkdown(this.parent!(node, helpers, context), style);
  },
}).configure({ resizable: true, cellMinWidth: 50, lastColumnResizable: true });
