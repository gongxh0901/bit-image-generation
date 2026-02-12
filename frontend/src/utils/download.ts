import JSZip from 'jszip';
import { saveAs } from 'file-saver';

/**
 * 下载单张图片
 */
export async function downloadImage(url: string, filename?: string): Promise<void> {
  const response = await fetch(url);
  const blob = await response.blob();
  const name = filename ?? url.split('/').pop() ?? 'image.png';
  saveAs(blob, name);
}

/**
 * 批量下载图片为 ZIP 包
 */
export async function downloadImagesAsZip(
  urls: string[],
  zipName = 'generated-images.zip',
): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder('images');
  if (!folder) return;

  const downloads = urls.map(async (url, index) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const filename = url.split('/').pop() ?? `image-${index}.png`;
      folder.file(filename, blob);
    } catch (e) {
      console.error(`下载失败: ${url}`, e);
    }
  });

  await Promise.all(downloads);
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, zipName);
}
