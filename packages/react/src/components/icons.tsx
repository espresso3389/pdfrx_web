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
    <rect x="4" y="5" width="16" height="14" rx="1" />
    <path d="M7 12h10M7 12l3-3M7 12l3 3M17 12l-3-3M17 12l-3 3" />
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
export const IconTextSize = (): ReactNode => (
  <Icon>
    <path d="M3.5 19L8.5 5l5 14M5.5 14h6" />
    <path d="M18.5 6v12M16.5 8l2-2 2 2M16.5 16l2 2 2-2" />
  </Icon>
);

/** @internal */
export const IconOpenFile = (): ReactNode => (
  <Icon>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </Icon>
);

/** @internal Add an image annotation. */
export const IconImage = (): ReactNode => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9" r="1.5" />
    <path d="M4 17l5-5 3.5 3.5 2.5-2.5 5 5" />
  </Icon>
);

/** @internal */
export const IconSave = (): ReactNode => (
  <Icon>
    <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
  </Icon>
);

/** @internal Annotate toggle: a freehand scribble. */
export const IconAnnotate = (): ReactNode => (
  <Icon>
    <path d="M3 16C5 7 7.5 6 9.5 9c2 3 1.5 8 4 8s2-9 4.5-9c2 0 2.5 4 3 6" />
  </Icon>
);

/** @internal Text-selection mode: an I-beam cursor. */
export const IconCursorText = (): ReactNode => (
  <Icon>
    <path d="M9 5c2 0 3 .8 3 2 0-1.2 1-2 3-2M9 19c2 0 3-.8 3-2 0 1.2 1 2 3 2M12 7v10" />
  </Icon>
);

/** @internal Object-select mode: a marquee with a pointer. */
export const IconSelectObject = (): ReactNode => (
  <Icon>
    <rect x="4" y="4" width="11" height="11" rx="1" strokeDasharray="3 2.5" />
    <path d="M13.5 13.5l7 2.6-3.1 1.3-1.3 3.1z" />
  </Icon>
);

/** @internal Freehand pen tool. */
export const IconPen = (): ReactNode => (
  <Icon>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17z" />
    <path d="M14.5 7.5l3 3" />
  </Icon>
);

/** @internal Rectangle tool. */
export const IconRectangle = (): ReactNode => (
  <Icon>
    <rect x="4" y="6" width="16" height="12" rx="1" />
  </Icon>
);

/** @internal Ellipse tool. */
export const IconEllipse = (): ReactNode => (
  <Icon>
    <ellipse cx="12" cy="12" rx="8" ry="6" />
  </Icon>
);

/** @internal Line tool. */
export const IconLine = (): ReactNode => (
  <Icon>
    <path d="M5 19L19 5" />
  </Icon>
);

/** @internal Arrow tool. */
export const IconArrowTool = (): ReactNode => (
  <Icon>
    <path d="M5 19L19 5M19 5h-6.5M19 5v6.5" />
  </Icon>
);

/** @internal Note (comment bubble) tool. */
export const IconNote = (): ReactNode => (
  <Icon>
    <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2h-7l-4 4v-4H6a2 2 0 01-2-2z" />
  </Icon>
);

/** @internal Text box tool. */
export const IconTextBox = (): ReactNode => (
  <Icon>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M9 9.5h6M12 9.5V15" />
  </Icon>
);

/** @internal Highlighter (text-markup) — kept for apps that opt the tool in. */
export const IconHighlighter = (): ReactNode => (
  <Icon>
    <path d="M15 4l5 5-8.5 8.5H7V13z" />
    <path d="M4 20h7" />
  </Icon>
);

/** @internal Annotation opacity. */
export const IconOpacity = (): ReactNode => (
  <Icon>
    <path d="M12 3C9 7 6 10.2 6 14a6 6 0 0012 0c0-3.8-3-7-6-11z" />
    <path d="M8.5 15.5a3.8 3.8 0 003.5 2.3" />
  </Icon>
);

/** @internal Annotation stroke thickness. */
export const IconThickness = (): ReactNode => (
  <Icon>
    <rect x="4" y="5" width="16" height="1" rx="0.5" fill="currentColor" stroke="none" />
    <rect x="4" y="10" width="16" height="2" rx="1" fill="currentColor" stroke="none" />
    <rect x="4" y="16" width="16" height="3" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
);

/** @internal Undo. */
export const IconUndo = (): ReactNode => (
  <Icon>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 015.5 5.5V19" />
  </Icon>
);

/** @internal Redo. */
export const IconRedo = (): ReactNode => (
  <Icon>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5A5.5 5.5 0 004 14.5V19" />
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

/** @internal */
export const IconPlus = (): ReactNode => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
