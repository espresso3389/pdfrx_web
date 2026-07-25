import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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

  return (
    <div
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
