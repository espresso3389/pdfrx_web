import type { ContextMenuContext, PdfrxViewer } from '@pdfrx/viewer';
import { describe, expect, it, vi } from 'vitest';
import { buildDefaultContextMenu, TEXT_HIGHLIGHT_COLORS, TEXT_HIGHLIGHT_OPACITY } from './context-menu.js';
import { defaultPdfrxStrings } from './strings.js';

const context = (close = vi.fn(), pointerType: 'mouse' | 'touch' = 'mouse'): ContextMenuContext => ({
  viewPoint: { x: 0, y: 0 },
  hasSelection: true,
  isCopyAllowed: true,
  pointerType,
  close,
});

const viewerWithMarkup = (
  addTextMarkupToSelection = vi.fn(() => Promise.resolve([])),
): PdfrxViewer => ({
  canAddTextMarkupToSelection: () => true,
  canAddLinkToSelection: () => true,
  addTextMarkupToSelection,
  previewTextMarkupSelection: vi.fn(),
  clearTextMarkupSelectionPreview: vi.fn(),
  copySelection: () => Promise.resolve(true),
  clearSelection: vi.fn(),
  selectAll: vi.fn(),
} as unknown as PdfrxViewer);

describe('buildDefaultContextMenu', () => {
  it('places a split markup action above add-link', () => {
    const menu = buildDefaultContextMenu(viewerWithMarkup(), defaultPdfrxStrings, context());
    expect([...menu.querySelectorAll<HTMLButtonElement>(':scope > button, :scope > div button')]
      .map((item) => item.textContent)).toEqual([
      defaultPdfrxStrings.copy,
      defaultPdfrxStrings.selectAll,
      defaultPdfrxStrings.textMarkup,
      '›',
      defaultPdfrxStrings.addLink,
    ]);
  });

  it('applies the default highlight from the primary split action', () => {
    const addTextMarkupToSelection = vi.fn(() => Promise.resolve([]));
    const close = vi.fn();
    const menu = buildDefaultContextMenu(
      viewerWithMarkup(addTextMarkupToSelection),
      defaultPdfrxStrings,
      context(close),
    );
    menu.querySelector<HTMLButtonElement>('.pdfrx-context-menu-markup-apply')!.click();
    expect(addTextMarkupToSelection).toHaveBeenCalledWith(
      'highlight',
      TEXT_HIGHLIGHT_COLORS[0],
      TEXT_HIGHLIGHT_OPACITY,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('offers every subtype/color combination and applies the chosen cell', () => {
    const addTextMarkupToSelection = vi.fn(() => Promise.resolve([]));
    const close = vi.fn();
    const menu = buildDefaultContextMenu(
      viewerWithMarkup(addTextMarkupToSelection),
      defaultPdfrxStrings,
      context(close),
    );
    const trigger = menu.querySelector<HTMLButtonElement>('.pdfrx-context-menu-submenu-trigger')!;
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect([...menu.querySelectorAll<HTMLElement>('.pdfrx-text-markup-row-label')]
      .map((item) => item.textContent)).toEqual([
        defaultPdfrxStrings.highlight,
        defaultPdfrxStrings.underline,
        defaultPdfrxStrings.squiggly,
        defaultPdfrxStrings.strikeout,
      ]);
    const choices = menu.querySelectorAll<HTMLButtonElement>('.pdfrx-text-markup-choice');
    expect(choices).toHaveLength(4 * TEXT_HIGHLIGHT_COLORS.length);
    choices[2 * TEXT_HIGHLIGHT_COLORS.length + 3]!.click();
    expect(addTextMarkupToSelection).toHaveBeenCalledWith(
      'squiggly',
      TEXT_HIGHLIGHT_COLORS[3],
      1,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('previews a cell on hover and clears the preview when leaving', () => {
    const viewer = viewerWithMarkup();
    const menu = buildDefaultContextMenu(viewer, defaultPdfrxStrings, context());
    menu.querySelector<HTMLButtonElement>('.pdfrx-context-menu-submenu-trigger')!.click();
    const choice = menu.querySelectorAll<HTMLButtonElement>('.pdfrx-text-markup-choice')[
      3 * TEXT_HIGHLIGHT_COLORS.length + 2
    ]!;

    choice.dispatchEvent(new MouseEvent('mouseenter'));
    expect(viewer.previewTextMarkupSelection).toHaveBeenCalledWith(
      'strikeout',
      TEXT_HIGHLIGHT_COLORS[2],
      1,
    );
    choice.dispatchEvent(new MouseEvent('mouseleave'));
    expect(viewer.clearTextMarkupSelectionPreview).toHaveBeenCalled();
  });

  it('remembers the last subtype/color cell for the viewer', () => {
    const addTextMarkupToSelection = vi.fn(() => Promise.resolve([]));
    const viewer = viewerWithMarkup(addTextMarkupToSelection);
    const first = buildDefaultContextMenu(viewer, defaultPdfrxStrings, context());
    first.querySelector<HTMLButtonElement>('.pdfrx-context-menu-submenu-trigger')!.click();
    first.querySelectorAll<HTMLButtonElement>('.pdfrx-text-markup-choice')[
      TEXT_HIGHLIGHT_COLORS.length + 3
    ]!.click();

    const second = buildDefaultContextMenu(viewer, defaultPdfrxStrings, context());
    second.querySelector<HTMLButtonElement>('.pdfrx-context-menu-markup-apply')!.click();
    expect(addTextMarkupToSelection).toHaveBeenLastCalledWith(
      'underline',
      TEXT_HIGHLIGHT_COLORS[3],
      1,
    );
  });

  it('applies a touch-selected color before focus removes the palette', () => {
    const addTextMarkupToSelection = vi.fn(() => Promise.resolve([]));
    const close = vi.fn();
    const menu = buildDefaultContextMenu(
      viewerWithMarkup(addTextMarkupToSelection),
      defaultPdfrxStrings,
      context(close, 'touch'),
    );
    const trigger = menu.querySelector<HTMLButtonElement>('.pdfrx-context-menu-submenu-trigger')!;
    trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const choice = menu.querySelector<HTMLButtonElement>('.pdfrx-text-markup-choice')!;
    choice.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
    }));
    trigger.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    choice.click();

    expect(addTextMarkupToSelection).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('disables both split controls when text markup is unavailable', () => {
    const viewer = { canAddTextMarkupToSelection: () => false } as unknown as PdfrxViewer;
    const menu = buildDefaultContextMenu(viewer, defaultPdfrxStrings, {
      ...context(),
      hasSelection: false,
    });
    expect(menu.querySelector<HTMLButtonElement>('.pdfrx-context-menu-markup-apply')!.disabled).toBe(true);
    const trigger = menu.querySelector<HTMLButtonElement>('.pdfrx-context-menu-submenu-trigger')!;
    expect(trigger.disabled).toBe(true);
    trigger.click();
    expect(menu.querySelector('.pdfrx-text-markup-palette')).toBeNull();
  });

  it('keeps the markup palette inside the viewport', () => {
    const menu = buildDefaultContextMenu(viewerWithMarkup(), defaultPdfrxStrings, context());
    const host = menu.querySelector<HTMLElement>('.pdfrx-context-menu-submenu-host')!;
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
      left: 280, right: 320, top: 190, bottom: 220,
      width: 40, height: 30, x: 280, y: 190, toJSON: () => ({}),
    });
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if ((this as HTMLElement).classList.contains('pdfrx-text-markup-palette')) {
        return {
          left: 325, right: 505, top: 186, bottom: 326,
          width: 180, height: 140, x: 325, y: 186, toJSON: () => ({}),
        };
      }
      return new DOMRect();
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });

    host.dispatchEvent(new MouseEvent('mouseenter'));
    const palette = host.querySelector<HTMLElement>('.pdfrx-text-markup-palette')!;
    expect(palette.style.position).toBe('fixed');
    expect(palette.style.left).toBe('95px');
    expect(palette.style.top).toBe('96px');
    rectSpy.mockRestore();
  });
});
