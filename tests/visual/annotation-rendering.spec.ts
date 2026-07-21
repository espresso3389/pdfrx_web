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

test('selected annotations can be copied, cut, pasted and undone', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const spec: AnnotationSpec = {
    subtype: 'square',
    rect: { left: 48, top: 208, right: 160, bottom: 96 },
    color: rgba(30, 136, 229),
    interiorColor: rgba(67, 160, 71),
    borderWidth: 8,
  };
  const result = await page.evaluate(async (annotation) => {
    const api = (
      window as unknown as {
        annotationVisualTest: {
          runClipboardTest(s: unknown): Promise<{
            copyPaste: { count: number; selectedCount: number; dx: number; dy: number; countAfterUndo: number };
            cutPaste: { countAfterCut: number; countAfterPaste: number; dx: number; dy: number; selectedCount: number };
          }>;
        };
      }
    ).annotationVisualTest;
    return api.runClipboardTest(annotation);
  }, spec);

  expect(result.copyPaste).toEqual({ count: 2, selectedCount: 1, dx: 10, dy: -10, countAfterUndo: 1 });
  expect(result.cutPaste).toEqual({ countAfterCut: 0, countAfterPaste: 1, dx: 0, dy: 0, selectedCount: 1 });
});

test('modifier-drag duplicates on one axis and Ctrl+D repeats the spacing', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const spec: AnnotationSpec = {
    subtype: 'square',
    rect: { left: 40, top: 216, right: 88, bottom: 168 },
    color: rgba(30, 136, 229),
    interiorColor: rgba(67, 160, 71),
    borderWidth: 4,
  };
  const id = await page.evaluate(async (annotation) => {
    const api = (
      window as unknown as {
        annotationVisualTest: { setupDuplicateGesture(s: unknown): Promise<string> };
      }
    ).annotationVisualTest;
    return api.setupDuplicateGesture(annotation);
  }, spec);
  const shape = page.locator(`g[data-annot-id="${id}"]`);
  await expect(shape).toHaveCount(1);
  const box = await shape.boundingBox();
  if (!box) throw new Error('Source annotation is not visible');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.keyboard.down('Shift');
  await page.keyboard.down('Control');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 64, start.y + 18, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  await page.keyboard.up('Shift');
  await expect(page.locator('g[data-annot-id]')).toHaveCount(2);
  await page.locator('canvas').press('Control+d');
  await expect(page.locator('g[data-annot-id]')).toHaveCount(3);

  const state = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        annotationVisualTest: {
          readDuplicateState(): Promise<{
            rects: { left: number; top: number; right: number; bottom: number }[];
            selectedCount: number;
          }>;
        };
      }
    ).annotationVisualTest;
    return api.readDuplicateState();
  });
  expect(state.selectedCount).toBe(1);
  expect(state.rects).toHaveLength(3);
  expect(state.rects[1]!.top).toBeCloseTo(state.rects[0]!.top, 5);
  expect(state.rects[2]!.top).toBeCloseTo(state.rects[1]!.top, 5);
  expect(state.rects[1]!.left - state.rects[0]!.left).toBeCloseTo(64, 5);
  expect(state.rects[2]!.left - state.rects[1]!.left).toBeCloseTo(64, 5);
});

test('Ctrl+A selects every annotation on the current page in object-select mode', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const specs: AnnotationSpec[] = [
    {
      subtype: 'square',
      rect: { left: 24, top: 232, right: 72, bottom: 184 },
      color: rgba(30, 136, 229),
      borderWidth: 4,
    },
    {
      subtype: 'circle',
      rect: { left: 104, top: 152, right: 168, bottom: 88 },
      color: rgba(229, 57, 53),
      borderWidth: 4,
    },
  ];
  await page.evaluate(async (annotations) => {
    const api = (
      window as unknown as {
        annotationVisualTest: { setupSelectAllTest(s: unknown[]): Promise<void> };
      }
    ).annotationVisualTest;
    await api.setupSelectAllTest(annotations);
  }, specs);
  await expect(page.locator('g[data-annot-id]')).toHaveCount(2);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  await canvas.press('Control+a');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const api = (
          window as unknown as {
            annotationVisualTest: { readDuplicateState(): Promise<{ selectedCount: number }> };
          }
        ).annotationVisualTest;
        return api.readDuplicateState().then((state) => state.selectedCount);
      }),
    )
    .toBe(2);
});

test('a selected fill-only rectangle shows a dashed bounding box', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const spec: AnnotationSpec = {
    subtype: 'square',
    rect: { left: 48, top: 208, right: 176, bottom: 80 },
    color: rgba(30, 136, 229),
    interiorColor: rgba(67, 160, 71),
    borderWidth: 0,
  };
  await page.evaluate(async (annotation) => {
    const api = (
      window as unknown as {
        annotationVisualTest: { setupDuplicateGesture(s: unknown): Promise<string> };
      }
    ).annotationVisualTest;
    await api.setupDuplicateGesture(annotation);
  }, spec);
  const guide = page.locator('.pdfrx-anchors > rect');
  await expect(guide).toHaveCount(1);
  await expect(guide).toHaveAttribute('stroke-dasharray', /\d/);
});
