import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { usePdfSearch } from '../hooks/use-pdf-search.js';
import { IconChevronDown, IconChevronUp, IconClose, IconSearch } from './icons.js';
import { joinClass } from './toolbar-parts.js';

/** Props for {@link PdfSearchBox}. */
export interface PdfSearchBoxProps {
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  /** Focus the input on mount — e.g. when the box appears from a collapsed toggle. */
  autoFocus?: boolean;
  /**
   * When set, the clear (✕) button dismisses the whole box instead of just
   * clearing the query: it resets the search and then calls this. Used by
   * {@link PdfToolbar} to close its collapsed mobile search row. The button is
   * then always shown (so the box can be closed before anything is typed).
   */
  onClose?: () => void;
}

/**
 * A search field with previous/next buttons and a `3 / 27` counter.
 *
 * Typing starts a debounced search (500 ms) that scans page by page, so the
 * count keeps climbing while the trailing `…` is shown. `Enter` goes to the next
 * match, `Shift+Enter` to the previous one, `Escape` clears.
 *
 * @example
 * ```tsx
 * <PdfrxProvider src="/manual.pdf">
 *   <PdfSearchBox placeholder="Find in document" />
 *   <PdfViewerSurface style={{ flex: 1 }} />
 * </PdfrxProvider>
 * ```
 */
export function PdfSearchBox({
  className,
  style,
  placeholder = 'Search',
  autoFocus = false,
  onClose,
}: PdfSearchBoxProps): ReactNode {
  const { query, setQuery, currentIndex, matchCount, isSearching, goToNext, goToPrevious, reset } = usePdfSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // The ✕ button clears the query; when hosted in a dismissible container it
  // also closes it (and Escape follows suit).
  const clear = (): void => {
    reset();
    if (onClose) onClose();
    else inputRef.current?.focus();
  };

  const hasQuery = query.length > 0;
  const status = hasQuery ? `${(currentIndex ?? -1) + 1} / ${matchCount}${isSearching ? '…' : ''}` : '';

  return (
    <div className={joinClass('pdfrx-search', className)} style={style}>
      <span className="pdfrx-search-icon">
        <IconSearch />
      </span>
      <input
        ref={inputRef}
        className="pdfrx-search-input"
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void (e.shiftKey ? goToPrevious() : goToNext());
          } else if (e.key === 'Escape') {
            clear();
          }
        }}
      />
      {hasQuery && (
        <span className="pdfrx-search-status" aria-live="polite">
          {status}
        </span>
      )}
      <button
        className="pdfrx-button"
        onClick={() => void goToPrevious()}
        disabled={matchCount === 0}
        title="Previous match (Shift+Enter)"
      >
        <IconChevronUp />
      </button>
      <button
        className="pdfrx-button"
        onClick={() => void goToNext()}
        disabled={matchCount === 0}
        title="Next match (Enter)"
      >
        <IconChevronDown />
      </button>
      {(hasQuery || onClose) && (
        <button
          className="pdfrx-button"
          onClick={clear}
          title={onClose ? 'Close search' : 'Clear search (Escape)'}
          aria-label={onClose ? 'Close search' : 'Clear search'}
        >
          <IconClose />
        </button>
      )}
    </div>
  );
}
