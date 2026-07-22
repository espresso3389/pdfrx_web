import type { PdfDest, PdfDocument, PdfOutlineNode } from '@pdfrx/engine';
import type { PagePlacement } from '@pdfrx/viewer-core';
import type { PageSourceRegistry } from './page-adapter.js';

/** Outline node whose destination refers to the final arranged page index. */
export interface MappedOutlineNode {
  /** Visible bookmark label. */
  readonly title: string;
  /** Resolved target, or `null` for a structural node without a destination. */
  readonly dest: { readonly pageIndex: number; readonly command: string; readonly params: readonly (number | null)[] } | null;
  /** Recursively mapped child bookmarks. */
  readonly children: readonly MappedOutlineNode[];
}

/**
 * Exports a virtual collaborative arrangement and merges outlines from every
 * represented source document. AcroForm merging is intentionally a separate
 * phase because it requires field-name and resource collision policy.
 * Equal field names from separate sources receive source-scoped prefixes.
 *
 * @param rootDocument Document currently owned by the viewer.
 * @param placements Final authoritative virtual-page order.
 * @param sources Registry containing every referenced source document.
 */
export async function encodeCollaborativePdf(
  rootDocument: PdfDocument,
  placements: readonly PagePlacement[],
  sources: PageSourceRegistry,
): Promise<Uint8Array> {
  const bytes = await rootDocument.encodePdfCopy();
  const documentIds = [...new Set(placements.map((page) => page.source.documentId))];
  if (documentIds.length <= 1) return bytes;

  const mapped: MappedOutlineNode[] = [];
  for (const documentId of documentIds) {
    const sourceDocument = sources.document(documentId);
    const outline = await sourceDocument.loadOutline();
    mapped.push(...outline.map((node) => mapOutlineNode(node, documentId, placements)));
  }
  const { mergeAcroForms, writeOutline } = await import('./outline-writer.js');
  const outlined = mapped.length > 0 ? await writeOutline(bytes, mapped) : bytes;
  const formSources = await Promise.all(documentIds.map(async (documentId) => ({
    documentId,
    bytes: await sources.document(documentId).encodePdfCopy(),
  })));
  return mergeAcroForms(outlined, placements, formSources);
}

function mapOutlineNode(
  node: PdfOutlineNode,
  documentId: string,
  placements: readonly PagePlacement[],
): MappedOutlineNode {
  return {
    title: node.title,
    dest: mapDestination(node.dest, documentId, placements),
    children: node.children.map((child) => mapOutlineNode(child, documentId, placements)),
  };
}

function mapDestination(
  dest: PdfDest | null,
  documentId: string,
  placements: readonly PagePlacement[],
): MappedOutlineNode['dest'] {
  if (!dest) return null;
  const pageIndex = placements.findIndex(
    (page) => page.source.documentId === documentId && page.source.pageIndex === dest.pageNumber - 1,
  );
  return pageIndex < 0 ? null : { pageIndex, command: dest.command, params: dest.params };
}
