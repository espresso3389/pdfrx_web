/**
 * Interactive text search.
 *
 * Progressively searches page texts, tracks the current match, and asks the
 * viewer to navigate/highlight. Create via `PdfrxViewer.createTextSearcher()`
 * so the viewer paints the match highlights.
 */

import {
  allMatches,
  pdfRectBoundingRect,
  type PdfPageText,
  type PdfRect,
} from '@pdfrx/viewer-core';
import type { PdfrxViewer } from './viewer.js';

/**
 * A single search hit, flattened to the fields the viewer needs to highlight
 * and navigate to a match.
 */
export interface SearchMatch {
  /** 1-based page the match is on. */
  pageNumber: number;
  /** Start index (inclusive) in the page's fullText. */
  start: number;
  /** End index (exclusive). */
  end: number;
  /** Bounding rect in PDF page coordinates. */
  bounds: PdfRect;
}

/** Options for {@link PdfTextSearcher.startTextSearch}. */
export interface StartTextSearchOptions {
  /** Match without regard to case. Default: `true`. */
  caseInsensitive?: boolean;
  /** Navigate to the first match as soon as it is found. Default: `true`. */
  goToFirstMatch?: boolean;
  /** Skip the 500ms debounce used for type-as-you-search. */
  searchImmediately?: boolean;
}

interface SearchCondition {
  pattern: string | RegExp;
  caseInsensitive: boolean;
  goToFirstMatch: boolean;
}

/**
 * Interactive full-text search over a document, with progressive per-page
 * scanning and current-match tracking. Obtain one from
 * {@link PdfrxViewer.createTextSearcher}; the owning viewer paints the match
 * highlights (all matches plus the {@link PdfTextSearcher.currentMatch | current match}
 * in a distinct color) and scrolls to matches as you navigate.
 *
 * @example
 * ```ts
 * const searcher = viewer.createTextSearcher();
 * searcher.addListener(() => updateUi(searcher.currentIndex, searcher.matches.length));
 * searcher.startTextSearch('invoice');   // debounced; highlights + jumps to the first match
 * await searcher.goToNextMatch();
 * ```
 */
export class PdfTextSearcher {
  /** @internal — use {@link PdfrxViewer.createTextSearcher}. */
  constructor(private readonly viewer: PdfrxViewer) {}

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSession = 0;
  private _matches: SearchMatch[] = [];
  private matchesPageStartIndices: number[] = [];
  private lastSearchCondition: SearchCondition | null = null;
  private _currentIndex: number | null = null;
  private _searchingPageNumber: number | null = null;
  private _totalPageCount: number | null = null;
  private _isSearching = false;
  private readonly listeners = new Set<() => void>();

  /** All matches found so far, in page then in-page order. Grows as pages are scanned. */
  get matches(): readonly SearchMatch[] {
    return this._matches;
  }

  /** Index into {@link matches} of the current (active) match, or `null` if none. */
  get currentIndex(): number | null {
    return this._currentIndex;
  }

  /** The current (active, highlighted) match, or `null` if none is selected. */
  get currentMatch(): SearchMatch | null {
    return this._currentIndex !== null ? (this._matches[this._currentIndex] ?? null) : null;
  }

  /** Whether any matches have been found so far. */
  get hasMatches(): boolean {
    return this._matches.length > 0;
  }

  /** Whether a search is still scanning pages. */
  get isSearching(): boolean {
    return this._isSearching;
  }

  /** Scan progress in `[0, 1]` (searched pages / total pages), or `null` before a search starts. */
  get searchProgress(): number | null {
    if (this._totalPageCount === null || this._searchingPageNumber === null) return null;
    return this._searchingPageNumber / this._totalPageCount;
  }

  /**
   * The 1-based page number currently being scanned, or `null` before a search
   * starts. Reaches the last page once scanning completes.
   */
  get searchingPageNumber(): number | null {
    return this._searchingPageNumber;
  }

  /** The pattern of the most recent search, or `null` if none is active. */
  get pattern(): string | RegExp | null {
    return this.lastSearchCondition?.pattern ?? null;
  }

  /**
   * Subscribes to search-state changes (new matches, current-match moves,
   * progress). Fires on the same events that repaint the viewer highlights.
   *
   * @returns An unsubscribe function.
   */
  addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Repaints the viewer highlights and notifies listeners. */
  private notify(): void {
    this.viewer.invalidatePaint();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error('Error in PdfTextSearcher listener:', e);
      }
    }
  }

  /**
   * Starts a new search, cancelling any in-flight one. Debounced by 500ms
   * unless {@link StartTextSearchOptions.searchImmediately} is set, so it is
   * cheap to call on every keystroke. Pages are scanned progressively and
   * {@link matches} grows as they complete; re-searching the identical pattern
   * is a no-op, and an empty pattern resets the search.
   *
   * @param pattern - Literal string or `RegExp` to search for.
   */
  startTextSearch(pattern: string | RegExp, options: StartTextSearchOptions = {}): void {
    this.cancelTextSearch();
    const session = ++this.searchSession;

    const search = (): void => {
      if (isIdenticalPattern(this.lastSearchCondition?.pattern ?? null, pattern)) return;
      const condition: SearchCondition = {
        pattern,
        caseInsensitive: options.caseInsensitive ?? true,
        goToFirstMatch: options.goToFirstMatch ?? true,
      };
      this.lastSearchCondition = condition;
      if (patternIsEmpty(pattern)) {
        this.resetTextSearch();
        return;
      }
      void this.startTextSearchInternal(condition, session);
    };

    if (options.searchImmediately) {
      search();
    } else {
      this.searchTimer = setTimeout(search, 500);
    }
  }

  /** Clears the current matches and pattern, and repaints (notifies listeners). */
  resetTextSearch(): void {
    this.doReset(true, true);
  }

  /**
   * Releases the searcher: cancels any pending search and drops listeners.
   * Called automatically when the owning viewer creates a new searcher or is
   * disposed. Like {@link resetTextSearch} but does not notify listeners.
   */
  dispose(): void {
    this.listeners.clear();
    this.doReset(false, true);
  }

  /** @internal Shared reset used by {@link resetTextSearch} and {@link dispose}. */
  private doReset(notify: boolean, clearSearchCondition: boolean): void {
    this.cancelTextSearch();
    this._matches = [];
    this.matchesPageStartIndices = [];
    this._searchingPageNumber = null;
    this._currentIndex = null;
    this._isSearching = false;
    if (clearSearchCondition) this.lastSearchCondition = null;
    if (notify) this.notify();
  }

  /**
   * @internal
   * Re-runs the current search after the document's pages were rearranged.
   * Matches are keyed by page number, so every one of them is stale; the pattern
   * is kept and re-scanned rather than silently pointing at the wrong pages.
   * The view is not moved, since the user was editing pages, not searching.
   */
  onPagesRearranged(): void {
    const condition = this.lastSearchCondition;
    this.doReset(true, true);
    if (!condition || patternIsEmpty(condition.pattern)) return;
    this.startTextSearch(condition.pattern, {
      caseInsensitive: condition.caseInsensitive,
      goToFirstMatch: false,
      searchImmediately: true,
    });
  }

  /** @internal Cancels the debounce timer and invalidates the running session. */
  private cancelTextSearch(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    ++this.searchSession;
  }

  /** @internal Scans every page for the condition, publishing matches as it goes. */
  private async startTextSearchInternal(condition: SearchCondition, session: number): Promise<void> {
    const doc = this.viewer.document;
    if (!doc) return;
    const matches: SearchMatch[] = [];
    const pageStartIndices: number[] = [];
    let first = true;
    this._isSearching = true;
    this._totalPageCount = doc.pages.length;

    for (const page of doc.pages) {
      this._searchingPageNumber = page.pageNumber;
      if (session !== this.searchSession) return;
      let pageText: PdfPageText | null;
      try {
        pageText = await this.viewer.loadPageText(page.pageNumber);
      } catch {
        pageText = null;
      }
      if (session !== this.searchSession) return;
      pageStartIndices.push(matches.length);
      if (pageText && pageText.fullText.length > 0) {
        for (const m of allMatches(pageText, condition.pattern, { caseInsensitive: condition.caseInsensitive })) {
          matches.push({
            pageNumber: page.pageNumber,
            start: m.start,
            end: m.end,
            bounds: pdfRectBoundingRect(pageText.charRects, m.start, m.end),
          });
        }
      }
      this._matches = matches.slice();
      this.matchesPageStartIndices = pageStartIndices.slice();
      this._isSearching = page.pageNumber < doc.pages.length;
      this.notify();

      if (matches.length > 0 && first) {
        first = false;
        if (condition.goToFirstMatch) {
          void this.goToMatchOfIndex(0);
        }
      }
    }
  }

  /**
   * The `[start, end)` slice of {@link matches} that belongs to a page (1-based),
   * or `null` if the page has not been scanned yet. Used by the viewer to paint
   * per-page highlights.
   */
  getMatchesRangeForPage(pageNumber: number): { start: number; end: number } | null {
    if (this.matchesPageStartIndices.length < pageNumber) return null;
    const start = this.matchesPageStartIndices[pageNumber - 1]!;
    const end =
      this.matchesPageStartIndices.length > pageNumber
        ? this.matchesPageStartIndices[pageNumber]!
        : this._matches.length;
    return { start, end };
  }

  /**
   * Makes the previous match current and scrolls it into view. From no
   * selection, wraps to the last match.
   *
   * @returns The new current index, or `-1` if already at the first match.
   */
  async goToPrevMatch(): Promise<number> {
    if (this._currentIndex === null) {
      return await this.goToMatchOfIndex(this._matches.length - 1);
    }
    if (this._currentIndex > 0) {
      return await this.goToMatchOfIndex(this._currentIndex - 1);
    }
    return -1;
  }

  /**
   * Makes the next match current and scrolls it into view. From no selection,
   * starts at the first match.
   *
   * @returns The new current index, or `-1` if already at the last match.
   */
  async goToNextMatch(): Promise<number> {
    if (this._currentIndex === null) {
      return await this.goToMatchOfIndex(0);
    }
    if (this._currentIndex + 1 < this._matches.length) {
      return await this.goToMatchOfIndex(this._currentIndex + 1);
    }
    return -1;
  }

  /**
   * Makes the match at `index` current and asks the viewer to bring it into
   * view (via {@link PdfrxViewer.ensureVisiblePageRect}).
   *
   * @returns `index`, or `-1` if it is out of range.
   */
  async goToMatchOfIndex(index: number): Promise<number> {
    if (index < 0 || index >= this._matches.length) return -1;
    this._currentIndex = index;
    const match = this._matches[index]!;
    this.viewer.ensureVisiblePageRect(match.pageNumber, match.bounds, 50);
    this.notify();
    return index;
  }
}

function patternIsEmpty(pattern: string | RegExp): boolean {
  return (typeof pattern === 'string' ? pattern : pattern.source).length === 0;
}

function isIdenticalPattern(a: string | RegExp | null, b: string | RegExp | null): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags;
  return a === null && b === null;
}
