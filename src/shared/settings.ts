import { z } from 'zod';

export const AutoSaveSettings = z.object({ enabled: z.boolean(), delayMs: z.union([z.literal(750), z.literal(1500), z.literal(3000), z.literal(5000)]) }).strict();
export type AutoSave = z.infer<typeof AutoSaveSettings>;
export const defaultAutoSave: AutoSave = { enabled: true, delayMs: 750 };
export const AppearanceSettings = z.object({ fontSize: z.number().int().min(12).max(24) }).strict();
export type Appearance = z.infer<typeof AppearanceSettings>;
export const defaultAppearance: Appearance = { fontSize: 14 };
export type TrashPreview = { total: number; protected: number; candidates: Array<{ id: string; version: number }>; revisions: number; affected: number; pendingAssets: number };
export type PurgeResult = { ids: string[]; count: number; attachments?: { removed: number; retained: number; failed: string[]; pending: number } };
export type CacheInfo = { path: string; activePath: string; defaultPath: string; restartRequired: boolean; error: string; bytes: number };
export type StartupSettings = { supported: boolean; enabled: boolean; reason?: string };
