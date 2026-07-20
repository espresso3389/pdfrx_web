import type { CSSProperties, ReactNode } from 'react';
import { PdfSearchBox } from './search-box.js';
import { IconMenu } from './icons.js';
import { joinClass, PdfLoadingBar, PdfPageIndicator, PdfPrintButton, PdfZoomControls } from './toolbar-parts.js';

/** Props for {@link PdfToolbar}. */
export interface PdfToolbarProps {
  className?: string;
  style?: CSSProperties;
  /** Show the sidebar toggle button. Supply {@link onToggleSidebar} to make it do something. */
  showSidebarToggle?: boolean;
  onToggleSidebar?: () => void;
  /** Show the page number / total box. Defaults to `true`. */
  showPageIndicator?: boolean;
  /** Show the zoom and fit controls. Defaults to `true`. */
  showZoomControls?: boolean;
  /** Show the search field. Defaults to `true`. */
  showSearch?: boolean;
  /** Show the print button. Defaults to `true`. */
  showPrint?: boolean;
  /** Extra controls, placed at the end of the bar. */
  children?: ReactNode;
}

/**
 * A ready-made toolbar: sidebar toggle, page indicator, zoom and fit controls,
 * search field, print button, plus whatever you pass as `children`.
 *
 * Each piece is also exported on its own ({@link PdfPageIndicator},
 * {@link PdfZoomControls}, {@link PdfSearchBox}, {@link PdfPrintButton}) if you
 * would rather lay them out yourself.
 *
 * @example
 * ```tsx
 * <PdfToolbar showSidebarToggle onToggleSidebar={() => setOpen((o) => !o)}>
 *   <button onClick={download}>Download</button>
 * </PdfToolbar>
 * ```
 */
export function PdfToolbar({
  className,
  style,
  showSidebarToggle = false,
  onToggleSidebar,
  showPageIndicator = true,
  showZoomControls = true,
  showSearch = true,
  showPrint = true,
  children,
}: PdfToolbarProps): ReactNode {
  return (
    <div className={joinClass('pdfrx-toolbar', className)} style={style}>
      {showSidebarToggle && (
        <button className="pdfrx-button" onClick={onToggleSidebar} title="Toggle sidebar" aria-label="Toggle sidebar">
          <IconMenu />
        </button>
      )}
      {showPageIndicator && <PdfPageIndicator />}
      {showZoomControls && <PdfZoomControls />}
      <span className="pdfrx-toolbar-spacer" />
      {showSearch && <PdfSearchBox className="pdfrx-toolbar-search" />}
      {showPrint && <PdfPrintButton />}
      {children}
      <PdfLoadingBar />
    </div>
  );
}
