import { type CSSProperties, type ReactNode } from 'react';
import { usePdfrxViewer } from '../hooks/use-pdfrx-viewer.js';
import { usePdfrxStrings } from '../strings.js';
import { IconRotate, IconTrash } from './icons.js';

export type PdfPageRotationDelta = 90 | 180 | 270;

export interface PdfPageActionsProps {
  /** 1-based page number to edit. */
  pageNumber: number;
  /** Rotation choices to render, clockwise. Defaults to `[90]`. */
  rotationDeltas?: readonly PdfPageRotationDelta[];
  /** Overrides the built-in local viewer mutation, e.g. to submit a collaboration command. */
  onRotatePage?: (pageNumber: number, delta: PdfPageRotationDelta) => void;
  /** Overrides the built-in local viewer mutation, e.g. to submit a collaboration command. */
  onDeletePage?: (pageNumber: number) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Reusable rotate/delete controls for one page, controllable by collaborative applications. */
export function PdfPageActions({
  pageNumber,
  rotationDeltas = DEFAULT_ROTATIONS,
  onRotatePage,
  onDeletePage,
  disabled = false,
  className,
  style,
}: PdfPageActionsProps): ReactNode {
  const viewer = usePdfrxViewer();
  const strings = usePdfrxStrings();
  const document = viewer?.document;
  const page = document?.pages[pageNumber - 1];
  const rotationLabel = (delta: PdfPageRotationDelta): string =>
    delta === 90 ? strings.rotatePage : delta === 180 ? strings.rotatePage180 : strings.rotatePageCounterclockwise;

  const rotate = (delta: PdfPageRotationDelta): void => {
    if (onRotatePage) {
      onRotatePage(pageNumber, delta);
      return;
    }
    // Page replacement does not remount these controls. Resolve the page at
    // click time so repeated rotations build on the latest replacement rather
    // than repeatedly rotating the page captured by the initial render.
    const currentPage = viewer?.document?.pages[pageNumber - 1];
    if (currentPage) viewer.setPage(pageNumber, currentPage.rotatedBy(delta));
  };
  const remove = (): void => {
    if (onDeletePage) {
      onDeletePage(pageNumber);
      return;
    }
    if (!document || document.pages.length <= 1) return;
    viewer?.setPages(document.pages.filter((item) => item.pageNumber !== pageNumber));
  };

  return (
    <span className={['pdfrx-page-actions', className].filter(Boolean).join(' ')} style={style}>
      {rotationDeltas.map((delta) => (
        <button
          key={delta}
          type="button"
          className="pdfrx-button"
          disabled={disabled || !page}
          onClick={() => rotate(delta)}
          title={rotationLabel(delta)}
          aria-label={rotationLabel(delta)}
        >
          {delta === 180 ? <span aria-hidden="true">180°</span> : <span style={delta === 270 ? { transform: 'scaleX(-1)' } : undefined}><IconRotate /></span>}
        </button>
      ))}
      <button
        type="button"
        className="pdfrx-button pdfrx-danger"
        disabled={disabled || !page || (document?.pages.length ?? 0) <= 1}
        onClick={remove}
        title={strings.deletePage}
        aria-label={strings.deletePage}
      >
        <IconTrash />
      </button>
    </span>
  );
}

const DEFAULT_ROTATIONS: readonly PdfPageRotationDelta[] = [90];
