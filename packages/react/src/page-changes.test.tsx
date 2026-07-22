import type { PdfDocumentEventMap } from '@pdfrx/engine';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({ viewer: null as { document: FakeDocument | null } | null }));

vi.mock('./hooks/use-pdfrx-viewer.js', () => ({
  usePdfrxViewer: (): typeof testState.viewer => testState.viewer,
}));

const { usePdfPageChanges } = await import('./hooks/use-document-generation.js');

class FakeDocument {
  listeners = new Set<(event: PdfDocumentEventMap['pagesRearranged']) => void>();

  addEventListener(
    event: 'pagesRearranged',
    listener: (payload: PdfDocumentEventMap['pagesRearranged']) => void,
  ): () => void {
    expect(event).toBe('pagesRearranged');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(payload: PdfDocumentEventMap['pagesRearranged']): void {
    for (const listener of this.listeners) listener(payload);
  }
}

const pageChange = (transactionId: string): PdfDocumentEventMap['pagesRearranged'] => ({
  origin: 'remote',
  transactionId,
  actorId: 'peer-1',
  before: [{ sourceKey: '1:0', sourcePageIndex: 0, rotation: 0 }],
  after: [{ sourceKey: '1:0', sourcePageIndex: 0, rotation: 90 }],
  pageNumbers: [1],
});

describe('usePdfPageChanges', () => {
  it('delivers exact events and keeps the latest callback without resubscribing', () => {
    const document = new FakeDocument();
    testState.viewer = { document };
    const first = vi.fn();
    const second = vi.fn();

    const hook = renderHook(({ listener }) => usePdfPageChanges(listener), {
      initialProps: { listener: first },
    });
    expect(document.listeners.size).toBe(1);

    document.emit(pageChange('tx-1'));
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-1', origin: 'remote' }));

    hook.rerender({ listener: second });
    expect(document.listeners.size).toBe(1);
    document.emit(pageChange('tx-2'));
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-2' }));
    expect(first).toHaveBeenCalledTimes(1);

    hook.unmount();
    expect(document.listeners.size).toBe(0);
  });
});
