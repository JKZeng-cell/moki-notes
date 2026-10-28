import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, Cloud, ExternalLink, Link2, LoaderCircle, RefreshCw } from 'lucide-react';
import { FeishuActivity } from './feishu-activity.js';
import type { FeishuLogin, FeishuStatus, SyncDirection, FeishuRecord } from '../shared/feishu.js';
import type { FeishuSession } from './use-feishu-sync.js';

type Props = { busy: boolean; run(action: () => Promise<void>): Promise<void>; message(text: string): void; session: FeishuSession; background(): void; openNote(record: FeishuRecord): void };
const directions = [
  { value: 'both', title: '双向同步', hint: '合并两端更新', Icon: RefreshCw },
  { value: 'push', title: '上传到飞书', hint: '本机 → 云盘', Icon: ArrowUpFromLine },
  { value: 'pull', title: '从飞书拉取', hint: '云盘 → 本机', Icon: ArrowDownToLine },
] as const;

export function FeishuSettings({ busy, run, message, session, background, openNote }: Props) {
  const [status, setStatus] = useState<FeishuStatus>({ connected: false }), [checking, setChecking] = useState(true);
  const [login, setLogin] = useState<FeishuLogin | null>(null), [appId, setAppId] = useState(''), [secret, setSecret] = useState('');
  const [folder, setFolder] = useState(''), [direction, setDirection] = useState<SyncDirection>('both');
  const [authError, setAuthError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const report = session.running ? undefined : session.overview?.report;
  useEffect(() => {
    let active = true;
    void window.mokiDesktop?.feishuStatus().then(value => { if (active) setStatus(value); })
      .catch(e => { if (active) setStatus({ connected: false, error: (e as Error).message }); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>, previous = '';
    const poll = async () => {
      try {
        const progress = await window.mokiDesktop?.feishuAuthProgress();
        if (!active || !progress) return;
        if (progress.state === 'pending') { setLogin(progress.login ?? null); setAuthError(''); }
        else if (progress.state !== previous) {
          setLogin(null); setAuthError(progress.error ?? '');
          if (progress.state === 'succeeded') { const value = await window.mokiDesktop!.feishuStatus(); if (active) { setStatus(value); message('授权成功，请连接云盘'); } }
        }
        previous = progress.state;
      } catch (e) { if (active) setAuthError((e as Error).message); }
      finally { if (active) timer = setTimeout(() => void poll(), 1000); }
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, []);
  if (!window.mokiDesktop) return <section className="settings-section"><h3>飞书同步</h3><p>请在桌面客户端中连接飞书。</p></section>;
  const ready = status.connected && status.loggedIn;
  const validApp = /^cli_[a-zA-Z0-9]+$/.test(appId.trim());
  const currentStep = !status.configured ? 0 : !status.loggedIn ? 1 : 2;
  const startLogin = () => run(async () => { setAuthError(''); setLogin(await window.mokiDesktop!.feishuLogin()); message('请在飞书中授权，完成后将自动获取登录状态'); });
  const connect = () => run(async () => { setStatus(await window.mokiDesktop!.feishuConnect(folder.trim() || undefined)); message('已连接 MOKI便签 云盘文件夹'); });
  const configuration = (<details className="settings-disclosure" open={status.configured === false}><summary>{status.configured === false ? '填写应用凭据' : '应用配置'}</summary><p>在<a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">飞书开放平台</a>创建企业自建应用，开通云盘、云文档与 Markdown 权限。</p><div className="settings-credentials"><label className="settings-field">App ID<input value={appId} aria-invalid={!!appId && !validApp} disabled={busy} onChange={e => setAppId(e.target.value)} autoComplete="off" placeholder="cli_…" /></label><label className="settings-field">App Secret<input type="password" value={secret} disabled={busy} onChange={e => setSecret(e.target.value)} autoComplete="new-password" placeholder="输入应用密钥" /></label></div>{appId && !validApp ? <small className="settings-error" role="alert">App ID 应以 cli_ 开头，请从飞书开放平台复制。</small> : <small className="settings-help">凭据仅保存在本机，不随便签同步。</small>}<div className="settings-transfer-actions"><button disabled={busy || !validApp || secret.length < 8} onClick={() => void run(async () => { try { setStatus(await window.mokiDesktop!.feishuConfigure({ appId: appId.trim(), secret })); setLogin(null); message('配置已保存，请登录飞书'); } finally { setSecret(''); } })}>保存应用配置</button></div></details>);
  return <>
    <section className="settings-section">
      <div className="settings-section-heading"><span className="settings-section-icon"><Cloud size={18} /></span><div className="settings-section-copy"><h3>飞书云盘</h3><p>{checking ? '正在读取连接状态…' : ready ? `${status.authUser ?? status.user ?? '飞书用户'} · MOKI便签` : '在不同设备间同步便签与附件'}</p></div><span className={`settings-badge ${ready ? 'connected' : ''}`}>{checking ? '检查中' : ready ? '已连接' : status.loggedIn ? '待连接' : '未连接'}</span></div>
      {!checking && !ready && <ol className="feishu-steps" aria-label="连接步骤">{['配置应用', '登录授权', '连接云盘'].map((step, i) => <li key={step} aria-current={i === currentStep ? 'step' : undefined} className={i < currentStep ? 'done' : ''}><span>{i < currentStep ? <Check size={12} /> : i + 1}</span>{step}</li>)}</ol>}
      {status.error && <p className="settings-error" role="alert">{status.error}</p>}
      {!checking && !ready && <>
        <p className="settings-help">{status.configured === false ? '首次使用需要你自己的飞书应用凭据。完成配置后即可扫码登录。' : !status.loggedIn ? '使用飞书扫码授权，便签只会同步到你的云盘。' : '将创建或复用云盘中的「MOKI便签」文件夹。'}</p>
        {status.configured !== false && <div className="settings-transfer-actions"><button className="primary" disabled={busy || !!login || !status.cliPath} onClick={() => void (status.loggedIn ? connect() : startLogin())}><Link2 size={15} />{status.loggedIn ? '连接云盘' : '登录飞书'}</button></div>}
      </>}
      {ready && status.url && <a className="settings-inline-link" href={status.url} target="_blank" rel="noreferrer">打开云盘文件夹<ExternalLink size={13} /></a>}
      {login && <div className="settings-feishu-login"><img src={login.qr} width={148} height={148} alt="飞书授权二维码" /><div><h3>使用飞书扫码</h3><p>有效期至 {new Date(login.expiresAt).toLocaleTimeString()}</p><a className="settings-inline-link" href={login.url} target="_blank" rel="noreferrer">在浏览器中授权<ExternalLink size={13} /></a><p role="status">正在等待授权，完成后自动连接登录状态…</p><button disabled={busy} onClick={() => void run(async () => { await window.mokiDesktop!.feishuAuthCancel(); setLogin(null); message('已停止等待授权'); })}>取消等待</button></div></div>}
      {authError && <p className="settings-error" role="alert">{authError}</p>}
      {!checking && status.configured === false && configuration}

      <details className="settings-disclosure"><summary>高级设置与连接诊断</summary>
        {!checking && status.configured !== false && configuration}
        <p>{status.cliSource === 'bundled' ? `内置 CLI ${status.cliVersion}，无需额外安装。` : status.cliPath ? '正在使用自定义或系统 CLI。' : '未找到可用 CLI，请尝试恢复内置版本。'}</p><small className="settings-path-text">{status.cliPath}</small>
        <div className="settings-transfer-actions"><button disabled={busy || checking} onClick={() => void run(async () => { setChecking(true); try { setStatus(await window.mokiDesktop!.feishuStatus()); message('连接状态已刷新'); } finally { setChecking(false); } })}><RefreshCw size={14} />刷新状态</button><button disabled={busy || !!login || !status.cliPath || status.configured === false} onClick={() => void startLogin()}>重新授权</button><button disabled={busy || !status.loggedIn} onClick={() => void connect()}>重新检查连接</button></div>
        <details className="settings-disclosure"><summary>CLI 程序与文件夹</summary><div className="settings-transfer-actions"><button disabled={busy} onClick={() => void run(async () => { setStatus(await window.mokiDesktop!.feishuChooseCli()); setLogin(null); })}>选择 CLI 程序</button><button disabled={busy} onClick={() => void run(async () => { setStatus(await window.mokiDesktop!.feishuResetCli()); setLogin(null); message('已恢复使用内置 CLI'); })}>恢复使用内置 CLI</button></div><label className="settings-field settings-help">已有文件夹 token<input value={folder} disabled={busy} onChange={e => setFolder(e.target.value)} placeholder="留空时自动创建或复用" /></label><small className="settings-help">存在多个同名文件夹时填写，再点击“重新检查连接”。</small></details>
      </details>
    </section>
    <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon"><RefreshCw size={18} /></span><div className="settings-section-copy"><h3>同步便签</h3><p>{(session.overview?.report?.at || status.lastSync) ? `上次同步 ${new Date(session.overview?.report?.at || status.lastSync!).toLocaleString('zh-CN')}` : '选择方向，合并内容；不会同步删除'}</p></div></div>
      <fieldset className="sync-direction" disabled={busy || !!login || !ready}><legend className="sr-only">同步方向</legend>{directions.map(({value,title,hint,Icon}) => <label className={direction === value ? 'selected' : ''} key={value}><input type="radio" name="sync-direction" value={value} checked={direction === value} onChange={() => { setDirection(value); setConfirm(false); }} /><Icon size={17} /><strong>{title}</strong><small>{hint}</small></label>)}</fieldset>
      <div className="sync-start-row"><small>{session.running ? '正在同步，可收起到后台继续使用便签。' : ready ? '同步前请保存正在编辑的便签。' : '完成上方连接后即可同步。'}</small>{session.running ? <button onClick={background}><LoaderCircle className="settings-spinner" size={14} />收起到后台</button> : <button className="primary" disabled={busy || !ready} onClick={() => setConfirm(true)}><RefreshCw size={14} />开始同步</button>}</div>
      {confirm && <div className="settings-confirm" role="group" aria-label="确认同步"><p>{directions.find(item => item.value === direction)?.title} · MOKI便签</p><small>目标：{status.user ?? status.authUser}。更新已对应的内容并创建新增内容，不删除任一端文件。</small><div className="settings-buttons"><button disabled={busy} onClick={() => setConfirm(false)}>取消</button><button className="primary" disabled={busy} onClick={() => { setConfirm(false); session.start(direction); }}>确认开始同步</button></div></div>}
      {report && <div className="settings-sync-report" role="status"><div className="sync-result-grid">{[['上传',report.uploaded],['拉取',report.downloaded],['冲突副本',report.conflicts],['跳过',report.skipped]].map(([label,value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>{report.errors.length > 0 && <details open><summary>需要处理的项目（{report.errors.length}）</summary><ul>{report.errors.map((error,i) => <li key={i}>{error}</li>)}</ul></details>}</div>}
      <details className="settings-disclosure"><summary>同步范围与冲突处理</summary><p>Markdown 与附件可双向同步；飞书原生云文档和非 Markdown 文件仅拉取。两端同时修改会保留冲突副本；有未保存草稿的便签会跳过。</p><p>需要迁移历史版本和草稿？请使用“数据与存储”中的数据包。</p></details>
    </section>
    <FeishuActivity session={session} busy={busy} ready={!!ready && !login} run={run} message={message} openNote={openNote} />
  </>;
}
