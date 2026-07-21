import type { ContextMenuContext, PdfrxViewer } from '@pdfrx/viewer';
import { describe, expect, it, vi } from 'vitest';
import { buildDefaultContextMenu, TEXT_HIGHLIGHT_COLORS, TEXT_HIGHLIGHT_OPACITY } from './context-menu.js';
import { defaultPdfrxStrings } from './strings.js';

describe('buildDefaultContextMenu', () => {
  it('opens a dedicated highlight palette and applies its fixed opacity', () => {
    const highlightSelection = vi.fn(() => Promise.resolve());
    const viewer = {
      canHighlightSelection: () => true,
      highlightSelection,
      copySelection: () => Promise.resolve(true),
      clearSelection: vi.fn(),
      selectAll: vi.fn(),
    } as unknown as PdfrxViewer;
    const close = vi.fn();
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

    host.dispatchEvent(new MouseEvent('mouseleave'));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.pdfrx-highlight-palette')).toBeNull();
  });
});
