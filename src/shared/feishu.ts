export type SyncDirection = 'both' | 'push' | 'pull';
export type FeishuStatus = { connected: boolean; user?: string; folder?: string; url?: string; lastSync?: string; cliPath?: string;
  cliSource?: 'bundled' | 'custom' | 'system'; cliVersion?: string; configured?: boolean; loggedIn?: boolean; authUser?: string; error?: string };
export type FeishuLogin = { url: string; qr: string; expiresAt: string };
export type SyncReport = { uploaded: number; downloaded: number; conflicts: number; skipped: number; errors: string[]; at: string };
export type FeishuAuthProgress = { state: 'idle' | 'pending' | 'succeeded' | 'expired' | 'failed' | 'cancelled'; login?: FeishuLogin; error?: string };
export type FeishuAutoSettings = { enabled: boolean; intervalMinutes: number; direction: SyncDirection };
export type FeishuRecord = { id: string; title: string; archived: boolean; url: string; at?: string; direction?: 'push' | 'pull'; status: 'synced' | 'changed' | 'missing' | 'error'; error?: string };
export type FeishuOverview = { connected: boolean; settings: FeishuAutoSettings; running: boolean; nextRun?: string; lastAttempt?: string; lastError?: string; report?: SyncReport; records: FeishuRecord[] };
