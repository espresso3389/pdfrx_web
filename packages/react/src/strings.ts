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
 *
 */
export interface PdfrxStrings {
  // Toolbar
  /** Sidebar toggle button (title + aria-label). */
  toggleSidebar: string;
  /** Collapsed-search toggle button (title + aria-label). */
  search: string;
  /** Page-navigation controls aria-label. */
  pageNumber: string;
  zoomOut: string;
  zoomIn: string;
  fitPage: string;
  fitWidth: string;
  /** Print button while idle. */
  print: string;
  /** Print button while pages are being rasterized. */
  preparingToPrint: string;
  enterFullscreen: string;
  exitFullscreen: string;
  spreadNone: string;
  spreadOdd: string;
  spreadEven: string;
  captureArea: string;
  zoomToArea: string;

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
  /** Adds a link annotation over the selected text. */
  addLink: string;
  selectAll: string;

  // Editing / annotation toolbar
  undo: string;
  redo: string;
  objectSelection: string;
  textSelection: string;
  penTool: string;
  rectangleTool: string;
  ellipseTool: string;
  lineTool: string;
  arrowTool: string;
  highlighterTool: string;
  noteTool: string;
  linkTool: string;
  editLink: string;
  linkUrl: string;
  applyLink: string;
  cancel: string;
  textBoxTool: string;
  /** Add an image annotation to the center of the current page. */
  addImage: string;
  /** Placeholder shown while editing text inside a box. */
  annotationTextPlaceholder: string;
  /** Placeholder shown while editing a sticky note. */
  annotationNotePlaceholder: string;
  strokeColor: string;
  noStroke: string;
  fillColor: string;
  noFill: string;
  textColor: string;
  otherColor: string;
  customColor: string;
  saturationBrightness: string;
  hue: string;
  colorCode: string;
  applyColor: string;
  textSize: string;
  textAlignment: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignTop: string;
  alignMiddle: string;
  alignBottom: string;
  opacity: string;
  thickness: string;
  /** Delete the currently selected annotation objects. */
  deleteAnnotations: string;
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
   *
   */
  enterPassword: string;
  /** Error banner text; receives the error message. */
  failedToOpen: (message: string) => string;
  /** Error banner text when a file could not be imported as a page or image annotation. */
  failedToImport: (fileName: string, message: string) => string;
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
  enterFullscreen: 'Enter fullscreen',
  exitFullscreen: 'Exit fullscreen',
  spreadNone: 'Single-page layout',
  spreadOdd: 'Two-page layout',
  spreadEven: 'Book layout (cover first)',
  captureArea: 'Capture area',
  zoomToArea: 'Zoom to area',

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
  addLink: 'Add link',
  selectAll: 'Select All',

  undo: 'Undo',
  redo: 'Redo',
  objectSelection: 'Select objects',
  textSelection: 'Text selection',
  penTool: 'Pen',
  rectangleTool: 'Rectangle',
  ellipseTool: 'Ellipse',
  lineTool: 'Line',
  arrowTool: 'Arrow',
  highlighterTool: 'Highlighter',
  noteTool: 'Note',
  linkTool: 'Link',
  editLink: 'Edit link',
  linkUrl: 'Link URL',
  applyLink: 'Apply',
  cancel: 'Cancel',
  textBoxTool: 'Text box',
  addImage: 'Add image',
  annotationTextPlaceholder: 'Text',
  annotationNotePlaceholder: 'Note',
  strokeColor: 'Stroke color',
  noStroke: 'No stroke',
  fillColor: 'Fill color',
  noFill: 'No fill',
  textColor: 'Text color',
  otherColor: 'Other…',
  customColor: 'Custom color',
  saturationBrightness: 'Saturation and brightness',
  hue: 'Hue',
  colorCode: 'Color code (#RRGGBB)',
  applyColor: 'Apply color',
  textSize: 'Text size',
  textAlignment: 'Text alignment',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  alignTop: 'Align top',
  alignMiddle: 'Align middle',
  alignBottom: 'Align bottom',
  opacity: 'Opacity',
  thickness: 'Thickness',
  deleteAnnotations: 'Delete selected annotations',
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
  failedToImport: (fileName, message) => `Failed to import “${fileName}”: ${message}`,
  dismissError: 'Dismiss',
};

/** Context carrying the active strings; defaults to English so components work standalone. */
export const PdfrxStringsContext = createContext<PdfrxStrings>(defaultPdfrxStrings);

/**
 * The active {@link PdfrxStrings}. Read by every built-in component; use it in
 * your own components too so they translate alongside the rest.
 * @returns The current pdfrx strings state and actions.
 *
 */
export function usePdfrxStrings(): PdfrxStrings {
  return useContext(PdfrxStringsContext);
}
