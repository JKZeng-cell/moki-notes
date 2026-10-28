// Match URLs conservatively, including raw HTML/code and historical content.
// A false positive retains a file; a false negative could break a reference.
export function assetReferences(content: string): string[] {
  return [...new Set([...content.matchAll(/\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content/gi)].map(match => match[1].toLowerCase()))];
}
