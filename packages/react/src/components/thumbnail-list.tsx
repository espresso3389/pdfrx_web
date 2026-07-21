import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePdfDocument } from '../hooks/use-pdf-document.js';
import { usePdfNavigation } from '../hooks/use-pdf-navigation.js';
import { usePdfPageThumbnail } from '../hooks/use-pdf-page-thumbnail.js';
import { usePdfrxStrings } from '../strings.js';
import { IconPlus } from './icons.js';
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
  /**
   * Enables dropping files (PDFs or images) onto the strip to insert them as
   * pages. `index` is the 0-based position to insert at (0 = before the first
   * page, `pageCount` = after the last), taken from where the drop lands between
   * thumbnails. An insertion line follows the cursor while dragging.
   *
   * Uses HTML5 file drag & drop, which browsers do not raise for touch.
   */
  onInsertFiles?: (files: File[], index: number) => void;
  /**
   * Enables dragging a thumbnail to a new position. `fromPageNumber` is the
   * 1-based page being moved and `toIndex` is the 0-based slot to drop it before
   * (0 = first, `pageCount` = last). The same insertion line marks the target.
   *
   * Pointer-based, so it works with both mouse and touch: a mouse drag starts on
   * movement, a touch drag on a short long-press (a plain swipe still scrolls).
   */
  onMovePage?: (fromPageNumber: number, toIndex: number) => void;
}

/** Touch long-press before a drag starts, so a swipe still scrolls the strip. */
const DRAG_HOLD_MS = 300;
/** Mouse pointer travel (px) that turns a press into a drag. */
const DRAG_THRESHOLD = 5;
/** Distance (px) from a scroll edge that auto-scrolls while dragging. */
const EDGE_SCROLL_ZONE = 40;
const EDGE_SCROLL_SPEED = 12;

/** Where an insert/reorder drop would land: the 0-based index and the indicator's y-offset. */
interface DropTarget {
  index: number;
  top: number;
}

/** Mutable state of an in-progress pointer reorder; a ref, so moves don't re-render. */
interface ReorderState {
  pointerId: number;
  pointerType: string;
  fromPageNumber: number;
  item: HTMLElement;
  startY: number;
  active: boolean;
  holdTimer: ReturnType<typeof setTimeout> | null;
  ghost: HTMLElement | null;
  scroller: HTMLElement | null;
  dropIndex: number | null;
}

/** True when a drag carries files (as opposed to text, a page reorder, etc.). */
function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

/**
 * Finds the insertion point nearest `clientY`: the index to insert at, and the
 * y-offset (relative to the strip) to draw the indicator line.
 */
function computeDropTarget(container: HTMLElement, clientY: number): DropTarget {
  const items = Array.from(container.querySelectorAll<HTMLElement>('.pdfrx-thumb-item'));
  const containerTop = container.getBoundingClientRect().top;
  for (let i = 0; i < items.length; i++) {
    const rect = items[i]!.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return { index: i, top: rect.top - containerTop - 5 };
    }
  }
  const last = items[items.length - 1];
  return { index: items.length, top: last ? last.getBoundingClientRect().bottom - containerTop + 5 : 8 };
}

/** The nearest vertically-scrollable ancestor, for edge auto-scroll while dragging. */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
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
  onInsertFiles,
  onMovePage,
}: PdfThumbnailListProps): ReactNode {
  const { pageCount } = usePdfDocument();
  const { currentPageNumber, goToPage } = usePdfNavigation();
  const strings = usePdfrxStrings();
  const containerRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // The page being reorder-dragged (1-based), for styling only.
  const [draggingPage, setDraggingPage] = useState<number | null>(null);

  // --- File drop-to-insert (HTML5 drag & drop) ---------------------------------

  const onDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!onInsertFiles || !containerRef.current || !dragHasFiles(e)) return;
      // Claim the drop so the surrounding app's "open file" handler doesn't also
      // fire and replace the whole document.
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setDropTarget(computeDropTarget(containerRef.current, e.clientY));
    },
    [onInsertFiles],
  );

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && containerRef.current?.contains(next)) return;
    setDropTarget(null);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!onInsertFiles || !containerRef.current || !dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const { index } = computeDropTarget(containerRef.current, e.clientY);
      setDropTarget(null);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onInsertFiles(files, index);
    },
    [onInsertFiles],
  );

  // --- Page reorder (pointer events: mouse + touch) ----------------------------

  const reorderRef = useRef<ReorderState | null>(null);
  // Set while the click that trails a completed drag is still to be delivered.
  const justDraggedRef = useRef(false);

  const beginReorder = useCallback((state: ReorderState, clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return;
    state.active = true;
    setDraggingPage(state.fromPageNumber);
    // A short buzz confirms a touch long-press has armed the reorder.
    if (state.pointerType !== 'mouse') navigator.vibrate?.(10);

    // A ghost that follows the pointer. cloneNode does not copy canvas pixels,
    // so draw the thumbnail into a fresh canvas.
    const source = state.item.querySelector('canvas');
    const ghost = window.document.createElement('canvas');
    if (source && source.width > 0) {
      ghost.width = source.width;
      ghost.height = source.height;
      ghost.getContext('2d')?.drawImage(source, 0, 0);
    }
    ghost.className = 'pdfrx-thumb-ghost';
    ghost.style.width = `${width}px`;
    window.document.body.appendChild(ghost);
    state.ghost = ghost;
    state.scroller = findScrollParent(container);

    try {
      container.setPointerCapture(state.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    moveGhost(state, clientX, clientY);
    const target = computeDropTarget(container, clientY);
    state.dropIndex = target.index;
    setDropTarget(target);
  }, [width]);

  const endReorder = useCallback(
    (commit: boolean) => {
      const state = reorderRef.current;
      reorderRef.current = null;
      if (!state) return;
      if (state.holdTimer !== null) clearTimeout(state.holdTimer);
      state.ghost?.remove();
      try {
        containerRef.current?.releasePointerCapture(state.pointerId);
      } catch {
        /* ignore */
      }
      setDraggingPage(null);
      setDropTarget(null);
      if (!state.active) return;
      // Swallow the click the browser synthesizes after the drag's pointerup.
      justDraggedRef.current = true;
      setTimeout(() => (justDraggedRef.current = false), 0);
      if (commit && state.dropIndex !== null) onMovePage?.(state.fromPageNumber, state.dropIndex);
    },
    [onMovePage],
  );

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!onMovePage) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.pdfrx-thumb-actions')) return; // action buttons are taps
    const item = target.closest<HTMLElement>('.pdfrx-thumb-item');
    const pageNumber = item?.dataset.pageNumber ? Number(item.dataset.pageNumber) : NaN;
    if (!item || !Number.isFinite(pageNumber)) return;

    const state: ReorderState = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      fromPageNumber: pageNumber,
      item,
      startY: e.clientY,
      active: false,
      holdTimer: null,
      ghost: null,
      scroller: null,
      dropIndex: null,
    };
    reorderRef.current = state;
    if (e.pointerType !== 'mouse') {
      // Long press: a short swipe stays a scroll.
      const { clientX, clientY } = e;
      state.holdTimer = setTimeout(() => {
        state.holdTimer = null;
        if (reorderRef.current === state) beginReorder(state, clientX, clientY);
      }, DRAG_HOLD_MS);
    }
  }, [onMovePage, beginReorder]);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const state = reorderRef.current;
      if (!state || e.pointerId !== state.pointerId) return;
      if (!state.active) {
        const moved = Math.abs(e.clientY - state.startY);
        if (state.holdTimer !== null) {
          // Still waiting for the long press — real movement means a scroll.
          if (moved > DRAG_THRESHOLD * 2) endReorder(false);
          return;
        }
        if (e.pointerType !== 'mouse' || moved < DRAG_THRESHOLD) return;
        beginReorder(state, e.clientX, e.clientY);
      }
      e.preventDefault();
      moveGhost(state, e.clientX, e.clientY);
      edgeScroll(state, e.clientY);
      const container = containerRef.current;
      if (container) {
        const target = computeDropTarget(container, e.clientY);
        state.dropIndex = target.index;
        setDropTarget(target);
      }
    },
    [beginReorder, endReorder],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (reorderRef.current?.pointerId === e.pointerId) endReorder(true);
    },
    [endReorder],
  );
  const onPointerCancel = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (reorderRef.current?.pointerId === e.pointerId) endReorder(false);
    },
    [endReorder],
  );

  // While a touch reorder is active, block the browser's own scrolling. This
  // must be a *native, non-passive* touchmove listener: React's onPointerMove
  // `preventDefault()` does not stop touch panning on Chrome (only cancelling
  // the underlying touchmove does), so without this the first finger move after
  // the long-press starts a scroll and fires `pointercancel`, killing the drag.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onMovePage) return;
    const onTouchMove = (e: TouchEvent): void => {
      if (reorderRef.current?.active) e.preventDefault();
    };
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => container.removeEventListener('touchmove', onTouchMove);
  }, [onMovePage]);

  // Clean up a drag interrupted by unmount.
  useEffect(
    () => () => {
      const state = reorderRef.current;
      if (state?.holdTimer !== null && state?.holdTimer !== undefined) clearTimeout(state.holdTimer);
      state?.ghost?.remove();
    },
    [],
  );

  const dndEnabled = Boolean(onInsertFiles);
  const reorderEnabled = Boolean(onMovePage);

  return (
    <div
      ref={containerRef}
      className={joinClass('pdfrx-thumbnails', className)}
      style={{ ...style, ['--pdfrx-thumb-width' as string]: `${width}px` }}
      onDragOver={dndEnabled ? onDragOver : undefined}
      onDragLeave={dndEnabled ? onDragLeave : undefined}
      onDrop={dndEnabled ? onDrop : undefined}
      onPointerDown={reorderEnabled ? onPointerDown : undefined}
      onPointerMove={reorderEnabled ? onPointerMove : undefined}
      onPointerUp={reorderEnabled ? onPointerUp : undefined}
      onPointerCancel={reorderEnabled ? onPointerCancel : undefined}
      onClickCapture={
        reorderEnabled
          ? (e) => {
              if (!justDraggedRef.current) return;
              justDraggedRef.current = false;
              e.preventDefault();
              e.stopPropagation();
            }
          : undefined
      }
    >
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
        <PdfThumbnailItem
          key={pageNumber}
          pageNumber={pageNumber}
          width={width}
          isCurrent={pageNumber === currentPageNumber}
          isDragging={pageNumber === draggingPage}
          isReorderable={reorderEnabled}
          onSelect={() => {
            goToPage(pageNumber, 300);
            onNavigate?.(pageNumber);
          }}
          actions={renderPageActions?.(pageNumber)}
        />
      ))}
      {onInsertFiles && (
        <div className="pdfrx-thumb-add">
          <button
            type="button"
            className="pdfrx-thumb-add-button"
            onClick={() => addInputRef.current?.click()}
            aria-label={strings.addPages}
            title={strings.addPages}
          >
            <IconPlus />
            <span className="pdfrx-thumb-add-label">{strings.addPages}</span>
          </button>
          <input
            ref={addInputRef}
            type="file"
            accept="application/pdf,.pdf,image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = ''; // let the same files be picked again
              if (files.length > 0) onInsertFiles(files, pageCount);
            }}
          />
        </div>
      )}
      {dropTarget && <div className="pdfrx-thumb-drop-indicator" style={{ top: dropTarget.top }} aria-hidden />}
    </div>
  );
}

/** Moves the drag ghost to the pointer. */
function moveGhost(state: ReorderState, clientX: number, clientY: number): void {
  if (!state.ghost) return;
  state.ghost.style.left = `${clientX}px`;
  state.ghost.style.top = `${clientY}px`;
}

/** Scrolls the enclosing pane when the pointer nears its top or bottom edge. */
function edgeScroll(state: ReorderState, clientY: number): void {
  const scroller = state.scroller;
  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  if (clientY < rect.top + EDGE_SCROLL_ZONE) scroller.scrollTop -= EDGE_SCROLL_SPEED;
  else if (clientY > rect.bottom - EDGE_SCROLL_ZONE) scroller.scrollTop += EDGE_SCROLL_SPEED;
}

interface PdfThumbnailItemProps {
  pageNumber: number;
  width: number;
  isCurrent: boolean;
  isDragging: boolean;
  isReorderable: boolean;
  onSelect: () => void;
  actions: ReactNode;
}

/**
 * One thumbnail. Kept separate so each page gets its own
 * {@link usePdfPageThumbnail} and only the visible ones render.
 */
function PdfThumbnailItem({
  pageNumber,
  width,
  isCurrent,
  isDragging,
  isReorderable,
  onSelect,
  actions,
}: PdfThumbnailItemProps): ReactNode {
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

  const className = ['pdfrx-thumb-item', isCurrent && 'pdfrx-thumb-current', isDragging && 'pdfrx-thumb-item-dragging']
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={itemRef} className={className} data-page-number={pageNumber} data-reorderable={isReorderable || undefined}>
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
