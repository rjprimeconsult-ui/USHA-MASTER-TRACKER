/**
 * Client-side image compression for receipt attachments.
 *
 * Phone receipts are typically 2–4 MB. localStorage caps at 5–10 MB total,
 * and base64 inflates by ~33%, so even 2–3 untouched receipts can blow the
 * quota. This helper downscales to 1600px max dimension at 0.7 JPEG quality,
 * which typically drops a 2 MB photo to ~150 KB without visibly hurting
 * readability of receipt text.
 *
 * PDFs are passed through unchanged (no good way to compress in the browser).
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.7;

/** Convert a Blob → base64 data URL. */
const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

/** Load an image element from a File. */
const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
  img.src = url;
});

/**
 * Compress an image File. Resizes if either dimension exceeds MAX_DIMENSION,
 * and re-encodes as JPEG at JPEG_QUALITY. PDFs and non-image files pass
 * through unchanged. Returns the resulting data URL + final byte size.
 */
export async function compressIfImage(file) {
  if (!file) return null;
  // Only compress raster images
  if (!file.type.startsWith('image/')) {
    const dataUrl = await blobToDataUrl(file);
    return { name: file.name, type: file.type, dataUrl, sizeBytes: dataUrl.length, compressed: false };
  }

  try {
    const img = await loadImage(file);
    const { width, height } = img;
    let targetW = width;
    let targetH = height;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      if (width >= height) {
        targetW = MAX_DIMENSION;
        targetH = Math.round((height / width) * MAX_DIMENSION);
      } else {
        targetH = MAX_DIMENSION;
        targetW = Math.round((width / height) * MAX_DIMENSION);
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) {
      // Fallback: return the raw file if canvas.toBlob failed
      const dataUrl = await blobToDataUrl(file);
      return { name: file.name, type: file.type, dataUrl, sizeBytes: dataUrl.length, compressed: false };
    }
    const dataUrl = await blobToDataUrl(blob);
    // Preserve original filename but switch extension to .jpg if we re-encoded
    const newName = file.name.replace(/\.(png|webp|gif|bmp|tiff?)$/i, '.jpg');
    return {
      name: newName,
      type: 'image/jpeg',
      dataUrl,
      sizeBytes: dataUrl.length,
      compressed: true,
      origSizeBytes: file.size,
    };
  } catch (e) {
    // If anything fails, fall back to the raw file
    const dataUrl = await blobToDataUrl(file);
    return { name: file.name, type: file.type, dataUrl, sizeBytes: dataUrl.length, compressed: false };
  }
}
