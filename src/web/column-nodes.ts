import { Node } from '@tiptap/core';
import { columnsMarkdown, parseColumnsMarkdown } from '../shared/columns.js';

export const Column = Node.create({
  name: 'mokiColumn', content: 'block+', isolating: true,
  parseHTML: () => [{ tag: 'div[data-moki-column]' }],
  renderHTML: () => ['div', { 'data-moki-column': '', class: 'moki-column' }, 0],
  renderMarkdown: (node, h) => h.renderChildren(node.content ?? [], '\n\n'),
});
export const Columns = Node.create({
  name: 'mokiColumns', group: 'block', content: 'mokiColumn mokiColumn+', isolating: true, defining: true,
  parseHTML: () => [{ tag: 'div[data-moki-columns]' }],
  renderHTML: ({ node }) => ['div', { 'data-moki-columns': '', 'data-columns': node.childCount, class: 'moki-columns', style: `--moki-column-count:${node.childCount}` }, 0],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'moki-columns'; dom.setAttribute('data-moki-columns', '');
      const update = (next: typeof node) => {
        if (next.type !== node.type) return false;
        // ProseMirror reuses the row DOM when only its children change;
        // renderHTML is not called again to update the derived grid count.
        dom.dataset.columns = String(next.childCount);
        dom.style.setProperty('--moki-column-count', String(next.childCount));
        return true;
      };
      update(node);
      return { dom, contentDOM: dom, update };
    };
  },
  markdownTokenName: 'mokiColumns',
  markdownTokenizer: {
    name: 'mokiColumns', level: 'block', start: src => src.search(/^:{3,}moki-columns\s*$/m),
    tokenize: (src, _tokens, lexer) => {
      const parsed = parseColumnsMarkdown(src);
      return parsed ? { type: 'mokiColumns', raw: parsed.raw, columns: parsed.columns.map(text => lexer.blockTokens(text)) } : undefined;
    },
  },
  parseMarkdown: (token, h) => h.createNode('mokiColumns', {}, token.columns.map((tokens: Parameters<typeof h.parseChildren>[0]) => h.createNode('mokiColumn', {}, h.parseChildren(tokens).length ? h.parseChildren(tokens) : [h.createNode('paragraph')]))),
  renderMarkdown: (node, h) => columnsMarkdown((node.content ?? []).map(col => h.renderChildren(col.content ?? [], '\n\n'))),
});
