import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePdfDocument } from '../hooks/use-pdf-document.js';
import { usePdfNavigation } from '../hooks/use-pdf-navigation.js';
import { usePdfPrint } from '../hooks/use-pdf-print.js';
import { usePdfZoom } from '../hooks/use-pdf-zoom.js';
import { usePdfrxStrings } from '../strings.js';
import { IconFitPage, IconFitWidth, IconPrint, IconZoomIn, IconZoomOut } from './icons.js';

/** Props shared by the small toolbar pieces. */
export interface PdfControlProps {
  className?: string;
  style?: CSSProperties;
}

/** A "page / total" button that opens page-number and slider navigation. */
export function PdfPageIndicator({ className, style }: PdfControlProps): ReactNode {
  const { currentPageNumber, pageCount, goToPage } = usePdfNavigation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Leave the user's half-typed value alone; otherwise track the viewer.
  useEffect(() => {
    setDraft(null);
  }, [currentPageNumber]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    const onDown = (event: PointerEvent): void => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const strings = usePdfrxStrings();

  const commit = (close = false): void => {
    const parsed = Number(draft);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= pageCount) goToPage(parsed, 200);
    setDraft(null);
    if (close) setOpen(false);
  };

  if (pageCount === 0) return null;
  const current = currentPageNumber ?? 1;
  const parsedDraft = Number(draft);
  const sliderPage =
    Number.isInteger(parsedDraft) && parsedDraft >= 1 && parsedDraft <= pageCount ? parsedDraft : current;
  return (
    <span ref={hostRef} className={joinClass('pdfrx-page-indicator', className)} style={style}>
      <button
        type="button"
        className="pdfrx-page-trigger"
        aria-label={strings.pageNumber}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{current}</span>
        <span className="pdfrx-page-total">/ {pageCount}</span>
      </button>
      {open && (
        <div className="pdfrx-page-popup" role="dialog" aria-label={strings.pageNumber}>
          <div className="pdfrx-page-popup-row">
            <input
              ref={inputRef}
              className="pdfrx-page-input"
              type="text"
              inputMode="numeric"
              aria-label={strings.pageNumber}
              value={draft ?? String(current)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit(true);
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setDraft(null);
                  setOpen(false);
                }
              }}
            />
            <span className="pdfrx-page-total">/ {pageCount}</span>
          </div>
          <input
            className="pdfrx-page-slider"
            type="range"
            min={1}
            max={pageCount}
            step={1}
            value={sliderPage}
            aria-label={strings.pageNumber}
            onChange={(event) => {
              const page = Number(event.target.value);
              setDraft(String(page));
              goToPage(page, 0);
            }}
          />
        </div>
      )}
    </span>
  );
}

/** Zoom out / current percentage / zoom in, plus fit-page and fit-width buttons. */
export function PdfZoomControls({ className, style }: PdfControlProps): ReactNode {
  const { zoom, zoomMode, zoomIn, zoomOut, canZoomIn, canZoomOut, fitToPage, fitToWidth } = usePdfZoom();
  const strings = usePdfrxStrings();
  return (
    <span className={joinClass('pdfrx-zoom-controls', className)} style={style}>
      <button className="pdfrx-button" onClick={() => zoomOut()} disabled={!canZoomOut} title={strings.zoomOut}>
        <IconZoomOut />
      </button>
      <span className="pdfrx-zoom-value">{Math.round(zoom * 100)}%</span>
      <button className="pdfrx-button" onClick={() => zoomIn()} disabled={!canZoomIn} title={strings.zoomIn}>
        <IconZoomIn />
      </button>
      <button
        className={joinClass(
          'pdfrx-button pdfrx-fit-page-button',
          zoomMode === 'page' ? 'pdfrx-button-active' : undefined,
        )}
        onClick={() => fitToPage(undefined, 200)}
        title={strings.fitPage}
        aria-pressed={zoomMode === 'page'}
      >
        <IconFitPage />
      </button>
      <button
        className={joinClass(
          'pdfrx-button pdfrx-fit-width-button',
          zoomMode === 'width' ? 'pdfrx-button-active' : undefined,
        )}
        onClick={() => fitToWidth(undefined, 200)}
        title={strings.fitWidth}
        aria-pressed={zoomMode === 'width'}
      >
        <IconFitWidth />
      </button>
    </span>
  );
}

/** A print button that disables itself while pages are being rasterized. */
export function PdfPrintButton({ className, style }: PdfControlProps): ReactNode {
  const { print, isPrinting } = usePdfPrint();
  const { pageCount } = usePdfDocument();
  const strings = usePdfrxStrings();
  return (
    <button
      className={joinClass('pdfrx-button', className)}
      style={style}
      onClick={() => void print()}
      disabled={isPrinting || pageCount === 0}
      title={isPrinting ? strings.preparingToPrint : strings.print}
    >
      <IconPrint />
    </button>
  );
}

/**
 * A thin progress bar across the top while a document downloads. Renders
 * nothing when idle, and becomes indeterminate when the server sends no
 * `Content-Length`.
 */
export function PdfLoadingBar({ className, style }: PdfControlProps): ReactNode {
  const { isLoading, progress } = usePdfDocument();
  if (!isLoading) return null;
  const ratio = progress?.bytesTotal ? progress.bytesReceived / progress.bytesTotal : null;
  return (
    <div
      className={joinClass('pdfrx-loading-bar', className)}
      style={style}
      role="progressbar"
      aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
    >
      <div
        className={ratio === null ? 'pdfrx-loading-fill pdfrx-loading-indeterminate' : 'pdfrx-loading-fill'}
        style={ratio === null ? undefined : { width: `${ratio * 100}%` }}
      />
    </div>
  );
}

/** @internal Joins a built-in class name with a caller-supplied one. */
export function joinClass(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}
