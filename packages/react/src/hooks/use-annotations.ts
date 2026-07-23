import type { PdfAnnotationObject, PdfAnnotationSpec } from '@pdfrx/engine';
import { useCallback, useEffect, useState } from 'react';
import { usePdfrxViewer } from './use-pdfrx-viewer.js';
import { useDocumentGeneration } from './use-document-generation.js';

/** Annotation state returned by {@link useAnnotations}. */
export interface PdfAnnotationsState {
  /** All content annotations of the document, `[]` when there are none. */
  annotations: readonly PdfAnnotationObject[];
  /** Whether the annotations are being loaded. */
  isLoading: boolean;
  /** Creates an annotation on `pageNumber` (1-based); resolves to its id. */
  add: (pageNumber: number, spec: PdfAnnotationSpec) => Promise<string | undefined>;
  /** Replaces the annotation `id` with a fresh one built from `spec`. */
  update: (pageNumber: number, id: string, spec: PdfAnnotationSpec) => Promise<string | undefined>;
  /** Removes the annotation `id` from `pageNumber`. */
  remove: (pageNumber: number, id: string) => Promise<void>;
  /** Forces a reload of the annotation list. */
  reload: () => void;
}

/**
 * The document's annotations, reloaded whenever the document changes and
 * whenever an annotation is added/updated/removed — from these methods or from
 * the user editing in the viewer (the `annotationsChanged` event).
 *
 * @example
 * ```tsx
 * const { annotations, add } = useAnnotations();
 * // draw a red rectangle on page 1
 * await add(1, { subtype: 'square', rect: { left: 50, top: 700, right: 200, bottom: 640 },
 *                color: { r: 220, g: 30, b: 30, a: 255 }, borderWidth: 2 });
 * ```
 */
export function useAnnotations(): PdfAnnotationsState {
  const viewer = usePdfrxViewer();
  const generation = useDocumentGeneration();
  const [annotations, setAnnotations] = useState<readonly PdfAnnotationObject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const doc = viewer?.document ?? null;

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    if (!doc) {
      setAnnotations([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const load = (): void => {
      setIsLoading(true);
      void doc
        .loadAnnotations()
        .then((a) => {
          if (!cancelled) {
            setAnnotations(a);
            setIsLoading(false);
          }
        })
        .catch((e: unknown) => {
          console.error('Failed to load annotations:', e);
          if (!cancelled) {
            setAnnotations([]);
            setIsLoading(false);
          }
        });
    };
    load();
    const unsubscribe = doc.addEventListener('annotationsChanged', () => {
      if (!cancelled) load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [doc, viewer, generation, reloadNonce]);

  const add = useCallback(
    async (pageNumber: number, spec: PdfAnnotationSpec): Promise<string | undefined> =>
      doc?.pages[pageNumber - 1]?.addAnnotation(spec),
    [doc],
  );
  const update = useCallback(
    async (pageNumber: number, id: string, spec: PdfAnnotationSpec): Promise<string | undefined> =>
      doc?.pages[pageNumber - 1]?.updateAnnotation(id, spec),
    [doc],
  );
  const remove = useCallback(
    async (pageNumber: number, id: string): Promise<void> => {
      await doc?.pages[pageNumber - 1]?.removeAnnotation(id);
    },
    [doc],
  );
  return { annotations, isLoading, add, update, remove, reload };
}
