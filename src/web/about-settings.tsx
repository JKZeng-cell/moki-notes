import { useEffect, useRef, useState } from 'react';
import { Copy, Mail, UserRound } from 'lucide-react';
import { APP_NAME, APP_DEVELOPER, APP_DEVELOPER_EMAIL, DEVELOPER_CONTACT_URL } from '../shared/app-metadata.js';
import { api } from './api.js';

export function AboutSettings({ busy, run, message }: { busy: boolean; run(action: () => Promise<void>): Promise<void>; message(text: string): void }) {
  const [version, setVersion] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const emailField = useRef<HTMLInputElement>(null);
  useEffect(() => { if (manualCopy) { emailField.current?.focus(); emailField.current?.select(); } }, [manualCopy]);
  useEffect(() => { let active = true; void (window.mokiDesktop?.appVersion() ?? api<{ version: string }>('/health').then(info => info.version)).then(value => { if (active) setVersion(value); }).catch(() => { if (active) setVersion('不可用'); }); return () => { active = false; }; }, []);
  return <>
    <section className="settings-section settings-about-brand" aria-label="应用信息"><img src="/icon.svg" alt="" width={52} height={52} /><div><h3>{APP_NAME}</h3><p>记录想法，连接知识</p><span className="settings-version">{version ? version === '不可用' ? '暂时无法读取版本' : `版本 ${version}` : '正在读取版本…'}</span></div></section>
    <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon"><UserRound size={18} /></span><div className="settings-section-copy"><h3>开发者与反馈</h3><p>使用问题或建议，欢迎联系</p></div></div>
      <dl className="settings-developer-info"><div><dt>开发者</dt><dd>{APP_DEVELOPER}</dd></div><div><dt>联系邮箱</dt><dd>{APP_DEVELOPER_EMAIL}</dd></div></dl>
      <div className="settings-contact-actions"><a className="primary" href={DEVELOPER_CONTACT_URL} aria-disabled={busy} onClick={e => {
        if (busy) { e.preventDefault(); return; }
        if (!window.mokiDesktop) return;
        e.preventDefault(); void run(async () => { try { await window.mokiDesktop!.contactDeveloper(); } catch { throw Error(`无法打开默认邮件应用，请复制邮箱联系：${APP_DEVELOPER_EMAIL}`); } message('已请求打开默认邮件应用；若未打开，可复制邮箱联系'); });
      }}><Mail size={15} />联系开发者</a><button disabled={busy} onClick={() => void run(async () => {
        try {
          if (window.mokiDesktop) await window.mokiDesktop.copyDeveloperEmail();
          else await navigator.clipboard.writeText(APP_DEVELOPER_EMAIL);
          setManualCopy(false);
          message(window.mokiDesktop ? '开发者邮箱已复制' : '已请求复制邮箱，请粘贴确认');
        } catch {
          setManualCopy(true);
          emailField.current?.focus(); emailField.current?.select();
          throw Error('复制未成功，请选中下方邮箱，按 Ctrl+C（Mac：⌘C）手动复制');
        }
      })}><Copy size={15} />复制邮箱</button></div>
      {manualCopy && <label className="settings-field settings-help">手动复制邮箱<input ref={emailField} readOnly value={APP_DEVELOPER_EMAIL} onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()} /></label>}
      <small className="settings-help">通过默认邮件应用发送，或复制邮箱自行联系。</small>
    </section>
  </>;
}
