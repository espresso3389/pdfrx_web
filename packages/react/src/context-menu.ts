import type { ContextMenuContext, PdfrxViewer, TextMarkupAnnotationSubtype } from '@pdfrx/viewer';
import type { PdfrxStrings } from './strings.js';

/**
 * Opacity used by the default context menu for Highlight previews and commits.
 * Line-based text markup uses full opacity instead.
 */
export const TEXT_HIGHLIGHT_OPACITY = 0.5;

/**
 * Pastel colors used by the default context menu's Highlight row.
 * They are intentionally independent of the annotation-toolbar style.
 */
export const TEXT_HIGHLIGHT_COLORS = [
  '#ffeb3b',
  '#8bc34a',
  '#4dd0e1',
  '#f48fb1',
  '#ffb74d',
  '#ce93d8',
] as const;

/**
 * Higher-contrast colors used at full opacity by the default context menu's
 * Underline, Squiggly, and StrikeOut rows.
 */
export const TEXT_MARKUP_LINE_COLORS = [
  '#c49000',
  '#388e3c',
  '#0288d1',
  '#d32f2f',
  '#ef6c00',
  '#7b1fa2',
] as const;

const DEFAULT_TEXT_MARKUP = {
  subtype: 'highlight' as TextMarkupAnnotationSubtype,
  color: TEXT_HIGHLIGHT_COLORS[0],
};
const lastTextMarkupByViewer = new WeakMap<PdfrxViewer, {
  subtype: TextMarkupAnnotationSubtype;
  color: string;
}>();

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
 *
 */
export type PdfReactContextMenuBuilder = (
  context: ContextMenuContext,
  helpers: PdfContextMenuHelpers,
) => HTMLElement | null | undefined;

/**
 * Builds the localized Copy / Select All / text-markup / Add link context menu
 * that `@pdfrx/react` installs on the viewer by default (via
 * {@link PdfrxViewerOptions.contextMenuBuilder}).
 *
 * It is plain DOM, not React — the viewer wants an `HTMLElement` and owns the
 * menu's placement and dismissal. The labels come from the active
 * {@link PdfrxStrings}; the look is themeable through the `pdfrx-context-menu`
 * classes in `styles.css`.
 *
 * Markup is a split action. Its primary button reapplies the viewer's last
 * committed subtype and color; its submenu is a subtype-by-color matrix.
 * Hovering or focusing a cell previews it without mutating the PDF, and
 * clicking commits it. Highlight uses {@link TEXT_HIGHLIGHT_COLORS} and
 * {@link TEXT_HIGHLIGHT_OPACITY}; line subtypes use
 * {@link TEXT_MARKUP_LINE_COLORS} at full opacity.
 *
 * Apps that want different items can pass their own `contextMenuBuilder` prop
 * instead (it wins over this default).
 * @param viewer - The viewer value (PdfrxViewer).
 * @param strings - The strings value (PdfrxStrings).
 * @param context - The context value (ContextMenuContext).
 * @returns The resulting HTMLElement.
 *
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

  const addTextMarkupMenu = (): void => {
    const enabled = viewer.canAddTextMarkupToSelection();
    const host = document.createElement('div');
    host.className = 'pdfrx-context-menu-submenu-host';
    const split = document.createElement('div');
    split.className = 'pdfrx-context-menu-split';
    const applyItem = document.createElement('button');
    applyItem.className = 'pdfrx-context-menu-item pdfrx-context-menu-markup-apply';
    applyItem.textContent = strings.textMarkup;
    applyItem.disabled = !enabled;
    const item = document.createElement('button');
    item.className = 'pdfrx-context-menu-item pdfrx-context-menu-submenu-trigger';
    item.title = strings.textMarkupOptions;
    item.setAttribute('aria-label', strings.textMarkupOptions);
    item.disabled = !enabled;
    item.setAttribute('aria-haspopup', 'true');
    item.setAttribute('aria-expanded', 'false');
    const arrow = document.createElement('span');
    arrow.textContent = '›';
    arrow.setAttribute('aria-hidden', 'true');
    item.appendChild(arrow);
    split.append(applyItem, item);
    host.appendChild(split);
    if (enabled) {
      const PALETTE_HOVER_GRACE = 6;
      let trackPalettePointer: ((event: MouseEvent) => void) | null = null;
      const current = (): { subtype: TextMarkupAnnotationSubtype; color: string } =>
        lastTextMarkupByViewer.get(viewer) ?? DEFAULT_TEXT_MARKUP;
      const applyMarkup = (
        subtype: TextMarkupAnnotationSubtype = current().subtype,
        color: string = current().color,
      ): void => {
        viewer.clearTextMarkupSelectionPreview();
        lastTextMarkupByViewer.set(viewer, { subtype, color });
        void viewer.addTextMarkupToSelection(
          subtype,
          color,
          subtype === 'highlight' ? TEXT_HIGHLIGHT_OPACITY : 1,
        );
        context.close();
      };
      applyItem.addEventListener('click', () => applyMarkup());
      const closePalette = (): void => {
        viewer.clearTextMarkupSelectionPreview();
        if (trackPalettePointer) {
          document.removeEventListener('mousemove', trackPalettePointer);
          trackPalettePointer = null;
        }
        host.querySelector<HTMLElement>('.pdfrx-text-markup-palette')?.remove();
        item.setAttribute('aria-expanded', 'false');
      };
      const openPalette = (): void => {
        if (host.querySelector('.pdfrx-text-markup-palette')) return;
        const palette = document.createElement('div');
        palette.className = 'pdfrx-text-markup-palette';
        palette.setAttribute('role', 'menu');
        palette.setAttribute('aria-label', strings.textMarkupOptions);
        const matrix = document.createElement('div');
        matrix.className = 'pdfrx-text-markup-matrix';
        const markupTypes: readonly [TextMarkupAnnotationSubtype, string][] = [
          ['highlight', strings.highlight],
          ['underline', strings.underline],
          ['squiggly', strings.squiggly],
          ['strikeout', strings.strikeout],
        ];
        for (const [subtype, label] of markupTypes) {
          const rowLabel = document.createElement('span');
          rowLabel.className = 'pdfrx-text-markup-row-label';
          rowLabel.textContent = label;
          matrix.appendChild(rowLabel);
          const colors = subtype === 'highlight' ? TEXT_HIGHLIGHT_COLORS : TEXT_MARKUP_LINE_COLORS;
          for (const color of colors) {
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = `pdfrx-text-markup-choice pdfrx-text-markup-${subtype}`;
            choice.title = `${label} ${color}`;
            choice.setAttribute('aria-label', `${label} ${color}`);
            choice.setAttribute('role', 'menuitem');
            const preview = document.createElement('span');
            preview.className = 'pdfrx-text-markup-preview';
            preview.textContent = 'Aa';
            if (subtype === 'highlight') {
              preview.style.backgroundColor = color;
            } else {
              preview.style.textDecorationColor = color;
            }
            choice.appendChild(preview);
            const previewChoice = (): void => {
              viewer.previewTextMarkupSelection(
                subtype,
                color,
                subtype === 'highlight' ? TEXT_HIGHLIGHT_OPACITY : 1,
              );
            };
            choice.addEventListener('mouseenter', previewChoice);
            choice.addEventListener('mouseleave', () => viewer.clearTextMarkupSelectionPreview());
            choice.addEventListener('focus', previewChoice);
            choice.addEventListener('blur', () => viewer.clearTextMarkupSelectionPreview());
            let handledByTouchPointer = false;
            const applyChoice = (): void => {
              // Capture and start processing the viewer selection before the
              // menu is removed. Removing the clicked submenu first can let the
              // browser's focus/default-action processing invalidate selection.
              applyMarkup(subtype, color);
            };
            choice.addEventListener('pointerdown', (event) => {
              if (event.pointerType !== 'touch') return;
              event.preventDefault();
              handledByTouchPointer = true;
              applyChoice();
            });
            choice.addEventListener('click', () => {
              if (handledByTouchPointer) return;
              applyChoice();
            });
            matrix.appendChild(choice);
          }
        }
        palette.appendChild(matrix);
        host.appendChild(palette);
        item.setAttribute('aria-expanded', 'true');
        // Use viewport coordinates so all four edges remain visible even when
        // the viewer or its context menu is itself close to a window edge.
        const viewportMargin = 4;
        const submenuGap = 5;
        const hostRect = host.getBoundingClientRect();
        const paletteRect = palette.getBoundingClientRect();
        let left = hostRect.right + submenuGap;
        if (left + paletteRect.width > window.innerWidth - viewportMargin) {
          left = hostRect.left - submenuGap - paletteRect.width;
        }
        left = Math.max(viewportMargin, Math.min(left, window.innerWidth - viewportMargin - paletteRect.width));
        const top = Math.max(
          viewportMargin,
          Math.min(hostRect.top - 4, window.innerHeight - viewportMargin - paletteRect.height),
        );
        palette.style.position = 'fixed';
        palette.style.inset = 'auto';
        palette.style.left = `${left}px`;
        palette.style.top = `${top}px`;
        trackPalettePointer = (event): void => {
          if (host.matches(':hover')) return;
          const paletteRect = palette.getBoundingClientRect();
          const insideGraceArea =
            event.clientX >= paletteRect.left - PALETTE_HOVER_GRACE &&
            event.clientX <= paletteRect.right + PALETTE_HOVER_GRACE &&
            event.clientY >= paletteRect.top - PALETTE_HOVER_GRACE &&
            event.clientY <= paletteRect.bottom + PALETTE_HOVER_GRACE;
          if (!insideGraceArea) closePalette();
        };
        document.addEventListener('mousemove', trackPalettePointer);
      };
      host.addEventListener('mouseenter', openPalette);
      host.addEventListener('mouseleave', (event) => {
        if (host.contains(document.activeElement)) return;
        trackPalettePointer?.(event);
      });
      host.addEventListener('focusin', openPalette);
      host.addEventListener('focusout', (event) => {
        if (!host.contains(event.relatedTarget as Node | null)) closePalette();
      });
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        // Touch has no hover. Android Chrome sends focusin before click for a
        // tap, so focusin may already have opened the palette by this point.
        // Keeping openPalette() idempotent avoids immediately closing it again.
        openPalette();
      });
    }
    menu.appendChild(host);
  };

  addItem(strings.copy, context.hasSelection && context.isCopyAllowed, () => {
    context.close();
    void viewer.copySelection().then(() => viewer.clearSelection());
  });
  addItem(strings.selectAll, true, () => {
    context.close();
    void viewer.selectAll();
  });
  addTextMarkupMenu();
  addItem(strings.addLink, viewer.canAddLinkToSelection?.() ?? false, () => {
    context.close();
    void viewer.addLinkToSelection();
  });

  return menu;
}
