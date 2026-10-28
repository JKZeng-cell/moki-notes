import Image from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { ResourceView } from './resource-view.js';
import { assetIdFromSource, type ResourceData } from '../shared/resources.js';
import { resourceEdit } from './resource-editing.js';
import { readImageTitle, writeImageTitle } from '../shared/image-size.js';

export function imageResource(src: string, alt?: string | null): ResourceData {
  let source = src;
  try { if (!assetIdFromSource(src)) source = new URL(src, typeof location === 'undefined' ? 'http://localhost' : location.origin).href; } catch { /* Invalid image URLs remain removable instead of crashing the editor. */ }
  return { id: '00000000-0000-4000-8000-000000000001', src: source, title: alt || '图片', kind: 'file', view: 'preview' };
}
function ImageNodeView({ node, editor, deleteNode, updateAttributes }: ReactNodeViewProps) {
  return <NodeViewWrapper className="embedded-image" data-drag-handle=""><ResourceView imageOnly imageWidth={node.attrs.width} onImageResize={editor.isEditable ? width => { resourceEdit(editor, () => updateAttributes({ width, height: null })); editor.commands.focus(); } : undefined} resource={imageResource(node.attrs.src, node.attrs.alt)} onRemove={editor.isEditable ? () => { resourceEdit(editor, deleteNode); editor.commands.focus(); } : undefined} /></NodeViewWrapper>;
}
export const InlineImage = Image.extend({
  addNodeView() { return ReactNodeViewRenderer(ImageNodeView); },
  parseMarkdown(token, helpers) { const size = readImageTitle(token.title); return helpers.createNode('image', { src: token.href, alt: token.text, title: size.title, width: size.width }); },
  renderMarkdown(node, helpers, context) { return this.parent!({ ...node, attrs: { ...node.attrs, title: writeImageTitle(node.attrs?.width, node.attrs?.title) } }, helpers, context); },
});
