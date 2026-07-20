import type { ContextMenuContext, PdfrxViewer } from '@pdfrx/viewer';
import type { PdfrxStrings } from './strings.js';

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

  addItem(strings.copy, context.hasSelection && context.isCopyAllowed, () => {
    context.close();
    void viewer.copySelection().then(() => viewer.clearSelection());
  });
  addItem(strings.selectAll, true, () => {
    context.close();
    void viewer.selectAll();
  });

  return menu;
}
