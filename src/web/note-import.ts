import type { NoteInput } from '../shared/model.js';
import type { z } from 'zod';

type ImportFile = Pick<File, 'name' | 'size' | 'text'>;
export type ImportProgress = { total: number; completed: number; imported: number; failed: number; current: string };
export type ImportResult = { imported: number; total: number; lastId: string | null; failures: Array<{ name: string; error: string }> };

export async function importNoteFiles(files: ImportFile[], create: (input: z.input<typeof NoteInput>) => Promise<{ id: string }>, progress: (value: ImportProgress) => void) {
  const result: ImportResult = { imported: 0, total: files.length, lastId: null, failures: [] };
  for (const [index, file] of files.entries()) {
    progress({ total: files.length, completed: index, imported: result.imported, failed: result.failures.length, current: file.name });
    try {
      if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('仅支持 Markdown / TXT 文件');
      if (file.size > 3_600_000) throw new Error('文件超过 3.6 MB');
      const content = (await file.text()).replace(/^\uFEFF/, '');
      if (content.length > 900_000) throw new Error('正文超过 90 万字符');
      const note = await create({ title: file.name.replace(/\.[^.]+$/, '').trim().slice(0, 200) || '未命名便签', content, source: `导入文件：${file.name}`.slice(0, 2000) });
      result.imported++; result.lastId = note.id;
    } catch (e) { result.failures.push({ name: file.name, error: e instanceof Error ? e.message : '读取或导入失败' }); }
    progress({ total: files.length, completed: index + 1, imported: result.imported, failed: result.failures.length, current: '' });
  }
  return result;
}
