import { expect, test, type TestInfo } from '@playwright/test';

interface VisualDiffResult {
  mismatchRatio: number;
  maxChannelDelta: number;
  boundsDelta: number;
  pdfiumPng: string;
  svgPng: string;
  diffPng: string;
}

interface AnnotationColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface AnnotationSpec {
  subtype: string;
  rect: { left: number; top: number; right: number; bottom: number };
  color: AnnotationColor;
  interiorColor?: AnnotationColor;
  borderWidth: number;
  geometry?: unknown;
}

const rgba = (r: number, g: number, b: number, a = 166): AnnotationColor => ({ r, g, b, a });

async function attachImages(result: VisualDiffResult, testInfo: TestInfo): Promise<void> {
  for (const key of ['pdfiumPng', 'svgPng', 'diffPng'] as const) {
    await testInfo.attach(key.replace('Png', ''), {
      body: Buffer.from(result[key].split(',')[1]!, 'base64'),
      contentType: 'image/png',
    });
  }
}

const cases: { name: string; spec: AnnotationSpec; maxMismatchRatio: number }[] = [
  {
    name: 'square with stroke, fill and opacity',
    spec: {
      subtype: 'square',
      rect: { left: 48, top: 208, right: 208, bottom: 48 },
      color: rgba(30, 136, 229),
      interiorColor: rgba(67, 160, 71),
      borderWidth: 12,
    },
    maxMismatchRatio: 0.02,
  },
  {
    name: 'circle with stroke, fill and opacity',
    spec: {
      subtype: 'circle',
      rect: { left: 48, top: 208, right: 208, bottom: 48 },
      color: rgba(229, 57, 53),
      interiorColor: rgba(251, 192, 45),
      borderWidth: 8,
    },
    maxMismatchRatio: 0.025,
  },
  {
    name: 'square without stroke',
    spec: {
      subtype: 'square',
      rect: { left: 64, top: 192, right: 192, bottom: 64 },
      color: rgba(30, 136, 229),
      interiorColor: rgba(142, 36, 170),
      borderWidth: 0,
    },
    maxMismatchRatio: 0.01,
  },
  {
    name: 'arrow ink cap and join',
    spec: {
      subtype: 'ink',
      rect: { left: 70, top: 220, right: 190, bottom: 36 },
      color: rgba(229, 57, 53, 255),
      borderWidth: 7,
      geometry: {
        kind: 'ink',
        strokes: [
          [{ x: 180, y: 220 }, { x: 76, y: 42 }],
          [{ x: 72, y: 57 }, { x: 76, y: 42 }, { x: 89, y: 51 }],
        ],
      },
    },
    maxMismatchRatio: 0.015,
  },
];

for (const visualCase of cases) {
  test(visualCase.name, async ({ page }, testInfo) => {
    page.on('pageerror', (error) => console.error(`visual harness: ${error.message}`));
    await page.goto('/visual-tests/annotation-rendering.html');
    await page.waitForFunction(() => 'annotationVisualTest' in window);
    const result = await page.evaluate(async (spec) => {
      const api = (window as unknown as { annotationVisualTest: { run(s: unknown): Promise<VisualDiffResult> } }).annotationVisualTest;
      return api.run(spec);
    }, visualCase.spec);
    await attachImages(result, testInfo);
    expect(result.boundsDelta, 'painted bounding boxes should align within one pixel').toBeLessThanOrEqual(1);
    expect(result.mismatchRatio, 'PDFium/SVG pixel difference is too large').toBeLessThanOrEqual(
      visualCase.maxMismatchRatio,
    );
  });
}

test('annotation overlay is atomically replaced after move/resize', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const base: AnnotationSpec = {
    subtype: 'square',
    rect: { left: 48, top: 208, right: 160, bottom: 96 },
    color: rgba(30, 136, 229),
    interiorColor: rgba(67, 160, 71),
    borderWidth: 8,
  };
  const result = await page.evaluate(
    async ({ before, after }) => {
      const api = (
        window as unknown as {
          annotationVisualTest: {
            runAtomicUpdate(a: unknown, b: unknown): Promise<{ frames: number; missingFrames: number }>;
          };
        }
      ).annotationVisualTest;
      return api.runAtomicUpdate(before, after);
    },
    {
      before: base,
      after: { ...base, rect: { left: 80, top: 224, right: 208, bottom: 64 } },
    },
  );
  expect(result.frames).toBeGreaterThan(0);
  expect(result.missingFrames, 'the edited annotation disappeared for one or more animation frames').toBe(0);
});
