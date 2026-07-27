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

  it('keeps WebKit pinch gestures on toolbar and popup chrome from zooming the page', () => {
    const { container } = render(
      <PdfViewerLayout
        toolbar={() => (
          <div className="pdfrx-toolbar">
            <button>toolbar</button>
            <div role="dialog">popup</div>
          </div>
        )}
        sidebar={() => null}
      >
        <main>document</main>
      </PdfViewerLayout>,
    );
    const toolbar = screen.getByRole('button', { name: 'toolbar' });
    const popup = screen.getByRole('dialog');
    for (const target of [toolbar, popup]) {
      for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        expect(target.dispatchEvent(event)).toBe(false);
        expect(event.defaultPrevented).toBe(true);
      }
    }

    const app = container.querySelector('.pdfrx-app');
    expect(app).not.toBeNull();
    const twoFingerStart = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(twoFingerStart, 'touches', { value: [{}, {}] });
    expect(app!.dispatchEvent(twoFingerStart)).toBe(false);
    expect(twoFingerStart.defaultPrevented).toBe(true);

    const twoFingerMove = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(twoFingerMove, 'touches', { value: [{}, {}] });
    expect(document.dispatchEvent(twoFingerMove)).toBe(false);
    expect(twoFingerMove.defaultPrevented).toBe(true);

    const oneFingerMove = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(oneFingerMove, 'touches', { value: [{}] });
    expect(app!.dispatchEvent(oneFingerMove)).toBe(true);
    expect(oneFingerMove.defaultPrevented).toBe(false);
    const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(touchEnd, 'touches', { value: [] });
    app!.dispatchEvent(touchEnd);

    const portaledPopup = document.createElement('div');
    portaledPopup.dataset.pdfrxPageZoomGuard = '';
    document.body.appendChild(portaledPopup);
    const portalGesture = new Event('gesturestart', { bubbles: true, cancelable: true });
    expect(portaledPopup.dispatchEvent(portalGesture)).toBe(false);
    expect(portalGesture.defaultPrevented).toBe(true);
    const portalGestureEnd = new Event('gestureend', { bubbles: true, cancelable: true });
    portaledPopup.dispatchEvent(portalGestureEnd);
    portaledPopup.remove();

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const outsideGesture = new Event('gesturestart', { bubbles: true, cancelable: true });
    expect(outside.dispatchEvent(outsideGesture)).toBe(true);
    expect(outsideGesture.defaultPrevented).toBe(false);
    outside.remove();
  });
});
