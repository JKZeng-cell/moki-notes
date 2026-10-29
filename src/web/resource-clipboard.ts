import type { ResourceData } from '../shared/resources.js';

export async function copyEmbeddedImage(resource: ResourceData) {
  const image = new Image(); image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { image.src = ''; reject(new Error('读取图片超时，请重试')); }, 30_000);
    image.onload = () => { clearTimeout(timer); resolve(); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('无法读取图片，外部图片可能限制跨域复制，可先另存为')); };
    image.src = resource.src;
  });
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('图片尺寸过大，请复制原文件或另存为');
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d'); if (!context) throw new Error('无法读取图片');
  context.drawImage(image, 0, 0);
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片转换失败')), 'image/png'));
  if (window.mokiDesktop) await window.mokiDesktop.copyResourceImage(new Uint8Array(await png.arrayBuffer()));
  else await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
