import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RootContent } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm);

/** Plain text for navigation only; stored Markdown and search indexing stay intact. */
export function noteExcerpt(markdown: string, length = 180): string {
  const source = markdown.slice(0, 16000).replace(/^:{3,}(?:moki-columns|column|end-columns|moki-table [^\r\n]*|end-table)[ \t]*\r?$/gm, '');
  const text = (node: RootContent): string => {
    if (node.type === 'html' || node.type === 'definition' || node.type === 'footnoteDefinition') return '';
    if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
    if ('children' in node) {
      const inline = ['paragraph', 'heading', 'link', 'linkReference', 'strong', 'emphasis', 'delete', 'tableCell'].includes(node.type);
      return node.children.map(child => text(child as RootContent)).join(inline ? '' : ' ');
    }
    return 'value' in node ? String(node.value) : ' ';
  };
  return parser.parse(source).children.map(text).join(' ').replace(/\s+/g, ' ').trim().slice(0, length);
}
