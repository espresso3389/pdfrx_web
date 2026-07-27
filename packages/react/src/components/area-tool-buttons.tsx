import type { PdfCaptureOptions } from '@pdfrx/viewer';
import { useState, type ReactNode } from 'react';
import { usePdfrxViewer } from '../hooks/use-pdfrx-viewer.js';
import { usePdfrxStrings } from '../strings.js';
import { IconCapture, IconZoomArea } from './icons.js';

/** Props for {@link PdfCaptureAreaButton}. */
export interface PdfCaptureAreaButtonProps {
  options?: PdfCaptureOptions;
  /** Receives the captured image. Omit to download it as `capture.png`. */
  onCapture?: (blob: Blob) => void | Promise<void>;
}

/** Selects and renders a rectangular page area. Escape cancels the selection. */
export function PdfCaptureAreaButton({ options, onCapture }: PdfCaptureAreaButtonProps): ReactNode {
  const viewer = usePdfrxViewer();
  const strings = usePdfrxStrings();
  const [active, setActive] = useState(false);
  const run = async (): Promise<void> => {
    if (!viewer || active) return;
    setActive(true);
    try {
      const area = await viewer.selectPageArea();
      if (!area) return;
      const blob = await viewer.capturePageArea(area.pageNumber, area.rect, options);
      if (onCapture) await onCapture(blob);
      else downloadBlob(blob, extensionFor(blob.type));
    } finally {
      setActive(false);
    }
  };
  return (
    <button
      type="button"
      className={`pdfrx-button${active ? ' pdfrx-button-active' : ''}`}
      onClick={() => void run()}
      disabled={!viewer}
      aria-pressed={active}
      title={strings.captureArea}
      aria-label={strings.captureArea}
    >
      <IconCapture />
    </button>
  );
}

/** Selects a rectangular page area and zooms it to the viewport. */
export function PdfMarqueeZoomButton(): ReactNode {
  const viewer = usePdfrxViewer();
  const strings = usePdfrxStrings();
  const [active, setActive] = useState(false);
  const run = async (): Promise<void> => {
    if (!viewer || active) return;
    setActive(true);
    try {
      const area = await viewer.selectPageArea();
      if (area) viewer.zoomToPageArea(area.pageNumber, area.rect, 200);
    } finally {
      setActive(false);
    }
  };
  return (
    <button
      type="button"
      className={`pdfrx-button${active ? ' pdfrx-button-active' : ''}`}
      onClick={() => void run()}
      disabled={!viewer}
      aria-pressed={active}
      title={strings.zoomToArea}
      aria-label={strings.zoomToArea}
    >
      <IconZoomArea />
    </button>
  );
}

function extensionFor(type: string): string {
  return type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
}

function downloadBlob(blob: Blob, extension: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `capture.${extension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
