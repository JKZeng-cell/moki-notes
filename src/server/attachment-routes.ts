import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { Attachments, parseByteRange } from './attachments.js';

export function attachmentRoutes(app: FastifyInstance, assets: Attachments) {
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));
  app.post('/api/assets', async req => {
    const name = decodeURIComponent(z.string().min(1).max(2000).parse(req.headers['x-file-name']));
    if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') throw new Error('请使用文件上传');
    return assets.importStream(name, req.body as Readable);
  });
  const id = (req: { params: unknown }) => z.string().uuid().parse((req.params as { id: string }).id);
  app.get('/api/assets/:id', req => assets.get(id(req)));
  app.get('/api/assets/:id/text', req => assets.text(id(req)));
  app.get('/api/assets/:id/content', async (req, reply) => {
    const info = await assets.get(id(req)), path = await assets.contentPath(info.id);
    const range = parseByteRange(req.headers.range, info.size);
    const download = (req.query as { download?: string }).download === '1' || info.preview === 'none';
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'")
      .header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(info.name)}`)
      .header('Accept-Ranges', 'bytes').header('Cache-Control', 'no-store').type(info.mime);
    if (range) reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
    reply.header('Content-Length', range ? range.end - range.start + 1 : info.size);
    return reply.send(createReadStream(path, range ?? undefined));
  });
}
