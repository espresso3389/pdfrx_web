import type { PdfAnnotationSpec, PdfRect } from '@pdfrx/engine';
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
  annotationEditorPlaceholders: { text: 'Localized text', note: 'Localized note' },
  margin: 0,
  pageDropShadow: null,
});
let lastAnnotationPreviewRects: { id: string; rect: PdfRect | undefined }[] = [];
viewer.addAnnotationPreviewChangeListener((changes) => {
  lastAnnotationPreviewRects = changes.map((change) => ({ id: change.id, rect: change.spec.rect }));
});

const white = new Uint8Array(SIZE * SIZE * 4).fill(255);
const seed = await viewer.engine.createFromImages([
  { pixels: white, width: SIZE, height: SIZE },
  { pixels: white, width: SIZE, height: SIZE },
]);
const bytes = await seed.encodePdf();
await seed.dispose();
await viewer.openData(bytes);

async function waitForShape(id: string): Promise<SVGGElement> {
  for (let frame = 0; frame < 120; frame++) {
    const shape =
      host.querySelector<SVGGElement>(`g[data-annot-visual-id="${CSS.escape(id)}"]`) ??
      host.querySelector<SVGGElement>(`g[data-annot-id="${CSS.escape(id)}"]`);
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
  const id = await doc.pages[0]!.addAnnotation(spec);
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
    await doc.pages[0]!.removeAnnotation(id);
  }
}

async function inspectStamp(spec: PdfAnnotationSpec): Promise<{
  label: string | null;
  labelFill: string | null;
  stroke: string | null;
  fill: string | null;
  rx: string | null;
}> {
  const doc = viewer.document;
  if (!doc) throw new Error('Test PDF is not open');
  const id = await doc.pages[0]!.addAnnotation(spec);
  try {
    const shape = await waitForShape(id);
    const rect = shape.querySelector('rect');
    return {
      label: shape.querySelector('text')?.textContent ?? null,
      labelFill: shape.querySelector('text')?.getAttribute('fill') ?? null,
      stroke: rect?.getAttribute('stroke') ?? null,
      fill: rect?.getAttribute('fill') ?? null,
      rx: rect?.getAttribute('rx') ?? null,
    };
  } finally {
    await doc.pages[0]!.removeAnnotation(id);
  }
}

async function runAtomicUpdate(before: PdfAnnotationSpec, after: PdfAnnotationSpec): Promise<{ frames: number; missingFrames: number }> {
  const doc = viewer.document;
  if (!doc) throw new Error('Test PDF is not open');
  const id = await doc.pages[0]!.addAnnotation(before);
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
    await doc.pages[0]!.updateAnnotation(id, after);
    for (let frame = 0; frame < 120 && original.isConnected; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (original.isConnected) throw new Error('Updated SVG did not replace the original');
    return { frames, missingFrames };
  } finally {
    monitoring = false;
    await monitor;
    await doc.pages[0]!.removeAnnotation(id);
  }
}

interface ClipboardTestResult {
  copyPaste: { count: number; selectedCount: number; dx: number; dy: number; countAfterUndo: number };
  cutPaste: { countAfterCut: number; countAfterPaste: number; dx: number; dy: number; selectedCount: number };
}

async function clearAnnotations(): Promise<void> {
  const doc = viewer.document;
  if (!doc) return;
  for (const annotation of await doc.pages[0]!.loadAnnotations()) {
    await doc.pages[0]!.removeAnnotation(annotation.id);
  }
  viewer.setSelectedAnnotations([]);
}

async function runClipboardTest(spec: PdfAnnotationSpec): Promise<ClipboardTestResult> {
  const doc = viewer.document;
  if (!doc || !spec.rect) throw new Error('Test PDF is not open or spec has no rect');
  await clearAnnotations();
  try {
    const originalId = await doc.pages[0]!.addAnnotation(spec);
    await waitForShape(originalId);
    viewer.setSelectedAnnotation(originalId);
    if (!viewer.copySelectedAnnotations()) throw new Error('Copy failed');
    if (!(await viewer.pasteAnnotations())) throw new Error('Paste failed');
    const copied = await doc.loadAnnotations(1);
    const pasted = copied.find((annotation) => annotation.id !== originalId);
    if (!pasted) throw new Error('Pasted annotation was not found');
    const copyPaste = {
      count: copied.length,
      selectedCount: viewer.getSelectedAnnotationIds().length,
      dx: pasted.rect.left - spec.rect.left,
      dy: pasted.rect.top - spec.rect.top,
      countAfterUndo: 0,
    };
    await viewer.undoAnnotation();
    copyPaste.countAfterUndo = (await doc.loadAnnotations(1)).length;

    viewer.setSelectedAnnotation(originalId);
    if (!(await viewer.cutSelectedAnnotations())) throw new Error('Cut failed');
    const countAfterCut = (await doc.loadAnnotations(1)).length;
    if (!(await viewer.pasteAnnotations())) throw new Error('Paste after cut failed');
    const cutResult = await doc.loadAnnotations(1);
    const cutPasted = cutResult[0];
    if (!cutPasted) throw new Error('Cut annotation was not pasted');
    return {
      copyPaste,
      cutPaste: {
        countAfterCut,
        countAfterPaste: cutResult.length,
        dx: cutPasted.rect.left - spec.rect.left,
        dy: cutPasted.rect.top - spec.rect.top,
        selectedCount: viewer.getSelectedAnnotationIds().length,
      },
    };
  } finally {
    await clearAnnotations();
  }
}

async function setupDuplicateGesture(spec: PdfAnnotationSpec): Promise<string> {
  const doc = viewer.document;
  if (!doc) throw new Error('Test PDF is not open');
  await clearAnnotations();
  const id = await doc.pages[0]!.addAnnotation(spec);
  await waitForShape(id);
  viewer.setAnnotationSelectMode(true);
  viewer.setSelectedAnnotation(id);
  return id;
}

async function readDuplicateState(): Promise<{
  rects: { left: number; top: number; right: number; bottom: number }[];
  selectedCount: number;
}> {
  const doc = viewer.document;
  if (!doc) throw new Error('Test PDF is not open');
  const annotations = await doc.loadAnnotations(1);
  return {
    rects: annotations.map((annotation) => annotation.rect).sort((a, b) => a.left - b.left || b.top - a.top),
    selectedCount: viewer.getSelectedAnnotationIds().length,
  };
}

async function setupSelectAllTest(specs: PdfAnnotationSpec[]): Promise<void> {
  const doc = viewer.document;
  if (!doc) throw new Error('Test PDF is not open');
  await clearAnnotations();
  for (const spec of specs) await doc.pages[0]!.addAnnotation(spec);
  viewer.setAnnotationSelectMode(true);
  viewer.setSelectedAnnotations([]);
}

async function setupSnapGesture(specs: PdfAnnotationSpec[]): Promise<string[]> {
  const doc = viewer.document;
  if (!doc) throw new Error('Test PDF is not open');
  await clearAnnotations();
  const ids: string[] = [];
  for (const spec of specs) ids.push(await doc.pages[0]!.addAnnotation(spec));
  for (const id of ids) await waitForShape(id);
  viewer.setAnnotationSelectMode(true);
  viewer.setSelectedAnnotation(ids[0] ?? null);
  return ids;
}

function readViewTransform(): { xZoomed: number; yZoomed: number; zoom: number } {
  return viewer.currentTransform;
}

function readAnnotationPreviewRects(): typeof lastAnnotationPreviewRects {
  return structuredClone(lastAnnotationPreviewRects);
}

async function setupTextTool(tool: 'note' | 'freeText' | 'rectangle', strokeWidth?: number): Promise<void> {
  await clearAnnotations();
  if (strokeWidth !== undefined) viewer.setAnnotationStyle({ strokeWidth });
  viewer.setAnnotationTool(tool);
}

function setTextStyle(textColor: string, fontSize: number): void {
  viewer.setAnnotationStyle({ textColor, fontSize });
}

function setObjectSelectMode(): void {
  viewer.setAnnotationSelectMode(true);
}

async function readTextStyleRoundTrip(): Promise<{ textColor: unknown; fontSize: number | null } | null> {
  const doc = viewer.document;
  if (!doc) return null;
  const encoded = await doc.encodePdf();
  const reopened = await viewer.engine.openData(encoded);
  try {
    const annotation = (await reopened.pages[0]!.loadAnnotations())[0];
    return annotation ? { textColor: annotation.textColor, fontSize: annotation.fontSize } : null;
  } finally {
    await reopened.dispose();
  }
}

async function readTextAnnotations(): Promise<{ subtype: string; contents: string | null; borderWidth: number }[]> {
  const doc = viewer.document;
  if (!doc) return [];
  return (await doc.pages[0]!.loadAnnotations()).map((annotation) => ({
    subtype: annotation.subtype,
    contents: annotation.contents,
    borderWidth: annotation.borderWidth,
  }));
}

async function readTextAnnotationsRoundTrip(): Promise<{ subtype: string; contents: string | null; borderWidth: number }[]> {
  const doc = viewer.document;
  if (!doc) return [];
  const encoded = await doc.encodePdf();
  const reopened = await viewer.engine.openData(encoded);
  try {
    return (await reopened.pages[0]!.loadAnnotations()).map((annotation) => ({
      subtype: annotation.subtype,
      contents: annotation.contents,
      borderWidth: annotation.borderWidth,
    }));
  } finally {
    await reopened.dispose();
  }
}

async function flushAnnotationTextEdit(): Promise<void> {
  await viewer.flushAnnotationTextEdit();
}

async function runFreeTextRoundTrip(spec: PdfAnnotationSpec): Promise<{
  contents: string | null;
  darkInteriorPixels: number;
}> {
  const doc = viewer.document;
  if (!doc || !spec.rect) throw new Error('Test PDF is not open or spec has no rect');
  await clearAnnotations();
  await doc.pages[0]!.addAnnotation(spec);
  const encoded = await doc.encodePdf();
  const reopened = await viewer.engine.openData(encoded);
  try {
    const annotation = (await reopened.pages[0]!.loadAnnotations())[0];
    const image = await reopened.pages[0]!.render({
      fullWidth: SIZE,
      fullHeight: SIZE,
      backgroundColor: 0xffffffff,
      annotationRenderingMode: 'annotationAndForms',
    });
    if (!image) throw new Error('Round-trip render was cancelled');
    const pixels = image.toImageData().data;
    const left = Math.ceil(spec.rect.left + 2);
    const right = Math.floor(spec.rect.right - 2);
    const top = Math.ceil(SIZE - spec.rect.top + 2);
    const bottom = Math.floor(SIZE - spec.rect.bottom - 2);
    let darkInteriorPixels = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const i = (y * SIZE + x) * 4;
        if (pixels[i]! < 80 && pixels[i + 1]! < 80 && pixels[i + 2]! < 80) darkInteriorPixels++;
      }
    }
    return { contents: annotation?.contents ?? null, darkInteriorPixels };
  } finally {
    await reopened.dispose();
    await clearAnnotations();
  }
}

async function inspectCurrentFreeTextRoundTrip(): Promise<{
  contents: string | null;
  darkInteriorPixels: number;
  emojiPixels: number;
  emojiPositionDelta: number;
  emojiPosition: { actualX: number; actualY: number; expectedX: number; expectedY: number };
  fontFaces: string[];
  runs: { text: string; fontFace: string | null }[];
}> {
  const doc = viewer.document;
  if (!doc) throw new Error('Test PDF is not open');
  const current = (await doc.pages[0]!.loadAnnotations()).find((annotation) => annotation.subtype === 'freeText');
  if (!current) return { contents: null, darkInteriorPixels: 0, emojiPixels: 0, emojiPositionDelta: Infinity, emojiPosition: { actualX: 0, actualY: 0, expectedX: 0, expectedY: 0 }, fontFaces: [], runs: [] };
  const encoded = await doc.encodePdf();
  const reopened = await viewer.engine.openData(encoded);
  try {
    const annotation = (await reopened.pages[0]!.loadAnnotations()).find((item) => item.subtype === 'freeText');
    const image = await reopened.pages[0]!.render({
      fullWidth: SIZE,
      fullHeight: SIZE,
      backgroundColor: 0xffffffff,
      annotationRenderingMode: 'annotationAndForms',
    });
    if (!image) throw new Error('Round-trip render was cancelled');
    const pixels = image.toImageData().data;
    const left = Math.ceil(current.rect.left + 2);
    const right = Math.floor(current.rect.right - 2);
    const top = Math.ceil(SIZE - current.rect.top + 2);
    const bottom = Math.floor(SIZE - current.rect.bottom - 2);
    let darkInteriorPixels = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const i = (y * SIZE + x) * 4;
        if (pixels[i]! < 80 && pixels[i + 1]! < 80 && pixels[i + 2]! < 80) darkInteriorPixels++;
      }
    }
    let emojiPixels = 0;
    let emojiLeft = Infinity;
    let emojiTop = Infinity;
    const inset = Math.ceil(current.borderWidth + 3);
    for (let y = Math.ceil(SIZE - current.rect.top) + inset; y < Math.floor(SIZE - current.rect.bottom) - inset; y++) {
      for (let x = Math.ceil(current.rect.left) + inset; x < Math.floor(current.rect.right) - inset; x++) {
        const i = (y * SIZE + x) * 4;
        const r = pixels[i]!;
        const g = pixels[i + 1]!;
        const b = pixels[i + 2]!;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 30 && Math.min(r, g, b) < 240) {
          emojiPixels++;
          emojiLeft = Math.min(emojiLeft, x);
          emojiTop = Math.min(emojiTop, y);
        }
      }
    }
    const fontFaces = [...new Set((annotation?.appearanceRuns ?? []).flat().map((run) => run.fontFace).filter((face): face is string => !!face))];
    const runs = (annotation?.appearanceRuns ?? []).flat().map((run) => ({ text: run.text, fontFace: run.fontFace }));
    let expectedX = Infinity;
    let expectedY = Infinity;
    annotation?.appearanceRuns?.forEach((line, lineIndex) => {
      const emoji = line.find((run) => /\p{Extended_Pictographic}/u.test(run.text));
      if (!emoji) return;
      expectedX = current.rect.left + current.borderWidth + 3 + emoji.x;
      expectedY = SIZE - current.rect.top + current.borderWidth + 3 + lineIndex * 14.4;
    });
    const emojiPositionDelta = Math.max(Math.abs(emojiLeft - expectedX), Math.abs(emojiTop - expectedY));
    return { contents: annotation?.contents ?? null, darkInteriorPixels, emojiPixels, emojiPositionDelta, emojiPosition: { actualX: emojiLeft, actualY: emojiTop, expectedX, expectedY }, fontFaces, runs };
  } finally {
    await reopened.dispose();
  }
}

declare global {
  interface Window {
    annotationVisualTest: {
      run: typeof run;
      inspectStamp: typeof inspectStamp;
      runAtomicUpdate: typeof runAtomicUpdate;
      runClipboardTest: typeof runClipboardTest;
      setupDuplicateGesture: typeof setupDuplicateGesture;
      readDuplicateState: typeof readDuplicateState;
      setupSelectAllTest: typeof setupSelectAllTest;
      setupSnapGesture: typeof setupSnapGesture;
      readViewTransform: typeof readViewTransform;
      readAnnotationPreviewRects: typeof readAnnotationPreviewRects;
      setupTextTool: typeof setupTextTool;
      setTextStyle: typeof setTextStyle;
      setObjectSelectMode: typeof setObjectSelectMode;
      readTextStyleRoundTrip: typeof readTextStyleRoundTrip;
      readTextAnnotations: typeof readTextAnnotations;
      readTextAnnotationsRoundTrip: typeof readTextAnnotationsRoundTrip;
      flushAnnotationTextEdit: typeof flushAnnotationTextEdit;
      runFreeTextRoundTrip: typeof runFreeTextRoundTrip;
      inspectCurrentFreeTextRoundTrip: typeof inspectCurrentFreeTextRoundTrip;
    };
  }
}

window.annotationVisualTest = {
  run,
  inspectStamp,
  runAtomicUpdate,
  runClipboardTest,
  setupDuplicateGesture,
  readDuplicateState,
  setupSelectAllTest,
  setupSnapGesture,
  readViewTransform,
  readAnnotationPreviewRects,
  setupTextTool,
  setTextStyle,
  setObjectSelectMode,
  readTextStyleRoundTrip,
  readTextAnnotations,
  readTextAnnotationsRoundTrip,
  flushAnnotationTextEdit,
  runFreeTextRoundTrip,
  inspectCurrentFreeTextRoundTrip,
};
