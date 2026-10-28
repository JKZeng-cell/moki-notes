import { z } from 'zod';
import type { Root } from 'mdast';

export const assetIdFromSource = (src: string) => /^\/api\/assets\/([\da-f-]{36})\/content$/i.exec(src)?.[1];
export function noteIdFromSource(src: string) {
  const id = /^\/\?note=([\da-f-]{36})$/i.exec(src)?.[1];
  return id && z.string().uuid().safeParse(id).success ? id : undefined;
}
export function safeResourceSource(src: string) {
  if (noteIdFromSource(src)) return true;
  if (assetIdFromSource(src)) return z.string().uuid().safeParse(assetIdFromSource(src)).success;
  try { const url = new URL(src); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export const Resource = z.object({
  id: z.string().uuid(), kind: z.enum(['web', 'video', 'file', 'note']),
  src: z.string().max(8000).refine(safeResourceSource, '请输入有效的 http / https 地址'),
  title: z.string().trim().min(1).max(250), view: z.enum(['title', 'link', 'card', 'preview']),
}).refine(r => r.kind === 'note' ? !!noteIdFromSource(r.src) : !noteIdFromSource(r.src), '便签附件必须引用有效的本地便签');
export type ResourceData = z.infer<typeof Resource>;
export type ResourceKind = ResourceData['kind'];
export type ResourceViewMode = ResourceData['view'];
export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';
export type AttachmentInfo = { id: string; name: string; size: number; mime: string; preview: PreviewKind; createdAt: string; src: string; canOpen: boolean };
export const viewLabels: Record<ResourceViewMode, string> = { title: '标题', link: '链接', card: '卡片', preview: '预览' };

export function resourceFromLink(title: string, src: string, meta?: string | null): ResourceData | null {
  const m = /^moki-resource:(web|video|file|note):(title|link|card|preview):([\da-f-]{36})$/i.exec(meta ?? '');
  const parsed = m && Resource.safeParse({ title, src, kind: m[1], view: m[2], id: m[3] });
  return parsed && parsed.success ? parsed.data : null;
}
export function resourceMarkdown(input: ResourceData) {
  const r = Resource.parse(input);
  const title = r.title.replace(/[\r\n]/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\[\]*_~`]/g, '\\$&');
  const src = r.src.replace(/[\s<>"\\]/g, c => encodeURIComponent(c));
  return `[${title}](<${src}> "moki-resource:${r.kind}:${r.view}:${r.id}")`;
}
export function parseResourceMarkdown(src: string) {
  const m = /^\[((?:\\.|[^\]\\\n])+)\]\(<([^>\n]+)> "(moki-resource:[^"\n]+)"\)[ \t]*(?:\n|$)/.exec(src);
  if (!m) return;
  const resource = resourceFromLink(m[1].replace(/\\(.)/g, '$1').replace(/&(amp|lt|gt);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>' })[entity]!), m[2], m[3]);
  return resource ? { resource, raw: m[0] } : undefined;
}
export function videoEmbedSource(source: string): string | null {
  try {
    const url = new URL(source);
    let id: string | null = null;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)) id = url.searchParams.get('v') ?? /^\/(?:embed|shorts)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  } catch { return null; }
}
export function remotePreview(r: ResourceData): PreviewKind | 'web' {
  if (r.kind === 'note') return 'none';
  if (r.kind === 'web') return 'web';
  if (r.kind === 'video') return videoEmbedSource(r.src) ? 'web' : 'video';
  const path = new URL(r.src, 'http://localhost').pathname.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif|bmp)$/.test(path)) return 'image';
  if (/\.(mp4|webm|ogv|mov)$/.test(path)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(path)) return 'audio';
  if (/\.pdf$/.test(path)) return 'pdf';
  return 'none';
}

// A resource remains an ordinary, portable Markdown link for other readers.
// Only standalone links with our validated metadata become resource blocks.
export function remarkResources() {
  return (tree: Root) => {
    const visit = (node: any) => {
      if (node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'link') {
        const link = node.children[0];
        const text = (n: any): string => n.value ?? n.children?.map(text).join('') ?? '';
        const resource = resourceFromLink(text(link), link.url, link.title);
        if (resource) node.data = { ...node.data, resource, hName: 'div', hProperties: { 'data-moki-resource': JSON.stringify(resource), 'data-source-start': node.position?.start.offset, 'data-source-end': node.position?.end.offset } };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
