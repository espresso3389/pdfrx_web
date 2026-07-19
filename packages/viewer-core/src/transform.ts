/**
 * View transform and viewport math.
 *
 * pdfrx stores the view state in a `Matrix4` that only ever contains uniform
 * scale + translation; this port replaces it with an explicit
 * `{zoom, xZoomed, yZoomed}` record. The accessors mirror `PdfMatrix4Ext`
 * (`pdfrx/lib/src/widgets/pdf_viewer.dart`).
 *
 * Conventions (identical to pdfrx):
 * - `xZoomed`/`yZoomed` are the translation applied *after* zoom; i.e. the
 *   view-space position of the document origin.
 * - Document coordinates are unzoomed, y-down, spanning the laid-out document.
 */

import {
  rectCenter,
  rectFromCenter,
  rectFromLTWH,
  rectHeight,
  rectWidth,
  type Offset,
  type Rect,
  type Size,
} from './geometry.js';

/**
 * The view state: uniform scale + translation. Port of the `Matrix4` that
 * pdfrx keeps in the viewer (accessed via `PdfMatrix4Ext`).
 */
export interface ViewTransform {
  /** Uniform scale factor (view pixels per document unit). */
  zoom: number;
  /** View-space x of the document origin, i.e. the post-zoom x translation. */
  xZoomed: number;
  /** View-space y of the document origin, i.e. the post-zoom y translation. */
  yZoomed: number;
}

/** Boundary margins around the document. May contain `Infinity` for unbounded panning. Port of Flutter's `EdgeInsets`. */
export interface EdgeInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** All-zero {@link EdgeInsets}. */
export const edgeInsetsZero: EdgeInsets = { left: 0, top: 0, right: 0, bottom: 0 };

/** Whether any side of `e` is infinite (marks an unbounded/free-panning axis). */
export const edgeInsetsContainsInfinite = (e: EdgeInsets): boolean =>
  !isFinite(e.left) || !isFinite(e.top) || !isFinite(e.right) || !isFinite(e.bottom);

/** Component-wise sum of two {@link EdgeInsets}. */
export const edgeInsetsAdd = (a: EdgeInsets, b: EdgeInsets): EdgeInsets => ({
  left: a.left + b.left,
  top: a.top + b.top,
  right: a.right + b.right,
  bottom: a.bottom + b.bottom,
});

/** Grow a size by the horizontal/vertical insets. Port of `EdgeInsets.inflateSize`. */
export const edgeInsetsInflateSize = (e: EdgeInsets, size: Size): Size => ({
  width: size.width + e.left + e.right,
  height: size.height + e.top + e.bottom,
});

/** Grow a rect outward by the insets. Port of `EdgeInsets.inflateRect`. */
export const edgeInsetsInflateRect = (e: EdgeInsets, r: Rect): Rect => ({
  left: r.left - e.left,
  top: r.top - e.top,
  right: r.right + e.right,
  bottom: r.bottom + e.bottom,
});

/** `inflateRectIfFinite` — infinite components inflate by 0. */
export const edgeInsetsInflateRectIfFinite = (e: EdgeInsets, r: Rect): Rect => ({
  left: r.left - (isFinite(e.left) ? e.left : 0),
  top: r.top - (isFinite(e.top) ? e.top : 0),
  right: r.right + (isFinite(e.right) ? e.right : 0),
  bottom: r.bottom + (isFinite(e.bottom) ? e.bottom : 0),
});

// ---------------------------------------------------------------------------
// ViewTransform accessors (PdfMatrix4Ext port)
// ---------------------------------------------------------------------------

/** Document-space x of the view origin (top-left). Port of `PdfMatrix4Ext.x`. */
export const transformX = (t: ViewTransform): number => t.xZoomed / t.zoom;
/** Document-space y of the view origin (top-left). Port of `PdfMatrix4Ext.y`. */
export const transformY = (t: ViewTransform): number => t.yZoomed / t.zoom;

/** Document position currently shown at the view center. */
export const calcPosition = (t: ViewTransform, viewSize: Size): Offset => ({
  x: (viewSize.width / 2 - t.xZoomed) / t.zoom,
  y: (viewSize.height / 2 - t.yZoomed) / t.zoom,
});

/** Document-space rectangle currently visible in the view. */
export const calcVisibleRect = (t: ViewTransform, viewSize: Size, margin = 0): Rect =>
  rectFromCenter(
    calcPosition(t, viewSize),
    (viewSize.width - margin * 2) / t.zoom,
    (viewSize.height - margin * 2) / t.zoom,
  );

/** View (local) position -> document position. */
export const viewToDocument = (t: ViewTransform, local: Offset): Offset => ({
  x: (local.x - t.xZoomed) / t.zoom,
  y: (local.y - t.yZoomed) / t.zoom,
});

/** Document position -> view (local) position. */
export const documentToView = (t: ViewTransform, doc: Offset): Offset => ({
  x: doc.x * t.zoom + t.xZoomed,
  y: doc.y * t.zoom + t.yZoomed,
});

/** Document rect -> view rect. */
export const documentRectToView = (t: ViewTransform, r: Rect): Rect => ({
  left: r.left * t.zoom + t.xZoomed,
  top: r.top * t.zoom + t.yZoomed,
  right: r.right * t.zoom + t.xZoomed,
  bottom: r.bottom * t.zoom + t.yZoomed,
});

/** Canvas 2D `setTransform(a, b, c, d, e, f)` arguments for this transform. */
export const toCanvasTransform = (t: ViewTransform): [number, number, number, number, number, number] => [
  t.zoom,
  0,
  0,
  t.zoom,
  t.xZoomed,
  t.yZoomed,
];

// ---------------------------------------------------------------------------
// Transform construction — ports of _calcMatrixFor* in _PdfViewerState
// ---------------------------------------------------------------------------

/** `_calcMatrixFor` — center the given document position at the given zoom. */
export const calcTransformFor = (position: Offset, zoom: number, viewSize: Size): ViewTransform => ({
  zoom,
  xZoomed: -position.x * zoom + viewSize.width / 2,
  yZoomed: -position.y * zoom + viewSize.height / 2,
});

/** `_calcMatrixForRect` — fit the given document rect into the view. */
export function calcTransformForRect(
  rect: Rect,
  viewSize: Size,
  options: { zoomMax?: number; margin?: number } = {},
): ViewTransform {
  const margin = options.margin ?? 0;
  let zoom = Math.min(
    (viewSize.width - margin * 2) / rectWidth(rect),
    (viewSize.height - margin * 2) / rectHeight(rect),
  );
  if (options.zoomMax !== undefined && zoom > options.zoomMax) zoom = options.zoomMax;
  return calcTransformFor(rectCenter(rect), zoom, viewSize);
}

/** Anchor inside the view/page used for navigation and underflow alignment. */
export type PdfPageAnchor =
  | 'top'
  | 'left'
  | 'right'
  | 'bottom'
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'centerLeft'
  | 'center'
  | 'centerRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight'
  | 'all';

/** `_calcRectForArea` — the sub-rectangle of `rect` that should be brought into view. */
export function calcRectForArea(rect: Rect, anchor: PdfPageAnchor, visibleSize: Size): Rect {
  const w = Math.min(rectWidth(rect), visibleSize.width);
  const h = Math.min(rectHeight(rect), visibleSize.height);
  const center = rectCenter(rect);
  switch (anchor) {
    case 'top':
      return rectFromLTWH(rect.left, rect.top, rectWidth(rect), h);
    case 'left':
      return rectFromLTWH(rect.left, rect.top, w, rectHeight(rect));
    case 'right':
      return rectFromLTWH(rect.right - w, rect.top, w, rectHeight(rect));
    case 'bottom':
      return rectFromLTWH(rect.left, rect.bottom - h, rectWidth(rect), h);
    case 'topLeft':
      return rectFromLTWH(rect.left, rect.top, visibleSize.width, visibleSize.height);
    case 'topCenter':
      return rectFromLTWH(center.x - w / 2, rect.top, visibleSize.width, visibleSize.height);
    case 'topRight':
      return rectFromLTWH(rect.right - w, rect.top, visibleSize.width, visibleSize.height);
    case 'centerLeft':
      return rectFromLTWH(rect.left, center.y - h / 2, visibleSize.width, visibleSize.height);
    case 'center':
      return rectFromCenter(center, w, h);
    case 'centerRight':
      return rectFromLTWH(rect.right - w, center.y - h / 2, visibleSize.width, visibleSize.height);
    case 'bottomLeft':
      return rectFromLTWH(rect.left, rect.bottom - h, visibleSize.width, visibleSize.height);
    case 'bottomCenter':
      return rectFromLTWH(center.x - w / 2, rect.bottom - h, visibleSize.width, visibleSize.height);
    case 'bottomRight':
      return rectFromLTWH(rect.right - w, rect.bottom - h, visibleSize.width, visibleSize.height);
    case 'all':
      return rect;
  }
}

// ---------------------------------------------------------------------------
// Boundary margins and overscroll clamping
// ---------------------------------------------------------------------------

/**
 * `_splitHorizontalBoundaryExtra` / `_splitVerticalBoundaryExtra` —
 * how underflow (document smaller than view) is distributed to each side.
 */
const splitBoundaryExtra = (extra: number, leadingRatio: number): [number, number] => [
  extra * leadingRatio,
  extra * (1 - leadingRatio),
];

const horizontalLeadingRatio = (anchor: PdfPageAnchor | undefined): number => {
  switch (anchor) {
    case 'left':
    case 'topLeft':
    case 'centerLeft':
    case 'bottomLeft':
      return 0;
    case 'right':
    case 'topRight':
    case 'centerRight':
    case 'bottomRight':
      return 1;
    default:
      return 0.5;
  }
};

const verticalLeadingRatio = (anchor: PdfPageAnchor | undefined): number => {
  switch (anchor) {
    case 'top':
    case 'topLeft':
    case 'topCenter':
    case 'topRight':
      return 0;
    case 'bottom':
    case 'bottomLeft':
    case 'bottomCenter':
    case 'bottomRight':
      return 1;
    default:
      return 0.5;
  }
};

/**
 * `_adjustBoundaryMargins` — expands the configured boundary margin so that a
 * document smaller than the view is aligned per `underflowAnchor`.
 */
export function adjustBoundaryMargins(
  viewSize: Size,
  zoom: number,
  documentSize: Size,
  boundaryMargin: EdgeInsets = edgeInsetsZero,
  underflowAnchor?: PdfPageAnchor,
): EdgeInsets {
  if (edgeInsetsContainsInfinite(boundaryMargin)) return boundaryMargin;

  const currentDocumentSize = edgeInsetsInflateSize(boundaryMargin, documentSize);
  const effectiveWidth = currentDocumentSize.width * zoom;
  const effectiveHeight = currentDocumentSize.height * zoom;
  const extraBoundaryHorizontal = effectiveWidth < viewSize.width ? (viewSize.width - effectiveWidth) / zoom : 0;
  const extraBoundaryVertical = effectiveHeight < viewSize.height ? (viewSize.height - effectiveHeight) / zoom : 0;
  const [leftExtra, rightExtra] = splitBoundaryExtra(extraBoundaryHorizontal, horizontalLeadingRatio(underflowAnchor));
  const [topExtra, bottomExtra] = splitBoundaryExtra(extraBoundaryVertical, verticalLeadingRatio(underflowAnchor));

  return edgeInsetsAdd(boundaryMargin, { left: leftExtra, top: topExtra, right: rightExtra, bottom: bottomExtra });
}

/**
 * `_calcOverscroll` — the document-space offset by which the visible rect
 * exceeds the allowed boundary. Zero when fully inside.
 */
export function calcOverscroll(
  t: ViewTransform,
  viewSize: Size,
  documentSize: Size,
  adjustedBoundaryMargins: EdgeInsets,
): Offset {
  if (edgeInsetsContainsInfinite(adjustedBoundaryMargins)) return { x: 0, y: 0 };

  const visible = calcVisibleRect(t, viewSize);
  let dxDoc = 0;
  let dyDoc = 0;

  const leftBoundary = -adjustedBoundaryMargins.left;
  const rightBoundary = documentSize.width + adjustedBoundaryMargins.right;
  const topBoundary = -adjustedBoundaryMargins.top;
  const bottomBoundary = documentSize.height + adjustedBoundaryMargins.bottom;

  if (rightBoundary - leftBoundary <= rectWidth(visible)) {
    dxDoc = (leftBoundary + rightBoundary - visible.left - visible.right) / 2;
  } else if (visible.left < leftBoundary) {
    dxDoc = leftBoundary - visible.left;
  } else if (visible.right > rightBoundary) {
    dxDoc = rightBoundary - visible.right;
  }

  if (bottomBoundary - topBoundary <= rectHeight(visible)) {
    dyDoc = (topBoundary + bottomBoundary - visible.top - visible.bottom) / 2;
  } else if (visible.top < topBoundary) {
    dyDoc = topBoundary - visible.top;
  } else if (visible.bottom > bottomBoundary) {
    dyDoc = bottomBoundary - visible.bottom;
  }
  return { x: dxDoc, y: dyDoc };
}

/**
 * `_calcMatrixForClampedToNearestBoundary` — translate the candidate transform
 * back inside the allowed boundary. Overscroll is expressed in document
 * coordinates; the Dart code applies `translate(-dx, -dy)` on the matrix,
 * which post-multiplies the scaled space, i.e. `xZoomed -= zoom * dx`.
 */
export function clampToBoundary(
  candidate: ViewTransform,
  viewSize: Size,
  documentSize: Size,
  adjustedBoundaryMargins: EdgeInsets,
): ViewTransform {
  const overscroll = calcOverscroll(candidate, viewSize, documentSize, adjustedBoundaryMargins);
  if (overscroll.x === 0 && overscroll.y === 0) return candidate;
  return {
    zoom: candidate.zoom,
    xZoomed: candidate.xZoomed - overscroll.x * candidate.zoom,
    yZoomed: candidate.yZoomed - overscroll.y * candidate.zoom,
  };
}
