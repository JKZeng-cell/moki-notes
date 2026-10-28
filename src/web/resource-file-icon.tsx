import { File, FileText, FileSpreadsheet, Presentation, FileCode2, FileJson2, FileArchive, FileImage, FileAudio, FileVideo, FileType2, Box, FileCog, HardDrive, Palette, NotebookPen, Globe, BookOpen } from 'lucide-react';
import { assetIdFromSource, type AttachmentInfo, type ResourceData } from '../shared/resources.js';
import './resource-file-icon.css';

const formats = {
  word: { label: '文档', icon: FileText, tone: 'blue', extensions: 'doc docx docm dot dotx odt rtf pages wps' },
  sheet: { label: '电子表格', icon: FileSpreadsheet, tone: 'green', extensions: 'xls xlsx xlsm xlsb xlt xltx ods csv tsv numbers et' },
  slides: { label: '演示文稿', icon: Presentation, tone: 'orange', extensions: 'ppt pptx pptm pps ppsx pot potx odp key dps' },
  pdf: { label: 'PDF 文档', icon: FileText, tone: 'red', extensions: 'pdf' },
  markdown: { label: 'Markdown', icon: NotebookPen, tone: 'purple', extensions: 'md markdown mdx mdown' },
  text: { label: '文本', icon: FileText, tone: 'slate', extensions: 'txt log srt vtt ass nfo' },
  code: { label: '代码', icon: FileCode2, tone: 'blue', extensions: 'js jsx ts tsx mjs cjs py pyw java c cpp cc h hpp cs go rs rb php swift kt kts dart vue svelte html htm css scss sass less sh bash zsh ps1 bat cmd sql lua r ipynb' },
  config: { label: '数据与配置', icon: FileJson2, tone: 'teal', extensions: 'json jsonl jsonc yaml yml toml xml ini cfg conf env gitignore editorconfig lock db sqlite sqlite3' },
  archive: { label: '压缩包', icon: FileArchive, tone: 'amber', extensions: 'zip rar 7z tar gz tgz bz2 tbz2 xz txz zst cab tar.gz tar.bz2 tar.xz tar.zst' },
  image: { label: '图片', icon: FileImage, tone: 'purple', extensions: 'png jpg jpeg gif webp avif bmp svg svgz ico tif tiff heic heif raw cr2 nef dng' },
  audio: { label: '音频', icon: FileAudio, tone: 'pink', extensions: 'mp3 wav flac aac m4a ogg opus wma aiff aif mid midi' },
  video: { label: '视频', icon: FileVideo, tone: 'purple', extensions: 'mp4 mov mkv avi webm ogv m4v wmv flv mpg mpeg 3gp' },
  design: { label: '设计文件', icon: Palette, tone: 'pink', extensions: 'fig sketch psd psb ai eps xd afdesign afphoto aep prproj' },
  model: { label: '模型与 CAD', icon: Box, tone: 'teal', extensions: 'obj fbx stl gltf glb blend usdz dwg dxf step stp igs iges 3dm max c4d' },
  font: { label: '字体', icon: FileType2, tone: 'purple', extensions: 'ttf otf woff woff2 eot ttc' },
  ebook: { label: '电子书', icon: BookOpen, tone: 'amber', extensions: 'epub mobi azw azw3 fb2 djvu' },
  app: { label: '程序与安装包', icon: FileCog, tone: 'slate', extensions: 'exe msi msix msp dmg app apk aab deb rpm pkg appimage jar' },
  disk: { label: '磁盘映像', icon: HardDrive, tone: 'slate', extensions: 'iso img vhd vhdx vmdk qcow2 nrg' },
  notes: { label: 'MOKI 便签数据', icon: NotebookPen, tone: 'purple', extensions: 'mokinotes' },
  web: { label: '网页', icon: Globe, tone: 'blue', extensions: '' },
  note: { label: '便签引用', icon: FileText, tone: 'purple', extensions: '' },
  file: { label: '文件', icon: File, tone: 'slate', extensions: '' },
} as const;
type Format = keyof typeof formats;
const extensions = new Map(Object.entries(formats).flatMap(([key, value]) => value.extensions.split(' ').filter(Boolean).map(ext => [ext, key as Format] as const)));
const mimeFormats: Record<string, Format> = {
  'application/pdf': 'pdf', 'application/msword': 'word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-excel': 'sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet',
  'application/vnd.ms-powerpoint': 'slides', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slides',
  'application/zip': 'archive', 'application/x-7z-compressed': 'archive', 'application/gzip': 'archive',
  'application/json': 'config', 'application/xml': 'config', 'text/csv': 'sheet', 'text/markdown': 'markdown',
};
export function resourceFileFormat(resource: ResourceData, info?: AttachmentInfo | null) {
  if (resource.kind === 'note' || resource.kind === 'web') return { key: resource.kind, extension: '', ...formats[resource.kind] };
  let filename = info?.name ?? '';
  if (!filename && !assetIdFromSource(resource.src)) {
    try { filename = decodeURIComponent(new URL(resource.src).pathname.split('/').at(-1) ?? ''); } catch { /* Fall back to the display title. */ }
  }
  if (!filename || !info && !filename.includes('.')) filename = resource.title;
  filename = filename.split(/[\\/]/).at(-1)!.toLowerCase().trim();
  const compound = /\.((?:tar\.(?:gz|bz2|xz|zst)))$/.exec(filename)?.[1];
  const extension = compound ?? (filename.includes('.') ? filename.split('.').at(-1)! : '');
  const mime = info?.mime.split(';')[0].trim().toLowerCase() ?? '';
  const fallback: Format = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') || resource.kind === 'video' ? 'video' : mime.startsWith('font/') ? 'font' : mime.startsWith('text/') ? 'text' : 'file';
  const key = extensions.get(extension) ?? mimeFormats[mime] ?? fallback;
  return { key, extension, ...formats[key] };
}
export function ResourceFileIcon({ resource, info, compact }: { resource: ResourceData; info: AttachmentInfo | null; compact: boolean }) {
  const format = resourceFileFormat(resource, info), Icon = format.icon;
  const badge = format.key === 'notes' ? 'MOKI' : /^[a-z\d.]{1,6}$/i.test(format.extension) ? format.extension.toUpperCase() : format.key === 'file' ? 'FILE' : '';
  const label = `${format.label}${format.extension ? ` · ${format.extension.toUpperCase()}` : ''}`;
  return <span className="resource-icon file-format-icon" data-file-kind={format.key} data-file-tone={format.tone} data-compact={compact} role="img" aria-label={label} title={label}>
    <Icon size={compact ? 17 : badge ? 20 : 23} aria-hidden="true" />{!compact && badge && <small aria-hidden="true">{badge}</small>}
  </span>;
}
