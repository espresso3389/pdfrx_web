import { createContext, useContext } from 'react';

/**
 * Every piece of user-facing text the built-in components render, so an app can
 * translate the UI. Pass a partial override to {@link PdfrxProvider} /
 * {@link PdfrxViewerApp} via their `strings` prop; anything you leave out falls
 * back to {@link defaultPdfrxStrings} (English).
 *
 * @example
 * ```tsx
 * const ja: Partial<PdfrxStrings> = {
 *   search: '検索',
 *   pagesTab: 'ページ',
 *   outlineTab: '目次',
 *   goToPage: (n) => `${n} ページへ`,
 * };
 * <PdfrxViewerApp src="/manual.pdf" strings={ja} />
 * ```
 */
export interface PdfrxStrings {
  // Toolbar
  /** Sidebar toggle button (title + aria-label). */
  toggleSidebar: string;
  /** Collapsed-search toggle button (title + aria-label). */
  search: string;
  /** Page-number input aria-label. */
  pageNumber: string;
  zoomOut: string;
  zoomIn: string;
  fitPage: string;
  fitWidth: string;
  /** Print button while idle. */
  print: string;
  /** Print button while pages are being rasterized. */
  preparingToPrint: string;

  // Search box
  /** Default placeholder for the search field (overridable per box). */
  searchPlaceholder: string;
  previousMatch: string;
  nextMatch: string;
  /** ✕ button title when it only clears the query. */
  clearSearch: string;
  /** ✕ button aria-label when it only clears the query. */
  clearSearchLabel: string;
  /** ✕ button title + aria-label when it also dismisses the box. */
  closeSearch: string;

  // Sidebar
  pagesTab: string;
  outlineTab: string;

  // Outline
  /** Shown when the document has no outline (overridable per tree). */
  noOutline: string;
  expand: string;
  collapse: string;

  // Thumbnails
  /** Thumbnail button aria-label. */
  goToPage: (pageNumber: number) => string;

  // Context menu (right-click / long-press)
  copy: string;
  highlight: string;
  selectAll: string;

  // Editing / annotation toolbar
  undo: string;
  redo: string;
  textSelection: string;
  selectObjects: string;
  penTool: string;
  rectangleTool: string;
  ellipseTool: string;
  lineTool: string;
  arrowTool: string;
  highlighterTool: string;
  noteTool: string;
  textBoxTool: string;
  /** Placeholder shown while editing text inside a box. */
  annotationTextPlaceholder: string;
  /** Placeholder shown while editing a sticky note. */
  annotationNotePlaceholder: string;
  strokeColor: string;
  noStroke: string;
  fillColor: string;
  noFill: string;
  textColor: string;
  textSize: string;
  opacity: string;
  thickness: string;
  closeAnnotationToolbar: string;

  // Viewer app chrome
  openFile: string;
  download: string;
  annotate: string;
  closeSidebar: string;
  rotatePage: string;
  rotatePageCounterclockwise: string;
  rotatePage180: string;
  deletePage: string;
  /** "Add pages" button at the end of the thumbnail strip (label + aria-label). */
  addPages: string;
  /**
   * Message shown by the built-in `window.prompt` password provider when a
   * document is encrypted (used by {@link PdfrxViewerApp} unless the app supplies
   * its own `passwordProvider`).
   */
  enterPassword: string;
  /** Error banner text; receives the error message. */
  failedToOpen: (message: string) => string;
  /** Error-banner dismiss button (title + aria-label). */
  dismissError: string;
}

/** The built-in English strings. Any field omitted from a `strings` override uses these. */
export const defaultPdfrxStrings: PdfrxStrings = {
  toggleSidebar: 'Toggle sidebar',
  search: 'Search',
  pageNumber: 'Page number',
  zoomOut: 'Zoom out',
  zoomIn: 'Zoom in',
  fitPage: 'Fit page',
  fitWidth: 'Fit width',
  print: 'Print',
  preparingToPrint: 'Preparing pages…',

  searchPlaceholder: 'Search',
  previousMatch: 'Previous match (Shift+Enter)',
  nextMatch: 'Next match (Enter)',
  clearSearch: 'Clear search (Escape)',
  clearSearchLabel: 'Clear search',
  closeSearch: 'Close search',

  pagesTab: 'Pages',
  outlineTab: 'Outline',

  noOutline: 'No outline',
  expand: 'Expand',
  collapse: 'Collapse',

  goToPage: (pageNumber) => `Go to page ${pageNumber}`,

  copy: 'Copy',
  highlight: 'Highlight',
  selectAll: 'Select All',

  undo: 'Undo',
  redo: 'Redo',
  textSelection: 'Text selection',
  selectObjects: 'Select objects',
  penTool: 'Pen',
  rectangleTool: 'Rectangle',
  ellipseTool: 'Ellipse',
  lineTool: 'Line',
  arrowTool: 'Arrow',
  highlighterTool: 'Highlighter',
  noteTool: 'Note',
  textBoxTool: 'Text box',
  annotationTextPlaceholder: 'Text',
  annotationNotePlaceholder: 'Note',
  strokeColor: 'Stroke color',
  noStroke: 'No stroke',
  fillColor: 'Fill color',
  noFill: 'No fill',
  textColor: 'Text color',
  textSize: 'Text size',
  opacity: 'Opacity',
  thickness: 'Thickness',
  closeAnnotationToolbar: 'Close annotation toolbar',

  openFile: 'Open a PDF file',
  download: 'Download',
  annotate: 'Annotate',
  closeSidebar: 'Close sidebar',
  rotatePage: 'Rotate 90° clockwise',
  rotatePageCounterclockwise: 'Rotate 90° counterclockwise',
  rotatePage180: 'Rotate 180°',
  deletePage: 'Delete this page',
  addPages: 'Add pages',
  enterPassword: 'This document is password protected.\nPassword:',
  failedToOpen: (message) => `Failed to open the document: ${message}`,
  dismissError: 'Dismiss',
};

/** Context carrying the active strings; defaults to English so components work standalone. */
export const PdfrxStringsContext = createContext<PdfrxStrings>(defaultPdfrxStrings);

/**
 * The active {@link PdfrxStrings}. Read by every built-in component; use it in
 * your own components too so they translate alongside the rest.
 */
export function usePdfrxStrings(): PdfrxStrings {
  return useContext(PdfrxStringsContext);
}
