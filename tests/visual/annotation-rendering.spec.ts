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
  await noteEditor.fill('Review this section');
  await noteEditor.press('Control+Enter');
  await expect.poll(async () => (await read()).length).toBe(1);
  expect(await read()).toEqual([{ subtype: 'text', contents: 'Review this section', borderWidth: 0 }]);

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
  await page.mouse.move(200, 140, { steps: 3 });
  await page.mouse.up();
  const freeTextEditor = page.locator('.pdfrx-annotation-text-editor textarea');
  await expect(freeTextEditor).toHaveCount(1);
  const multilineText = '日本語テキスト ABC\nThis is a very long line that must wrap inside the text box.';
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
  await expect(renderedText.locator('tspan')).toHaveCount(4);
  await expect(renderedText).toHaveAttribute('clip-path', /^url\(#pdfrx-free-text-/);
  const roundTrip = await page.evaluate(() => {
    const api = (
      window as unknown as {
        annotationVisualTest: {
          inspectCurrentFreeTextRoundTrip(): Promise<{ contents: string | null; darkInteriorPixels: number }>;
        };
      }
    ).annotationVisualTest;
    return api.inspectCurrentFreeTextRoundTrip();
  });
  expect(roundTrip.contents).toBe(multilineText);
  expect(roundTrip.darkInteriorPixels).toBeGreaterThan(100);

  // The empty area inside the box is also a hit target; users should not have
  // to double-click directly on a glyph or the thin border to edit it.
  const freeTextShape = page.locator('g[data-annot-id]').first();
  await freeTextShape.dblclick({ position: { x: 140, y: 45 } });
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
