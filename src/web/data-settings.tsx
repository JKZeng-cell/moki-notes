import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Database } from 'lucide-react';
import type { TransferPreview } from '../server/transfer.js';
import type { Appearance, AutoSave } from '../shared/settings.js';
import { api } from './api.js';
import { announceAppearance } from './appearance.js';
import { announceAutoSave } from './use-autosave.js';

type Props = { busy: boolean; run(action: () => Promise<void>): Promise<void>; message(text: string): void; changed(): void };
export function TransferSettings({ busy, run, message, changed }: Props) {
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  if (!window.mokiDesktop) return <section className="settings-section"><h3>设备迁移</h3><p>请在桌面客户端中导出或导入完整数据包。</p></section>;
  return <section className="settings-section settings-transfer-section"><div className="settings-section-heading"><span className="settings-section-icon"><Database size={18} /></span><div className="settings-section-copy"><h3>设备迁移</h3><p>备份全部内容，或迁移到另一台设备</p></div></div><details className="settings-disclosure"><summary>包含哪些数据？</summary><p>便签、列表分组与排序、附件、知识树、历史、回收站、草稿与偏好设置。登录凭据和缓存路径不会导出。</p><p>导入会合并内容；已有便签不覆盖，冲突保留副本。</p></details>
    <div className="settings-transfer-actions"><button disabled={busy} onClick={() => void run(async () => { const result = await window.mokiDesktop!.transferExport(); message(result ? `已导出 ${result.notes} 条便签、${result.attachments} 个附件：${result.path}` : '已取消导出'); })}><ArrowUpFromLine size={15} />导出全部数据</button><button disabled={busy} onClick={() => void run(async () => { setPreview(await window.mokiDesktop!.transferPreview()); })}><ArrowDownToLine size={15} />导入数据包</button></div>
    {preview && <div className="settings-confirm" role="group" aria-label="确认导入"><p>{preview.notes} 条便签 · {preview.revisions} 个历史版本 · {preview.attachments} 个附件</p><small>{preview.drafts} 份草稿 · 导出于 {new Date(preview.exportedAt).toLocaleString('zh-CN')}</small><small>与本机合并，已有便签不覆盖；相同 ID 内容不同时保留副本，重复导入同一数据包不会重复创建。字号、自动保存和布局偏好采用迁移包设置。</small><div className="settings-buttons"><button disabled={busy} onClick={() => setPreview(null)}>取消</button><button className="primary" disabled={busy} onClick={() => void run(async () => {
      const result = await window.mokiDesktop!.transferImport(preview.ticket);
      try {
        for (const [key, value] of Object.entries(result.local)) {
          let target = key;
          if (key.startsWith('moki-notes:draft:') && localStorage.getItem(key) && localStorage.getItem(key) !== value) {
            if (Object.keys(localStorage).some(k => k.startsWith(key.split(':').slice(0, 3).join(':') + ':') && localStorage.getItem(k) === value)) continue;
            target = key.split(':').slice(0, 3).join(':') + ':' + crypto.randomUUID();
          }
          localStorage.setItem(target, value);
          window.dispatchEvent(new StorageEvent('storage', { key: target, newValue: value }));
        }
      } catch { throw Error('便签已导入，但本机草稿存储空间不足。请保留迁移包，释放空间后重新导入以恢复草稿。'); }
      window.dispatchEvent(new Event('moki-data-imported'));
      announceAppearance(await api<Appearance>('/settings/appearance')); announceAutoSave(await api<AutoSave>('/settings/autosave'));
      setPreview(null); changed(); message(result.alreadyImported ? '此数据包已导入，已恢复设置与草稿，未重复创建便签' : `导入完成：新增 ${result.imported} 条，跳过 ${result.skipped} 条相同便签`);
    })}>确认合并导入</button></div></div>}
  </section>;
}
