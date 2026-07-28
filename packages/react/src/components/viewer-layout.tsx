import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePdfrxStrings } from '../strings.js';

const NARROW_BREAKPOINT = 780;

export interface PdfViewerLayoutControls {
  readonly isSidebarOpen: boolean;
  readonly toggleSidebar: () => void;
}

export interface PdfViewerLayoutProps {
  className?: string;
  style?: CSSProperties;
  sidebarWidth?: number;
  sidebarSide?: 'left' | 'right';
  toolbar: (controls: PdfViewerLayoutControls) => ReactNode;
  beforeBody?: ReactNode;
  sidebar: (onNavigate: () => void) => ReactNode;
  children: ReactNode;
}

/**
 * Standard responsive viewer chrome used by the ready-made viewer layouts.
 * The sidebar occupies document space on wide screens and becomes an overlay
 * drawer with a scrim below the standard 780px breakpoint.
 * @param __namedParameters - The destructured component props or operation options.
 * @returns The resulting ReactNode.
 *
 */
export function PdfViewerLayout({
  className,
  style,
  sidebarWidth = 190,
  sidebarSide = 'left',
  toolbar,
  beforeBody,
  sidebar,
  children,
}: PdfViewerLayoutProps): ReactNode {
  const strings = usePdfrxStrings();
  const appRef = useRef<HTMLDivElement>(null);
  const isNarrow = useIsNarrow();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const closeDrawer = useCallback(() => {
    if (isNarrow) setIsSidebarOpen(false);
  }, [isNarrow]);
  const sidebarNode = (
    <div className="pdfrx-sidebar-slot" style={{ width: !isNarrow && isSidebarOpen ? sidebarWidth : 0 }}>
      {sidebar(closeDrawer)}
    </div>
  );

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    let ownsNativeGesture = false;
    let ownsMultiTouch = false;
    let touchStartedInside = false;
    const startsInsideApp = (event: Event): boolean => {
      if (!(event.target instanceof Node)) return false;
      if (app.contains(event.target)) return true;
      const element = event.target instanceof Element ? event.target : event.target.parentElement;
      return element?.closest('[data-pdfrx-page-zoom-guard]') != null;
    };
    const preventGesture = (event: Event): void => {
      if (event.type === 'gesturestart') {
        ownsNativeGesture = startsInsideApp(event) || ownsMultiTouch || touchStartedInside;
      }
      if (ownsNativeGesture && event.cancelable) event.preventDefault();
      if (event.type === 'gestureend') ownsNativeGesture = false;
    };
    const preventMultiTouch = (event: TouchEvent): void => {
      if (event.type === 'touchstart') {
        if (event.touches.length === 1) touchStartedInside = startsInsideApp(event);
        if (event.touches.length > 1 && (touchStartedInside || startsInsideApp(event))) {
          ownsMultiTouch = true;
        }
      }
      if (ownsMultiTouch && event.touches.length > 1 && event.cancelable) event.preventDefault();
      if ((event.type === 'touchend' || event.type === 'touchcancel') && event.touches.length < 2) {
        ownsMultiTouch = false;
      }
      if ((event.type === 'touchend' || event.type === 'touchcancel') && event.touches.length === 0) {
        touchStartedInside = false;
      }
    };
    // The engine surface already owns its native pinch. Cover the surrounding
    // React chrome as well so a pinch beginning on a toolbar, popup, sidebar,
    // or scrim cannot become Safari viewport magnification. WebKit may retarget
    // these events to document once the second finger lands, so listen there
    // and retain ownership for the lifetime of a gesture that began in this app.
    document.addEventListener('touchstart', preventMultiTouch, { passive: false, capture: true });
    document.addEventListener('touchmove', preventMultiTouch, { passive: false, capture: true });
    document.addEventListener('touchend', preventMultiTouch, { passive: false, capture: true });
    document.addEventListener('touchcancel', preventMultiTouch, { passive: false, capture: true });
    document.addEventListener('gesturestart', preventGesture, { passive: false, capture: true });
    document.addEventListener('gesturechange', preventGesture, { passive: false, capture: true });
    document.addEventListener('gestureend', preventGesture, { passive: false, capture: true });
    return () => {
      document.removeEventListener('touchstart', preventMultiTouch, { capture: true });
      document.removeEventListener('touchmove', preventMultiTouch, { capture: true });
      document.removeEventListener('touchend', preventMultiTouch, { capture: true });
      document.removeEventListener('touchcancel', preventMultiTouch, { capture: true });
      document.removeEventListener('gesturestart', preventGesture, { capture: true });
      document.removeEventListener('gesturechange', preventGesture, { capture: true });
      document.removeEventListener('gestureend', preventGesture, { capture: true });
    };
  }, []);

  return (
    <div
      ref={appRef}
      className={
        isNarrow ? `pdfrx-app pdfrx-app-narrow ${className ?? ''}`.trim() : `pdfrx-app ${className ?? ''}`.trim()
      }
      style={style}
      data-sidebar-open={isSidebarOpen}
      data-sidebar-side={sidebarSide}
    >
      {toolbar({
        isSidebarOpen,
        toggleSidebar: () => setIsSidebarOpen((open) => !open),
      })}
      {beforeBody}
      <div className="pdfrx-app-body">
        {sidebarSide === 'left' && sidebarNode}
        {children}
        {sidebarSide === 'right' && sidebarNode}
        {isSidebarOpen && isNarrow && (
          <button className="pdfrx-scrim" aria-label={strings.closeSidebar} onClick={() => setIsSidebarOpen(false)} />
        )}
      </div>
    </div>
  );
}

function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`);
    setIsNarrow(query.matches);
    const onChange = (event: MediaQueryListEvent): void => setIsNarrow(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return isNarrow;
}
