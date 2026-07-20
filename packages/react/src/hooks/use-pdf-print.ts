import { useCallback, useState } from 'react';
import { usePdfrxStore } from '../context.js';

/** Print state and action returned by {@link usePdfPrint}. */
export interface PdfPrint {
  /** Renders every page and opens the browser's print dialog. */
  print: (options?: { dpi?: number }) => Promise<void>;
  /** Whether pages are still being rendered for printing. */
  isPrinting: boolean;
  /** The error from the last print attempt, or `null`. */
  error: unknown;
}

/**
 * Printing, with the "still rendering" state a button needs to disable itself.
 *
 * Every page is rasterized before the dialog opens, so a long document takes a
 * noticeable moment; there is no progress reporting and no cancellation.
 *
 * @example
 * ```tsx
 * const { print, isPrinting } = usePdfPrint();
 * return <button onClick={() => void print()} disabled={isPrinting}>Print</button>;
 * ```
 */
export function usePdfPrint(): PdfPrint {
  const store = usePdfrxStore();
  const [isPrinting, setIsPrinting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const print = useCallback(
    async (options?: { dpi?: number }) => {
      const viewer = store.viewer;
      if (!viewer) return;
      setIsPrinting(true);
      setError(null);
      try {
        await viewer.print(options);
      } catch (e) {
        setError(e);
        throw e;
      } finally {
        setIsPrinting(false);
      }
    },
    [store],
  );

  return { print, isPrinting, error };
}
