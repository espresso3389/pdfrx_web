import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPdfrxStrings } from './strings.js';

const state = vi.hoisted(() => ({ viewer: null as unknown }));

vi.mock('./hooks/use-pdfrx-viewer.js', () => ({ usePdfrxViewer: () => state.viewer }));
vi.mock('./strings.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./strings.js')>();
  return { ...original, usePdfrxStrings: () => original.defaultPdfrxStrings };
});

const { PdfPageActions } = await import('./components/page-actions.js');

afterEach(cleanup);

describe('PdfPageActions', () => {
  it('delegates controlled rotate/delete actions for collaboration hosts', () => {
    const onRotatePage = vi.fn();
    const onDeletePage = vi.fn();
    state.viewer = { document: { pages: [{}, {}] } };
    render(
      <PdfPageActions
        pageNumber={2}
        rotationDeltas={[270, 90, 180]}
        onRotatePage={onRotatePage}
        onDeletePage={onDeletePage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: defaultPdfrxStrings.rotatePageCounterclockwise }));
    fireEvent.click(screen.getByRole('button', { name: defaultPdfrxStrings.rotatePage180 }));
    fireEvent.click(screen.getByRole('button', { name: defaultPdfrxStrings.deletePage }));
    expect(onRotatePage.mock.calls).toEqual([[2, 270], [2, 180]]);
    expect(onDeletePage).toHaveBeenCalledWith(2);
  });

  it('keeps the original local viewer mutation as its default behavior', () => {
    const rotated = {};
    const page = { pageNumber: 1, rotatedBy: vi.fn(() => rotated) };
    const setPage = vi.fn();
    const setPages = vi.fn();
    state.viewer = { document: { pages: [page, { pageNumber: 2 }] }, setPage, setPages };
    render(<PdfPageActions pageNumber={1} />);

    fireEvent.click(screen.getByRole('button', { name: defaultPdfrxStrings.rotatePage }));
    fireEvent.click(screen.getByRole('button', { name: defaultPdfrxStrings.deletePage }));
    expect(page.rotatedBy).toHaveBeenCalledWith(90);
    expect(setPage).toHaveBeenCalledWith(1, rotated);
    expect(setPages).toHaveBeenCalledWith([{ pageNumber: 2 }]);
  });
});
