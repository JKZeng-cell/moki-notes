import { memo } from 'react';
import { remarkMokiMarks } from '../shared/markdown-marks.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import { Resource, remarkResources, resourceMarkdown } from '../shared/resources.js';
import { ResourceView } from './resource-view.js';
import { remarkColumns } from '../shared/columns.js';
import './block-layout.css';
import { remarkTableStyle, TableStyle } from '../shared/table-style.js';
import { imageResource } from './image-node.js';
import type { Root } from 'mdast';
import { imageWidth, remarkImageSize } from '../shared/image-size.js';
import { ImageSurface } from './image-surface.js';
function remarkBlockImages() {
  return (tree: Root) => {
    const visit = (node: any) => {
      if (node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'image') {
        node.data = { ...node.data, hName: 'div' };
        node.children[0].data = { ...node.children[0].data, hProperties: { ...node.children[0].data?.hProperties, 'data-moki-image': true } };
      }
      node.children?.forEach(visit);
    }; visit(tree);
  };
}
export const MarkdownPreview = memo(function MarkdownPreview({ content, onChange }: { content: string; onChange?(content: string): void | Promise<void> }) {
  return <div className="markdown"><Markdown remarkPlugins={[remarkGfm, remarkMath, remarkMokiMarks, remarkColumns, remarkResources, remarkTableStyle, remarkImageSize, remarkBlockImages]} rehypePlugins={[rehypeKatex, rehypeHighlight]} components={{
    table: ({ node, children, ...props }) => {
      let widths: number[] = [];
      try { widths = TableStyle.parse(JSON.parse(String(node?.properties['data-moki-table-style']))).widths; } catch { /* Plain Markdown table. */ }
      return <div className="tableWrapper"><table {...props} style={{ tableLayout: 'fixed', display: 'table', ...(widths.length ? { minWidth: widths.reduce((a, b) => a + (b || 50), 0) } : {}), ...(widths.length && widths.every(Boolean) ? { width: widths.reduce((a, b) => a + b, 0) } : {}) }}>
        {!!widths.length && <colgroup>{widths.map((width, i) => <col key={i} style={width ? { width } : undefined} />)}</colgroup>}{children}</table></div>;
    },
    div: ({ node, ...props }) => {
      const value = node?.properties['data-moki-resource'];
      if (typeof value === 'string') {
        try {
          const resource = Resource.parse(JSON.parse(value)), start = Number(node?.properties['data-source-start']), end = Number(node?.properties['data-source-end']);
          return <ResourceView resource={resource} onChange={onChange && Number.isInteger(start) && Number.isInteger(end) ? next => onChange(content.slice(0, start) + resourceMarkdown(next) + content.slice(end)) : undefined} />;
        } catch { /* Invalid resource metadata is shown as an ordinary link. */ }
      }
      return <div {...props} />;
    },
    a: props => <a {...props} target="_blank" rel="noreferrer" />, img: ({ node, src, alt, ...props }) => {
      if (typeof src === 'string' && node?.properties['data-moki-image']) {
        const start = node.position?.start.offset, end = node.position?.end.offset;
        return <ResourceView imageOnly imageWidth={imageWidth(props.width)} resource={imageResource(src, alt)} onRemove={onChange && start !== undefined && end !== undefined ? () => onChange(content.slice(0, start) + content.slice(end)) : undefined} />;
      }
      return typeof src === 'string' ? <ImageSurface inline src={src} title={alt || props.title || '图片'} width={imageWidth(props.width)} /> : null;
    },
  }}>{content || '*在这里，让想法留下来。*'}</Markdown></div>;
});
