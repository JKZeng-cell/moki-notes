import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Resource, parseResourceMarkdown, resourceMarkdown } from '../shared/resources.js';
import { ResourceView } from './resource-view.js';
import { resourceEdit } from './resource-editing.js';

function ResourceNodeView({ node, updateAttributes, deleteNode, editor, getPos }: ReactNodeViewProps) {
  const parsed = Resource.safeParse(node.attrs);
  return <NodeViewWrapper className="resource-node" data-drag-handle=""><div contentEditable={false}>{parsed.success ? <ResourceView resource={parsed.data} onImageResize={editor.isEditable ? width => { const pos = getPos(); if (typeof pos !== 'number') return; resourceEdit(editor, () => { editor.commands.insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: 'image', attrs: { src: parsed.data.src, alt: parsed.data.title, width } }); }); editor.commands.focus(); } : undefined} onChange={editor.isEditable ? next => resourceEdit(editor, () => updateAttributes(next)) : undefined} onRemove={editor.isEditable ? () => { resourceEdit(editor, deleteNode); editor.commands.focus(); } : undefined} /> : <p>无法读取资源</p>}</div></NodeViewWrapper>;
}
export const ResourceNode = Node.create({
  name: 'resourceEmbed', group: 'block', atom: true, draggable: true,
  addAttributes: () => Object.fromEntries(['id', 'src', 'title', 'kind', 'view'].map(key => [key, { default: '' }])),
  parseHTML: () => [{ tag: 'div[data-moki-resource]', getAttrs: el => { try { const parsed = Resource.safeParse(JSON.parse((el as HTMLElement).dataset.mokiResource!)); return parsed.success ? parsed.data : false; } catch { return false; } } }],
  renderHTML: ({ node }) => ['div', { 'data-moki-resource': JSON.stringify(node.attrs) }, ['a', { href: node.attrs.src }, node.attrs.title]],
  addNodeView: () => ReactNodeViewRenderer(ResourceNodeView),
  markdownTokenName: 'resourceEmbed',
  markdownTokenizer: { name: 'resourceEmbed', level: 'block', start: src => src.search(/^\[.+\]\(<.+> "moki-resource:/m), tokenize: src => { const match = parseResourceMarkdown(src); return match ? { type: 'resourceEmbed', raw: match.raw, resource: match.resource } : undefined; } },
  parseMarkdown: token => ({ type: 'resourceEmbed', attrs: Resource.parse(token.resource) }),
  renderMarkdown: node => resourceMarkdown(Resource.parse(node.attrs)),
});
