export const windowId = sessionStorage.getItem('moki-notes:window') ?? crypto.randomUUID();
sessionStorage.setItem('moki-notes:window', windowId);
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.message ?? '请求失败'), { code: value.error, status: response.status });
  return value as T;
}
declare global {
  interface Window {
    mokiDesktop?: {
      appVersion(): Promise<string>;
      getStartup(): Promise<import('../shared/settings.js').StartupSettings>;
      setStartup(enabled: boolean): Promise<import('../shared/settings.js').StartupSettings>;
      contactDeveloper(): Promise<void>;
      copyDeveloperEmail(): Promise<void>;
      transferExport(): Promise<{ notes: number; revisions: number; attachments: number; bytes: number; path: string } | null>;
      transferPreview(): Promise<import('../server/transfer.js').TransferPreview | null>;
      transferImport(ticket: string): Promise<import('../server/transfer.js').TransferResult>;
      feishuStatus(): Promise<import('../shared/feishu.js').FeishuStatus>;
      feishuLogin(): Promise<import('../shared/feishu.js').FeishuLogin>;
      feishuAuthProgress(): Promise<import('../shared/feishu.js').FeishuAuthProgress>;
      feishuAuthCancel(): Promise<void>;
      feishuOverview(): Promise<import('../shared/feishu.js').FeishuOverview>;
      feishuAutoSave(settings: import('../shared/feishu.js').FeishuAutoSettings): Promise<import('../shared/feishu.js').FeishuOverview>;
      feishuConfigure(value: { appId: string; secret: string }): Promise<import('../shared/feishu.js').FeishuStatus>;
      feishuResetCli(): Promise<import('../shared/feishu.js').FeishuStatus>;
      feishuChooseCli(): Promise<import('../shared/feishu.js').FeishuStatus>;
      feishuConnect(folder?: string): Promise<import('../shared/feishu.js').FeishuStatus>;
      feishuSync(direction: import('../shared/feishu.js').SyncDirection): Promise<import('../shared/feishu.js').SyncReport>;
      importResources(video?: boolean): Promise<import('../shared/resources.js').AttachmentInfo[]>;
      openResource(resource: import('../shared/resources.js').ResourceData): Promise<void>;
      saveResource(resource: import('../shared/resources.js').ResourceData): Promise<boolean>;
      copyResourceFile(resource: import('../shared/resources.js').ResourceData): Promise<void>;
      copyResourceImage(data: Uint8Array): Promise<void>;
      textClipboardAction(action: 'copy' | 'cut' | 'paste'): Promise<void>;
      pin(id: string, edit?: boolean): Promise<boolean>; unpin(id: string): Promise<boolean>;
      pins(): Promise<{ ids: string[]; top: boolean }>; top(value: boolean): Promise<void>;
      manager(id?: string): Promise<void>; onSelect(callback: (id: string) => void): () => void;
      fullscreen(): Promise<boolean>; close(): Promise<void>;
      cacheInfo(): Promise<import('../shared/settings.js').CacheInfo>;
      chooseCache(reset?: boolean): Promise<import('../shared/settings.js').CacheInfo>;
      clearCache(): Promise<import('../shared/settings.js').CacheInfo>;
      export(id: string, format: string): Promise<boolean>;
    };
  }
}
