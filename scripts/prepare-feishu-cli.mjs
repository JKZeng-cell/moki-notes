import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

const version = '1.0.98';
const archiveHash = 'b13a5d710f9afe327b34bfe68c4a736a574d4d97274f6da862e912dfada1ccdc';
const archiveUrl = `https://github.com/larksuite/cli/releases/download/v${version}/lark-cli-${version}-windows-amd64.zip`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function prepareFeishuCli() {
  const directory = fileURLToPath(new URL('../vendor/feishu-cli/win32-x64/', import.meta.url));
  await mkdir(directory, { recursive: true });
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    if (manifest.version === version && manifest.archiveSha256 === archiveHash
      && digest(await readFile(join(directory, 'lark-cli.exe'))) === manifest.binarySha256
      && digest(await readFile(join(directory, 'LICENSE'))) === manifest.licenseSha256) return directory;
  } catch { /* Download an authenticated release archive below. */ }
  let archive, downloadedFrom;
  for (const url of [archiveUrl, `https://registry.npmmirror.com/-/binary/lark-cli/v${version}/lark-cli-${version}-windows-amd64.zip`]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) continue;
      archive = Buffer.from(await response.arrayBuffer()); downloadedFrom = url; break;
    } catch { /* The official installer's mirror serves the same pinned archive. */ }
  }
  if (!archive) throw Error('无法下载飞书 CLI，请检查网络后重新打包');
  if (digest(archive) !== archiveHash) throw Error('飞书 CLI 官方发行包校验失败');
  const entries = unzipSync(archive);
  const binary = Object.entries(entries).find(([name]) => /(^|\/)lark-cli\.exe$/.test(name))?.[1];
  if (!binary) throw Error('飞书 CLI 发行包缺少可执行文件');
  let license = Object.entries(entries).find(([name]) => /(^|\/)LICENSE$/.test(name))?.[1];
  if (!license) {
    const res = await fetch(`https://raw.githubusercontent.com/larksuite/cli/v${version}/LICENSE`);
    if (!res.ok) throw Error('无法取得飞书 CLI 开源许可');
    license = new Uint8Array(await res.arrayBuffer());
  }
  if (!Buffer.from(license).toString('utf8').includes('MIT License')) throw Error('飞书 CLI 许可不匹配');
  await writeFile(join(directory, 'lark-cli.exe'), binary);
  await writeFile(join(directory, 'LICENSE'), license);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version, platform: 'win32-x64', source: archiveUrl, downloadedFrom,
    archiveSha256: archiveHash, binarySha256: digest(binary), licenseSha256: digest(license) }, null, 2) + '\n');
  return directory;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(await prepareFeishuCli());
