import { useCallback, useEffect, useState } from 'react';
import { usePdfrxStore } from '../context.js';

/** Fullscreen state and actions for the complete viewer app. */
export interface PdfFullscreen {
  readonly isFullscreen: boolean;
  readonly isSupported: boolean;
  /** @returns A promise that resolves after entering fullscreen, or immediately when unsupported. */
  enter(): Promise<void>;
  /** @returns A promise that resolves after leaving fullscreen. */
  exit(): Promise<void>;
  /** @returns A promise that resolves after the fullscreen state has been toggled. */
  toggle(): Promise<void>;
}

/**
 * Controls browser fullscreen, targeting the complete `.pdfrx-app` when present.
 *
 * @returns The current pdf fullscreen state and actions.
 *
 */
export function usePdfFullscreen(): PdfFullscreen {
  const store = usePdfrxStore();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isSupported = typeof document !== 'undefined' && document.fullscreenEnabled;

  useEffect(() => {
    const update = (): void => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', update);
    update();
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const enter = useCallback(async (): Promise<void> => {
    const surface = store.surfaceElement;
    if (!surface || !document.fullscreenEnabled) return;
    const target = surface.closest('.pdfrx-app') ?? surface;
    await target.requestFullscreen();
  }, [store]);

  const exit = useCallback(async (): Promise<void> => {
    if (document.fullscreenElement) await document.exitFullscreen();
  }, []);

  const toggle = useCallback(
    async (): Promise<void> => {
      if (document.fullscreenElement) await exit();
      else await enter();
    },
    [enter, exit],
  );

  return { isFullscreen, isSupported, enter, exit, toggle };
}
