import {
  parseCalcAction,
  type PdfDocument,
  type PdfRawCreatedObject,
  type PdfRawObjectEditor,
  type WireRawPdfObject,
  type WireRawPdfPatchOperation,
  type WireRawPdfPatchValue,
  type WireRawPdfTarget,
} from '@pdfrx/engine';
import type { PagePlacement } from '@pdfrx/viewer-core';
import type { MappedOutlineNode } from './export-composer.js';

type RawDictionary = Extract<WireRawPdfObject, { kind: 'dictionary' }>;

const name = (value: string): WireRawPdfObject => ({ kind: 'name', value });
const nullObject = (): WireRawPdfObject => ({ kind: 'null' });
const integer = (value: number): WireRawPdfObject => ({ kind: 'integer', value });
const number = (value: number): WireRawPdfObject => ({ kind: 'number', value });
const reference = (objectNumber: number): WireRawPdfObject => ({
  kind: 'reference',
  objectNumber,
  generationNumber: 0,
});
const localReference = (id: string): WireRawPdfPatchValue => ({ kind: 'localReference', id });
const array = (items: WireRawPdfObject[]): WireRawPdfObject => ({ kind: 'array', items });
const dictionary = (entries: Record<string, WireRawPdfObject>): WireRawPdfObject => ({ kind: 'dictionary', entries });
const string = (value: string): WireRawPdfObject => ({ kind: 'string', value: encodePdfText(value) });

/** Replaces the document's outline catalog with mapped bookmark nodes. */
export async function writeOutline(document: PdfDocument, nodes: readonly MappedOutlineNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const pageRefs = await loadPageReferences(document);
  const flat: { id: string; node: MappedOutlineNode; parent: string; previous?: string; next?: string }[] = [];
  let sequence = 0;
  const visit = (siblings: readonly MappedOutlineNode[], parent: string): void => {
    const ids = siblings.map(() => `outline-${sequence++}`);
    siblings.forEach((node, index) => {
      const id = ids[index]!;
      flat.push({
        id,
        node,
        parent,
        ...(ids[index - 1] ? { previous: ids[index - 1] } : {}),
        ...(ids[index + 1] ? { next: ids[index + 1] } : {}),
      });
      visit(node.children, id);
    });
  };
  visit(nodes, 'outline-root');

  const operations: WireRawPdfPatchOperation[] = [
    { op: 'dictionarySet', target: { root: true }, key: 'Outlines', value: localReference('outline-root') },
    { op: 'dictionarySet', target: { root: true }, key: 'PageMode', value: name('UseOutlines') },
    { op: 'dictionarySet', target: localTarget('outline-root'), key: 'Type', value: name('Outlines') },
    { op: 'dictionarySet', target: localTarget('outline-root'), key: 'First', value: localReference(flat[0]!.id) },
    { op: 'dictionarySet', target: localTarget('outline-root'), key: 'Last', value: localReference(lastTopLevelId(nodes, flat)) },
    { op: 'dictionarySet', target: localTarget('outline-root'), key: 'Count', value: integer(flat.length) },
  ];
  for (const entry of flat) {
    operations.push(
      { op: 'dictionarySet', target: localTarget(entry.id), key: 'Title', value: string(entry.node.title) },
      { op: 'dictionarySet', target: localTarget(entry.id), key: 'Parent', value: localReference(entry.parent) },
    );
    if (entry.previous) operations.push({
      op: 'dictionarySet', target: localTarget(entry.id), key: 'Prev', value: localReference(entry.previous),
    });
    if (entry.next) operations.push({
      op: 'dictionarySet', target: localTarget(entry.id), key: 'Next', value: localReference(entry.next),
    });
    if (entry.node.dest) {
      const pageRef = pageRefs[entry.node.dest.pageIndex];
      if (pageRef !== undefined) {
        operations.push({
          op: 'dictionarySet',
          target: localTarget(entry.id),
          key: 'Dest',
          value: array([
            reference(pageRef),
            name(destinationCommand(entry.node.dest.command)),
            ...entry.node.dest.params.map((param) => param === null ? nullObject() : number(param)),
          ]),
        });
      }
    }
    const children = flat.filter((candidate) => candidate.parent === entry.id);
    if (children.length > 0) {
      operations.push(
        { op: 'dictionarySet', target: localTarget(entry.id), key: 'First', value: localReference(children[0]!.id) },
        { op: 'dictionarySet', target: localTarget(entry.id), key: 'Last', value: localReference(children.at(-1)!.id) },
        { op: 'dictionarySet', target: localTarget(entry.id), key: 'Count', value: integer(descendantCount(entry.id, flat)) },
      );
    }
  }
  await applyPatchWithLocals(document, flat.map((entry) => entry.id).concat('outline-root'), operations);
}

/**
 * Rebuilds the catalog AcroForm from Widget annotations already copied with
 * the final pages. Each source receives a prefix so equal field names remain independent.
 */
export async function mergeAcroForms(
  document: PdfDocument,
  placements: readonly PagePlacement[],
  sourceDocuments: ReadonlyMap<string, PdfDocument>,
): Promise<void> {
  const pageRefs = await loadPageReferences(document);
  await rebuildImportedFieldParents(document, placements, sourceDocuments, pageRefs);
  const sourceOrder = [...new Set(placements.map((page) => page.source.documentId))];
  const prefixes = new Map(sourceOrder.map((documentId, index) => [documentId, `source_${index + 1}`]));
  const roots = new Set<number>();
  const fields: number[] = [];
  const fieldRefs = new Map<string, number>();
  const calculatedFields = new Map<string, string[]>();
  const operations: WireRawPdfPatchOperation[] = [];

  for (let pageIndex = 0; pageIndex < pageRefs.length; pageIndex++) {
    const placement = placements[pageIndex];
    if (!placement) continue;
    const page = await readDictionary(document, pageRefs[pageIndex]!);
    const annots = page.entries.Annots;
    if (!annots || annots.kind !== 'array') continue;
    for (const annot of annots.items) {
      if (annot.kind !== 'reference') continue;
      const widget = await readDictionary(document, annot.objectNumber);
      if (widget.entries.Subtype?.kind !== 'name' || widget.entries.Subtype.value !== 'Widget') continue;
      const rootRef = await fieldRoot(document, annot.objectNumber);
      if (roots.has(rootRef)) continue;
      roots.add(rootRef);
      fields.push(rootRef);
      const root = await readDictionary(document, rootRef);
      const currentName = decodePdfString(root.entries.T) ?? `field_${roots.size}`;
      const prefix = prefixes.get(placement.source.documentId)!;
      await collectAndRewriteCalculations(
        document,
        rootRef,
        '',
        prefix,
        placement.source.documentId,
        fieldRefs,
        calculatedFields,
        operations,
      );
      operations.push({
        op: 'dictionarySet',
        target: { objectNumber: rootRef },
        key: 'T',
        value: string(`${prefix}.${currentName}`),
      });
    }
  }
  if (fields.length === 0) return;

  const catalog = await readRoot(document);
  const existingAcroForm = catalog.entries.AcroForm;
  const createIds: string[] = [];
  let acroTarget: WireRawPdfTarget;
  if (existingAcroForm?.kind === 'reference') {
    acroTarget = { objectNumber: existingAcroForm.objectNumber };
  } else if (existingAcroForm?.kind === 'dictionary') {
    acroTarget = { root: true, path: ['AcroForm'] };
  } else {
    createIds.push('acro-form');
    acroTarget = localTarget('acro-form');
    operations.push({
      op: 'dictionarySet',
      target: { root: true },
      key: 'AcroForm',
      value: localReference('acro-form'),
    });
  }
  operations.push(
    { op: 'dictionarySet', target: acroTarget, key: 'Fields', value: array(fields.map(reference)) },
    { op: 'dictionarySet', target: acroTarget, key: 'NeedAppearances', value: { kind: 'boolean', value: true } },
  );
  const acroForm = existingAcroForm?.kind === 'reference'
    ? await readDictionary(document, existingAcroForm.objectNumber)
    : existingAcroForm?.kind === 'dictionary' ? existingAcroForm : null;
  if (!acroForm?.entries.DR) {
    createIds.push('acro-font');
    operations.push({
      op: 'dictionarySet',
      target: localTarget('acro-font'),
      key: 'Type',
      value: name('Font'),
    }, {
      op: 'dictionarySet',
      target: localTarget('acro-font'),
      key: 'Subtype',
      value: name('Type1'),
    }, {
      op: 'dictionarySet',
      target: localTarget('acro-font'),
      key: 'BaseFont',
      value: name('Helvetica'),
    }, {
      op: 'dictionarySet',
      target: localTarget('acro-font'),
      key: 'Encoding',
      value: name('WinAnsiEncoding'),
    }, {
      op: 'dictionarySet',
      target: acroTarget,
      key: 'DR',
      value: {
        kind: 'dictionary',
        entries: { Font: { kind: 'dictionary', entries: { Helv: localReference('acro-font') } } },
      },
    });
  }
  if (!acroForm?.entries.DA) operations.push({
    op: 'dictionarySet', target: acroTarget, key: 'DA', value: string('/Helv 0 Tf 0 g'),
  });

  const calculationOrder: number[] = [];
  for (const [documentId, source] of sourceDocuments) {
    const orderedNames = await loadCalculationOrder(source);
    const fallbackNames = calculatedFields.get(documentId) ?? [];
    for (const fieldName of [...orderedNames, ...fallbackNames]) {
      const ref = fieldRefs.get(`${documentId}\u0000${fieldName}`);
      if (ref !== undefined && !calculationOrder.includes(ref)) calculationOrder.push(ref);
    }
  }
  if (calculationOrder.length > 0) operations.push({
    op: 'dictionarySet', target: acroTarget, key: 'CO', value: array(calculationOrder.map(reference)),
  });
  await applyPatchWithLocals(document, createIds, operations);
}

const FIELD_KEYS = new Set([
  'FT', 'Ff', 'V', 'DV', 'Opt', 'AA', 'DA', 'Q', 'MaxLen', 'TI', 'I', 'Lock', 'SV',
]);

async function rebuildImportedFieldParents(
  document: PdfDocument,
  placements: readonly PagePlacement[],
  sourceDocuments: ReadonlyMap<string, PdfDocument>,
  finalPageRefs: readonly number[],
): Promise<void> {
  const sourcePageRefs = new Map<string, number[]>();
  const groups = new Map<string, {
    id: string;
    name: string;
    entries: Record<string, WireRawPdfObject>;
    widgets: number[];
  }>();
  const widgetParents: { widget: number; groupId: string }[] = [];

  for (let pageIndex = 0; pageIndex < finalPageRefs.length; pageIndex++) {
    const placement = placements[pageIndex];
    if (!placement) continue;
    const source = sourceDocuments.get(placement.source.documentId);
    if (!source) continue;
    let refs = sourcePageRefs.get(placement.source.documentId);
    if (!refs) {
      refs = await loadPageReferences(source);
      sourcePageRefs.set(placement.source.documentId, refs);
    }
    const sourcePageRef = refs[placement.source.pageIndex];
    if (sourcePageRef === undefined) continue;
    const finalWidgets = await pageWidgetReferences(document, finalPageRefs[pageIndex]!);
    const sourceWidgets = await pageWidgetReferences(source, sourcePageRef);
    for (let index = 0; index < Math.min(finalWidgets.length, sourceWidgets.length); index++) {
      const descriptor = await sourceFieldDescriptor(source, sourceWidgets[index]!);
      if (!descriptor.name) continue;
      const key = `${placement.source.documentId}\u0000${descriptor.name}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          id: `field-${groups.size}`,
          name: descriptor.name,
          entries: descriptor.entries,
          widgets: [],
        };
        groups.set(key, group);
      }
      group.widgets.push(finalWidgets[index]!);
      widgetParents.push({ widget: finalWidgets[index]!, groupId: group.id });
    }
  }
  if (groups.size === 0) return;
  const createIds = [...groups.values()].map((group) => group.id);
  const operations: WireRawPdfPatchOperation[] = [];
  for (const group of groups.values()) {
    for (const [key, value] of Object.entries(group.entries)) {
      operations.push({ op: 'dictionarySet', target: localTarget(group.id), key, value });
    }
    operations.push(
      { op: 'dictionarySet', target: localTarget(group.id), key: 'T', value: string(group.name) },
      {
        op: 'dictionarySet',
        target: localTarget(group.id),
        key: 'Kids',
        value: array(group.widgets.map(reference)),
      },
    );
  }
  for (const item of widgetParents) {
    operations.push({
      op: 'dictionarySet',
      target: { objectNumber: item.widget },
      key: 'Parent',
      value: localReference(item.groupId),
    });
  }
  await applyPatchWithLocals(document, createIds, operations);
}

async function pageWidgetReferences(document: PdfDocument, pageRef: number): Promise<number[]> {
  const page = await readDictionary(document, pageRef);
  const annots = page.entries.Annots;
  if (!annots || annots.kind !== 'array') return [];
  const widgets: number[] = [];
  for (const annot of annots.items) {
    if (annot.kind !== 'reference') continue;
    const value = await readDictionary(document, annot.objectNumber);
    if (value.entries.Subtype?.kind === 'name' && value.entries.Subtype.value === 'Widget') {
      widgets.push(annot.objectNumber);
    }
  }
  return widgets;
}

async function sourceFieldDescriptor(
  document: PdfDocument,
  widgetRef: number,
): Promise<{ name: string; entries: Record<string, WireRawPdfObject> }> {
  const chain: RawDictionary[] = [];
  let ref: number | null = widgetRef;
  const visited = new Set<number>();
  while (ref !== null && !visited.has(ref)) {
    visited.add(ref);
    const field = await readDictionary(document, ref);
    chain.unshift(field);
    const parent = field.entries.Parent;
    ref = parent?.kind === 'reference' ? parent.objectNumber : null;
  }
  const names = chain.map((field) => decodePdfString(field.entries.T)).filter((item): item is string => Boolean(item));
  const entries: Record<string, WireRawPdfObject> = {};
  for (const field of chain) {
    for (const [key, value] of Object.entries(field.entries)) {
      if (FIELD_KEYS.has(key)) entries[key] = await cloneRawValue(document, value);
    }
  }
  return { name: names.join('.'), entries };
}

async function cloneRawValue(
  document: PdfDocument,
  value: WireRawPdfObject,
  visited = new Set<number>(),
): Promise<WireRawPdfObject> {
  if (value.kind === 'reference') {
    if (visited.has(value.objectNumber)) return { kind: 'null' };
    const nextVisited = new Set(visited).add(value.objectNumber);
    const resolved = (await document.getRawObject(value.objectNumber)).object;
    return resolved ? cloneRawValue(document, resolved, nextVisited) : { kind: 'null' };
  }
  if (value.kind === 'array') {
    return { ...value, items: await Promise.all(value.items.map((item) => cloneRawValue(document, item, visited))) };
  }
  if (value.kind === 'dictionary' || value.kind === 'stream') {
    return {
      ...value,
      entries: Object.fromEntries(await Promise.all(
        Object.entries(value.entries).map(async ([key, item]) => [key, await cloneRawValue(document, item, visited)]),
      )),
    };
  }
  return value;
}

function localTarget(id: string): WireRawPdfTarget {
  return { localId: id };
}

async function applyPatchWithLocals(
  document: PdfDocument,
  createIds: string[],
  operations: WireRawPdfPatchOperation[],
): Promise<void> {
  await document.editRawObjects((editor) => {
    const created = new Map<string, PdfRawCreatedObject>();
    for (const id of createIds) created.set(id, editor.createDictionary());
    for (const operation of operations) {
      const target = resolveEditorTarget(editor, operation.target, created);
      if (operation.op === 'dictionarySet') {
        editor.setDictionaryValue(target, operation.key, resolveEditorValue(operation.value, created));
      } else if (operation.op === 'dictionaryRemove') {
        editor.removeDictionaryValue(target, operation.key);
      } else if (operation.op === 'arrayAppend') {
        editor.appendArrayValue(target, resolveEditorValue(operation.value, created));
      } else if (operation.op === 'arraySet') {
        editor.setArrayValue(target, operation.index, resolveEditorValue(operation.value, created));
      } else if (operation.op === 'arrayRemove') {
        editor.removeArrayValue(target, operation.index);
      } else {
        editor.setStreamData(target, operation.data);
      }
    }
  });
}

function resolveEditorTarget(
  editor: PdfRawObjectEditor,
  target: WireRawPdfTarget,
  created: ReadonlyMap<string, PdfRawCreatedObject>,
): WireRawPdfTarget {
  let result: WireRawPdfTarget;
  if (target.root) {
    result = editor.catalog();
  } else if (target.localId) {
    const local = created.get(target.localId);
    if (!local) throw new Error(`Unknown local raw PDF object: ${target.localId}`);
    result = local;
  } else if (target.objectNumber !== undefined) {
    result = editor.object(target.objectNumber);
  } else {
    throw new Error('Raw PDF target has no root, object number, or local object');
  }
  return target.path?.length ? editor.at(result, ...target.path) : result;
}

function resolveEditorValue(
  value: WireRawPdfPatchValue,
  created: ReadonlyMap<string, PdfRawCreatedObject>,
): WireRawPdfPatchValue {
  if (value.kind === 'localReference') {
    const local = created.get(value.id);
    if (!local) throw new Error(`Unknown local raw PDF reference: ${value.id}`);
    return local.reference;
  }
  if (value.kind === 'array') {
    return { ...value, items: value.items.map((item) => resolveEditorValue(item, created)) };
  }
  if (value.kind === 'dictionary' || value.kind === 'stream') {
    return {
      ...value,
      entries: Object.fromEntries(
        Object.entries(value.entries).map(([key, item]) => [key, resolveEditorValue(item, created)]),
      ),
    };
  }
  return value;
}

async function loadPageReferences(document: PdfDocument): Promise<number[]> {
  const root = await readRoot(document);
  const pages = root.entries.Pages;
  if (!pages || pages.kind !== 'reference') throw new Error('PDF catalog has no indirect /Pages tree');
  const refs: number[] = [];
  const visit = async (objectNumber: number): Promise<void> => {
    const node = await readDictionary(document, objectNumber);
    if (node.entries.Type?.kind === 'name' && node.entries.Type.value === 'Page') {
      refs.push(objectNumber);
      return;
    }
    const kids = node.entries.Kids;
    if (!kids || kids.kind !== 'array') return;
    for (const kid of kids.items) if (kid.kind === 'reference') await visit(kid.objectNumber);
  };
  await visit(pages.objectNumber);
  return refs;
}

async function readRoot(document: PdfDocument): Promise<RawDictionary> {
  const result = await document.getCatalogObject();
  if (!result.object || result.object.kind !== 'dictionary') throw new Error('PDF catalog is not a dictionary');
  return result.object;
}

async function readDictionary(document: PdfDocument, objectNumber: number): Promise<RawDictionary> {
  const result = await document.getRawObject(objectNumber);
  if (!result.object || result.object.kind !== 'dictionary') {
    throw new Error(`PDF object ${objectNumber} is not a dictionary`);
  }
  return result.object;
}

async function fieldRoot(document: PdfDocument, initialRef: number): Promise<number> {
  let ref = initialRef;
  const visited = new Set<number>();
  while (!visited.has(ref)) {
    visited.add(ref);
    const field = await readDictionary(document, ref);
    const parent = field.entries.Parent;
    if (!parent || parent.kind !== 'reference') break;
    ref = parent.objectNumber;
  }
  return ref;
}

async function collectAndRewriteCalculations(
  document: PdfDocument,
  ref: number,
  parentName: string,
  prefix: string,
  documentId: string,
  fieldRefs: Map<string, number>,
  calculatedFields: Map<string, string[]>,
  operations: WireRawPdfPatchOperation[],
): Promise<void> {
  const field = await readDictionary(document, ref);
  const partialName = decodePdfString(field.entries.T);
  const fieldName = partialName ? (parentName ? `${parentName}.${partialName}` : partialName) : parentName;
  if (fieldName) fieldRefs.set(`${documentId}\u0000${fieldName}`, ref);
  const aa = await resolveDictionaryEntry(document, field.entries.AA);
  const action = await resolveDictionaryEntry(document, aa?.entries.C);
  const js = decodePdfString(action?.entries.JS);
  const spec = parseCalcAction(js);
  if (action && spec && fieldName) {
    const rewrittenFields = spec.fields.map((item) => `${prefix}.${item}`);
    operations.push({
      op: 'dictionarySet',
      target: { objectNumber: ref, path: ['AA', 'C'] },
      key: 'JS',
      value: string(
        `AFSimple_Calculate("${spec.op}", new Array(${rewrittenFields.map((item) => JSON.stringify(item)).join(', ')}));`,
      ),
    });
    const names = calculatedFields.get(documentId) ?? [];
    names.push(fieldName);
    calculatedFields.set(documentId, names);
  }
  const kids = field.entries.Kids;
  if (!kids || kids.kind !== 'array') return;
  for (const kid of kids.items) {
    if (kid.kind === 'reference') {
      await collectAndRewriteCalculations(
        document, kid.objectNumber, fieldName, prefix, documentId, fieldRefs, calculatedFields, operations,
      );
    }
  }
}

async function resolveDictionaryEntry(
  document: PdfDocument,
  value: WireRawPdfObject | undefined,
): Promise<RawDictionary | null> {
  if (!value) return null;
  if (value.kind === 'dictionary') return value;
  if (value.kind === 'reference') return readDictionary(document, value.objectNumber);
  return null;
}

async function loadCalculationOrder(document: PdfDocument): Promise<string[]> {
  const root = await readRoot(document);
  const acroForm = await resolveDictionaryEntry(document, root.entries.AcroForm);
  const order = acroForm?.entries.CO;
  if (!order || order.kind !== 'array') return [];
  const names: string[] = [];
  for (const item of order.items) {
    if (item.kind !== 'reference') continue;
    const fieldName = await qualifiedFieldName(document, item.objectNumber);
    if (fieldName) names.push(fieldName);
  }
  return names;
}

async function qualifiedFieldName(document: PdfDocument, initialRef: number): Promise<string | null> {
  const parts: string[] = [];
  let ref: number | null = initialRef;
  const visited = new Set<number>();
  while (ref !== null && !visited.has(ref)) {
    visited.add(ref);
    const field = await readDictionary(document, ref);
    const fieldName = decodePdfString(field.entries.T);
    if (fieldName) parts.unshift(fieldName);
    const parent = field.entries.Parent;
    ref = parent?.kind === 'reference' ? parent.objectNumber : null;
  }
  return parts.length > 0 ? parts.join('.') : null;
}

function decodePdfString(value: WireRawPdfObject | undefined): string | null {
  if (!value || (value.kind !== 'string' && value.kind !== 'name')) return null;
  if (value.kind === 'name') return value.value;
  const bytes = value.value;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let result = '';
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      result += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!);
    }
    return result;
  }
  return new TextDecoder('windows-1252').decode(bytes);
}

function encodePdfText(value: string): Uint8Array {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes[0] = 0xfe;
  bytes[1] = 0xff;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    bytes[2 + index * 2] = code >> 8;
    bytes[3 + index * 2] = code & 0xff;
  }
  return bytes;
}

function destinationCommand(command: string): string {
  const names: Record<string, string> = {
    xyz: 'XYZ', fit: 'Fit', fitb: 'FitB', fith: 'FitH', fitbh: 'FitBH',
    fitv: 'FitV', fitbv: 'FitBV', fitr: 'FitR',
  };
  return names[command.toLowerCase()] ?? 'Fit';
}

function descendantCount(parent: string, flat: readonly { id: string; parent: string }[]): number {
  const children = flat.filter((entry) => entry.parent === parent);
  return children.length + children.reduce((sum, child) => sum + descendantCount(child.id, flat), 0);
}

function lastTopLevelId(
  nodes: readonly MappedOutlineNode[],
  flat: readonly { id: string; parent: string }[],
): string {
  const top = flat.filter((entry) => entry.parent === 'outline-root');
  return top[Math.max(0, nodes.length - 1)]!.id;
}
