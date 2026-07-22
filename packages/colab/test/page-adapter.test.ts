import type { PdfDocument, PdfPage } from '@pdfrx/engine';
import type { PdfrxViewer } from '@pdfrx/viewer';
import { describe, expect, it, vi } from 'vitest';
import {
  applyPagePlacementsToViewer,
  createPagePlacements,
  PageSourceRegistry,
  resolvePagePlacements,
} from '../src/index.js';

interface FakePage {
  document: PdfDocument;
  sourcePage: PdfPage;
  sourcePageIndex: number;
  rotation: 0 | 90 | 180 | 270;
  rotatedTo: (rotation: 0 | 90 | 180 | 270) => PdfPage;
}

const fakeDocument = (rotations: Array<0 | 90 | 180 | 270>): PdfDocument => {
  const document = { isDisposed: false, pages: [] } as unknown as PdfDocument;
  const pages = rotations.map((rotation, sourcePageIndex): FakePage => {
    const make = (nextRotation: 0 | 90 | 180 | 270): PdfPage => ({
      document,
      get sourcePage(): PdfPage { return this as unknown as PdfPage; },
      sourcePageIndex,
      rotation: nextRotation,
      rotatedTo: make,
    }) as unknown as PdfPage;
    return make(rotation) as unknown as FakePage;
  });
  (document.pages as PdfPage[]) = pages as unknown as PdfPage[];
  return document;
};

describe('PageSourceRegistry', () => {
  it('round-trips source documents and rejects ambiguous registrations', () => {
    const sources = new PageSourceRegistry();
    const first = fakeDocument([0]);
    const second = fakeDocument([0]);
    sources.register('main', first);

    expect(sources.document('main')).toBe(first);
    expect(sources.documentId(first)).toBe('main');
    expect(() => sources.register('main', second)).toThrow('already registered');
    expect(() => sources.register('other', first)).toThrow('already registered');
  });
});

describe('page placement adapter', () => {
  it('captures and resolves placements including independent rotations', () => {
    const document = fakeDocument([0, 90]);
    const sources = new PageSourceRegistry();
    sources.register('main', document);
    const ids = ['one', 'two'];
    const placements = createPagePlacements(document.pages, sources, () => ids.shift()!);

    expect(placements).toEqual([
      { placementId: 'one', source: { documentId: 'main', pageIndex: 0 }, rotation: 0 },
      { placementId: 'two', source: { documentId: 'main', pageIndex: 1 }, rotation: 90 },
    ]);

    const resolved = resolvePagePlacements(
      [{ ...placements[0]!, placementId: 'copy', rotation: 180 }, placements[1]!],
      sources,
    );
    expect(resolved.map((page) => page.rotation)).toEqual([180, 90]);
    expect(resolved.map((page) => page.sourcePageIndex)).toEqual([0, 1]);
  });

  it('applies remote metadata without local history', () => {
    const document = fakeDocument([0]);
    const sources = new PageSourceRegistry();
    sources.register('main', document);
    const setPages = vi.fn();
    const viewer = { setPages } as unknown as PdfrxViewer;
    const placements = [{
      placementId: 'page-1',
      source: { documentId: 'main', pageIndex: 0 },
      rotation: 90 as const,
    }];

    applyPagePlacementsToViewer(viewer, placements, sources, {
      origin: 'remote',
      transactionId: 'op-1',
      actorId: 'peer-1',
      recordHistory: false,
    });

    expect(setPages).toHaveBeenCalledWith(
      [expect.objectContaining({ sourcePageIndex: 0, rotation: 90 })],
      { origin: 'remote', transactionId: 'op-1', actorId: 'peer-1', recordHistory: false },
    );
  });

  it('rejects unknown source documents and pages', () => {
    const sources = new PageSourceRegistry();
    expect(() => resolvePagePlacements([
      { placementId: 'x', source: { documentId: 'missing', pageIndex: 0 }, rotation: 0 },
    ], sources)).toThrow('not registered');

    sources.register('main', fakeDocument([0]));
    expect(() => resolvePagePlacements([
      { placementId: 'x', source: { documentId: 'main', pageIndex: 4 }, rotation: 0 },
    ], sources)).toThrow(RangeError);
  });

  it('keeps physical source indices stable after the document arrangement changes', () => {
    const document = fakeDocument([0, 0, 0]);
    const originalPages = document.pages.slice();
    const sources = new PageSourceRegistry();
    sources.register('main', document);
    (document.pages as PdfPage[]) = [originalPages[2]!, originalPages[0]!];

    const resolved = resolvePagePlacements([
      { placementId: 'original-third', source: { documentId: 'main', pageIndex: 2 }, rotation: 90 },
    ], sources);
    expect(resolved[0]!.sourcePageIndex).toBe(2);
    expect(resolved[0]!.rotation).toBe(90);
  });
});
