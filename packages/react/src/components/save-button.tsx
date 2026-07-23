import { useState, type CSSProperties, type ReactNode } from 'react';
import { usePdfDocument } from '../hooks/use-pdf-document.js';
import { usePdfrxViewer } from '../hooks/use-pdfrx-viewer.js';
import { usePdfrxStrings } from '../strings.js';
import { IconSave } from './icons.js';
import type { PdfDocument } from '@pdfrx/engine';

/** Props for {@link PdfSaveButton}. */
export interface PdfSaveButtonProps {
  className?: string;
  style?: CSSProperties;
  /** Overrides the download file name (without needing the source name). */
  fileName?: string;
  /** Custom label/children; defaults to a save icon. */
  children?: ReactNode;
  /** Overrides serialization, for example to merge collaboration document structures. */
  encode?: (document: PdfDocument) => Promise<Uint8Array>;
}

/**
 * Serializes a temporary copy of the current document — including any
 * annotation, form, and page edits — and downloads it as a PDF without materializing
 * the live document's page arrangement or invalidating its editing history.
 */
export function PdfSaveButton({ className, style, fileName, children, encode }: PdfSaveButtonProps): ReactNode {
  const viewer = usePdfrxViewer();
  const { pageCount, sourceName } = usePdfDocument();
  const strings = usePdfrxStrings();
  const [isSaving, setIsSaving] = useState(false);

  const save = async (): Promise<void> => {
    const doc = viewer?.document;
    if (!doc) return;
    setIsSaving(true);
    try {
      await viewer.flushAnnotationTextEdit();
      const data = encode ? await encode(doc) : await doc.encodePdfCopy();
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' }));
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = fileName ?? downloadName(sourceName);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to save the document:', e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <button
      type="button"
      className={['pdfrx-button', className].filter(Boolean).join(' ')}
      style={style}
      onClick={() => void save()}
      disabled={isSaving || pageCount === 0}
      title={strings.download}
      aria-label={strings.download}
    >
      {children ?? <IconSave />}
    </button>
  );
}

/** `sourceName` may be a file name or a `uri%https://host/dir/file.pdf` form. */
function downloadName(sourceName: string | null): string {
  const base =
    (sourceName ?? '')
      .split(/[/\\]/)
      .pop()
      ?.split('?')[0]
      ?.replace(/\.pdf$/i, '') || 'document';
  return `${base}.pdf`;
}
