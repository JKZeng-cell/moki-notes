import { useRef, useState } from 'react';
import { Clock3, Cloud, ExternalLink, Search } from 'lucide-react';
import type { FeishuAutoSettings, FeishuRecord } from '../shared/feishu.js';
import type { FeishuSession } from './use-feishu-sync.js';

export const syncLabels = { synced: '已同步', changed: '待上传', missing: '云端已移出', error: '需处理' };
type Props = { busy: boolean; ready: boolean; run(action: () => Promise<void>): Promise<void>; message(text: string): void; session: FeishuSession; openNote(record: FeishuRecord): void };
export function FeishuActivity({ busy, ready, run, message, session, openNote }: Props) {
  const { overview, error } = session;
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(10);
  const recordList = useRef<HTMLDivElement>(null);
  const save = (patch: Partial<FeishuAutoSettings>) => void run(async () => {
    if (!overview) return;
    const next = await window.mokiDesktop!.feishuAutoSave({ ...overview.settings, ...patch }); await session.refresh();
    message(next.settings.enabled ? `已开启自动同步，每 ${next.settings.intervalMinutes} 分钟运行` : '自动同步已关闭');
  });
  const records = overview?.records.filter(r => r.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];
  return <>
    <section className="settings-section">
      <div className="settings-section-heading"><span className="settings-section-icon"><Clock3 size={18} /></span><div className="settings-section-copy"><h3>自动同步</h3><p>应用运行时生效，收起到托盘后继续同步</p></div><input type="checkbox" role="switch" aria-label="自动同步飞书" checked={overview?.settings.enabled ?? false} disabled={busy || !overview || (!ready && !overview.settings.enabled)} onChange={e => save({ enabled: e.target.checked })} /></div>
      {overview && <div className="feishu-auto-fields"><label>同步间隔<select aria-label="自动同步间隔" value={overview.settings.intervalMinutes} disabled={busy || !ready} onChange={e => save({ intervalMinutes: Number(e.target.value) })}>{[1,5,15,30,60,120,360,720,1440].map(n => <option key={n} value={n}>{n < 60 ? `${n} 分钟` : `${n / 60} 小时`}</option>)}</select></label><label>同步方向<select aria-label="自动同步方向" value={overview.settings.direction} disabled={busy || !ready} onChange={e => save({ direction: e.target.value as FeishuAutoSettings['direction'] })}><option value="both">双向同步</option><option value="push">上传到飞书</option><option value="pull">从飞书拉取</option></select></label></div>}
      <small className="settings-help" role="status">{session.running ? '正在同步，可关闭设置继续使用便签。' : overview?.settings.enabled && overview.nextRun ? `下次同步 ${new Date(overview.nextRun).toLocaleString('zh-CN')}` : '开启后按所选间隔运行；未保存草稿会跳过。'}</small>
      {(error || overview?.lastError) && <p className="settings-error" role="alert">{error || overview?.lastError}</p>}
      {overview?.report && <details className="settings-disclosure"><summary>最近同步 · {new Date(overview.report.at).toLocaleString('zh-CN')}</summary><p>上传 {overview.report.uploaded} · 拉取 {overview.report.downloaded} · 冲突副本 {overview.report.conflicts} · 跳过 {overview.report.skipped}</p>{overview.report.errors.length > 0 && <ul className="feishu-report-errors">{overview.report.errors.map((text, i) => <li key={i}>{text}</li>)}</ul>}</details>}
    </section>
    <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon"><Cloud size={18} /></span><div className="settings-section-copy"><h3>同步记录 <small>{overview?.records.length ?? 0}</small></h3><p>已建立云端对应关系的便签；点击标题打开</p></div></div>
      {!!overview?.records.length && <label className="feishu-record-search"><Search size={14} /><input aria-label="搜索同步记录" placeholder="搜索便签…" value={query} onChange={e => { setQuery(e.target.value); setLimit(10); if (recordList.current) recordList.current.scrollTop = 0; }} /></label>}
      <div ref={recordList} className="feishu-records" role="region" aria-label="同步记录列表" tabIndex={records.length ? 0 : undefined}>{records.slice(0,limit).map(record => <div className="feishu-record" key={record.id + record.url}><button className="feishu-record-open" onClick={() => openNote(record)}><strong title={record.title}>{record.title}</strong><small>{record.direction === 'push' ? '上传' : record.direction === 'pull' ? '拉取' : '同步'}{record.at ? ` · ${new Date(record.at).toLocaleString('zh-CN')}` : ''}</small></button><span className={`feishu-record-state ${record.status}`} title={record.error}>{syncLabels[record.status]}</span><a href={record.url} target="_blank" rel="noreferrer" aria-label={`在飞书打开 ${record.title}`} title="在飞书打开"><ExternalLink size={14} /></a></div>)}</div>
      {!records.length && <p className="settings-help">{query ? '没有匹配的记录' : '完成首次同步后，记录会显示在这里和便签列表中。'}</p>}
      {!!records.length && <div className="feishu-record-pagination"><small>已显示 {Math.min(limit, records.length)} / {records.length} 条</small>{records.length > limit && <button onClick={() => setLimit(n => n + 10)}>加载更多（{Math.min(10, records.length - limit)} 条）</button>}</div>}
      {!!records.length && <small className="settings-help">“已同步”表示本地内容与上次成功同步一致；云端新改动将在下次同步时检查。</small>}
    </section>
  </>;
}
