import type { Root } from 'mdast';

export function imageWidth(value: unknown): number | null {
  const width = Number(value);
  return Number.isInteger(width) && width >= 48 && width <= 8192 ? width : null;
}
export function readImageTitle(title?: string | null) {
  const match = /^moki-image:(\d+):(.*)$/.exec(title ?? '');
  if (match && imageWidth(match[1])) {
    try { return { width: imageWidth(match[1]), title: decodeURIComponent(match[2]) || null }; } catch { /* Preserve malformed titles as text. */ }
  }
  return { width: null, title: title || null };
}
export function writeImageTitle(width: unknown, title?: string | null) {
  const value = imageWidth(width);
  return value ? `moki-image:${value}:${encodeURIComponent(title ?? '')}` : title || null;
}
export function remarkImageSize() {
  return (tree: Root) => {
    const visit = (node: any) => {
      if (node.type === 'image') {
        const parsed = readImageTitle(node.title);
        if (parsed.width) { node.title = parsed.title; node.data = { ...node.data, hProperties: { ...node.data?.hProperties, width: parsed.width, style: 'height:auto;max-width:100%' } }; }
      }
      node.children?.forEach(visit);
    }; visit(tree);
  };
}
