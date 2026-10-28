import { useEffect, useRef } from 'react';
import { Check, FileInput, LoaderCircle, X } from 'lucide-react';
import type { ImportProgress, ImportResult } from './note-import.js';

export function NoteImportDialog({ progress, result, onClose }: { progress: ImportProgress; result: ImportResult | null; onClose(): void }) {
  const done = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null);
  useEffect(() => { if (result) done.current?.focus(); else panel.current?.focus(); }, [!!result]);
  return <div className="modal-backdrop" onClick={() => { if (result) onClose(); }}>
    <section className="dialog note-import-dialog" role="dialog" aria-modal="true" aria-label="批量导入便签" ref={panel} tabIndex={-1} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (result) onClose(); } }}>
      <header><h2><FileInput size={18} />{result ? '导入完成' : '正在导入便签'}</h2><button aria-label="关闭导入结果" disabled={!result} onClick={onClose}><X size={18} /></button></header>
      <div className="note-import-body">
        <p role="status">{result ? <Check size={17} /> : <LoaderCircle className="settings-spinner" size={17} />}{result ? `已导入 ${result.imported} / ${result.total} 个文件` : `正在处理 ${Math.min(progress.completed + 1, progress.total)} / ${progress.total} 个文件`}</p>
        {!result && <><progress aria-label="批量导入进度" value={progress.completed} max={progress.total} /><small className="note-import-current" title={progress.current}>{progress.current || '正在更新列表…'}</small></>}
        {result && !result.failures.length && <small>每个文件已保存为一条便签，可在“全部便签”中查看。</small>}
        {!!result?.failures.length && <><p className="note-import-warning">{result.failures.length} 个文件未导入{result.imported ? '，其他文件已保存。' : '，请检查后重试。'}</p><ul className="note-import-failures" aria-label="未导入文件">{result.failures.map((failure, index) => <li key={index}><strong>{failure.name}</strong><span>{failure.error}</span></li>)}</ul></>}
      </div>
      <footer><button ref={done} className="primary" disabled={!result} onClick={onClose}>完成</button></footer>
    </section>
  </div>;
}
