import type { ContextMenuContext, PdfrxViewer } from '@pdfrx/viewer';
import type { PdfrxStrings } from './strings.js';

/** Fixed opacity used by the text-selection highlight palette. */
export const TEXT_HIGHLIGHT_OPACITY = 0.5;

/** Text-highlight colors, intentionally independent of annotation-toolbar style. */
export const TEXT_HIGHLIGHT_COLORS = [
  '#ffeb3b',
  '#8bc34a',
  '#4dd0e1',
  '#f48fb1',
  '#ffb74d',
  '#ce93d8',
] as const;

/** Extra arguments `@pdfrx/react` hands a {@link PdfReactContextMenuBuilder}. */
export interface PdfContextMenuHelpers {
  /** The live viewer — call `copySelection()` / `selectAll()` / `selection` etc. */
  readonly viewer: PdfrxViewer;
  /** The active (localized) strings, e.g. to label your own items. */
  readonly strings: PdfrxStrings;
}

/**
 * The `contextMenuBuilder` prop of {@link PdfrxProvider} / {@link PdfrxViewerApp}.
 *
 * Unlike the raw {@link ContextMenuBuilder} on the viewer, this also receives
 * the viewer and the active strings, so you can reuse {@link buildDefaultContextMenu}
 * and add your own items. Return the menu element (the viewer positions and
 * dismisses it) or `null`/`undefined` for no menu.
 */
export type PdfReactContextMenuBuilder = (
  context: ContextMenuContext,
  helpers: PdfContextMenuHelpers,
) => HTMLElement | null | undefined;

/**
 * Builds the localized Copy / Select All context menu that `@pdfrx/react`
 * installs on the viewer by default (via {@link PdfrxViewerOptions.contextMenuBuilder}).
 *
 * It is plain DOM, not React — the viewer wants an `HTMLElement` and owns the
 * menu's placement and dismissal. The labels come from the active
 * {@link PdfrxStrings}; the look is themeable through the `pdfrx-context-menu`
 * classes in `styles.css`.
 *
 * Apps that want different items can pass their own `contextMenuBuilder` prop
 * instead (it wins over this default).
 */
export function buildDefaultContextMenu(
  viewer: PdfrxViewer,
  strings: PdfrxStrings,
  context: ContextMenuContext,
): HTMLElement {
  const menu = document.createElement('div');
  menu.className = context.pointerType === 'touch' ? 'pdfrx-context-menu pdfrx-context-menu-touch' : 'pdfrx-context-menu';

  const addItem = (label: string, enabled: boolean, action: () => void): void => {
    const item = document.createElement('button');
    item.className = 'pdfrx-context-menu-item';
    item.textContent = label;
    item.disabled = !enabled;
    if (enabled) item.addEventListener('click', action);
    menu.appendChild(item);
  };

  const addHighlightPalette = (): void => {
    const enabled = viewer.canHighlightSelection();
    const host = document.createElement('div');
    host.className = 'pdfrx-context-menu-submenu-host';
    const item = document.createElement('button');
    item.className = 'pdfrx-context-menu-item pdfrx-context-menu-submenu-trigger';
    item.textContent = strings.highlight;
    item.disabled = !enabled;
    item.setAttribute('aria-haspopup', 'true');
    item.setAttribute('aria-expanded', 'false');
    const arrow = document.createElement('span');
    arrow.textContent = '›';
    arrow.setAttribute('aria-hidden', 'true');
    item.appendChild(arrow);
    host.appendChild(item);
    if (enabled) {
      const closePalette = (): void => {
        host.querySelector<HTMLElement>('.pdfrx-highlight-palette')?.remove();
        item.setAttribute('aria-expanded', 'false');
      };
      const openPalette = (): void => {
        if (host.querySelector('.pdfrx-highlight-palette')) return;
        const palette = document.createElement('div');
        palette.className = 'pdfrx-highlight-palette';
        palette.setAttribute('role', 'menu');
        palette.setAttribute('aria-label', strings.highlight);
        for (const color of TEXT_HIGHLIGHT_COLORS) {
          const swatch = document.createElement('button');
          swatch.type = 'button';
          swatch.className = 'pdfrx-highlight-swatch';
          swatch.style.backgroundColor = color;
          swatch.title = color;
          swatch.setAttribute('aria-label', `${strings.highlight} ${color}`);
          swatch.addEventListener('click', () => {
            context.close();
            void viewer.highlightSelection(color, TEXT_HIGHLIGHT_OPACITY);
          });
          palette.appendChild(swatch);
        }
        host.appendChild(palette);
        item.setAttribute('aria-expanded', 'true');
        // Prefer a conventional right-side submenu, but flip it at the window edge.
        const rect = palette.getBoundingClientRect();
        if (rect.right > window.innerWidth - 4) palette.classList.add('pdfrx-highlight-palette-left');
      };
      host.addEventListener('mouseenter', openPalette);
      host.addEventListener('mouseleave', () => {
        if (!host.contains(document.activeElement)) closePalette();
      });
      host.addEventListener('focusin', openPalette);
      host.addEventListener('focusout', (event) => {
        if (!host.contains(event.relatedTarget as Node | null)) closePalette();
      });
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        // Touch has no hover, so tapping the item toggles the palette. Mouse and
        // keyboard clicks keep the already-hovered/focused palette open.
        if (context.pointerType === 'touch' && host.querySelector('.pdfrx-highlight-palette')) closePalette();
        else openPalette();
      });
    }
    menu.appendChild(host);
  };

  addItem(strings.copy, context.hasSelection && context.isCopyAllowed, () => {
    context.close();
    void viewer.copySelection().then(() => viewer.clearSelection());
  });
  addHighlightPalette();
  addItem(strings.selectAll, true, () => {
    context.close();
    void viewer.selectAll();
  });

  return menu;
}
