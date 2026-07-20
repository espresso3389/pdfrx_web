import type { ReactNode } from 'react';

/**
 * The icon set used by the built-in components.
 *
 * Inline SVG rather than an icon font or a dependency: the package stays
 * self-contained, and the strokes inherit `currentColor` so themeing the text
 * colour themes the icons too.
 *
 * @internal
 */
function Icon({ children, label }: { children: ReactNode; label?: string }): ReactNode {
  return (
    <svg
      className="pdfrx-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {children}
    </svg>
  );
}

/** @internal */
export const IconZoomIn = (): ReactNode => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3M11 8v6M8 11h6" />
  </Icon>
);

/** @internal */
export const IconZoomOut = (): ReactNode => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3M8 11h6" />
  </Icon>
);

/** @internal */
export const IconFitPage = (): ReactNode => (
  <Icon>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Icon>
);

/** @internal */
export const IconFitWidth = (): ReactNode => (
  <Icon>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M2 12h3M19 12h3" />
  </Icon>
);

/** @internal */
export const IconPrint = (): ReactNode => (
  <Icon>
    <path d="M6 9V3h12v6M6 18H4v-6a2 2 0 012-2h12a2 2 0 012 2v6h-2" />
    <rect x="6" y="14" width="12" height="7" rx="1" />
  </Icon>
);

/** @internal */
export const IconMenu = (): ReactNode => (
  <Icon>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </Icon>
);

/** @internal */
export const IconSearch = (): ReactNode => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Icon>
);

/** @internal */
export const IconChevronUp = (): ReactNode => (
  <Icon>
    <path d="M6 15l6-6 6 6" />
  </Icon>
);

/** @internal */
export const IconChevronDown = (): ReactNode => (
  <Icon>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

/** @internal */
export const IconChevronRight = (): ReactNode => (
  <Icon>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

/** @internal */
export const IconClose = (): ReactNode => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

/** @internal */
export const IconOpenFile = (): ReactNode => (
  <Icon>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </Icon>
);

/** @internal */
export const IconSave = (): ReactNode => (
  <Icon>
    <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
  </Icon>
);

/** @internal */
export const IconRotate = (): ReactNode => (
  <Icon>
    <path d="M20 12a8 8 0 11-2.6-5.9M20 3v5h-5" />
  </Icon>
);

/** @internal */
export const IconTrash = (): ReactNode => (
  <Icon>
    <path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13" />
  </Icon>
);
