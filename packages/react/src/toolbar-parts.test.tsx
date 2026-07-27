import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPdfrxStrings } from './strings.js';

const state = vi.hoisted(() => ({
  currentPageNumber: 2 as number | null,
  pageCount: 8,
  goToPage: vi.fn(),
  print: vi.fn(),
  printSupported: true,
  printAllowed: true,
}));

vi.mock('./hooks/use-pdf-navigation.js', () => ({
  usePdfNavigation: () => ({
    currentPageNumber: state.currentPageNumber,
    pageCount: state.pageCount,
    goToPage: state.goToPage,
  }),
}));
vi.mock('./hooks/use-pdf-document.js', () => ({ usePdfDocument: () => ({ pageCount: state.pageCount }) }));
vi.mock('./hooks/use-pdf-print.js', () => ({
  usePdfPrint: () => ({
    print: state.print,
    isPrinting: false,
    isSupported: state.printSupported,
    isAllowed: state.printAllowed,
    error: null,
  }),
}));
vi.mock('./hooks/use-pdf-zoom.js', () => ({ usePdfZoom: vi.fn() }));
vi.mock('./strings.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./strings.js')>();
  return { ...original, usePdfrxStrings: () => original.defaultPdfrxStrings };
});

const { PdfPageIndicator, PdfPrintButton } = await import('./components/toolbar-parts.js');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.goToPage.mockReset();
  state.currentPageNumber = 2;
  state.pageCount = 8;
  state.printSupported = true;
  state.printAllowed = true;
});

describe('PdfPrintButton', () => {
  it('is omitted when printing is unsupported by the platform', () => {
    state.printSupported = false;
    render(<PdfPrintButton />);
    expect(screen.queryByRole('button', { name: defaultPdfrxStrings.print })).toBeNull();
  });
});

describe('PdfPageIndicator', () => {
  it('opens page navigation with an input and slider', () => {
    render(<PdfPageIndicator />);

    const trigger = screen.getByRole('button', { name: defaultPdfrxStrings.pageNumber });
    expect(trigger.textContent).toContain('2');
    expect(trigger.textContent).toContain('/ 8');
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: defaultPdfrxStrings.pageNumber })).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: defaultPdfrxStrings.pageNumber }));
    expect((screen.getByRole('slider', { name: defaultPdfrxStrings.pageNumber }) as HTMLInputElement).value).toBe('2');
  });

  it('does not initially focus the page input on a touch-first device', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(hover: none) and (pointer: coarse)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    render(<PdfPageIndicator />);

    fireEvent.click(screen.getByRole('button', { name: defaultPdfrxStrings.pageNumber }));

    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: defaultPdfrxStrings.pageNumber }));
  });

  it('navigates immediately with the slider and commits typed pages with Enter', () => {
    render(<PdfPageIndicator />);
    fireEvent.click(screen.getByRole('button', { name: defaultPdfrxStrings.pageNumber }));

    const slider = screen.getByRole('slider', { name: defaultPdfrxStrings.pageNumber });
    fireEvent.change(slider, { target: { value: '6' } });
    expect(state.goToPage).toHaveBeenCalledWith(6, 0);
    expect((slider as HTMLInputElement).value).toBe('6');

    const input = screen.getByRole('textbox', { name: defaultPdfrxStrings.pageNumber });
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(state.goToPage).toHaveBeenLastCalledWith(4, 200);
    expect(screen.queryByRole('dialog', { name: defaultPdfrxStrings.pageNumber })).toBeNull();
  });

  it('closes on an outside pointer press', () => {
    render(
      <div>
        <PdfPageIndicator />
        <button type="button">Outside</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: defaultPdfrxStrings.pageNumber }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog', { name: defaultPdfrxStrings.pageNumber })).toBeNull();
  });
});
