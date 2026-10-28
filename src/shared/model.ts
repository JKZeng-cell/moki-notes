import { z } from 'zod';

// Preserve the workbench's note content limit and five note colors.
export const Colors = ['violet', 'amber', 'mint', 'rose', 'sky'] as const;
export const NoteInput = z.object({
  title: z.string().trim().min(1).max(200).default('未命名便签'),
  content: z.string().max(900_000).default(''),
  color: z.enum(Colors).default('violet'),
  parentId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  links: z.array(z.string().uuid()).max(100).default([]),
  starred: z.boolean().default(false),
  archived: z.boolean().default(false),
  knowledge: z.boolean().default(true),
  source: z.string().max(2000).default(''),
}).strict();
// Zod 4 applies nested defaults even in partial objects. Strip creation defaults
// so a content-only Agent update cannot erase tags, hierarchy or metadata.
export const Patch = z.object({
  title: NoteInput.shape.title.removeDefault().optional(),
  content: NoteInput.shape.content.removeDefault().optional(),
  color: NoteInput.shape.color.removeDefault().optional(),
  parentId: NoteInput.shape.parentId.removeDefault().optional(),
  tags: NoteInput.shape.tags.removeDefault().optional(),
  links: NoteInput.shape.links.removeDefault().optional(),
  starred: NoteInput.shape.starred.removeDefault().optional(),
  archived: NoteInput.shape.archived.removeDefault().optional(),
  knowledge: NoteInput.shape.knowledge.removeDefault().optional(),
  source: NoteInput.shape.source.removeDefault().optional(),
}).strict().refine(value => Object.keys(value).length > 0, '至少更新一个字段');
export const UpdateInput = z.object({ expectedVersion: z.number().int().positive(), patch: Patch }).strict();
export const Query = z.object({
  q: z.string().max(500).default(''),
  status: z.enum(['active', 'archived', 'trash', 'all']).default('active'),
  tag: z.string().max(60).optional(),
  parentId: z.string().uuid().nullable().optional(),
  knowledge: z.boolean().optional(),
  starred: z.boolean().optional(),
  sort: z.enum(['manual', 'updated', 'created', 'title']).default('updated'),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().nonnegative().default(0),
});
export type NoteData = z.infer<typeof NoteInput>;
export type Note = NoteData & { id: string; version: number; createdAt: string; updatedAt: string; deletedAt: string | null };
export type NoteSummary = Omit<Note, 'content'> & { excerpt: string };
export type NoteQuery = z.input<typeof Query>;
export type NotePatch = z.infer<typeof Patch>;
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
