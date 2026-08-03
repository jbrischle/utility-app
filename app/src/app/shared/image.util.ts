/**
 * Resizes/compresses an image file to keep IndexedDB storage reasonable.
 * The longest edge is capped and the result is re-encoded as JPEG. If anything
 * goes wrong (e.g. an unsupported format) the original blob is returned.
 */
export async function resizeImage(file: Blob, maxEdge = 1600, quality = 0.8): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
