import type { ContextMenuContext, PdfrxViewer } from '@pdfrx/viewer';
import { describe, expect, it, vi } from 'vitest';
import { buildDefaultContextMenu, TEXT_HIGHLIGHT_COLORS, TEXT_HIGHLIGHT_OPACITY } from './context-menu.js';
import { defaultPdfrxStrings } from './strings.js';

describe('buildDefaultContextMenu', () => {
  it('orders copy and select-all before highlight', () => {
    const viewer = { canHighlightSelection: () => true } as unknown as PdfrxViewer;
    const menu = buildDefaultContextMenu(viewer, defaultPdfrxStrings, {
      viewPoint: { x: 0, y: 0 },
      hasSelection: true,
      isCopyAllowed: true,
      pointerType: 'mouse',
      close: vi.fn(),
    });
    expect([...menu.querySelectorAll<HTMLButtonElement>(':scope > button, :scope > div > button')].map((item) => item.textContent)).toEqual([
      defaultPdfrxStrings.copy,
      defaultPdfrxStrings.selectAll,
      `${defaultPdfrxStrings.highlight}›`,
    ]);
  });

  it('opens a dedicated highlight palette and applies its fixed opacity', () => {
    const calls: string[] = [];
    const highlightSelection = vi.fn(() => {
      calls.push('highlight');
      return Promise.resolve();
    });
    const viewer = {
      canHighlightSelection: () => true,
      highlightSelection,
      copySelection: () => Promise.resolve(true),
      clearSelection: vi.fn(),
      selectAll: vi.fn(),
    } as unknown as PdfrxViewer;
    const close = vi.fn(() => calls.push('close'));
    const context: ContextMenuContext = {
      viewPoint: { x: 0, y: 0 },
      hasSelection: true,
      isCopyAllowed: true,
      pointerType: 'mouse',
      close,
    };
    const menu = buildDefaultContextMenu(viewer, defaultPdfrxStrings, context);
    const trigger = menu.querySelector<HTMLButtonElement>('.pdfrx-context-menu-submenu-trigger')!;

    trigger.click();
    expect(highlightSelection).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const swatches = menu.querySelectorAll<HTMLButtonElement>('.pdfrx-highlight-swatch');
    expect(swatches).toHaveLength(TEXT_HIGHLIGHT_COLORS.length);

    swatches[0]!.click();
    expect(close).toHaveBeenCalledOnce();
    expect(highlightSelection).toHaveBeenCalledWith(TEXT_HIGHLIGHT_COLORS[0], TEXT_HIGHLIGHT_OPACITY);
    expect(calls).toEqual(['highlight', 'close']);
  });

  it('disables the palette when text cannot be highlighted', () => {
    const viewer = { canHighlightSelection: () => false } as unknown as PdfrxViewer;
    const menu = buildDefaultContextMenu(viewer, defaultPdfrxStrings, {
      viewPoint: { x: 0, y: 0 },
      hasSelection: false,
      isCopyAllowed: true,
      pointerType: 'mouse',
      close: vi.fn(),
    });
    const trigger = menu.querySelector<HTMLButtonElement>('.pdfrx-context-menu-submenu-trigger')!;
    expect(trigger.disabled).toBe(true);
    trigger.click();
    expect(menu.querySelector('.pdfrx-highlight-palette')).toBeNull();
  });

  it('opens on hover and closes after leaving the submenu', () => {
    const viewer = { canHighlightSelection: () => true } as unknown as PdfrxViewer;
    const menu = buildDefaultContextMenu(viewer, defaultPdfrxStrings, {
      viewPoint: { x: 0, y: 0 },
      hasSelection: true,
      isCopyAllowed: true,
      pointerType: 'mouse',
      close: vi.fn(),
    });
    const host = menu.querySelector<HTMLElement>('.pdfrx-context-menu-submenu-host')!;
    const trigger = host.querySelector<HTMLButtonElement>('.pdfrx-context-menu-submenu-trigger')!;

    host.dispatchEvent(new MouseEvent('mouseenter'));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelectorAll('.pdfrx-highlight-swatch')).toHaveLength(TEXT_HIGHLIGHT_COLORS.length);

    host.dispatchEvent(new MouseEvent('mouseleave', { clientX: 100, clientY: 100 }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.pdfrx-highlight-palette')).toBeNull();
  });

  it('keeps the palette open while the pointer crosses its surrounding grace area', () => {
    const viewer = { canHighlightSelection: () => true } as unknown as PdfrxViewer;
    const menu = buildDefaultContextMenu(viewer, defaultPdfrxStrings, {
      viewPoint: { x: 0, y: 0 },
      hasSelection: true,
      isCopyAllowed: true,
      pointerType: 'mouse',
      close: vi.fn(),
    });
    const host = menu.querySelector<HTMLElement>('.pdfrx-context-menu-submenu-host')!;
    host.dispatchEvent(new MouseEvent('mouseenter'));
    const palette = host.querySelector<HTMLElement>('.pdfrx-highlight-palette')!;
    vi.spyOn(palette, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 200,
      top: 50,
      bottom: 150,
      width: 100,
      height: 100,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    });

    host.dispatchEvent(new MouseEvent('mouseleave', { clientX: 96, clientY: 80 }));
    expect(host.querySelector('.pdfrx-highlight-palette')).toBe(palette);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 90, clientY: 80 }));
    expect(host.querySelector('.pdfrx-highlight-palette')).toBeNull();
  });
});
