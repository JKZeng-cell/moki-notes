export type HistoricalTag = { tag: string; count: number };
export function addTags(current: string[], input: string) {
  const added = input.split(/[,，;；\r\n]+/).map(tag => tag.trim().replace(/^#/, '').trim()).filter(Boolean);
  if (added.some(tag => tag.length > 60)) throw new Error('每个标签最多 60 个字符');
  const result = [...new Set([...current, ...added])];
  if (result.length > 40) throw new Error('每条便签最多 40 个标签');
  return result;
}
