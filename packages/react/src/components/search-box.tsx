import { useRef, type CSSProperties, type ReactNode } from 'react';
import { usePdfSearch } from '../hooks/use-pdf-search.js';
import { IconChevronDown, IconChevronUp, IconClose, IconSearch } from './icons.js';
import { joinClass } from './toolbar-parts.js';

/** Props for {@link PdfSearchBox}. */
export interface PdfSearchBoxProps {
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
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
export function PdfSearchBox({ className, style, placeholder = 'Search' }: PdfSearchBoxProps): ReactNode {
  const { query, setQuery, currentIndex, matchCount, isSearching, goToNext, goToPrevious, reset } = usePdfSearch();
  const inputRef = useRef<HTMLInputElement>(null);

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
            reset();
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
      {hasQuery && (
        <button
          className="pdfrx-button"
          onClick={() => {
            reset();
            inputRef.current?.focus();
          }}
          title="Clear search (Escape)"
        >
          <IconClose />
        </button>
      )}
    </div>
  );
}
