import { remarkMokiMarks } from '../shared/markdown-marks.js';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Root, RootContent } from 'mdast';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ExternalHyperlink, HeadingLevel, WidthType, LevelFormat, AlignmentType, HeightRule } from 'docx';
import type { Note } from '../shared/model.js';
import { remarkResources, type ResourceData } from '../shared/resources.js';
import { remarkColumns } from '../shared/columns.js';
import { cellTextColor, remarkTableStyle, type TableStyle } from '../shared/table-style.js';

type Ast = { data?: { mokiMark?: string; color?: string; resource?: ResourceData; tableStyle?: TableStyle }; type: string; value?: string; url?: string; alt?: string | null; depth?: number; ordered?: boolean | null; checked?: boolean | null; children?: Ast[] };
export function parseMarkdown(content: string): Root { const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkMokiMarks).use(remarkColumns).use(remarkResources).use(remarkTableStyle); return parser.runSync(parser.parse(content)) as Root; }
export function plainText(node: Ast): string {
  if (node.data?.resource) return `${node.data.resource.title} (${node.data.resource.src})`;
  if (node.type === 'image') return `${node.alt || '图片'} (${node.url})`;
  if (node.value !== undefined) return node.value;
  const separator = ['root', 'list', 'blockquote', 'table', 'mokiColumns', 'mokiColumn'].includes(node.type) ? '\n\n' : node.type === 'tableRow' ? '\t' : '';
  return (node.children ?? []).map(plainText).join(separator);
}
function runs(node: Ast, style: { style?: string; bold?: boolean; italics?: boolean; strike?: boolean; font?: string; underline?: object; highlight?: 'yellow'; color?: string } = {}): Array<TextRun | ExternalHyperlink> {
  if (node.data?.resource) { const r = node.data.resource; return /^https?:\/\//i.test(r.src) ? [new ExternalHyperlink({ link: r.src, children: [new TextRun({ text: r.title, style: 'Hyperlink' })] })] : [new TextRun({ text: plainText(node) })]; }
  if (node.type === 'strong') style = { ...style, bold: true };
  if (node.data?.mokiMark === 'underline') style = { ...style, underline: {} };
  if (node.data?.mokiMark === 'highlight') style = { ...style, highlight: 'yellow' };
  if (node.data?.mokiMark === 'textColor') style = { ...style, color: node.data.color?.slice(1) };
  if (node.type === 'emphasis' && !node.data?.mokiMark) style = { ...style, italics: true };
  if (node.type === 'delete') style = { ...style, strike: true };
  if (node.type === 'inlineCode') style = { ...style, font: 'Consolas' };
  if (node.type === 'link' && /^https?:\/\//i.test(node.url ?? '')) return [new ExternalHyperlink({ link: node.url!, children: (node.children ?? []).flatMap(child => runs(child, { ...style, style: 'Hyperlink' })) })];
  if (node.type === 'break') return [new TextRun({ break: 1 })];
  if (node.value !== undefined || node.type === 'image') return [new TextRun({ text: plainText(node), ...style })];
  return (node.children ?? []).flatMap(n => runs(n, style));
}
function blocks(nodes: Ast[], depth = 0, list?: 'bullet' | 'ordered'): Array<Paragraph | Table> {
  return nodes.flatMap((node): Array<Paragraph | Table> => {
    if (node.type === 'mokiColumns') return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: (node.children ?? []).map(col => new TableCell({ width: { size: 100 / (node.children?.length || 2), type: WidthType.PERCENTAGE }, children: [...blocks(col.children ?? []), new Paragraph('')] })) })] })];
    if (node.type === 'table') return [new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: node.data?.tableStyle?.widths.some(Boolean) ? node.data.tableStyle.widths.map(w => (w || 120) * 15) : undefined,
      rows: (node.children ?? []).map((row, i) => new TableRow({
        tableHeader: i === 0,
        height: node.data?.tableStyle?.heights[i] ? { value: node.data.tableStyle.heights[i] * 15, rule: HeightRule.ATLEAST } : undefined,
        children: (row.children ?? []).map((cell, c) => new TableCell({
          shading: node.data?.tableStyle?.fills[`${i}:${c}`] ? { fill: node.data.tableStyle.fills[`${i}:${c}`].slice(1) } : undefined,
          children: [new Paragraph({ children: runs(cell, { bold: i === 0, color: node.data?.tableStyle?.fills[`${i}:${c}`] ? cellTextColor(node.data.tableStyle.fills[`${i}:${c}`]).slice(1) : undefined }) })],
        })),
      })),
    })];
    if (node.type === 'list') return blocks(node.children ?? [], depth, node.ordered ? 'ordered' : 'bullet');
    if (node.type === 'listItem') {
      const children = node.children ?? [];
      return children.flatMap((child, index) => child.type === 'list' ? blocks([child], depth + 1) : [new Paragraph({
        children: [...(node.checked != null && index === 0 ? [new TextRun(node.checked ? '☑ ' : '☐ ')] : []), ...runs(child)],
        ...(index === 0 && node.checked == null ? list === 'ordered' ? { numbering: { reference: 'ordered', level: Math.min(depth, 8) } } : { bullet: { level: Math.min(depth, 8) } } : { indent: { left: 360 * (depth + 1) } }),
      })]);
    }
    if (node.type === 'blockquote') return [new Paragraph({ children: runs(node, { italics: true }), indent: { left: 480 }, border: { left: { color: '625BC5', size: 12, space: 10, style: 'single' } } })];
    if (node.type === 'code' || node.type === 'math') return (node.value ?? '').split('\n').map(line => new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 20 })], shading: { fill: 'F3F4F8' } }));
    if (node.type === 'thematicBreak') return [new Paragraph({ text: '────────────────────────' })];
    if (node.type === 'definition') return [];
    return [new Paragraph({ children: runs(node), ...(node.type === 'heading' ? { heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][(node.depth ?? 1) - 1] } : {}), spacing: { after: 160 } })];
  });
}
export async function exportNote(note: Note, format: 'txt' | 'md' | 'docx') {
  const ast = parseMarkdown(note.content);
  const name = note.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || '便签';
  if (format === 'md') return { name: `${name}.md`, mime: 'text/markdown; charset=utf-8', bytes: Buffer.from(`# ${note.title}\n\n${note.content}\n`) };
  if (format === 'txt') return { name: `${name}.txt`, mime: 'text/plain; charset=utf-8', bytes: Buffer.from(`${note.title}\n\n${plainText(ast as Ast)}\n`) };
  const document = new Document({
    creator: 'MOKI便签', title: note.title,
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
    numbering: { config: [{ reference: 'ordered', levels: Array.from({ length: 9 }, (_, level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } } })) }] },
    sections: [{ children: [new Paragraph({ text: note.title, heading: HeadingLevel.TITLE }), ...blocks(ast.children as RootContent[] as Ast[])] }],
  });
  return { name: `${name}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: await Packer.toBuffer(document) };
}
