// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfViewerLayout } from './components/viewer-layout.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PdfViewerLayout', () => {
  it('uses the standard overlay drawer on narrow screens', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      media: '(max-width: 780px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { container } = render(
      <PdfViewerLayout
        toolbar={({ toggleSidebar }) => <button onClick={toggleSidebar}>menu</button>}
        sidebar={() => <aside>sidebar</aside>}
      >
        <main>document</main>
      </PdfViewerLayout>,
    );

    expect(container.querySelector('.pdfrx-app')?.classList.contains('pdfrx-app-narrow')).toBe(true);
    expect(container.querySelector<HTMLElement>('.pdfrx-sidebar-slot')?.style.width).toBe('0px');
    expect(container.querySelector('.pdfrx-scrim')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'menu' }));
    expect(container.querySelector('.pdfrx-scrim')).toBeNull();
    expect(container.querySelector('.pdfrx-app')?.getAttribute('data-sidebar-open')).toBe('false');
  });
});
