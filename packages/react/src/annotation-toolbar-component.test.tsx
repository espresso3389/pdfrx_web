import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPdfrxStrings } from './strings.js';

const state = vi.hoisted(() => ({
  addImage: vi.fn<() => Promise<void>>(),
  viewer: {
    document: {},
    getAnnotationTool: vi.fn(() => null),
    isAnnotationSelectMode: vi.fn(() => true),
    setAnnotationMode: vi.fn(),
    setAnnotationTool: vi.fn(),
    setAnnotationStyle: vi.fn(),
    setAnnotationLinkRequestHandler: vi.fn(),
    getSelectedAnnotationIds: vi.fn(() => []),
    getSelectedAnnotations: vi.fn(() => []),
    getSelectedAnnotationClientRect: vi.fn(() => null),
    addAnnotationToolChangeListener: vi.fn(() => () => undefined),
    addAnnotationSelectionChangeListener: vi.fn(() => () => undefined),
    addAnnotationPreviewChangeListener: vi.fn(() => () => undefined),
    addTransformChangeListener: vi.fn(() => () => undefined),
    clearSelectionStylePreview: vi.fn(),
  },
}));

vi.mock('./annotation-image.js', () => ({
  addCenteredImageAnnotation: state.addImage,
}));
vi.mock('./hooks/use-pdfrx-viewer.js', () => ({
  usePdfrxViewer: () => state.viewer,
}));
vi.mock('./context.js', () => ({
  usePdfrxStore: () => ({
    imageDecoder: undefined,
    reportImportError: vi.fn(),
  }),
}));
vi.mock('./strings.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./strings.js')>();
  return { ...original, usePdfrxStrings: () => original.defaultPdfrxStrings };
});

const { PdfAnnotationToolbar } = await import('./components/annotation-toolbar.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PdfAnnotationToolbar image insertion', () => {
  it('keeps the image button pressed until insertion settles', async () => {
    let finish!: () => void;
    state.addImage.mockImplementation(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const { container } = render(<PdfAnnotationToolbar />);
    const button = screen.getByRole('button', { name: defaultPdfrxStrings.addImage });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Image input was not rendered');

    fireEvent.change(input, {
      target: { files: [new File(['image'], 'stamp.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    expect(button.classList.contains('pdfrx-button-active')).toBe(true);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    finish();
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));
    expect(button.classList.contains('pdfrx-button-active')).toBe(false);
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
