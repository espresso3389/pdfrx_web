/**
 * Interactive text search — port of pdfrx's `PdfTextSearcher`
 * (`pdfrx/lib/src/widgets/pdf_text_searcher.dart`).
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

export interface SearchMatch {
  pageNumber: number;
  /** Start index (inclusive) in the page's fullText. */
  start: number;
  /** End index (exclusive). */
  end: number;
  /** Bounding rect in PDF page coordinates. */
  bounds: PdfRect;
}

export interface StartTextSearchOptions {
  caseInsensitive?: boolean;
  goToFirstMatch?: boolean;
  /** Skip the 500ms debounce used for type-as-you-search. */
  searchImmediately?: boolean;
}

interface SearchCondition {
  pattern: string | RegExp;
  caseInsensitive: boolean;
  goToFirstMatch: boolean;
}

export class PdfTextSearcher {
  /** @internal — use `PdfrxViewer.createTextSearcher()`. */
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

  get matches(): readonly SearchMatch[] {
    return this._matches;
  }

  get currentIndex(): number | null {
    return this._currentIndex;
  }

  get currentMatch(): SearchMatch | null {
    return this._currentIndex !== null ? (this._matches[this._currentIndex] ?? null) : null;
  }

  get hasMatches(): boolean {
    return this._matches.length > 0;
  }

  get isSearching(): boolean {
    return this._isSearching;
  }

  get searchProgress(): number | null {
    if (this._totalPageCount === null || this._searchingPageNumber === null) return null;
    return this._searchingPageNumber / this._totalPageCount;
  }

  get pattern(): string | RegExp | null {
    return this.lastSearchCondition?.pattern ?? null;
  }

  addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

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

  /** Start a new search; debounced by 500ms unless `searchImmediately`. */
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

  resetTextSearch(): void {
    this.doReset(true, true);
  }

  dispose(): void {
    this.listeners.clear();
    this.doReset(false, true);
  }

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

  private cancelTextSearch(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    ++this.searchSession;
  }

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

  /** Matches range `[start, end)` for a page, into `matches`. */
  getMatchesRangeForPage(pageNumber: number): { start: number; end: number } | null {
    if (this.matchesPageStartIndices.length < pageNumber) return null;
    const start = this.matchesPageStartIndices[pageNumber - 1]!;
    const end =
      this.matchesPageStartIndices.length > pageNumber
        ? this.matchesPageStartIndices[pageNumber]!
        : this._matches.length;
    return { start, end };
  }

  async goToPrevMatch(): Promise<number> {
    if (this._currentIndex === null) {
      return await this.goToMatchOfIndex(this._matches.length - 1);
    }
    if (this._currentIndex > 0) {
      return await this.goToMatchOfIndex(this._currentIndex - 1);
    }
    return -1;
  }

  async goToNextMatch(): Promise<number> {
    if (this._currentIndex === null) {
      return await this.goToMatchOfIndex(0);
    }
    if (this._currentIndex + 1 < this._matches.length) {
      return await this.goToMatchOfIndex(this._currentIndex + 1);
    }
    return -1;
  }

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
