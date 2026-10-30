import type { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createHash } from 'node:crypto';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

// Desktop windows share one immutable build. Read it before showing any window:
// reopening a card must not depend on a long-lived ASAR file stream or HTTP cache.
// This holds only bundled UI files; notes and user attachments keep their own routes.
export async function registerDesktopWebAssets(app: FastifyInstance, root: string) {
  const assets = new Map<string, { bytes: Buffer; type: string; etag: string }>();
  async function visit(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name), url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(path, url);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        assets.set(url, { bytes, type: types[extname(entry.name).toLowerCase()] ?? 'application/octet-stream', etag: `"${createHash('sha256').update(bytes).digest('hex')}"` });
      }
    }
  }
  await visit(root, '');
  if (!assets.has('/index.html')) throw new Error('应用页面资源缺失，请重新安装 MOKI便签；本地便签数据不受影响');
  app.route({ method: ['GET', 'HEAD'], url: '/*', handler: (request, reply) => {
    const pathname = '/' + (request.params as { '*': string })['*'];
    const asset = assets.get(pathname === '/' ? '/index.html' : pathname);
    if (!asset) return reply.callNotFound();
    reply.type(asset.type).header('Cache-Control', 'no-cache').header('ETag', asset.etag);
    const matches = request.headers['if-none-match']?.split(',').map(v => v.trim().replace(/^W\//, ''));
    if (matches?.includes('*') || matches?.includes(asset.etag)) return reply.code(304).send();
    return reply.header('Content-Length', asset.bytes.length).send(request.method === 'HEAD' ? undefined : asset.bytes);
  } });
}
