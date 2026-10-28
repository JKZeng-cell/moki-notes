import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'public', 'icons');
await mkdir(output, { recursive: true });
const source = await readFile(join(root, 'public', 'icon.svg'));
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];
const pngs = new Map();
for (const size of sizes) {
  const png = await sharp(source, { density: 288 }).resize(size, size).png().toBuffer();
  pngs.set(size, png);
  await writeFile(join(output, `moki-notes-${size}.png`), png);
}
await writeFile(join(root, 'public', 'icon.png'), pngs.get(512));
// Windows ICO: PNG image payloads with an explicit entry for every common size.
const icoSizes = sizes.filter(size => size <= 256);
const header = Buffer.alloc(6 + icoSizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((size, index) => {
  const entry = 6 + index * 16, bytes = pngs.get(size);
  header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
});
await writeFile(join(root, 'public', 'icon.ico'), Buffer.concat([header, ...icoSizes.map(size => pngs.get(size))]));
// Preview at actual system icon sizes, on both light and dark backgrounds.
const preview = sharp({ create: { width: 1000, height: 600, channels: 4, background: '#f6f5fb' } });
const labels = Buffer.from(`<svg width="1000" height="600" xmlns="http://www.w3.org/2000/svg"><path d="M500 0h500v600H500z" fill="#202436"/><g font-family="sans-serif" font-size="13" fill="#77728d"><text x="44" y="44">MOKI NOTES · APP ICON</text><text x="544" y="44" fill="#bbb6d2">DARK BACKGROUND</text></g></svg>`);
const layers = [{ input: labels, left: 0, top: 0 }];
for (const base of [0, 500]) {
  layers.push({ input: pngs.get(256), left: base + 122, top: 88 });
  for (const [index, size] of [16, 24, 32, 48, 64].entries()) {
    layers.push({ input: pngs.get(size), left: base + 55 + index * 82 + Math.round((64 - size) / 2), top: 415 + Math.round((64 - size) / 2) });
  }
}
await mkdir(join(root, 'docs', 'design'), { recursive: true });
await preview.composite(layers).png().toFile(join(root, 'docs', 'design', 'app-icon-preview.png'));
console.log(`Generated ${sizes.length} PNG sizes, SVG source and ${icoSizes.length}-size ICO`);
