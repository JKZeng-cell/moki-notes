import { z } from 'zod';
export const TreeMove = z.object({
  expectedVersion: z.number().int().positive(),
  targetId: z.string().uuid().nullable(),
  targetVersion: z.number().int().positive().optional(),
  placement: z.enum(['inside', 'before', 'after']),
}).strict().refine(v => v.targetId ? v.targetVersion !== undefined : v.placement === 'inside', '移动目标需要版本，根级仅支持放入');
export type TreeMoveInput = z.infer<typeof TreeMove>;
