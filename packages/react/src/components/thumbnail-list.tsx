import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { usePdfDocument } from '../hooks/use-pdf-document.js';
import { usePdfNavigation } from '../hooks/use-pdf-navigation.js';
import { usePdfPageThumbnail } from '../hooks/use-pdf-page-thumbnail.js';
import { usePdfrxStrings } from '../strings.js';
import { joinClass } from './toolbar-parts.js';

/** Props for {@link PdfThumbnailList}. */
export interface PdfThumbnailListProps {
  className?: string;
  style?: CSSProperties;
  /** Thumbnail width in CSS pixels. Defaults to `130`. */
  width?: number;
  /** Called after a thumbnail navigates — e.g. to close a drawer on a phone. */
  onNavigate?: (pageNumber: number) => void;
  /**
   * Extra controls drawn over each thumbnail on hover — rotate, delete, whatever
   * the app supports. Clicks inside are kept from navigating.
   */
  renderPageActions?: (pageNumber: number) => ReactNode;
}

/**
 * A scrolling strip of page thumbnails, with the current page highlighted.
 * Clicking one navigates to it.
 *
 * Thumbnails render lazily as they scroll into view and are cached per document
 * by {@link usePdfPageThumbnail}, so scrolling back up costs nothing and
 * reordering pages does not re-render a single page.
 *
 * @example
 * ```tsx
 * <PdfThumbnailList
 *   width={140}
 *   renderPageActions={(page) => <button onClick={() => rotate(page)}>⟳</button>}
 * />
 * ```
 */
export function PdfThumbnailList({
  className,
  style,
  width = 130,
  onNavigate,
  renderPageActions,
}: PdfThumbnailListProps): ReactNode {
  const { pageCount } = usePdfDocument();
  const { currentPageNumber, goToPage } = usePdfNavigation();

  return (
    <div
      className={joinClass('pdfrx-thumbnails', className)}
      style={{ ...style, ['--pdfrx-thumb-width' as string]: `${width}px` }}
    >
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
        <PdfThumbnailItem
          key={pageNumber}
          pageNumber={pageNumber}
          width={width}
          isCurrent={pageNumber === currentPageNumber}
          onSelect={() => {
            goToPage(pageNumber, 300);
            onNavigate?.(pageNumber);
          }}
          actions={renderPageActions?.(pageNumber)}
        />
      ))}
    </div>
  );
}

interface PdfThumbnailItemProps {
  pageNumber: number;
  width: number;
  isCurrent: boolean;
  onSelect: () => void;
  actions: ReactNode;
}

/**
 * One thumbnail. Kept separate so each page gets its own
 * {@link usePdfPageThumbnail} and only the visible ones render.
 */
function PdfThumbnailItem({ pageNumber, width, isCurrent, onSelect, actions }: PdfThumbnailItemProps): ReactNode {
  const itemRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isNearViewport = useNearViewport(itemRef);
  const { canvas } = usePdfPageThumbnail(isNearViewport ? pageNumber : null, width);
  const strings = usePdfrxStrings();

  // The cached canvas belongs to the provider and the same page can appear in
  // more than one list, so copy it rather than reparenting it.
  useEffect(() => {
    const target = canvasRef.current;
    if (!target) return;
    if (!canvas) {
      target.width = 0;
      return;
    }
    target.width = canvas.width;
    target.height = canvas.height;
    target.getContext('2d')?.drawImage(canvas, 0, 0);
  }, [canvas]);

  // Keep the highlighted page in view as the user scrolls the document.
  useEffect(() => {
    if (isCurrent) itemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isCurrent]);

  return (
    <div
      ref={itemRef}
      className={isCurrent ? 'pdfrx-thumb-item pdfrx-thumb-current' : 'pdfrx-thumb-item'}
      data-page-number={pageNumber}
    >
      <button className="pdfrx-thumb-button" onClick={onSelect} aria-label={strings.goToPage(pageNumber)}>
        <canvas ref={canvasRef} className="pdfrx-thumb-canvas" style={{ width: `${width}px` }} />
      </button>
      {actions && (
        <div className="pdfrx-thumb-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
      <div className="pdfrx-thumb-label">{pageNumber}</div>
    </div>
  );
}

/**
 * Reports whether an element is at or near the scroll viewport, so a long
 * document does not render every thumbnail on load. The margin renders a screen
 * ahead, which is enough for the render to finish before the user gets there.
 */
function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [isNear, setIsNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setIsNear(true); // no observer (SSR, old browser): just render it
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setIsNear(true);
        observer.disconnect(); // the render is cached from here on; stop watching
      },
      { rootMargin: '400px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return isNear;
}
