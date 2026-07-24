import {
  useEffect,
  useRef,
  type CSSProperties,
  type DragEventHandler,
  type ReactNode,
} from 'react';
import { usePdfrxStore } from './context.js';

/** Props for {@link PdfViewerSurface}. */
export interface PdfViewerSurfaceProps {
  className?: string;
  style?: CSSProperties;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
}

/**
 * The element the viewer paints into — the actual pages, text selection, links
 * and search highlights.
 *
 * This is where the {@link PdfrxViewer} is constructed, so a
 * {@link PdfrxProvider} tree needs **exactly one** of these. It has no
 * intrinsic size: give it one, usually by letting it flex-grow inside a sized
 * parent.
 *
 * @example
 * ```tsx
 * <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
 *   <PdfToolbar />
 *   <PdfViewerSurface style={{ flex: 1, minHeight: 0 }} />
 * </div>
 * ```
 */
export function PdfViewerSurface({ className, style, onDragOver, onDrop }: PdfViewerSurfaceProps): ReactNode {
  const store = usePdfrxStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    store.attach(element);
    return () => store.detach();
  }, [store]);

  return (
    <div
      ref={ref}
      className={className ? `pdfrx-surface ${className}` : 'pdfrx-surface'}
      style={style}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
}
