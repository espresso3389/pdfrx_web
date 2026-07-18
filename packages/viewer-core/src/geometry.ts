/**
 * Geometry primitives and coordinate conversions.
 *
 * Two coordinate spaces are used, mirroring pdfrx:
 *
 * - **View/document space** (`Offset`/`Rect`): y-down, like Flutter/Canvas.
 *   "Document" coordinates are the unzoomed coordinates of the whole laid-out
 *   document (all pages).
 * - **PDF page space** (`PdfPoint`/`PdfRect`): y-up, origin at the bottom-left
 *   of the page, in points (1/72 inch). `PdfRect.top >= PdfRect.bottom`.
 *
 * All types are plain JSON-serializable objects so that test vectors can be
 * shared with the Dart implementation.
 *
 * Dart counterparts: `pdfrx_engine/lib/src/pdf_rect.dart`, `pdf_point.dart`,
 * and the conversion extensions in `pdfrx/lib/src/pdfrx_flutter.dart`.
 */

export interface Offset {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Rectangle in y-down (view/document) coordinates. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Point in PDF page coordinates (y-up). */
export interface PdfPoint {
  x: number;
  y: number;
}

/** Rectangle in PDF page coordinates (y-up; `top >= bottom`). */
export interface PdfRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The geometry of a page needed for coordinate conversions.
 *
 * `width`/`height` are the *visual* (already rotation-applied) page size in
 * points, exactly like pdfrx's `PdfPage.width`/`height`. `rotation` is the
 * page's own rotation in 90-degree steps (0-3).
 */
export interface PageGeometry {
  width: number;
  height: number;
  rotation: number;
}

// ---------------------------------------------------------------------------
// Rect (y-down) helpers
// ---------------------------------------------------------------------------

export const rectFromLTWH = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

export const rectFromCenter = (center: Offset, width: number, height: number): Rect => ({
  left: center.x - width / 2,
  top: center.y - height / 2,
  right: center.x + width / 2,
  bottom: center.y + height / 2,
});

export const rectWidth = (r: Rect): number => r.right - r.left;
export const rectHeight = (r: Rect): number => r.bottom - r.top;
export const rectSize = (r: Rect): Size => ({ width: rectWidth(r), height: rectHeight(r) });
export const rectCenter = (r: Rect): Offset => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

export const rectContains = (r: Rect, p: Offset): boolean =>
  p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom;

export const rectContainsRect = (r: Rect, other: Rect): boolean =>
  rectContains(r, { x: other.left, y: other.top }) && rectContains(r, { x: other.right, y: other.bottom });

export const rectOverlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export const rectTranslate = (r: Rect, dx: number, dy: number): Rect => ({
  left: r.left + dx,
  top: r.top + dy,
  right: r.right + dx,
  bottom: r.bottom + dy,
});

export const rectInflate = (r: Rect, dx: number, dy = dx): Rect => ({
  left: r.left - dx,
  top: r.top - dy,
  right: r.right + dx,
  bottom: r.bottom + dy,
});

export const rectIntersect = (a: Rect, b: Rect): Rect => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
});

export const rectIsEmpty = (r: Rect): boolean => r.left >= r.right || r.top >= r.bottom;

// ---------------------------------------------------------------------------
// PdfRect (y-up) helpers — ports of PdfRect in pdfrx_engine
// ---------------------------------------------------------------------------

export const pdfRectIsEmpty = (r: PdfRect): boolean => r.left >= r.right || r.top <= r.bottom;
export const pdfRectWidth = (r: PdfRect): number => r.right - r.left;
export const pdfRectHeight = (r: PdfRect): number => r.top - r.bottom;
export const pdfRectCenter = (r: PdfRect): PdfPoint => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

export const pdfRectMerge = (a: PdfRect, b: PdfRect): PdfRect => ({
  left: Math.min(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
});

export const pdfRectContainsXy = (r: PdfRect, x: number, y: number, margin = 0): boolean =>
  x >= r.left - margin && x <= r.right + margin && y >= r.bottom - margin && y <= r.top + margin;

export const pdfRectContainsPoint = (r: PdfRect, p: PdfPoint, margin = 0): boolean =>
  pdfRectContainsXy(r, p.x, p.y, margin);

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const pdfRectDistanceSquaredTo = (r: PdfRect, p: PdfPoint): number => {
  if (pdfRectContainsPoint(r, p)) return 0;
  const dx = clamp(p.x, r.left, r.right) - p.x;
  const dy = clamp(p.y, r.bottom, r.top) - p.y;
  return dx * dx + dy * dy;
};

export const pdfRectOverlaps = (a: PdfRect, b: PdfRect): boolean =>
  a.left < b.right && a.right > b.left && a.top > b.bottom && a.bottom < b.top;

export const pdfRectInflate = (r: PdfRect, dx: number, dy: number): PdfRect => ({
  left: r.left - dx,
  top: r.top + dy,
  right: r.right + dx,
  bottom: r.bottom - dy,
});

export const pdfRectTranslate = (r: PdfRect, dx: number, dy: number): PdfRect => ({
  left: r.left + dx,
  top: r.top + dy,
  right: r.right + dx,
  bottom: r.bottom + dy,
});

/** Bounding rect over `rects[start..end)`. Throws if the range is empty. */
export function pdfRectBoundingRect(rects: readonly PdfRect[], start = 0, end = rects.length): PdfRect {
  let left = Infinity;
  let top = -Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  for (let i = start; i < end; i++) {
    const r = rects[i]!;
    if (r.left < left) left = r.left;
    if (r.top > top) top = r.top;
    if (r.right > right) right = r.right;
    if (r.bottom < bottom) bottom = r.bottom;
  }
  if (left === Infinity) throw new Error('No rects');
  return { left, top, right, bottom };
}

// ---------------------------------------------------------------------------
// Rotation — ports of PdfRect.rotate/rotateReverse and PdfPoint counterparts
// ---------------------------------------------------------------------------

/** Unrotated (raw PDF) page dimensions derived from the visual size. */
const rawPageSize = (page: PageGeometry): { width: number; height: number } => {
  const swap = (page.rotation & 1) === 1;
  return { width: swap ? page.height : page.width, height: swap ? page.width : page.height };
};

export function pdfRectRotate(r: PdfRect, rotation: number, page: PageGeometry): PdfRect {
  const { width, height } = rawPageSize(page);
  switch (rotation & 3) {
    case 0:
      return r;
    case 1:
      return { left: r.bottom, top: width - r.left, right: r.top, bottom: width - r.right };
    case 2:
      return { left: width - r.right, top: height - r.bottom, right: width - r.left, bottom: height - r.top };
    default:
      return { left: height - r.top, top: r.right, right: height - r.bottom, bottom: r.left };
  }
}

export function pdfRectRotateReverse(r: PdfRect, rotation: number, page: PageGeometry): PdfRect {
  const { width, height } = rawPageSize(page);
  switch (rotation & 3) {
    case 0:
      return r;
    case 1:
      return { left: width - r.top, top: r.right, right: width - r.bottom, bottom: r.left };
    case 2:
      return { left: width - r.right, top: height - r.bottom, right: width - r.left, bottom: height - r.top };
    default:
      return { left: r.bottom, top: height - r.left, right: r.top, bottom: height - r.right };
  }
}

export function pdfPointRotate(p: PdfPoint, rotation: number, page: PageGeometry): PdfPoint {
  const { width, height } = rawPageSize(page);
  switch (rotation & 3) {
    case 0:
      return p;
    case 1:
      return { x: p.y, y: width - p.x };
    case 2:
      return { x: width - p.x, y: height - p.y };
    default:
      return { x: height - p.y, y: p.x };
  }
}

export function pdfPointRotateReverse(p: PdfPoint, rotation: number, page: PageGeometry): PdfPoint {
  const { width, height } = rawPageSize(page);
  switch (rotation & 3) {
    case 0:
      return p;
    case 1:
      return { x: width - p.y, y: p.x };
    case 2:
      return { x: width - p.x, y: height - p.y };
    default:
      return { x: p.y, y: height - p.x };
  }
}

// ---------------------------------------------------------------------------
// PDF page space <-> view/document space — ports of the pdfrx_flutter.dart
// conversion extensions
// ---------------------------------------------------------------------------

export interface PageConversionOptions {
  page: PageGeometry;
  /** Scaled page size in view coordinates; defaults to the page size in points. */
  scaledPageSize?: Size;
  /** Rotation override (0-3); defaults to `page.rotation`. */
  rotation?: number;
}

/** `PdfRect.toRect` — to y-down page-local coordinates. */
export function pdfRectToRect(r: PdfRect, { page, scaledPageSize, rotation }: PageConversionOptions): Rect {
  const rotated = pdfRectRotate(r, rotation ?? page.rotation, page);
  const scale = scaledPageSize === undefined ? 1.0 : scaledPageSize.height / page.height;
  return {
    left: rotated.left * scale,
    top: (page.height - rotated.top) * scale,
    right: rotated.right * scale,
    bottom: (page.height - rotated.bottom) * scale,
  };
}

/** `PdfRect.toRectInDocument` — to document coordinates using the page's laid-out rect. */
export function pdfRectToRectInDocument(r: PdfRect, page: PageGeometry, pageRect: Rect): Rect {
  const local = pdfRectToRect(r, { page, scaledPageSize: rectSize(pageRect) });
  return rectTranslate(local, pageRect.left, pageRect.top);
}

/** `Rect.toPdfRect` — from y-down page-local coordinates back to PDF page space. */
export function rectToPdfRect(rect: Rect, { page, scaledPageSize, rotation }: PageConversionOptions): PdfRect {
  const scale = scaledPageSize === undefined ? 1.0 : scaledPageSize.height / page.height;
  return pdfRectRotateReverse(
    {
      left: rect.left / scale,
      top: page.height - rect.top / scale,
      right: rect.right / scale,
      bottom: page.height - rect.bottom / scale,
    },
    rotation ?? page.rotation,
    page,
  );
}

/** `PdfPoint.toOffset` — to y-down page-local coordinates. */
export function pdfPointToOffset(p: PdfPoint, { page, scaledPageSize, rotation }: PageConversionOptions): Offset {
  const rotated = pdfPointRotate(p, rotation ?? page.rotation, page);
  const scale = scaledPageSize === undefined ? 1.0 : scaledPageSize.height / page.height;
  return { x: rotated.x * scale, y: (page.height - rotated.y) * scale };
}

/** `PdfPoint.toOffsetInDocument` — to document coordinates using the page's laid-out rect. */
export function pdfPointToOffsetInDocument(p: PdfPoint, page: PageGeometry, pageRect: Rect): Offset {
  const rotated = pdfPointRotate(p, page.rotation, page);
  const scale = rectHeight(pageRect) / page.height;
  return {
    x: rotated.x * scale + pageRect.left,
    y: (page.height - rotated.y) * scale + pageRect.top,
  };
}

/** `Offset.toPdfPoint` — from y-down page-local coordinates back to PDF page space. */
export function offsetToPdfPoint(o: Offset, { page, scaledPageSize, rotation }: PageConversionOptions): PdfPoint {
  const scale = scaledPageSize === undefined ? 1.0 : page.height / scaledPageSize.height;
  return pdfPointRotateReverse(
    { x: o.x * scale, y: page.height - o.y * scale },
    rotation ?? page.rotation,
    page,
  );
}
