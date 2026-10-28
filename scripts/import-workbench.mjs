// Explicit, read-only source migration. Never opens the workbench DB for writing.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { NotesStore } from '../dist/server/store.js';
const arg = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const from = arg('--from'), to = arg('--to'), apply = process.argv.includes('--apply');
if (!from || !to) throw new Error('用法：node scripts/import-workbench.mjs --from <工作台数据库> --to <独立便签数据库> [--apply]。默认仅预览数量。');
if (resolve(from).toLowerCase() === resolve(to).toLowerCase()) throw new Error('来源和目标数据库必须不同');
const source = new DatabaseSync(resolve(from), { readOnly: true });
let rows;
try { rows = source.prepare('SELECT id,content,color,archived,created_at,updated_at FROM memo_notes ORDER BY created_at').all(); }
finally { source.close(); }
if (!apply) console.log(JSON.stringify({ mode: 'preview', count: rows.length, archived: rows.filter(r => r.archived).length, sourceReadOnly: true, targetNotOpened: true }, null, 2));
else {
  const target = new NotesStore(resolve(to));
  try {
    const imported = target.preference('workbench-imports', {}); let count = 0, skipped = 0;
    for (const row of rows) {
      const key = `${resolve(from)}:${row.id}`;
      if (imported[key]) { skipped++; continue; }
      const title = row.content.split(/\r?\n/).map(s => s.replace(/^[#>\s]+/, '').trim()).find(Boolean)?.slice(0, 200) || '空白便签';
      const note = target.create({ title, content: row.content, color: row.color, archived: !!row.archived, source: `MOKI工作台便签 ${row.id}；原创建 ${row.created_at}；原更新 ${row.updated_at}` }, 'workbench-import');
      imported[key] = note.id; target.setPreference('workbench-imports', imported); count++;
    }
    console.log(JSON.stringify({ imported: count, skipped, sourceReadOnly: true }, null, 2));
  } finally { target.close(); }
}
