import { z } from 'zod';
const Id = z.string().uuid();
export const ListGroup = z.object({ id: Id, name: z.string().trim().min(1).max(60), collapsed: z.boolean() }).strict();
export const ListOrganization = z.object({ version: z.number().int().nonnegative(), groups: z.array(ListGroup).max(1000), order: z.array(Id).max(100000), membership: z.record(Id, Id) }).strict().superRefine((s, ctx) => {
  const ids = new Set(s.groups.map(g => g.id));
  if (ids.size !== s.groups.length || new Set(s.order).size !== s.order.length || Object.values(s.membership).some(id => !ids.has(id))) ctx.addIssue({ code: 'custom', message: '分组或排序数据无效' });
});
export type ListOrganization = z.infer<typeof ListOrganization>;
const Version = { expectedVersion: z.number().int().nonnegative() };
export const ListAction = z.discriminatedUnion('kind', [
  z.object({ ...Version, kind: z.literal('create'), name: ListGroup.shape.name }).strict(),
  z.object({ ...Version, kind: z.literal('rename'), groupId: Id, name: ListGroup.shape.name }).strict(),
  z.object({ ...Version, kind: z.literal('collapse'), groupId: Id, collapsed: z.boolean() }).strict(),
  z.object({ ...Version, kind: z.literal('remove'), groupId: Id }).strict(),
  z.object({ ...Version, kind: z.literal('reorder-group'), groupId: Id, targetId: Id, placement: z.enum(['before', 'after']) }).strict(),
  z.object({ ...Version, kind: z.literal('move'), noteIds: z.array(Id).min(1).max(500), groupId: Id.nullable(), targetId: Id.nullable(), placement: z.enum(['before', 'after']) }).strict(),
]);
export type ListAction = z.infer<typeof ListAction>;
export type ListCommand = ListAction extends infer A ? A extends ListAction ? Omit<A, 'expectedVersion'> : never : never;
export const emptyListOrganization = (): ListOrganization => ({ version: 0, groups: [], order: [], membership: {} });
