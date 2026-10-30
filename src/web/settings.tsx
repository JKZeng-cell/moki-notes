import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Clock3, LoaderCircle, FolderOpen, HardDrive, Power, Settings2, Trash2, Type, X } from 'lucide-react';
import { announceAppearance } from './appearance.js';
import { TransferSettings } from './data-settings.js';
import { FeishuSettings } from './feishu-settings.js';
import { AboutSettings } from './about-settings.js';
import type { FeishuSession } from './use-feishu-sync.js';

const settingTabs = [['general', '偏好设置'], ['data', '数据与存储'], ['feishu', '飞书同步'], ['about', '关于与联系']] as const;
import { api } from './api.js';
import { announcePurged, draftAssets, purgeMessage } from './trash-data.js';
import { announceAutoSave } from './use-autosave.js';
import type { Appearance, AutoSave, CacheInfo, TrashPreview, PurgeResult, StartupSettings } from '../shared/settings.js';

export function Settings({ onClose, onClean, feishu, initialTab = 'general' }: { onClose(): void; onClean(ids: string[]): void; feishu: FeishuSession; initialTab?: 'general' | 'feishu' }) {
  const [auto, setAuto] = useState<AutoSave | null>(null), [cache, setCache] = useState<CacheInfo | null>(null), [trash, setTrash] = useState<TrashPreview | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [confirming, setConfirming] = useState(false);
  const [tab, setTab] = useState<(typeof settingTabs)[number][0]>(initialTab);
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [startup, setStartupState] = useState<StartupSettings | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  async function load() {
    setError('');
    const results = await Promise.allSettled([api<AutoSave>('/settings/autosave'), api<TrashPreview>('/trash/preview'), window.mokiDesktop?.cacheInfo(), api<Appearance>('/settings/appearance'), window.mokiDesktop?.getStartup()]);
    if (results[0].status === 'fulfilled') setAuto(results[0].value);
    if (results[1].status === 'fulfilled') setTrash(results[1].value);
    if (results[2].status === 'fulfilled') setCache(results[2].value ?? null);
    if (results[3].status === 'fulfilled') setAppearance(results[3].value);
    if (results[4].status === 'fulfilled') setStartupState(results[4].value ?? { supported: false, enabled: false, reason: '请在桌面应用中设置' });
    const failed = results.find(r => r.status === 'rejected');
    if (failed?.status === 'rejected') setError(`读取设置失败：${String(failed.reason)}`);
  }
  useEffect(() => { const previous = document.activeElement as HTMLElement; close.current?.focus(); void load(); return () => previous?.focus(); }, []);
  useEffect(() => {
    if (busy || tab !== 'general' || !window.mokiDesktop) return;
    let active = true;
    const refresh = () => { void window.mokiDesktop!.getStartup().then(value => { if (active) setStartupState(value); }).catch(() => { if (active) setError('读取设置失败：无法读取系统启动项'); }); };
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [busy, tab]);
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setMessage(''); setError('');
    try { await action(); } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method ['"][^'"]+['"]: (?:Error: )?/, '')); } finally { setBusy(false); }
  }
  const update = (next: AutoSave) => run(async () => {
    const saved = await api<AutoSave>('/settings/autosave', 'PUT', next);
    setAuto(saved); announceAutoSave(saved); setMessage('自动保存设置已生效');
  });
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}><section role="dialog" aria-modal="true" aria-label="设置" className="dialog settings-dialog" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) { if (confirming) setConfirming(false); else onClose(); } } }}>
    <header><div><h2><Settings2 size={19} />设置</h2></div><button ref={close} aria-label="关闭设置" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    <div className="settings-tabs" role="tablist" aria-label="设置分类">{settingTabs.map(([id, label], index, tabs) => <button role="tab" id={`settings-tab-${id}`} aria-controls={`settings-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} disabled={busy} key={id} onClick={() => { setTab(id); setMessage(''); setError(''); }} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length; setTab(tabs[next][0]); setMessage(''); setError(''); (e.currentTarget.parentElement!.children[next] as HTMLElement).focus(); } }}>{label}</button>)}</div>
    <div key={tab} className="settings-body" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
      {tab === 'general' && <><section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon"><Type size={18} /></span><div className="settings-section-copy"><h3>字体大小</h3><p>调整编辑器和桌面便签的文字大小</p></div></div><div className="settings-row"><label htmlFor="note-font-size">正文字号</label><select id="note-font-size" value={appearance?.fontSize ?? 14} disabled={!appearance || busy} onChange={e => void run(async () => { const next = await api<Appearance>('/settings/appearance', 'PUT', { fontSize: Number(e.target.value) }); setAppearance(next); announceAppearance(next); setMessage('字体大小已生效'); })}>{[12,14,16,18,20,22,24].map(size => <option key={size} value={size}>{size} px{size === 14 ? ' · 默认' : ''}</option>)}</select></div><div className="settings-font-preview" style={{ '--preview-font-size': `${appearance?.fontSize ?? 14}px` } as CSSProperties}>留住灵感，让知识慢慢生长。<br />MOKI Notes · 1234567890</div></section>
      <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon"><Clock3 size={18} /></span><div className="settings-section-copy"><h3><label htmlFor="autosave-enabled">自动保存</label></h3><p>停止输入后，自动保存修改</p></div><input id="autosave-enabled" aria-label="自动保存便签" type="checkbox" role="switch" checked={auto?.enabled ?? false} disabled={!auto || busy} onChange={e => auto && void update({ ...auto, enabled: e.target.checked })} /></div>
        <div className="settings-row"><div className="settings-row-copy"><label htmlFor="autosave-delay">等待时间</label></div><select id="autosave-delay" value={auto?.delayMs ?? 750} disabled={!auto?.enabled || busy} onChange={e => auto && void update({ ...auto, delayMs: Number(e.target.value) as AutoSave['delayMs'] })}><option value={750}>0.75 秒</option><option value={1500}>1.5 秒</option><option value={3000}>3 秒</option><option value={5000}>5 秒</option></select></div>
        <small className="settings-help">{auto?.enabled ? '无需手动保存，修改后自动生效。' : '已关闭，请使用 Ctrl / ⌘ + S 保存；未保存内容保留为草稿。'}</small>
      </section>
      <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon"><Power size={18} /></span><div className="settings-section-copy"><h3><label htmlFor="startup-enabled">开机自启动</label></h3><p>{startup?.supported ? '登录系统后自动启动 MOKI便签' : startup?.reason ?? '正在读取系统设置…'}</p></div><input id="startup-enabled" aria-label="开机自启动" type="checkbox" role="switch" checked={startup?.enabled ?? false} disabled={!startup?.supported || busy} onChange={e => { const enabled = e.target.checked; void run(async () => { const saved = await window.mokiDesktop!.setStartup(enabled); setStartupState(saved); setMessage(saved.enabled ? '已开启开机自启动' : '已关闭开机自启动'); }); }} /></div></section>
      </>}
      {tab === 'data' && <><TransferSettings busy={busy} run={run} message={setMessage} changed={() => { void load(); onClean([]); }} />
      <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon"><HardDrive size={18} /></span><div className="settings-section-copy"><h3>应用缓存</h3><p>清理临时文件，不影响便签和附件</p></div></div>
        {window.mokiDesktop ? <><details className="settings-disclosure"><summary>缓存位置</summary><div className="settings-path"><label className="settings-field" htmlFor="cache-path">缓存路径<input id="cache-path" readOnly value={cache?.path ?? '正在读取…'} title={cache?.path} /></label><div className="settings-path-actions"><button disabled={!cache || busy} onClick={() => void run(async () => { setCache(await window.mokiDesktop!.chooseCache()); })}><FolderOpen size={15} />更改路径</button><button className="settings-text-button" disabled={!cache || busy || cache.path === cache.defaultPath} onClick={() => void run(async () => { setCache(await window.mokiDesktop!.chooseCache(true)); })}>恢复默认</button></div></div></details>
          {cache?.restartRequired && <p className="settings-notice">已保存新路径，下次完全退出并重新打开后生效。当前路径：<span>{cache.activePath}</span></p>}
          {cache?.error && <p className="settings-error">{cache.error}</p>}
          <div className="settings-cache-summary"><span>缓存占用 <strong>{cache ? `${(cache.bytes / 1024 / 1024).toFixed(1)} MB` : '—'}</strong></span><button disabled={!cache || busy} onClick={() => void run(async () => { setCache(await window.mokiDesktop!.clearCache()); setMessage('当前页面与代码缓存已清理，便签和草稿已保留'); })}>清理缓存</button></div>

        </> : <small>缓存路径由浏览器管理，请在 MOKI便签桌面客户端中设置。</small>}
      </section>
      <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon"><Trash2 size={18} /></span><div className="settings-section-copy"><h3>回收站</h3><p>彻底删除后无法恢复</p></div></div>
        <div className="settings-trash"><div><div className="settings-trash-count"><strong>{trash?.total ?? '—'}</strong><span>条便签</span></div><small>{trash ? `可清理 ${trash.candidates.length} 条 · ${trash.pendingAssets} 个待处理附件` : '正在读取…'}</small></div><button className="settings-danger" disabled={(!trash?.candidates.length && !trash?.pendingAssets) || busy} onClick={() => void run(async () => { setTrash(await api<TrashPreview>('/trash/preview')); setConfirming(true); })}>清空回收站</button></div><small className="settings-help">删除所选便签的历史、草稿和独占附件，共用附件保留。</small>
        {confirming && trash && <div className="settings-confirm" role="group" aria-label="确认清理"><p>确认永久删除 {trash.candidates.length} 条便签和 {trash.revisions} 个历史版本？</p><small>其他便签会保留；指向删除便签的父级和关联将解除。共用附件保留。</small><div className="settings-buttons"><button disabled={busy} onClick={() => setConfirming(false)}>取消</button><button className="settings-danger" disabled={busy || (!trash.candidates.length && !trash.pendingAssets)} onClick={() => void run(async () => {
          try {
            const result = await api<PurgeResult>('/trash/clear', 'POST', { candidates: trash.candidates, protectedAssets: draftAssets(trash.candidates.map(n => n.id)) });
            announcePurged(result.ids);
            onClean(result.ids); setMessage(purgeMessage(result));
          } finally { setConfirming(false); setTrash(await api<TrashPreview>('/trash/preview')); }
        })}>确认永久清理</button></div></div>}
      </section>
      </>}
      {tab === 'about' && <AboutSettings busy={busy} run={run} message={setMessage} />}
      {tab === 'feishu' && <FeishuSettings session={feishu} background={onClose} openNote={record => { onClose(); window.dispatchEvent(new CustomEvent('moki:open-note', { detail: { id: record.id, archived: record.archived } })); }} busy={busy || feishu.running} run={run} message={setMessage} />}
    </div>
    <footer className="settings-footer">{!error && <span className="settings-save-status" role="status">{busy ? <LoaderCircle className="settings-spinner" size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{busy ? '正在处理，请稍候…' : message || (tab === 'general' ? '修改即时生效' : '数据保存在本机')}</span>}{error && <span className="settings-error" role="alert">{error}<button disabled={busy} onClick={() => error.startsWith('读取设置失败') ? void load() : setError('')}>{error.startsWith('读取设置失败') ? '重新读取' : '关闭提示'}</button></span>}</footer>
  </section></div>;
}
