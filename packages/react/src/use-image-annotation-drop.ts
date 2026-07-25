import { useCallback, type DragEventHandler } from 'react';
import { addDroppedImageAnnotation } from './annotation-image.js';
import { usePdfrxStore } from './context.js';
import { dragMayContainImage, isImageFile } from './file-open.js';
import { usePdfrxViewer } from './hooks/use-pdfrx-viewer.js';

/** Options for {@link useImageAnnotationDrop}. */
export interface UseImageAnnotationDropOptions {
  /** Disables both handlers while preserving their identities. Defaults to `true`. */
  readonly enabled?: boolean;
  /** Receives image decoding or annotation insertion failures. */
  readonly onError?: (error: unknown, file: File) => void;
}

/** Drop handlers that can be spread onto {@link PdfViewerSurface}. */
export interface ImageAnnotationDropHandlers {
  readonly onDragOver: DragEventHandler<HTMLDivElement>;
  readonly onDrop: DragEventHandler<HTMLDivElement>;
}

/**
 * Supplies the standard drop-to-insert image annotation behavior for a
 * composed viewer.
 *
 * The hook classifies image files, hit-tests the canvas in PDF coordinates,
 * and creates a stamp annotation centered at the drop point. Annotation change
 * listeners observe the resulting mutation normally, allowing applications to
 * attach their own persistence or other post-processing.
 */
export function useImageAnnotationDrop(
  options: UseImageAnnotationDropOptions = {},
): ImageAnnotationDropHandlers {
  const { enabled = true, onError } = options;
  const viewer = usePdfrxViewer();
  const store = usePdfrxStore();

  const onDragOver = useCallback<DragEventHandler<HTMLDivElement>>((event) => {
    if (!enabled || !dragMayContainImage(event.dataTransfer.items, event.dataTransfer.files)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, [enabled]);

  const onDrop = useCallback<DragEventHandler<HTMLDivElement>>((event) => {
    if (!enabled || !viewer) return;
    const file = Array.from(event.dataTransfer.files).find(isImageFile);
    if (!file) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const hit = viewer.getPageHitTestResult({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
    if (!hit) return;
    void addDroppedImageAnnotation(hit.page, file, hit.pdfPoint, store.imageDecoder)
      .catch((error: unknown) => onError?.(error, file));
  }, [enabled, onError, store, viewer]);

  return { onDragOver, onDrop };
}
