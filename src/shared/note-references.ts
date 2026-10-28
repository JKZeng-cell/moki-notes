import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { noteIdFromSource, remarkResources, type ResourceData } from './resources.js';

export type NoteReference = { id: string; resource: ResourceData; from: number; to: number };
export function noteReferences(content: string): NoteReference[] {
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkResources);
  const tree = parser.runSync(parser.parse(content));
  const refs: NoteReference[] = [];
  const visit = (node: any) => {
    const resource = node.data?.resource as ResourceData | undefined;
    const id = resource?.kind === 'note' ? noteIdFromSource(resource.src) : undefined;
    if (id && resource && Number.isInteger(node.position?.start.offset) && Number.isInteger(node.position?.end.offset)) refs.push({ id, resource, from: node.position.start.offset, to: node.position.end.offset });
    node.children?.forEach(visit);
  };
  visit(tree); return refs;
}
export function removeNoteReferences(content: string, id: string) {
  return noteReferences(content).filter(ref => ref.id === id).sort((a, b) => b.from - a.from).reduce((text, ref) => text.slice(0, ref.from) + text.slice(ref.to), content);
}
