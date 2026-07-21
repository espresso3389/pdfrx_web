import type { PdfAnnotationSpec } from '@pdfrx/engine';
import { PdfrxViewer } from '@pdfrx/viewer';

const SIZE = 256;

export interface VisualDiffResult {
  mismatchRatio: number;
  maxChannelDelta: number;
  boundsDelta: number;
  pdfiumPng: string;
  svgPng: string;
  diffPng: string;
}

const host = document.querySelector<HTMLElement>('#viewer')!;
const viewer = new PdfrxViewer(host, {
  engineOptions: { baseUrl: `${location.origin}/`, wasmModulesUrl: 'pdfium/' },
  interactiveAnnotations: true,
  margin: 0,
  pageDropShadow: null,
});

const white = new Uint8Array(SIZE * SIZE * 4).fill(255);
const seed = await viewer.engine.createFromImages([{ pixels: white, width: SIZE, height: SIZE }]);
const bytes = await seed.encodePdf();
await seed.dispose();
await viewer.openData(bytes);

async function waitForShape(id: string): Promise<SVGGElement> {
  for (let frame = 0; frame < 120; frame++) {
    const shape = [...host.querySelectorAll<SVGGElement>('g[data-annot-id]')].find((el) => el.dataset.annotId === id);
    if (shape) return shape;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  throw new Error(`Timed out waiting for annotation ${id}`);
}

function canvasWithWhiteBackground(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  return canvas;
}

async function rasterizeShape(shape: SVGGElement): Promise<HTMLCanvasElement> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${shape.outerHTML}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = canvasWithWhiteBackground();
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  URL.revokeObjectURL(url);
  return canvas;
}

function paintedBounds(data: Uint8ClampedArray): [number, number, number, number] | null {
  let left = SIZE;
  let top = SIZE;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (Math.min(data[i]!, data[i + 1]!, data[i + 2]!) > 247) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : [left, top, right, bottom];
}

function compare(pdfiumCanvas: HTMLCanvasElement, svgCanvas: HTMLCanvasElement): VisualDiffResult {
  const pdfium = pdfiumCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, SIZE, SIZE).data;
  const svg = svgCanvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, SIZE, SIZE).data;
  const diffCanvas = canvasWithWhiteBackground();
  const diffCtx = diffCanvas.getContext('2d')!;
  const diff = diffCtx.createImageData(SIZE, SIZE);
  let mismatches = 0;
  let maxChannelDelta = 0;
  for (let i = 0; i < pdfium.length; i += 4) {
    const delta = Math.max(
      Math.abs(pdfium[i]! - svg[i]!),
      Math.abs(pdfium[i + 1]! - svg[i + 1]!),
      Math.abs(pdfium[i + 2]! - svg[i + 2]!),
    );
    maxChannelDelta = Math.max(maxChannelDelta, delta);
    const mismatch = delta > 32;
    if (mismatch) mismatches++;
    diff.data[i] = mismatch ? 255 : 255 - delta;
    diff.data[i + 1] = mismatch ? 0 : 255 - delta;
    diff.data[i + 2] = mismatch ? 0 : 255 - delta;
    diff.data[i + 3] = 255;
  }
  diffCtx.putImageData(diff, 0, 0);
  const pb = paintedBounds(pdfium);
  const sb = paintedBounds(svg);
  const boundsDelta = pb && sb ? Math.max(...pb.map((v, i) => Math.abs(v - sb[i]!))) : pb === sb ? 0 : SIZE;
  return {
    mismatchRatio: mismatches / (SIZE * SIZE),
    maxChannelDelta,
    boundsDelta,
    pdfiumPng: pdfiumCanvas.toDataURL('image/png'),
    svgPng: svgCanvas.toDataURL('image/png'),
    diffPng: diffCanvas.toDataURL('image/png'),
  };
}

async function run(spec: PdfAnnotationSpec): Promise<VisualDiffResult> {
  const doc = viewer.document;
  if (!doc) throw new Error('Test PDF is not open');
  const id = await doc.addAnnotation(1, spec);
  try {
    const shape = await waitForShape(id);
    const pdfiumImage = await doc.pages[0]!.render({
      fullWidth: SIZE,
      fullHeight: SIZE,
      backgroundColor: 0xffffffff,
      annotationRenderingMode: 'annotationAndForms',
    });
    if (!pdfiumImage) throw new Error('PDFium render was cancelled');
    const pdfiumCanvas = canvasWithWhiteBackground();
    pdfiumCanvas.getContext('2d')!.putImageData(pdfiumImage.toImageData(), 0, 0);
    return compare(pdfiumCanvas, await rasterizeShape(shape));
  } finally {
    await doc.removeAnnotation(1, id);
  }
}

async function runAtomicUpdate(before: PdfAnnotationSpec, after: PdfAnnotationSpec): Promise<{ frames: number; missingFrames: number }> {
  const doc = viewer.document;
  if (!doc) throw new Error('Test PDF is not open');
  const id = await doc.addAnnotation(1, before);
  const original = await waitForShape(id);
  let frames = 0;
  let missingFrames = 0;
  let monitoring = true;
  const monitor = (async (): Promise<void> => {
    while (monitoring) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      frames++;
      const present = [...host.querySelectorAll<SVGGElement>('g[data-annot-id]')].some((el) => el.dataset.annotId === id);
      if (!present) missingFrames++;
    }
  })();
  try {
    await doc.updateAnnotation(1, id, after);
    for (let frame = 0; frame < 120 && original.isConnected; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (original.isConnected) throw new Error('Updated SVG did not replace the original');
    return { frames, missingFrames };
  } finally {
    monitoring = false;
    await monitor;
    await doc.removeAnnotation(1, id);
  }
}

declare global {
  interface Window {
    annotationVisualTest: { run: typeof run; runAtomicUpdate: typeof runAtomicUpdate };
  }
}

window.annotationVisualTest = { run, runAtomicUpdate };
