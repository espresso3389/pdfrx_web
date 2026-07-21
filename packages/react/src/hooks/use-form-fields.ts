import type { PdfFormField, PdfFormFieldValue } from '@pdfrx/engine';
import { useCallback, useEffect, useState } from 'react';
import { usePdfrxViewer } from './use-pdfrx-viewer.js';
import { useDocumentGeneration } from './use-document-generation.js';

/** Form-field state returned by {@link useFormFields}. */
export interface PdfFormFieldsState {
  /** All AcroForm fields of the document (grouped by name), `[]` when there are none. */
  fields: readonly PdfFormField[];
  /** Whether the fields are being loaded. */
  isLoading: boolean;
  /**
   * Sets a field's value (see {@link PdfFormFieldValue}). The change is applied
   * through the form-fill module, re-renders the affected page, and refreshes
   * {@link fields} via the document's `formFieldsChanged` event.
   */
  setValue: (name: string, value: PdfFormFieldValue) => Promise<void>;
  /** Forces a reload of the field list. */
  reload: () => void;
}

/**
 * The document's AcroForm fields, reloaded whenever the document changes and
 * whenever a value changes — from {@link PdfFormFieldsState.setValue} or from
 * the user editing a field directly in the viewer.
 *
 * @example
 * ```tsx
 * const { fields, setValue } = useFormFields();
 * return fields.map((f) =>
 *   f.type === 'checkBox' ? (
 *     <label key={f.name}>
 *       <input type="checkbox" checked={!!f.isChecked}
 *              onChange={(e) => setValue(f.name, e.target.checked)} />
 *       {f.name}
 *     </label>
 *   ) : (
 *     <input key={f.name} value={f.value}
 *            onChange={(e) => setValue(f.name, e.target.value)} />
 *   ),
 * );
 * ```
 */
export function useFormFields(): PdfFormFieldsState {
  const viewer = usePdfrxViewer();
  const generation = useDocumentGeneration();
  const [fields, setFields] = useState<readonly PdfFormField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const doc = viewer?.document ?? null;

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    if (!doc) {
      setFields([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const load = (): void => {
      setIsLoading(true);
      void doc
        .loadFormFields()
        .then((f) => {
          if (!cancelled) {
            setFields(f);
            setIsLoading(false);
          }
        })
        .catch((e: unknown) => {
          console.error('Failed to load form fields:', e);
          if (!cancelled) {
            setFields([]);
            setIsLoading(false);
          }
        });
    };
    load();
    const unsubscribe = doc.addEventListener('formFieldsChanged', () => {
      if (!cancelled) load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [doc, generation, reloadNonce]);

  const setValue = useCallback(
    async (name: string, value: PdfFormFieldValue): Promise<void> => {
      await doc?.setFormFieldValue(name, value);
    },
    [doc],
  );

  return { fields, isLoading, setValue, reload };
}
