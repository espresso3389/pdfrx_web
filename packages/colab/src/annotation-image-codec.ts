const WEBP_CONTENT_TYPE = 'image/webp';

export async function encodeAnnotationImageWebp(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('アノテーション画像を圧縮できません');
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('WebPエンコーダーを利用できません')),
      WEBP_CONTENT_TYPE,
      0.9,
    );
  });
  return blob.arrayBuffer();
}

export async function decodeAnnotationImage(
  bytes: ArrayBuffer,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: WEBP_CONTENT_TYPE }));
  try {
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new Error(`共有アノテーション画像の寸法が不正です (${bitmap.width}x${bitmap.height} / ${width}x${height})`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('共有アノテーション画像を展開できません');
    context.drawImage(bitmap, 0, 0);
    return new Uint8Array(context.getImageData(0, 0, width, height).data);
  } finally {
    bitmap.close();
  }
}
