import { describe, expect, it } from 'vitest';
import { importNoteFiles, type ImportProgress } from '../src/web/note-import.js';

const file = (name: string, content = '# 正文') => ({ name, size: new TextEncoder().encode(content).length, text: async () => content });

describe('batch note import', () => {
  it('imports all supported formats sequentially, strips BOM and reports progress', async () => {
    const inputs: any[] = [], progress: ImportProgress[] = []; let active = 0, peak = 0;
    const result = await importNoteFiles([file('入门.MD', '\uFEFF# 开始'), file('说明.markdown'), file('记录.txt', '')], async input => {
      peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--; inputs.push(input); return { id: String(inputs.length) };
    }, value => progress.push(value));
    expect(peak).toBe(1); expect(inputs[0]).toEqual({ title: '入门', content: '# 开始', source: '导入文件：入门.MD' });
    expect(inputs[2].content).toBe(''); expect(result).toEqual({ imported: 3, total: 3, lastId: '3', failures: [] });
    expect(progress.at(-1)).toEqual({ total: 3, completed: 3, imported: 3, failed: 0, current: '' });
  });
  it('continues after read and server failures without discarding successes', async () => {
    const result = await importNoteFiles([file('第一条.md'), { ...file('损坏.txt'), text: async () => { throw new Error('无法读取'); } }, file('失败.md'), file('最后.md')], async input => {
      if (input.title === '失败') throw new Error('服务暂不可用'); return { id: input.title! };
    }, () => {});
    expect(result.imported).toBe(2); expect(result.lastId).toBe('最后');
    expect(result.failures).toEqual([{ name: '损坏.txt', error: '无法读取' }, { name: '失败.md', error: '服务暂不可用' }]);
  });
  it('rejects unsupported and oversized files before reading and excessive characters before saving', async () => {
    let reads = 0, saves = 0;
    const unreadable = { name: '附件.pdf', size: 1, text: async () => { reads++; return ''; } };
    const result = await importNoteFiles([unreadable, { ...unreadable, name: '过大.md', size: 3_600_001 }, file('过长.txt', 'a'.repeat(900_001))], async () => { saves++; return { id: 'bad' }; }, () => {});
    expect(reads).toBe(0); expect(saves).toBe(0); expect(result.failures).toHaveLength(3); expect(result.lastId).toBeNull();
  });
  it('allows repeated filenames and handles empty selections', async () => {
    let saves = 0;
    const create = async () => ({ id: String(++saves) });
    expect((await importNoteFiles([file('重复.md'), file('重复.md')], create, () => {})).imported).toBe(2);
    expect(await importNoteFiles([], create, () => {})).toEqual({ imported: 0, total: 0, lastId: null, failures: [] });
    expect(saves).toBe(2);
  });
});
