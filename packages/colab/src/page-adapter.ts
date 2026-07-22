import type { PdfDocument, PdfPage } from '@pdfrx/engine';
import type { PagePlacement } from '@pdfrx/viewer-core';
import type { PdfrxPageMutationOptions, PdfrxViewer } from '@pdfrx/viewer';

/** Resolves session-level source IDs to the open PDF documents owned by one client. */
export class PageSourceRegistry {
  readonly #documents = new Map<string, { document: PdfDocument; pages: readonly PdfPage[] }>();
  readonly #ids = new WeakMap<PdfDocument, string>();

  /** Registers an open PDF and captures its immutable physical source pages. */
  register(documentId: string, document: PdfDocument): void {
    if (documentId.length === 0) throw new Error('documentId must not be empty');
    const existingDocument = this.#documents.get(documentId);
    if (existingDocument && existingDocument.document !== document) {
      throw new Error(`Source document id is already registered: ${documentId}`);
    }
    const existingId = this.#ids.get(document);
    if (existingId && existingId !== documentId) {
      throw new Error(`Source document is already registered as ${existingId}`);
    }
    this.#documents.set(documentId, {
      document,
      // `document.pages` is the mutable current arrangement. Preserve the
      // physical sources now so session source indices survive remove/reorder.
      pages: document.pages.map((page) => page.sourcePage),
    });
    this.#ids.set(document, documentId);
  }

  /** Removes a source mapping without disposing the caller-owned document. */
  unregister(documentId: string): void {
    const registered = this.#documents.get(documentId);
    if (!registered) return;
    this.#documents.delete(documentId);
    this.#ids.delete(registered.document);
  }

  /** Returns whether a live document is registered for `documentId`. */
  has(documentId: string): boolean {
    const registered = this.#documents.get(documentId);
    return registered !== undefined && !registered.document.isDisposed;
  }

  /** @throws `Error` when the source is missing or disposed. */
  document(documentId: string): PdfDocument {
    const registered = this.#documents.get(documentId);
    if (!registered) throw new Error(`Source document is not registered: ${documentId}`);
    if (registered.document.isDisposed) throw new Error(`Source document is disposed: ${documentId}`);
    return registered.document;
  }

  /** Resolves a zero-based physical source page. @throws `RangeError` if missing. */
  page(documentId: string, pageIndex: number): PdfPage {
    this.document(documentId); // validates registration and lifetime
    const page = this.#documents.get(documentId)!.pages[pageIndex];
    if (!page) throw new RangeError(`Source page ${pageIndex} is missing from ${documentId}`);
    return page;
  }

  /** Resolves the session id previously assigned to a PDF document. */
  documentId(document: PdfDocument): string {
    const documentId = this.#ids.get(document);
    if (!documentId) throw new Error('PDF document is not registered as a session source');
    return documentId;
  }
}

/** Converts a session arrangement into rotated engine page proxies for this client. */
export function resolvePagePlacements(
  placements: readonly PagePlacement[],
  sources: PageSourceRegistry,
): readonly PdfPage[] {
  return placements.map((placement) => {
    const page = sources.page(placement.source.documentId, placement.source.pageIndex);
    return page.rotatedTo(placement.rotation);
  });
}

/**
 * Captures an engine arrangement as independently addressable placements.
 * @throws `Error` for unregistered documents or empty/duplicate generated ids.
 */
export function createPagePlacements(
  pages: readonly PdfPage[],
  sources: PageSourceRegistry,
  createPlacementId: () => string = () => crypto.randomUUID(),
): readonly PagePlacement[] {
  const used = new Set<string>();
  return pages.map((page) => {
    const placementId = createPlacementId();
    if (placementId.length === 0) throw new Error('createPlacementId returned an empty id');
    if (used.has(placementId)) throw new Error(`createPlacementId returned a duplicate id: ${placementId}`);
    used.add(placementId);
    return {
      placementId,
      source: {
        documentId: sources.documentId(page.document),
        pageIndex: page.sourcePageIndex,
      },
      rotation: page.rotation,
    };
  });
}

/**
 * Applies resolved placements through the viewer's origin-aware page API.
 * Remote replay should use `origin: 'remote'` and `recordHistory: false`.
 */
export function applyPagePlacementsToViewer(
  viewer: PdfrxViewer,
  placements: readonly PagePlacement[],
  sources: PageSourceRegistry,
  options: PdfrxPageMutationOptions,
): void {
  viewer.setPages(resolvePagePlacements(placements, sources), options);
}
