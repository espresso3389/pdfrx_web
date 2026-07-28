import type { CSSProperties, ReactNode } from 'react';
import { usePdfFullscreen } from '../hooks/use-pdf-fullscreen.js';
import { usePdfrxStrings } from '../strings.js';
import { IconExitFullscreen, IconFullscreen } from './icons.js';
import { joinClass } from './toolbar-parts.js';

/** Props for {@link PdfFullscreenButton}. */
export interface PdfFullscreenButtonProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Standard button for entering and exiting browser fullscreen.
 *
 * @param __namedParameters - The destructured component props or operation options.
 * @returns The resulting ReactNode.
 *
 */
export function PdfFullscreenButton({ className, style }: PdfFullscreenButtonProps): ReactNode {
  const { isFullscreen, isSupported, toggle } = usePdfFullscreen();
  const strings = usePdfrxStrings();
  if (!isSupported) return null;
  const label = isFullscreen ? strings.exitFullscreen : strings.enterFullscreen;
  return (
    <button
      type="button"
      className={joinClass('pdfrx-button', className)}
      style={style}
      onClick={() => void toggle()}
      title={label}
      aria-label={label}
      aria-pressed={isFullscreen}
    >
      {isFullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
    </button>
  );
}
