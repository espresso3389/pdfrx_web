import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { mergeAcroForms, writeOutline } from '../src/outline-writer.js';

describe('collaborative outline export', () => {
  it('writes nested bookmarks with destinations in the final page order', async () => {
    const seed = await PDFDocument.create();
    seed.addPage([200, 300]);
    seed.addPage([200, 300]);
    const bytes = await writeOutline(await seed.save(), [
      {
        title: 'Document A',
        dest: { pageIndex: 1, command: 'xyz', params: [10, 250, null] },
        children: [{ title: 'First section', dest: { pageIndex: 0, command: 'fit', params: [] }, children: [] }],
      },
    ]);

    const pdf = await PDFDocument.load(bytes);
    const outlines = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    expect(outlines.lookup(PDFName.of('Count'), PDFNumber).asNumber()).toBe(2);
    const first = outlines.lookup(PDFName.of('First'), PDFDict);
    expect(first.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('Document A');
    const destination = first.lookup(PDFName.of('Dest'), PDFArray);
    expect(destination.get(0)).toEqual(pdf.getPage(1).ref);
    const child = first.lookup(PDFName.of('First'), PDFDict);
    expect(child.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('First section');
    expect(child.lookup(PDFName.of('Dest'), PDFArray).get(0)).toEqual(pdf.getPage(0).ref);
  });
});

describe('collaborative AcroForm export', () => {
  it('registers imported widgets under source-scoped field names', async () => {
    const sourceA = await PDFDocument.create();
    const pageA = sourceA.addPage([200, 300]);
    const fieldA = sourceA.getForm().createTextField('name');
    fieldA.setText('Alice');
    fieldA.addToPage(pageA, { x: 20, y: 200, width: 100, height: 20 });
    const sourceB = await PDFDocument.create();
    const pageB = sourceB.addPage([200, 300]);
    const fieldB = sourceB.getForm().createTextField('name');
    fieldB.setText('Bob');
    fieldB.addToPage(pageB, { x: 20, y: 200, width: 100, height: 20 });

    const merged = await PDFDocument.create();
    merged.addPage((await merged.copyPages(sourceA, [0]))[0]!);
    merged.addPage((await merged.copyPages(sourceB, [0]))[0]!);
    const bytes = await mergeAcroForms(await merged.save(), [
      { placementId: 'a', source: { documentId: 'document-a', pageIndex: 0 }, rotation: 0 },
      { placementId: 'b', source: { documentId: 'document-b', pageIndex: 0 }, rotation: 0 },
    ]);

    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getForm().getFields().map((field) => field.getName()).sort()).toEqual([
      'source_1.name',
      'source_2.name',
    ]);
    expect(reopened.getForm().getTextField('source_1.name').getText()).toBe('Alice');
    expect(reopened.getForm().getTextField('source_2.name').getText()).toBe('Bob');
  });

  it('rewrites AFSimple_Calculate references and combines source calculation order', async () => {
    const makeSource = async (value: string): Promise<{ pdf: PDFDocument; bytes: Uint8Array }> => {
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([200, 300]);
      const form = pdf.getForm();
      const input = form.createTextField('input');
      input.setText(value);
      input.addToPage(page, { x: 20, y: 230, width: 100, height: 20 });
      const total = form.createTextField('total');
      total.setText(value);
      total.addToPage(page, { x: 20, y: 190, width: 100, height: 20 });
      const action = pdf.context.obj({
        S: 'JavaScript',
        JS: PDFString.of('AFSimple_Calculate("SUM", new Array("input"));'),
      });
      total.acroField.dict.set(PDFName.of('AA'), pdf.context.obj({ C: action }));
      const acroForm = pdf.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
      const order = PDFArray.withContext(pdf.context);
      order.push(total.ref);
      acroForm.set(PDFName.of('CO'), order);
      return { pdf, bytes: await pdf.save() };
    };
    const first = await makeSource('10');
    const second = await makeSource('20');
    const merged = await PDFDocument.create();
    merged.addPage((await merged.copyPages(first.pdf, [0]))[0]!);
    merged.addPage((await merged.copyPages(second.pdf, [0]))[0]!);
    const placements = [
      { placementId: 'a', source: { documentId: 'document-a', pageIndex: 0 }, rotation: 0 as const },
      { placementId: 'b', source: { documentId: 'document-b', pageIndex: 0 }, rotation: 0 as const },
    ];
    const bytes = await mergeAcroForms(await merged.save(), placements, [
      { documentId: 'document-a', bytes: first.bytes },
      { documentId: 'document-b', bytes: second.bytes },
    ]);

    const reopened = await PDFDocument.load(bytes);
    const fields = reopened.getForm();
    expect(fields.getTextField('source_1.input').getText()).toBe('10');
    expect(fields.getTextField('source_2.input').getText()).toBe('20');
    const acroForm = reopened.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    expect(acroForm.lookup(PDFName.of('CO'), PDFArray).size()).toBe(2);
    for (const prefix of ['source_1', 'source_2']) {
      const total = fields.getTextField(`${prefix}.total`);
      const aa = total.acroField.dict.lookup(PDFName.of('AA'), PDFDict);
      const calculate = aa.lookup(PDFName.of('C'), PDFDict);
      expect(calculate.lookup(PDFName.of('JS'), PDFString).decodeText()).toContain(`"${prefix}.input"`);
    }
  });
});
