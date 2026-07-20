import { useState, type CSSProperties, type ReactNode } from 'react';
import { usePdfrxStrings } from '../strings.js';
import { PdfSearchBox } from './search-box.js';
import { IconMenu, IconSearch } from './icons.js';
import { joinClass, PdfLoadingBar, PdfPageIndicator, PdfPrintButton, PdfZoomControls } from './toolbar-parts.js';

/** Props for {@link PdfToolbar}. */
export interface PdfToolbarProps {
  className?: string;
  style?: CSSProperties;
  /** Show the sidebar toggle button. Supply {@link onToggleSidebar} to make it do something. */
  showSidebarToggle?: boolean;
  onToggleSidebar?: () => void;
  /**
   * Which end of the bar the sidebar toggle sits on. Defaults to `'start'`;
   * pair it with a right-hand sidebar by passing `'end'`.
   */
  sidebarTogglePosition?: 'start' | 'end';
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
 * On a narrow (phone) screen the inline search field is replaced by a search
 * button; tapping it reveals the search field in a second row below the bar.
 * This is purely responsive — on a wide screen the field is always inline.
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
  sidebarTogglePosition = 'start',
  showPageIndicator = true,
  showZoomControls = true,
  showSearch = true,
  showPrint = true,
  children,
}: PdfToolbarProps): ReactNode {
  // Only meaningful on a narrow screen: whether the collapsed search field is
  // expanded. On a wide screen CSS shows the inline field and hides both the
  // toggle button and this row, so the value is simply ignored there.
  const [searchOpen, setSearchOpen] = useState(false);
  const strings = usePdfrxStrings();

  const sidebarToggle = showSidebarToggle ? (
    <button className="pdfrx-button" onClick={onToggleSidebar} title={strings.toggleSidebar} aria-label={strings.toggleSidebar}>
      <IconMenu />
    </button>
  ) : null;

  return (
    <>
      <div className={joinClass('pdfrx-toolbar', className)} style={style}>
        {sidebarTogglePosition === 'start' && sidebarToggle}
        {showPageIndicator && <PdfPageIndicator />}
        {showZoomControls && <PdfZoomControls />}
        <span className="pdfrx-toolbar-spacer" />
        {showSearch && <PdfSearchBox className="pdfrx-toolbar-search" />}
        {showSearch && (
          <button
            className={joinClass('pdfrx-button pdfrx-toolbar-search-toggle', searchOpen ? 'pdfrx-button-active' : undefined)}
            onClick={() => setSearchOpen((open) => !open)}
            title={strings.search}
            aria-label={strings.search}
            aria-expanded={searchOpen}
          >
            <IconSearch />
          </button>
        )}
        {showPrint && <PdfPrintButton />}
        {children}
        {sidebarTogglePosition === 'end' && sidebarToggle}
        <PdfLoadingBar />
      </div>
      {showSearch && searchOpen && (
        <div className="pdfrx-toolbar-search-row">
          <PdfSearchBox autoFocus onClose={() => setSearchOpen(false)} />
        </div>
      )}
    </>
  );
}
