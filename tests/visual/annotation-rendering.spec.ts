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
  contents?: string;
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
  {
    name: 'text highlight color and opacity',
    spec: {
      subtype: 'highlight',
      rect: { left: 36, top: 156, right: 220, bottom: 108 },
      color: rgba(251, 192, 45),
      borderWidth: 0,
      geometry: {
        kind: 'markup',
        quads: [
          {
            topLeft: { x: 36, y: 156 },
            topRight: { x: 220, y: 156 },
            bottomLeft: { x: 36, y: 108 },
            bottomRight: { x: 220, y: 108 },
          },
        ],
      },
    },
    maxMismatchRatio: 0.01,
  },
  {
    name: 'sticky note appearance',
    spec: {
      subtype: 'text',
      rect: { left: 72, top: 184, right: 96, bottom: 160 },
      color: rgba(251, 192, 45, 255),
      borderWidth: 0,
      contents: 'Review this section',
      geometry: { kind: 'none' },
    },
    maxMismatchRatio: 0.004,
  },
  {
    name: 'free text appearance',
    spec: {
      subtype: 'freeText',
      rect: { left: 36, top: 184, right: 220, bottom: 112 },
      color: rgba(229, 57, 53, 255),
      borderWidth: 1,
      contents: 'Free text annotation',
      geometry: { kind: 'none' },
    },
    maxMismatchRatio: 0.025,
  },
  {
    name: 'filled free text with thick border',
    spec: {
      subtype: 'freeText',
      rect: { left: 36, top: 208, right: 220, bottom: 80 },
      color: rgba(229, 57, 53, 255),
      interiorColor: rgba(30, 136, 229, 255),
      borderWidth: 12,
      contents: 'Filled text box',
      geometry: { kind: 'none' },
    },
    maxMismatchRatio: 0.025,
  },
  {
    name: 'rotated free text appearance',
    spec: {
      subtype: 'freeText',
      // Deliberately non-square: this catches regressions where the rotated
      // text's clip is rotated too and only the middle of the line survives.
      rect: { left: 72, top: 184, right: 216, bottom: 76 },
      color: rgba(30, 90, 180, 255),
      borderWidth: 1,
      contents: 'Rotated text',
      textOrientation: { rotation: 90, behavior: 'page' },
      geometry: { kind: 'none' },
    },
    maxMismatchRatio: 0.035,
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

test('approved stamp preserves its label and standard outline', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const result = await page.evaluate((spec) =>
    (
      window as unknown as {
        annotationVisualTest: {
          inspectStamp(s: unknown): Promise<{ label: string | null; labelFill: string | null; stroke: string | null; fill: string | null; rx: string | null }>;
        };
      }
    ).annotationVisualTest.inspectStamp(spec),
  {
    subtype: 'stamp',
    rect: { left: 48, top: 164, right: 208, bottom: 116 },
    color: rgba(229, 57, 53, 255),
    contents: 'APPROVED',
    geometry: { kind: 'none' },
  });
  expect(result).toEqual({
    label: 'APPROVED',
    labelFill: 'rgb(229, 57, 53)',
    stroke: 'rgb(229, 57, 53)',
    fill: 'none',
    rx: '5',
  });
});

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

test('annotation move snaps to nearby object guides and shows the active guide', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const specs: AnnotationSpec[] = [
    {
      subtype: 'square',
      rect: { left: 40, top: 216, right: 88, bottom: 168 },
      color: rgba(30, 136, 229),
      borderWidth: 4,
    },
    {
      subtype: 'square',
      rect: { left: 184, top: 216, right: 232, bottom: 168 },
      color: rgba(229, 57, 53),
      borderWidth: 4,
    },
  ];
  const ids = await page.evaluate(async (annotations) => {
    const api = (
      window as unknown as {
        annotationVisualTest: { setupSnapGesture(s: unknown[]): Promise<string[]> };
      }
    ).annotationVisualTest;
    return api.setupSnapGesture(annotations);
  }, specs);
  const source = page.locator(`g[data-annot-id="${ids[0]}"]`);
  const target = page.locator(`g[data-annot-id="${ids[1]}"]`);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Snap test annotations are not visible');
  // Unfilled rectangles are hit-testable only on their outline. Stay clear of
  // the resize handles while beginning a body drag on the top edge.
  const start = { x: sourceBox.x + sourceBox.width / 4, y: sourceBox.y + 2 };
  const nearTargetDx = targetBox.x - (sourceBox.x + sourceBox.width) - 3;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + nearTargetDx, start.y, { steps: 4 });
  await expect(page.locator('.pdfrx-annotation-snap-guide')).not.toHaveCount(0);
  const livePreview = await page.evaluate(() =>
    (
      window as unknown as {
        annotationVisualTest: {
          readAnnotationPreviewRects(): { id: string; rect?: { left: number; right: number } }[];
        };
      }
    ).annotationVisualTest.readAnnotationPreviewRects(),
  );
  expect(livePreview[0]?.id).toBe(ids[0]);
  expect(livePreview[0]?.rect?.left).toBeGreaterThan(specs[0]!.rect!.left);
  await page.mouse.up();
  await expect(page.locator('.pdfrx-annotation-snap-guide')).toHaveCount(0);
  await expect
    .poll(async () => {
      const moved = await source.boundingBox();
      return moved ? Math.abs(moved.x + moved.width - targetBox.x) : Infinity;
    })
    .toBeLessThan(1.5);
});

test('annotation anchors never snap to the object being edited', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const spec: AnnotationSpec = {
    subtype: 'square',
    rect: { left: 64, top: 208, right: 160, bottom: 112 },
    color: rgba(30, 136, 229),
    borderWidth: 4,
  };
  await page.evaluate(async (annotation) => {
    const api = (
      window as unknown as {
        annotationVisualTest: { setupSnapGesture(s: unknown[]): Promise<string[]> };
      }
    ).annotationVisualTest;
    await api.setupSnapGesture([annotation]);
  }, spec);
  const anchors = page.locator('.pdfrx-anchors circle');
  const anchorCount = await anchors.count();
  expect(anchorCount).toBeGreaterThan(0);
  const anchor = anchors.nth(0);
  const before = await anchor.boundingBox();
  if (!before) throw new Error('Annotation anchor is not visible');
  const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 3, start.y + 3);
  await expect(page.locator('.pdfrx-annotation-snap-guide')).toHaveCount(0);
  const during = await anchor.boundingBox();
  if (!during) throw new Error('Annotation anchor disappeared while dragging');
  expect(during.x - before.x).toBeCloseTo(3, 0);
  expect(during.y - before.y).toBeCloseTo(3, 0);
  await page.mouse.up();
});

test('edge-center anchors only snap along their movable axis', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const specs: AnnotationSpec[] = [
    {
      subtype: 'square',
      rect: { left: 64, top: 208, right: 160, bottom: 112 },
      color: rgba(30, 136, 229),
      borderWidth: 4,
    },
    {
      // Same horizontal center as the source, but far away vertically. The
      // source's top-center handle must not emit an X guide to this object.
      subtype: 'square',
      rect: { left: 88, top: 80, right: 136, bottom: 32 },
      color: rgba(229, 57, 53),
      borderWidth: 4,
    },
  ];
  await page.evaluate(async (annotations) => {
    const api = (
      window as unknown as {
        annotationVisualTest: { setupSnapGesture(s: unknown[]): Promise<string[]> };
      }
    ).annotationVisualTest;
    await api.setupSnapGesture(annotations);
  }, specs);
  const anchors = page.locator('.pdfrx-anchors circle');
  expect(await anchors.count()).toBe(8);
  const topCenter = anchors.nth(1);
  const before = await topCenter.boundingBox();
  if (!before) throw new Error('Top-center annotation anchor is not visible');
  const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 10);
  const hasVerticalGuide = await page.evaluate(() =>
    [...document.querySelectorAll<SVGLineElement>('.pdfrx-annotation-snap-guide')].some(
      (line) => line.getAttribute('x1') === line.getAttribute('x2'),
    ),
  );
  expect(hasVerticalGuide).toBe(false);
  const during = await topCenter.boundingBox();
  if (!during) throw new Error('Top-center annotation anchor disappeared while dragging');
  expect(during.x).toBeCloseTo(before.x, 5);
  expect(during.y - before.y).toBeCloseTo(10, 0);
  await page.mouse.up();
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
  // The centred Add text banner owns the middle of a selected empty rectangle.
  const start = { x: box.x + box.width / 4, y: box.y + 5 };
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

test('Ctrl+A selects every annotation when one annotation is already selected', async ({ page }) => {
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
  const rectangle = page.locator('g[data-annot-id]').filter({ has: page.locator('rect') });
  const rectangleBox = await rectangle.boundingBox();
  if (!rectangleBox) throw new Error('Select-all test rectangle is not visible');
  await page.mouse.click(rectangleBox.x + rectangleBox.width / 4, rectangleBox.y + 2);
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

test('highlight uses a page-level Multiply layer that can blend with the PDF canvas', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const spec: AnnotationSpec = {
    subtype: 'highlight',
    rect: { left: 36, top: 156, right: 220, bottom: 108 },
    color: rgba(229, 57, 53),
    borderWidth: 0,
    geometry: {
      kind: 'markup',
      quads: [
        {
          topLeft: { x: 36, y: 156 },
          topRight: { x: 220, y: 156 },
          bottomLeft: { x: 36, y: 108 },
          bottomRight: { x: 220, y: 108 },
        },
      ],
    },
  };
  const id = await page.evaluate(async (annotation) => {
    const api = (
      window as unknown as {
        annotationVisualTest: { setupDuplicateGesture(s: unknown): Promise<string> };
      }
    ).annotationVisualTest;
    return api.setupDuplicateGesture(annotation);
  }, spec);
  const blendLayer = page.locator('.pdfrx-annotation-highlight-page');
  await expect(blendLayer).toHaveCount(1);
  await expect(blendLayer).toHaveCSS('mix-blend-mode', 'multiply');
  const visual = page.locator(`g[data-annot-visual-id="${id}"]`);
  await expect(visual).toHaveCount(1);
  await expect(visual.locator('polygon')).not.toHaveAttribute('fill-opacity');
});

test('wheel scrolling and browser-safe zoom work while the annotation SVG captures object selection', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const spec: AnnotationSpec = {
    subtype: 'square',
    rect: { left: 48, top: 208, right: 176, bottom: 80 },
    color: rgba(30, 136, 229),
    interiorColor: rgba(67, 160, 71),
    borderWidth: 4,
  };
  await page.evaluate(async (annotation) => {
    const api = (
      window as unknown as {
        annotationVisualTest: { setupSelectAllTest(s: unknown[]): Promise<void> };
      }
    ).annotationVisualTest;
    await api.setupSelectAllTest([annotation]);
  }, spec);
  await expect(page.locator('g[data-annot-id]')).toHaveCount(1);
  const transform = async (): Promise<{ yZoomed: number; zoom: number }> =>
    page.evaluate(() => {
      const api = (
        window as unknown as {
          annotationVisualTest: { readViewTransform(): { yZoomed: number; zoom: number } };
        }
      ).annotationVisualTest;
      return api.readViewTransform();
    });
  const before = await transform();
  await page.mouse.move(128, 128);
  await page.mouse.wheel(0, 80);
  await expect.poll(async () => (await transform()).yZoomed).toBeLessThan(before.yZoomed);

  const beforeZoom = await transform();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -80);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await transform()).zoom).toBeGreaterThan(beforeZoom.zoom);
});

test('the box tool switches automatically between rectangle and FreeText', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  await page.evaluate(() =>
    (
      window as unknown as {
        annotationVisualTest: {
          setupTextTool(t: 'note' | 'freeText' | 'rectangle', strokeWidth?: number): Promise<void>;
        };
      }
    ).annotationVisualTest.setupTextTool('rectangle', 5),
  );
  const read = (): Promise<{ subtype: string; contents: string | null; borderWidth: number }[]> =>
    page.evaluate(() =>
      (
        window as unknown as {
          annotationVisualTest: {
            readTextAnnotations(): Promise<{ subtype: string; contents: string | null; borderWidth: number }[]>;
          };
        }
      ).annotationVisualTest.readTextAnnotations(),
    );

  await page.mouse.move(40, 80);
  await page.mouse.down();
  await page.mouse.move(200, 230, { steps: 3 });
  await page.mouse.up();
  const editor = page.locator('.pdfrx-annotation-text-editor textarea');
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await read())[0]?.subtype).toBe('square');
  expect(await read()).toEqual([{ subtype: 'square', contents: null, borderWidth: 5 }]);

  const box = page.locator('g[data-annot-id]');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await expect(editor).toHaveCount(1);
  await expect(editor).toHaveAttribute('placeholder', 'Localized text');
  expect(
    await editor.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor };
    }),
  ).toEqual({ width: '2px', style: 'solid', color: 'rgb(229, 57, 53)' });
  await editor.fill('Text inside the box');
  await editor.press('Control+Enter');
  await expect.poll(async () => (await read())[0]?.subtype).toBe('freeText');
  expect(await read()).toEqual([{ subtype: 'freeText', contents: 'Text inside the box', borderWidth: 5 }]);

  await page.locator('g[data-annot-id] text').dblclick({ force: true });
  await expect(editor).toHaveValue('Text inside the box');
  await editor.fill('   ');
  await editor.press('Control+Enter');
  await expect.poll(async () => (await read())[0]?.subtype).toBe('square');
  expect(await read()).toEqual([{ subtype: 'square', contents: null, borderWidth: 5 }]);

  await page.reload();
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  await page.evaluate(() =>
    (
      window as unknown as {
        annotationVisualTest: {
          setupTextTool(t: 'note' | 'freeText' | 'rectangle', strokeWidth?: number): Promise<void>;
        };
      }
    ).annotationVisualTest.setupTextTool('rectangle', 0),
  );
  await page.mouse.move(40, 80);
  await page.mouse.down();
  await page.mouse.move(200, 230, { steps: 3 });
  await page.mouse.up();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await expect(editor).toHaveCount(1);
  expect(
    await editor.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.borderTopWidth, style: style.borderTopStyle };
    }),
  ).toEqual({ width: '0px', style: 'none' });
});

test('box text color and size are rendered and survive PDF round-trip', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  await page.evaluate(async () => {
    const api = (
      window as unknown as {
        annotationVisualTest: {
          setupTextTool(t: 'rectangle'): Promise<void>;
          setTextStyle(color: string, size: number): void;
        };
      }
    ).annotationVisualTest;
    await api.setupTextTool('rectangle');
    api.setTextStyle('#43a047', 24);
  });
  await page.mouse.move(40, 80);
  await page.mouse.down();
  await page.mouse.move(240, 230, { steps: 3 });
  await page.mouse.up();
  const editor = page.locator('.pdfrx-annotation-text-editor textarea');
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await expect(editor).toHaveCount(1);
  await expect(editor).toHaveCSS('color', 'rgb(67, 160, 71)');
  await expect(editor).toHaveCSS('font-size', '24px');
  await editor.fill('Styled text');
  await editor.press('Control+Enter');
  const svgText = page.locator('g[data-annot-id] text');
  await expect(svgText).toHaveAttribute('fill', 'rgb(67, 160, 71)');
  await expect(svgText).toHaveAttribute('font-size', '24');
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          annotationVisualTest: {
            readTextStyleRoundTrip(): Promise<{ textColor: unknown; fontSize: number | null } | null>;
          };
        }
      ).annotationVisualTest.readTextStyleRoundTrip(),
    ),
  ).toEqual({ textColor: { r: 67, g: 160, b: 71, a: 255 }, fontSize: 24 });
});

test('box text reflows while its resize handle is being dragged', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  await page.evaluate(() =>
    (
      window as unknown as {
        annotationVisualTest: { setupTextTool(t: 'rectangle'): Promise<void> };
      }
    ).annotationVisualTest.setupTextTool('rectangle'),
  );
  await page.mouse.move(40, 80);
  await page.mouse.down();
  await page.mouse.move(150, 220, { steps: 3 });
  await page.mouse.up();
  const editor = page.locator('.pdfrx-annotation-text-editor textarea');
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await editor.fill('Text that wraps across several lines while the box changes width');
  await editor.press('Control+Enter');
  const lines = page.locator('g[data-annot-id] text tspan');
  await expect.poll(async () => lines.count()).toBeGreaterThan(1);
  await page.evaluate(() =>
    (
      window as unknown as {
        annotationVisualTest: { setObjectSelectMode(): void };
      }
    ).annotationVisualTest.setObjectSelectMode(),
  );
  const box = page.locator('g[data-annot-id]');
  const boxBounds = await box.boundingBox();
  if (!boxBounds) throw new Error('FreeText box is not visible');
  await page.mouse.click(boxBounds.x + boxBounds.width / 4, boxBounds.y + 2);
  const handles = page.locator('.pdfrx-anchors circle');
  await expect(handles).toHaveCount(8);
  const initialLineCount = await lines.count();
  expect(initialLineCount).toBeGreaterThan(1);
  const rightHandle = handles.nth(3);
  const handleBox = await rightHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 220, handleBox!.y + handleBox!.height / 2, {
    steps: 4,
  });
  // Assert before pointerup: the live SVG preview must already use the wider box.
  await expect.poll(async () => lines.count()).toBeLessThan(initialLineCount);
  await page.mouse.up();
});

test('note and FreeText use inline editors instead of browser prompts', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const setup = (tool: 'note' | 'freeText'): Promise<void> =>
    page.evaluate((value) => {
      const api = (
        window as unknown as {
          annotationVisualTest: { setupTextTool(t: 'note' | 'freeText', strokeWidth?: number): Promise<void> };
        }
      ).annotationVisualTest;
      return api.setupTextTool(value);
    }, tool);
  const read = (): Promise<{ subtype: string; contents: string | null; borderWidth: number }[]> =>
    page.evaluate(() => {
      const api = (
        window as unknown as {
          annotationVisualTest: {
            readTextAnnotations(): Promise<{ subtype: string; contents: string | null; borderWidth: number }[]>;
          };
        }
      ).annotationVisualTest;
      return api.readTextAnnotations();
    });

  await setup('note');
  await expect(page.locator('svg[style*="crosshair"]')).toHaveCount(1);
  await page.mouse.click(120, 80);
  const noteEditor = page.locator('.pdfrx-annotation-text-editor textarea');
  await expect(noteEditor).toHaveCount(1);
  await expect(noteEditor).toHaveAttribute('placeholder', 'Localized note');
  await noteEditor.evaluate((element) => {
    element.style.width = '80px';
    element.style.height = '72px';
  });
  const noteEditorHost = page.locator('.pdfrx-annotation-text-editor');
  await expect.poll(async () => Number(await noteEditorHost.getAttribute('width'))).toBe(80);
  await expect.poll(async () => Number(await noteEditorHost.getAttribute('height'))).toBe(72);
  const noteContents =
    'これは複数行の日本語ですが、ちゃんと表示されているかどうか心配です。This is a long sentence, which also contains some 😒emoji. But I think emoji is not supported by PDF anyway.これは複数行の日本語ですが、ちゃんと表示されているかどうか心配です。This is a long sentence, which also contains some 😒emoji. But I think emoji is not supported by PDF anyway.';
  await noteEditor.fill(noteContents);
  await noteEditor.press('Control+Enter');
  await expect.poll(async () => (await read()).length).toBe(1);
  expect(await read()).toEqual([{ subtype: 'text', contents: noteContents, borderWidth: 0 }]);
  const roundTrippedNotes = await page.evaluate(() =>
    (
      window as unknown as {
        annotationVisualTest: {
          readTextAnnotationsRoundTrip(): Promise<{ subtype: string; contents: string | null; borderWidth: number }[]>;
        };
      }
    ).annotationVisualTest.readTextAnnotationsRoundTrip(),
  );
  expect(roundTrippedNotes).toEqual([{ subtype: 'text', contents: noteContents, borderWidth: 0 }]);
  await expect(page.locator('.pdfrx-anchors circle')).toHaveCount(0);

  // Reopening a Note and clicking inside its editor must not move focus back
  // to the canvas and commit/close the editor before caret placement or resize.
  await page.locator('g[data-annot-id]').dblclick({ force: true });
  await expect(noteEditor).toHaveCount(1);
  await expect(noteEditor).toHaveValue(noteContents);
  await noteEditor.click({ position: { x: 20, y: 20 } });
  await expect(noteEditor).toBeFocused();
  await expect(noteEditor).toHaveCount(1);
  const composedContents = `${noteContents} 変換中の追記`;
  await noteEditor.evaluate((element, value) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { data: '変換中' }));
    element.value = value;
    element.blur();
  }, composedContents);
  // A blur during IME conversion must not commit the pre-composition value.
  await expect(noteEditor).toHaveCount(1);
  await noteEditor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionend', { data: '変換中の追記' }));
  });
  await expect(noteEditor).toHaveCount(0);
  await expect.poll(async () => (await read())[0]?.contents).toBe(composedContents);

  // Exercise the second creation flow from a fresh document/viewer so the
  // previous tool's asynchronous overlay replacement cannot affect the drag.
  await page.reload();
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  await page.evaluate(() =>
    (
      window as unknown as {
        annotationVisualTest: { setupTextTool(t: 'note' | 'freeText', strokeWidth?: number): Promise<void> };
      }
    ).annotationVisualTest.setupTextTool('freeText', 7),
  );
  await expect(page.locator('svg[style*="crosshair"]')).toHaveCount(1);
  await page.mouse.move(40, 80);
  await page.mouse.down();
  await page.mouse.move(200, 230, { steps: 3 });
  await page.mouse.up();
  const freeTextEditor = page.locator('.pdfrx-annotation-text-editor textarea');
  await expect(freeTextEditor).toHaveCount(1);
  const multilineText =
    'これは複数行の日本語ですが、ちゃんと表示されているかどうか心配です。This is a long sentence, which also contains some 😒emoji.';
  await freeTextEditor.fill(multilineText);
  // Saving while the editor still owns focus must first commit its contents;
  // otherwise encodePdf can race ahead and persist an empty Text Box.
  await page.evaluate(() =>
    (
      window as unknown as { annotationVisualTest: { flushAnnotationTextEdit(): Promise<void> } }
    ).annotationVisualTest.flushAnnotationTextEdit(),
  );
  await expect.poll(async () => (await read()).length).toBe(1);
  expect(await read()).toEqual([{ subtype: 'freeText', contents: multilineText, borderWidth: 7 }]);
  const renderedText = page.locator('g[data-annot-id] text');
  await expect(renderedText.locator('tspan').first()).toBeAttached();
  expect(await renderedText.locator('tspan').count()).toBeGreaterThan(5);
  const clippedText = page.locator('g[data-annot-id] g[clip-path]');
  await expect(clippedText).toHaveCount(1);
  await expect(clippedText).toHaveAttribute('clip-path', /^url\(#pdfrx-free-text-/);
  await expect(clippedText.locator(':scope > text')).toHaveCount(1);
  const roundTrip = await page.evaluate(() => {
    const api = (
      window as unknown as {
        annotationVisualTest: {
          inspectCurrentFreeTextRoundTrip(): Promise<{
            contents: string | null;
            darkInteriorPixels: number;
            emojiPixels: number;
            emojiPositionDelta: number;
            emojiPosition: { actualX: number; actualY: number; expectedX: number; expectedY: number };
            fontFaces: string[];
            runs: { text: string; fontFace: string | null }[];
          }>;
        };
      }
    ).annotationVisualTest;
    return api.inspectCurrentFreeTextRoundTrip();
  });
  expect(roundTrip.contents).toBe(multilineText);
  expect(roundTrip.darkInteriorPixels).toBeGreaterThan(100);
  expect(roundTrip.emojiPixels, 'embedded emoji image should retain colored pixels').toBeGreaterThan(10);
  expect(roundTrip.emojiPositionDelta, `emoji position ${JSON.stringify(roundTrip.emojiPosition)}`).toBeLessThanOrEqual(3);
  expect(roundTrip.fontFaces).toContain('PdfrxFreeText-128');
  expect(roundTrip.runs.some((run) => run.text.includes('、') && run.fontFace === 'PdfrxFreeText-128')).toBe(true);
  expect(roundTrip.runs.some((run) => run.text.includes('。') && run.fontFace === 'PdfrxFreeText-128')).toBe(true);

  // The empty area inside the box is also a hit target; users should not have
  // to double-click directly on a glyph or the thin border to edit it.
  await page.locator('g[data-annot-id] text').dblclick({ force: true });
  await expect(page.locator('.pdfrx-annotation-text-editor textarea')).toHaveValue(multilineText);
});

test('FreeText contents survive encode and render after reopening', async ({ page }) => {
  await page.goto('/visual-tests/annotation-rendering.html');
  await page.waitForFunction(() => 'annotationVisualTest' in window);
  const spec: AnnotationSpec = {
    subtype: 'freeText',
    rect: { left: 36, top: 184, right: 220, bottom: 112 },
    color: rgba(229, 57, 53, 255),
    borderWidth: 1,
    contents: 'Persisted free text',
    geometry: { kind: 'none' },
  };
  const result = await page.evaluate(async (annotation) => {
    const api = (
      window as unknown as {
        annotationVisualTest: {
          runFreeTextRoundTrip(s: unknown): Promise<{ contents: string | null; darkInteriorPixels: number }>;
        };
      }
    ).annotationVisualTest;
    return api.runFreeTextRoundTrip(annotation);
  }, spec);
  expect(result.contents).toBe(spec.contents);
  expect(result.darkInteriorPixels, 'reopened PDF should paint the FreeText glyphs').toBeGreaterThan(20);
});
