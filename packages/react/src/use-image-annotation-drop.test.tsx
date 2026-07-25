import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  add: vi.fn(() => Promise.resolve()),
  hit: {
    page: { pageNumber: 1 },
    pdfPoint: { x: 25, y: 40 },
  },
}));

vi.mock('./annotation-image.js', () => ({
  addDroppedImageAnnotation: state.add,
}));
vi.mock('./context.js', () => ({
  usePdfrxStore: () => ({ imageDecoder: undefined }),
}));
vi.mock('./hooks/use-pdfrx-viewer.js', () => ({
  usePdfrxViewer: () => ({ getPageHitTestResult: vi.fn(() => state.hit) }),
}));

const { useImageAnnotationDrop } = await import('./use-image-annotation-drop.js');

function DropSurface({ enabled = true }: { enabled?: boolean }) {
  const handlers = useImageAnnotationDrop({ enabled });
  return <div data-testid="surface" {...handlers} />;
}

afterEach(() => {
  cleanup();
  state.add.mockClear();
});

describe('useImageAnnotationDrop', () => {
  it('claims image drags and inserts the dropped file at the hit-tested PDF point', async () => {
    render(<DropSurface />);
    const surface = screen.getByTestId('surface');
    const file = new File(['image'], 'stamp.png', { type: 'image/png' });
    const dataTransfer = {
      files: [file],
      items: [{ kind: 'file', type: 'image/png' }],
      dropEffect: 'none',
    };

    const dragOver = fireEvent.dragOver(surface, { dataTransfer });
    expect(dragOver).toBe(false);
    expect(dataTransfer.dropEffect).toBe('copy');

    const drop = fireEvent.drop(surface, { dataTransfer, clientX: 25, clientY: 40 });
    expect(drop).toBe(false);
    await waitFor(() => expect(state.add).toHaveBeenCalledWith(
      state.hit.page,
      file,
      state.hit.pdfPoint,
      undefined,
    ));
  });

  it('does not claim drops when disabled', () => {
    render(<DropSurface enabled={false} />);
    const file = new File(['image'], 'stamp.png', { type: 'image/png' });
    const dataTransfer = {
      files: [file],
      items: [{ kind: 'file', type: 'image/png' }],
      dropEffect: 'none',
    };

    expect(fireEvent.dragOver(screen.getByTestId('surface'), { dataTransfer })).toBe(true);
    expect(fireEvent.drop(screen.getByTestId('surface'), { dataTransfer })).toBe(true);
    expect(state.add).not.toHaveBeenCalled();
  });
});
