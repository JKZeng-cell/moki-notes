import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { z, ZodError } from 'zod';
import { fileURLToPath } from 'node:url';
import { AppError, UpdateInput, Query } from '../shared/model.js';
import { NotesStore } from './store.js';
import { exportNote } from './export.js';
import { TreeMove } from '../shared/tree.js';
import { Attachments } from './attachments.js';
import { attachmentRoutes } from './attachment-routes.js';
import { GraphPosition } from '../shared/graph-position.js';
import { AppearanceSettings, defaultAppearance } from '../shared/settings.js';

const Id = z.string().uuid();
const versionBody = z.object({ expectedVersion: z.number().int().positive() }).strict();
export async function createApp(store: NotesStore, options: { webRoot?: string; mcpCommand?: string; mcpEnv?: Record<string, string>; attachments?: Attachments; onPurged?(ids: string[]): void } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  app.addHook('onRequest', async (req, reply) => {
    // Loopback binding alone is insufficient: reject DNS rebinding and cross-site requests.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return reply.code(403).send({ error: 'INVALID_HOST', message: '仅允许本机访问' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && !(process.env.MOKI_NOTES_DEV === '1' && origin === 'http://127.0.0.1:4330')) return reply.code(403).send({ error: 'INVALID_ORIGIN', message: '拒绝跨站访问' });
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; media-src 'self' https: http:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https: http:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION', message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (error instanceof AppError) return reply.code(error.status).send({ error: error.code, message: error.message });
    const e = error as Error & { statusCode?: number };
    reply.code(e.statusCode ?? 500).send({ error: 'ERROR', message: e.message });
  });
  const id = (req: { params: unknown }) => Id.parse((req.params as { id: string }).id);
  const attachments = options.attachments ?? (store.path !== ':memory:' ? new Attachments(`${store.path}.attachments`) : undefined);
  if (attachments) attachmentRoutes(app, attachments);
  const protectedAssets = z.array(Id).max(100000).default([]);
  const cleanup = (ids: string[], protectedIds: string[]) => {
    options.onPurged?.(ids);
    return attachments ? store.cleanupPurgedAssets(id => attachments.remove(id), protectedIds) : undefined;
  };
  app.get('/api/health', async () => ({ app: 'moki-notes', version: '0.1.0' }));
  app.get('/api/settings/autosave', async () => store.autoSave());
  app.get('/api/settings/appearance', async () => AppearanceSettings.parse(store.preference('appearance', defaultAppearance)));
  app.put('/api/settings/appearance', async req => { const value = AppearanceSettings.parse(req.body); store.setPreference('appearance', value); return value; });
  app.put('/api/settings/autosave', async req => store.setAutoSave(req.body));
  app.get('/api/trash/preview', async () => store.trashPreview());
  app.post('/api/notes/purge', async req => {
    const b = z.object({ candidates: z.array(z.object({ id: Id, version: z.number().int().positive() }).strict()).min(1).max(500), protectedAssets }).strict().parse(req.body);
    const result = store.clearTrash(b.candidates, true);
    return { ...result, attachments: cleanup(result.ids, b.protectedAssets) };
  });
  app.post('/api/trash/clear', async req => {
    const b = z.object({ candidates: z.array(z.object({ id: Id, version: z.number().int().positive() }).strict()).max(100000), protectedAssets }).strict().parse(req.body);
    const result = store.clearTrash(b.candidates);
    return { ...result, attachments: cleanup(result.ids, b.protectedAssets) };
  });
  app.get('/api/config', async () => ({ dataPath: store.path, mcp: { mcpServers: { 'moki-notes': { command: options.mcpCommand ?? process.execPath, args: [fileURLToPath(new URL('../mcp/server.js', import.meta.url))], env: { ...options.mcpEnv, MOKI_NOTES_DATA: store.path } } } } }));
  app.post('/api/notes/query', async req => store.list(Query.parse(req.body ?? {})));
  app.post('/api/list/query', async req => store.list(Query.parse(req.body ?? {}), true));
  app.post('/api/list/organize', async req => store.organizeList(req.body));
  app.get('/api/tags', async () => store.tagHistory());
  app.post('/api/notes/resolve', async req => store.resolveNotes(z.object({ ids: z.array(Id).max(200) }).strict().parse(req.body).ids));
  app.get('/api/tree', async () => store.tree());
  app.post('/api/catalog', async req => {
    const { knownRevision } = z.object({ knownRevision: z.string().optional() }).parse(req.body ?? {});
    const revision = store.feedRevision();
    return knownRevision === revision ? { revision, unchanged: true } : { revision, items: store.tree(false, true).map(n => ({ ...n, links: [] })) };
  });
  app.post('/api/list/feed', async req => {
    const { knownRevision, ...query } = Query.extend({ knownRevision: z.string().optional(), limit: z.number().int().min(1).max(40).default(30) }).parse(req.body ?? {});
    const revision = store.feedRevision();
    if (knownRevision === revision) return { revision, unchanged: true };
    const result = store.list(query, query.status !== 'trash', true), ids = new Set(result.items.map(n => n.id));
    return { ...result, items: result.items.map(n => ({ ...n, links: [] })), revision, organization: { ...result.organization, order: result.items.map(n => n.id), membership: Object.fromEntries(Object.entries(result.organization.membership).filter(([id]) => ids.has(id))) } };
  });
  app.post('/api/knowledge/neighborhood', async req => {
    const b = z.object({ id: Id.nullable().default(null), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(40).default(40) }).parse(req.body ?? {});
    return store.neighborhood(b.id, b.offset, b.limit);
  });
  app.get('/api/knowledge/positions', async () => store.graphPositions());
  app.put('/api/notes/:id/position', async req => store.setGraphPosition(id(req), z.object({ position: GraphPosition.nullable() }).strict().parse(req.body).position));
  app.post('/api/notes/:id/move', async req => store.move(id(req), TreeMove.parse(req.body)));
  app.post('/api/notes', async req => store.create(req.body));
  app.get('/api/notes/:id', async req => store.get(id(req)));
  app.patch('/api/notes/:id', async req => { const b = UpdateInput.parse(req.body); return store.update(id(req), b.patch, b.expectedVersion); });
  app.post('/api/notes/:id/trash', async req => store.trash(id(req), versionBody.parse(req.body).expectedVersion));
  app.post('/api/notes/:id/restore', async req => store.restore(id(req), versionBody.parse(req.body).expectedVersion));
  app.delete('/api/notes/:id', async req => {
    const b = versionBody.extend({ protectedAssets }).parse(req.body), noteId = id(req);
    return { ...store.purge(noteId, b.expectedVersion), attachments: cleanup([noteId], b.protectedAssets) };
  });
  app.get('/api/notes/:id/history', async req => store.history(id(req)));
  app.get('/api/notes/:id/backlinks', async req => store.backlinks(id(req)));
  app.get('/api/notes/:id/revision/:version', async req => store.revision(id(req), z.coerce.number().int().positive().parse((req.params as { version: string }).version)));
  app.post('/api/context', async req => { const b = z.object({ query: z.string().max(500), rootId: Id.optional(), maxChars: z.number().int().min(100).max(50000).default(12000) }).parse(req.body); return store.context(b.query, b.rootId, b.maxChars); });
  app.get('/api/notes/:id/export/:format', async (req, reply) => {
    const f = z.enum(['txt', 'md', 'docx']).parse((req.params as { format: string }).format);
    const result = await exportNote(store.get(id(req)), f);
    return reply.type(result.mime).header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`).send(result.bytes);
  });
  if (options.webRoot) await app.register(fastifyStatic, { root: options.webRoot });
  return app;
}
