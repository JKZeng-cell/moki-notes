import { ResourceNode } from './resource-node.js';
import { Column, Columns } from './column-nodes.js';
import { inlineMarkExtensions } from './inline-marks.js';
import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { StyledTable, StyledCell, StyledHeader, StyledRow } from './styled-table.js';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { InlineImage as Image } from './image-node.js';
import Mathematics from '@tiptap/extension-mathematics';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
const lowlight = createLowlight(common);

const NotesMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    // Tiptap 3.32 escapes built-in syntax but not our == / {{color:...}}
    // delimiters. Extend its text-only escaping hook (code is already skipped).
    // Kept in one adapter and covered by literal/marked/code round-trip tests.
    const manager = this.storage.manager as unknown as { escapeMarkdownSyntax(text: string): string };
    if (typeof manager.escapeMarkdownSyntax !== 'function') throw new Error('Markdown serializer escaping hook changed');
    const escape = manager.escapeMarkdownSyntax.bind(manager);
    manager.escapeMarkdownSyntax = text => escape(text).replace(/([={}])/g, '\\$1');
  },
});

// Preserve footnotes and raw HTML when editing existing Markdown. Raw HTML is
// displayed as text, never mounted into the DOM as executable user markup.
const FootnoteReference = Node.create({
  name: 'footnoteReference', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ label: { default: '' } }),
  parseHTML: () => [{ tag: 'sup[data-footnote]' }],
  renderHTML: ({ node }) => ['sup', { 'data-footnote': node.attrs.label }, node.attrs.label],
  markdownTokenName: 'footnoteReference',
  markdownTokenizer: { name: 'footnoteReference', level: 'inline', start: src => src.indexOf('[^'), tokenize: src => {
    const m = /^\[\^([^\]\n]+)\]/.exec(src); return m ? { type: 'footnoteReference', raw: m[0], label: m[1] } : undefined;
  } },
  parseMarkdown: token => ({ type: 'footnoteReference', attrs: { label: token.label } }),
  renderMarkdown: node => `[^${node.attrs?.label}]`,
});
const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition', group: 'block', content: 'inline*',
  addAttributes: () => ({ label: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-footnote-definition]' }],
  renderHTML: ({ node }) => ['div', { 'data-footnote-definition': node.attrs.label, class: 'footnote-definition' }, ['sup', { contenteditable: 'false' }, node.attrs.label], ['span', {}, 0]],
  markdownTokenName: 'footnoteDefinition',
  markdownTokenizer: { name: 'footnoteDefinition', level: 'block', start: src => src.search(/^\[\^.+?\]:/m), tokenize: src => {
    const m = /^\[\^([^\]\n]+)\]:[ \t]*([^\n]*(?:\n(?: {4}|\t)[^\n]*)*)/.exec(src);
    return m ? { type: 'footnoteDefinition', raw: m[0], label: m[1], text: m[2].replace(/\n(?: {4}|\t)/g, '\n') } : undefined;
  } },
  parseMarkdown: (token, h) => h.createNode('footnoteDefinition', { label: token.label }, h.parseInline(h.tokenizeInline!(String(token.text)))),
  renderMarkdown: (node, h) => `[^${node.attrs?.label}]: ${h.renderChildren(node.content ?? []).replace(/\n/g, '\n    ')}`,
});
const RawHtml = Node.create({
  name: 'rawHtml', group: 'block', atom: true,
  addAttributes: () => ({ raw: { default: '' } }),
  parseHTML: () => [{ tag: 'pre[data-raw-html]' }],
  renderHTML: ({ node }) => ['pre', { 'data-raw-html': '', class: 'raw-html' }, node.attrs.raw],
  markdownTokenName: 'html',
  parseMarkdown: token => ({ type: 'rawHtml', attrs: { raw: token.raw } }),
  renderMarkdown: node => String(node.attrs?.raw ?? ''),
});
export function richExtensions(onMath?: (latex: string, pos: number, size: number) => void) {
  const mathOptions = onMath ? { onClick: (node: import('@tiptap/pm/model').Node, pos: number) => onMath(node.attrs.latex, pos, node.nodeSize) } : undefined;
  return [StarterKit.configure({ underline: false, trailingNode: false, codeBlock: false, link: { openOnClick: false, protocols: ['http', 'https', 'mailto'] } }), CodeBlockLowlight.configure({ lowlight }),
    StyledTable, StyledCell, StyledHeader, StyledRow, TaskList, TaskItem.configure({ nested: true }),
    Image.configure({ allowBase64: false }), Mathematics.configure({ inlineOptions: mathOptions, blockOptions: mathOptions, katexOptions: { throwOnError: false, trust: false } }),
    Column, Columns, ResourceNode, ...inlineMarkExtensions, FootnoteDefinition, FootnoteReference, RawHtml, NotesMarkdown,
    Placeholder.configure({ placeholder: '写下想法，输入 / 插入格式…' })];
}
