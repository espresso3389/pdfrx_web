import { useState, type CSSProperties, type ReactNode } from 'react';
import { usePdfrxStrings } from '../strings.js';
import { PdfOutlineTree } from './outline-tree.js';
import { PdfThumbnailList } from './thumbnail-list.js';
import { joinClass } from './toolbar-parts.js';

/** Which sidebar pane is showing. */
export type PdfSidebarTab = 'thumbnails' | 'outline';

/** Props for {@link PdfSidebar}. */
export interface PdfSidebarProps {
  className?: string;
  style?: CSSProperties;
  /** Which tabs to offer, in order. Defaults to both. */
  tabs?: readonly PdfSidebarTab[];
  /** The tab to start on. Defaults to the first entry of `tabs`. */
  defaultTab?: PdfSidebarTab;
  /** Thumbnail width in CSS pixels. */
  thumbnailWidth?: number;
  /** Called after a thumbnail or outline entry navigates — e.g. to close a drawer. */
  onNavigate?: () => void;
  /** Extra controls drawn over each thumbnail. See {@link PdfThumbnailList}. */
  renderPageActions?: (pageNumber: number) => ReactNode;
}

/**
 * The thumbnails/outline sidebar, with a tab strip when both are enabled.
 *
 * It has no width of its own — set one with `style` or `className`, or let a
 * flex parent size it.
 *
 * @example
 * ```tsx
 * <PdfSidebar style={{ width: 200 }} defaultTab="outline" />
 * ```
 */
export function PdfSidebar({
  className,
  style,
  tabs = DEFAULT_TABS,
  defaultTab,
  thumbnailWidth,
  onNavigate,
  renderPageActions,
}: PdfSidebarProps): ReactNode {
  const [active, setActive] = useState<PdfSidebarTab>(defaultTab ?? tabs[0] ?? 'thumbnails');
  const current = tabs.includes(active) ? active : (tabs[0] ?? 'thumbnails');
  const strings = usePdfrxStrings();

  return (
    <div className={joinClass('pdfrx-sidebar', className)} style={style}>
      {tabs.length > 1 && (
        <div className="pdfrx-sidebar-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={tab === current}
              className={tab === current ? 'pdfrx-sidebar-tab pdfrx-sidebar-tab-active' : 'pdfrx-sidebar-tab'}
              onClick={() => setActive(tab)}
            >
              {tab === 'thumbnails' ? strings.pagesTab : strings.outlineTab}
            </button>
          ))}
        </div>
      )}
      <div className="pdfrx-sidebar-pane">
        {current === 'thumbnails' ? (
          <PdfThumbnailList width={thumbnailWidth} onNavigate={onNavigate} renderPageActions={renderPageActions} />
        ) : (
          <PdfOutlineTree onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}

const DEFAULT_TABS: readonly PdfSidebarTab[] = ['thumbnails', 'outline'];
