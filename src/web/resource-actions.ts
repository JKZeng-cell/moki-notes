import { assetIdFromSource, videoEmbedSource, type ResourceData } from '../shared/resources.js';
import { openNoteAttachment, referencedNote } from './note-attachment.js';

export async function openEmbeddedResource(resource: ResourceData) {
  if (resource.kind === 'note') return openNoteAttachment(resource);
  if (window.mokiDesktop) return window.mokiDesktop.openResource(resource);
  const link = document.createElement('a'); link.href = resource.src; link.target = '_blank'; link.rel = 'noopener noreferrer';
  if (assetIdFromSource(resource.src)) { link.href += '?download=1'; link.download = resource.title; }
  link.click();
}
export async function saveEmbeddedResource(resource: ResourceData) {
  if (resource.kind === 'note') {
    const note = await referencedNote(resource);
    if (window.mokiDesktop) return window.mokiDesktop.export(note.id, 'md');
    const link = document.createElement('a'); link.href = `/api/notes/${note.id}/export/md`; link.download = `${note.title}.md`; link.click(); return true;
  }
  if (window.mokiDesktop) return window.mokiDesktop.saveResource(resource);
  const link = document.createElement('a'), local = assetIdFromSource(resource.src);
  if (!local && (resource.kind === 'web' || videoEmbedSource(resource.src))) {
    const url = URL.createObjectURL(new Blob([`[InternetShortcut]\r\nURL=${resource.src}\r\n`], { type: 'application/octet-stream' }));
    link.href = url; link.download = `${resource.title}.url`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else { link.href = resource.src + (local ? '?download=1' : ''); link.download = resource.title; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.click(); }
  return true;
}
