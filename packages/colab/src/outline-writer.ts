import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFDict,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import type { PagePlacement } from '@pdfrx/viewer-core';
import { parseCalcAction } from '@pdfrx/engine';
import type { MappedOutlineNode } from './export-composer.js';

/** Replaces the encoded PDF's outline catalog with mapped bookmark nodes. */
export async function writeOutline(bytes: Uint8Array, nodes: readonly MappedOutlineNode[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const context = pdf.context;
  const outline = context.obj({ Type: 'Outlines' });
  const outlineRef = context.register(outline);
  const top = buildSiblings(pdf, nodes, outlineRef);
  if (!top) return bytes;
  outline.set(PDFName.of('First'), top.first);
  outline.set(PDFName.of('Last'), top.last);
  outline.set(PDFName.of('Count'), PDFNumber.of(top.count));
  pdf.catalog.set(PDFName.of('Outlines'), outlineRef);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  return pdf.save({ useObjectStreams: false });
}

function buildSiblings(
  pdf: PDFDocument,
  nodes: readonly MappedOutlineNode[],
  parent: PDFRef,
): { readonly first: PDFRef; readonly last: PDFRef; readonly count: number } | null {
  if (nodes.length === 0) return null;
  const context = pdf.context;
  const entries = nodes.map((node) => {
    const dictionary = context.obj({ Title: PDFHexString.fromText(node.title), Parent: parent });
    const ref = context.register(dictionary);
    return { node, dictionary, ref };
  });
  let descendantCount = 0;
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    const next = entries[index + 1];
    if (previous) entry.dictionary.set(PDFName.of('Prev'), previous.ref);
    if (next) entry.dictionary.set(PDFName.of('Next'), next.ref);
    if (entry.node.dest) {
      const destination = PDFArray.withContext(context);
      destination.push(pdf.getPage(entry.node.dest.pageIndex).ref);
      destination.push(PDFName.of(destinationCommand(entry.node.dest.command)));
      for (const param of entry.node.dest.params) destination.push(param === null ? PDFNull : PDFNumber.of(param));
      entry.dictionary.set(PDFName.of('Dest'), destination);
    }
    const children = buildSiblings(pdf, entry.node.children, entry.ref);
    if (children) {
      entry.dictionary.set(PDFName.of('First'), children.first);
      entry.dictionary.set(PDFName.of('Last'), children.last);
      entry.dictionary.set(PDFName.of('Count'), PDFNumber.of(children.count));
      descendantCount += children.count;
    }
  });
  return { first: entries[0]!.ref, last: entries.at(-1)!.ref, count: entries.length + descendantCount };
}

function destinationCommand(command: string): string {
  const names: Record<string, string> = {
    xyz: 'XYZ', fit: 'Fit', fitb: 'FitB', fith: 'FitH', fitbh: 'FitBH', fitv: 'FitV', fitbv: 'FitBV', fitr: 'FitR',
  };
  return names[command.toLowerCase()] ?? 'Fit';
}

/**
 * Rebuilds the catalog AcroForm from Widget annotations already copied with
 * the final pages. Each source receives a prefix so equal field names from
 * different PDFs remain independent.
 * @returns Re-encoded PDF bytes containing the merged AcroForm catalog.
 */
export async function mergeAcroForms(
  bytes: Uint8Array,
  placements: readonly PagePlacement[],
  sourcePdfs: readonly { readonly documentId: string; readonly bytes: Uint8Array }[] = [],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const context = pdf.context;
  const fields = PDFArray.withContext(context);
  const roots = new Set<string>();
  const sourceOrder = [...new Set(placements.map((page) => page.source.documentId))];
  const prefixes = new Map(sourceOrder.map((documentId, index) => [documentId, `source_${index + 1}`]));
  const fieldRefs = new Map<string, PDFRef>();
  const calculatedFields = new Map<string, string[]>();

  pdf.getPages().forEach((page, pageIndex) => {
    const placement = placements[pageIndex];
    if (!placement) return;
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return;
    for (let index = 0; index < annots.size(); index += 1) {
      const widgetRef = annots.get(index);
      if (!(widgetRef instanceof PDFRef)) continue;
      const widget = context.lookup(widgetRef, PDFDict);
      if (widget.get(PDFName.of('Subtype'))?.toString() !== '/Widget') continue;
      const { ref: rootRef, dictionary: root } = fieldRoot(context, widgetRef, widget);
      const key = rootRef.toString();
      if (roots.has(key)) continue;
      roots.add(key);
      const currentName = decodePdfString(root.get(PDFName.of('T'))) ?? `field_${roots.size}`;
      const prefix = prefixes.get(placement.source.documentId)!;
      collectAndRewriteCalculations(
        context,
        rootRef,
        '',
        prefix,
        placement.source.documentId,
        fieldRefs,
        calculatedFields,
      );
      root.set(PDFName.of('T'), PDFHexString.fromText(`${prefix}.${currentName}`));
      fields.push(rootRef);
    }
  });

  if (fields.size() === 0) return bytes;
  const existing = pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const acroForm = existing ?? context.obj({});
  acroForm.set(PDFName.of('Fields'), fields);
  acroForm.set(PDFName.of('NeedAppearances'), context.obj(true));
  if (!acroForm.has(PDFName.of('DR'))) {
    const helvetica = context.register(context.obj({
      Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding',
    }));
    acroForm.set(PDFName.of('DR'), context.obj({ Font: { Helv: helvetica } }));
  }
  if (!acroForm.has(PDFName.of('DA'))) acroForm.set(PDFName.of('DA'), PDFString.of('/Helv 0 Tf 0 g'));
  const calculationOrder = PDFArray.withContext(context);
  for (const source of sourcePdfs) {
    const orderedNames = await loadCalculationOrder(source.bytes);
    const fallbackNames = calculatedFields.get(source.documentId) ?? [];
    for (const name of [...orderedNames, ...fallbackNames]) {
      const ref = fieldRefs.get(`${source.documentId}\u0000${name}`);
      if (ref && !calculationOrder.asArray().some((item) => item === ref)) calculationOrder.push(ref);
    }
  }
  if (calculationOrder.size() > 0) acroForm.set(PDFName.of('CO'), calculationOrder);
  if (!existing) pdf.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));
  return pdf.save({ useObjectStreams: false });
}

function collectAndRewriteCalculations(
  context: PDFDocument['context'],
  ref: PDFRef,
  parentName: string,
  prefix: string,
  documentId: string,
  fieldRefs: Map<string, PDFRef>,
  calculatedFields: Map<string, string[]>,
): void {
  const field = context.lookup(ref, PDFDict);
  const partialName = decodePdfString(field.get(PDFName.of('T')));
  const name = partialName ? (parentName ? `${parentName}.${partialName}` : partialName) : parentName;
  if (name) fieldRefs.set(`${documentId}\u0000${name}`, ref);
  const aa = field.lookupMaybe(PDFName.of('AA'), PDFDict);
  const action = aa?.lookupMaybe(PDFName.of('C'), PDFDict);
  const jsObject = action?.get(PDFName.of('JS'));
  const js = decodePdfString(jsObject);
  const spec = parseCalcAction(js);
  if (action && spec && name) {
    const rewrittenFields = spec.fields.map((fieldName) => `${prefix}.${fieldName}`);
    action.set(
      PDFName.of('JS'),
      PDFString.of(`AFSimple_Calculate("${spec.op}", new Array(${rewrittenFields.map((item) => JSON.stringify(item)).join(', ')}));`),
    );
    const names = calculatedFields.get(documentId) ?? [];
    names.push(name);
    calculatedFields.set(documentId, names);
  }
  const kids = field.lookupMaybe(PDFName.of('Kids'), PDFArray);
  if (!kids) return;
  for (let index = 0; index < kids.size(); index += 1) {
    const kid = kids.get(index);
    if (kid instanceof PDFRef) collectAndRewriteCalculations(context, kid, name, prefix, documentId, fieldRefs, calculatedFields);
  }
}

async function loadCalculationOrder(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const acroForm = pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const order = acroForm?.lookupMaybe(PDFName.of('CO'), PDFArray);
  if (!order) return [];
  const names: string[] = [];
  for (let index = 0; index < order.size(); index += 1) {
    const ref = order.get(index);
    if (!(ref instanceof PDFRef)) continue;
    const name = qualifiedFieldName(pdf.context, ref);
    if (name) names.push(name);
  }
  return names;
}

function qualifiedFieldName(context: PDFDocument['context'], initialRef: PDFRef): string | null {
  const parts: string[] = [];
  let ref: PDFRef | null = initialRef;
  const visited = new Set<string>();
  while (ref && !visited.has(ref.toString())) {
    visited.add(ref.toString());
    const field: PDFDict | undefined = context.lookupMaybe(ref, PDFDict);
    if (!field) break;
    const name = decodePdfString(field.get(PDFName.of('T')));
    if (name) parts.unshift(name);
    const parent: unknown = field.get(PDFName.of('Parent'));
    ref = parent instanceof PDFRef ? parent : null;
  }
  return parts.length > 0 ? parts.join('.') : null;
}

function fieldRoot(
  context: PDFDocument['context'],
  initialRef: PDFRef,
  initial: PDFDict,
): { readonly ref: PDFRef; readonly dictionary: PDFDict } {
  let ref = initialRef;
  let dictionary = initial;
  const visited = new Set<string>();
  while (!visited.has(ref.toString())) {
    visited.add(ref.toString());
    const parentRef = dictionary.get(PDFName.of('Parent'));
    if (!(parentRef instanceof PDFRef)) break;
    const parent = context.lookupMaybe(parentRef, PDFDict);
    if (!parent) break;
    ref = parentRef;
    dictionary = parent;
  }
  return { ref, dictionary };
}

function decodePdfString(value: unknown): string | null {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}
