import { readFile } from 'node:fs/promises';
import {
  PdfrxEngine,
  type PdfAnnotationSpec,
  type PdfDocument,
  type PdfDocumentEventMap,
  type WireRawPdfObject,
} from '@pdfrx/engine';
import { afterAll, describe, expect, it } from 'vitest';
import { mergeAcroForms, writeOutline } from '../src/outline-writer.js';

const engine = new PdfrxEngine();
afterAll(() => engine.dispose());

describe('raw PDF object API', () => {
  it('commits editor batches atomically and leaves the original untouched on either kind of failure', async () => {
    const pixel = { pixels: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 };
    const document = await engine.createFromImages([pixel]);
    try {
      const initialHandle = document.docHandle;
      await expect(document.editRawObjects((editor) => {
        editor.setDictionaryValue(editor.catalog(), 'CallbackMustNotCommit', { kind: 'boolean', value: true });
        throw new Error('stop building');
      })).rejects.toThrow('stop building');
      expect((await document.getCatalogObject()).object).not.toMatchObject({
        entries: { CallbackMustNotCommit: expect.anything() },
      });
      expect(document.docHandle).toBe(initialHandle);

      await document.editRawObjects((editor) => {
        editor.setDictionaryValue(editor.catalog(), 'DirectCommit', { kind: 'boolean', value: true });
      });
      expect((await document.getCatalogObject()).object).toMatchObject({
        entries: { DirectCommit: { kind: 'boolean', value: true } },
      });
      expect(document.docHandle).toBe(initialHandle);

      await expect(document.editRawObjects(
        (editor) => {
          editor.setDictionaryValue(editor.catalog(), 'WorkerMustNotCommit', { kind: 'boolean', value: true });
          editor.setDictionaryValue(editor.object(999999), 'Missing', { kind: 'null' });
        },
        { atomic: true },
      )).rejects.toThrow('Raw PDF patch target does not exist');
      expect((await document.getCatalogObject()).object).not.toMatchObject({
        entries: { WorkerMustNotCommit: expect.anything() },
      });
      expect(document.docHandle).toBe(initialHandle);

      await document.editRawObjects(
        (editor) => {
          const metadata = editor.createDictionary({
            Type: { kind: 'name', value: 'Metadata' },
          });
          editor.setDictionaryValue(editor.catalog(), 'PdfrxTest', metadata.reference);
        },
        { atomic: true },
      );
      expect(document.docHandle).not.toBe(initialHandle);
      const catalog = (await document.getCatalogObject()).object;
      expect(catalog).toMatchObject({
        entries: {
          PdfrxTest: { kind: 'reference' },
        },
      });
      const reopened = await engine.openData(await document.encodePdf());
      try {
        expect((await reopened.getCatalogObject()).object).toMatchObject({
          entries: {
            PdfrxTest: { kind: 'reference' },
          },
        });
      } finally {
        await reopened.dispose();
      }
    } finally {
      await document.dispose();
    }
  });

  it('decodes, edits, saves, and reopens a stream object', async () => {
    const pixel = { pixels: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 };
    const document = await engine.createFromImages([pixel]);
    try {
      const page = await firstPageDictionary(document);
      const contents = page.entries.Contents;
      const streamRef = contents?.kind === 'reference'
        ? contents.objectNumber
        : contents?.kind === 'array' && contents.items[0]?.kind === 'reference'
          ? contents.items[0].objectNumber
          : null;
      expect(streamRef).not.toBeNull();
      const stream = await document.getRawObject(streamRef!, { includeRawStreamData: true });
      expect(stream.object?.kind).toBe('stream');
      if (!stream.object || stream.object.kind !== 'stream') throw new Error('Expected a content stream');
      expect(stream.object.data.byteLength).toBeGreaterThan(0);
      expect(stream.object.rawData?.byteLength).toBeGreaterThan(0);
      const suffix = new TextEncoder().encode('\nq Q\n');
      const updated = new Uint8Array(stream.object.data.byteLength + suffix.byteLength);
      updated.set(stream.object.data);
      updated.set(suffix, stream.object.data.byteLength);
      await document.editRawObjects((editor) => {
        editor.setStreamData(editor.object(streamRef!), updated);
      });

      const reopened = await engine.openData(await document.encodePdf());
      try {
        const reopenedPage = await firstPageDictionary(reopened);
        const reopenedContents = reopenedPage.entries.Contents;
        const reopenedRef = reopenedContents?.kind === 'reference'
          ? reopenedContents.objectNumber
          : reopenedContents?.kind === 'array' && reopenedContents.items[0]?.kind === 'reference'
            ? reopenedContents.items[0].objectNumber
            : null;
        const reopenedStream = await reopened.getRawObject(reopenedRef!);
        expect(reopenedStream.object?.kind).toBe('stream');
        if (!reopenedStream.object || reopenedStream.object.kind !== 'stream') throw new Error('Expected a stream');
        expect([...reopenedStream.object.data.slice(-suffix.byteLength)]).toEqual([...suffix]);
      } finally {
        await reopened.dispose();
      }
    } finally {
      await document.dispose();
    }
  });
});

describe('page-scoped annotation API', () => {
  it('writes imported source pages while reporting placement page numbers from the host document', async () => {
    const pixel = { pixels: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 };
    const host = await engine.createFromImages([pixel]);
    const source = await engine.createFromImages([pixel]);
    const events: PdfDocumentEventMap['annotationsChanged'][] = [];
    const sourceEvents: PdfDocumentEventMap['annotationsChanged'][] = [];
    const unsubscribe = host.addEventListener('annotationsChanged', (event) => events.push(event));
    const unsubscribeSource = source.addEventListener('annotationsChanged', (event) => sourceEvents.push(event));
    try {
      host.setPages([source.pages[0]!, source.pages[0]!]);
      const firstPlacement = host.pages[0]!;
      expect(firstPlacement.document).toBe(host);
      expect(firstPlacement.sourceDocument).toBe(source);

      const id = await firstPlacement.addAnnotation(squareAnnotation());

      expect(events).toHaveLength(1);
      expect(events[0]?.pageNumbers).toEqual([1, 2]);
      expect(events[0]?.historyChanges).toHaveLength(2);
      expect(events[0]?.historyChanges[0]).toMatchObject({ id, pageNumber: 1, before: null });
      expect(events[0]?.historyChanges[0]?.after).toMatchObject({ subtype: 'square' });
      expect(sourceEvents).toHaveLength(1);
      expect(sourceEvents[0]?.pageNumbers).toEqual([1]);
      expect(sourceEvents[0]?.historyChanges[0]).toMatchObject({ id, pageNumber: 1, before: null });

      await firstPlacement.updateAnnotation(id, { ...squareAnnotation(), opacity: 0.5 });
      expect(events[1]?.historyChanges).toHaveLength(2);
      expect(events[1]?.historyChanges[0]?.before).toMatchObject({ subtype: 'square' });
      expect(events[1]?.historyChanges[0]?.after).toMatchObject({ subtype: 'square', opacity: 0.5 });
      const placed = await host.loadAnnotations();
      expect(placed.map((annotation) => annotation.pageNumber)).toEqual([1, 2]);
      expect(await source.pages[0]!.loadAnnotations()).toHaveLength(1);
      expect((await host.exportAnnotations()).annotations).toHaveLength(1);
    } finally {
      unsubscribe();
      unsubscribeSource();
      await host.dispose();
      await source.dispose();
    }
  });
});

describe('collaborative outline export', () => {
  it('writes nested bookmarks with destinations in the final page order', async () => {
    const pixel = { pixels: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 };
    const document = await engine.createFromImages([pixel, pixel]);
    await writeOutline(document, [
      {
        title: 'Document A',
        dest: { pageIndex: 1, command: 'xyz', params: [10, 250, null] },
        children: [{ title: 'First section', dest: { pageIndex: 0, command: 'fit', params: [] }, children: [] }],
      },
    ]);
    const bytes = await document.encodePdf();
    await document.dispose();

    const reopened = await engine.openData(bytes);
    try {
      const outline = await reopened.loadOutline();
      expect(outline).toHaveLength(1);
      expect(outline[0]?.title).toBe('Document A');
      expect(outline[0]?.dest?.pageNumber).toBe(2);
      expect(outline[0]?.children[0]?.title).toBe('First section');
      expect(outline[0]?.children[0]?.dest?.pageNumber).toBe(1);
    } finally {
      await reopened.dispose();
    }
  });
});

describe('collaborative AcroForm export', () => {
  it('records choice-field labels so history replay can restore the selected option', async () => {
    const document = await engine.openData(await readFile('../../examples/react/public/form.pdf'));
    const events: PdfDocumentEventMap['formFieldsChanged'][] = [];
    const unsubscribe = document.addEventListener('formFieldsChanged', (event) => events.push(event));
    try {
      await document.setFormFieldValue('country', 'USA');
      const change = events.at(-1)?.changes.find((item) => item.name === 'country');
      expect(change).toEqual({ name: 'country', before: ['Japan'], after: ['USA'] });

      await document.setFormFieldValues({ country: change!.before }, { origin: 'history' });
      const restored = (await document.loadFormFields()).find((field) => field.name === 'country');
      expect(restored?.value).toBe('Japan');
      expect(restored?.options?.find((option) => option.selected)?.label).toBe('Japan');
    } finally {
      unsubscribe();
      await document.dispose();
    }
  });

  it('registers imported widgets under source-scoped field names and rewrites calculations', async () => {
    const first = await openFixture('form-a.pdf');
    const second = await openFixture('form-b.pdf');
    const merged = await first.createPdfCopy();
    try {
      merged.setPages([merged.pages[0]!, second.pages[0]!]);
      await merged.assemblePages();
      const placements = [
        { placementId: 'a', source: { documentId: 'document-a', pageIndex: 0 }, rotation: 0 as const },
        { placementId: 'b', source: { documentId: 'document-b', pageIndex: 0 }, rotation: 0 as const },
      ];
      await mergeAcroForms(
        merged,
        placements,
        new Map([['document-a', first], ['document-b', second]]),
      );
      const bytes = await merged.encodePdf();
      const reopened = await engine.openData(bytes);
      try {
        const fields = await reopened.loadFormFields();
        expect(fields.map((field) => field.name).sort()).toEqual([
          'source_1.input',
          'source_1.total',
          'source_2.input',
          'source_2.total',
        ]);
        expect(await reopened.getFormFieldValue('source_1.input')).toBe('10');
        expect(await reopened.getFormFieldValue('source_2.input')).toBe('20');
        expect(await calculationOrderSize(reopened)).toBe(2);

        const formEvents: PdfDocumentEventMap['formFieldsChanged'][] = [];
        const unsubscribeForms = reopened.addEventListener('formFieldsChanged', (event) => {
          if (event.changes.length > 0) formEvents.push(event);
        });
        await reopened.setFormFieldValue('source_1.input', '7');
        expect(formEvents).toHaveLength(1);
        expect(formEvents[0]).toMatchObject({
          origin: 'api',
          changes: [
            { name: 'source_1.input', before: '10', after: '7' },
            { name: 'source_1.total', before: '10', after: '7' },
          ],
        });
        expect(await reopened.getFormFieldValue('source_1.total')).toBe('7');
        expect(await reopened.getFormFieldValue('source_2.total')).toBe('20');
        await reopened.setFormFieldValues({
          'source_1.input': '8',
          'source_2.input': '9',
        });
        expect(formEvents).toHaveLength(2);
        expect(formEvents[1]?.changes.map((change) => change.name)).toEqual([
          'source_1.input',
          'source_1.total',
          'source_2.input',
          'source_2.total',
        ]);
        expect(await reopened.getFormFieldValue('source_1.total')).toBe('8');
        expect(await reopened.getFormFieldValue('source_2.total')).toBe('9');
        unsubscribeForms();
      } finally {
        await reopened.dispose();
      }
    } finally {
      await merged.dispose();
      await first.dispose();
      await second.dispose();
    }
  });
});

async function openFixture(name: string): Promise<PdfDocument> {
  return engine.openData(await readFile(new URL(`fixtures/${name}`, import.meta.url)));
}

function squareAnnotation(): PdfAnnotationSpec {
  return {
    subtype: 'square',
    rect: { left: 0, top: 1, right: 1, bottom: 0 },
    color: { red: 255, green: 0, blue: 0, alpha: 255 },
    borderWidth: 1,
    geometry: { kind: 'none' },
  };
}

async function calculationOrderSize(document: PdfDocument): Promise<number> {
  const root = (await document.getCatalogObject()).object;
  if (!root || root.kind !== 'dictionary') return 0;
  const acroForm = await resolveObject(document, root.entries.AcroForm);
  if (!acroForm || acroForm.kind !== 'dictionary') return 0;
  const order = acroForm.entries.CO;
  return order?.kind === 'array' ? order.items.length : 0;
}

async function resolveObject(
  document: PdfDocument,
  value: WireRawPdfObject | undefined,
): Promise<WireRawPdfObject | null> {
  if (!value) return null;
  if (value.kind !== 'reference') return value;
  return (await document.getRawObject(value.objectNumber)).object;
}

async function firstPageDictionary(document: PdfDocument): Promise<Extract<WireRawPdfObject, { kind: 'dictionary' }>> {
  const root = (await document.getCatalogObject()).object;
  if (!root || root.kind !== 'dictionary') throw new Error('Expected a catalog dictionary');
  const pages = await resolveObject(document, root.entries.Pages);
  if (!pages || pages.kind !== 'dictionary') throw new Error('Expected a page tree');
  const first = pages.entries.Kids?.kind === 'array' ? pages.entries.Kids.items[0] : null;
  const page = await resolveObject(document, first ?? undefined);
  if (!page || page.kind !== 'dictionary') throw new Error('Expected a page dictionary');
  return page;
}
