import type { PdfAnnotationColor, PdfAnnotationSpec } from '@pdfrx/engine';
import svgpath from 'svgpath';

type AppearancePath = NonNullable<PdfAnnotationSpec['appearancePaths']>[number];

export interface SvgAnnotationAppearance {
  width: number;
  height: number;
  paths: AppearancePath[];
}

interface SvgStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fillRule: number;
  lineCap: number;
  lineJoin: number;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
}

const unsupportedSelector = [
  'text',
  'tspan',
  'textPath',
  'image',
  'use',
  'foreignObject',
  'filter',
  'mask',
  'pattern',
  'linearGradient',
  'radialGradient',
  'style',
  'script',
  'animate',
  'animateTransform',
  'animateMotion',
].join(',');

/** Converts a static, solid-color SVG subset to normalized PDF appearance paths. */
export function parseSvgAnnotation(svgText: string): SvgAnnotationAppearance | null {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = parsed.documentElement;
  if (
    root.localName !== 'svg' ||
    parsed.querySelector('parsererror') ||
    parsed.querySelector(unsupportedSelector) ||
    root.querySelector('svg') ||
    parsed.querySelector('[class],[marker-start],[marker-mid],[marker-end],[vector-effect],[href]')
  ) {
    return null;
  }
  const viewBox = parseNumbers(root.getAttribute('viewBox'));
  const fallbackWidth = parseLength(root.getAttribute('width')) ?? 300;
  const fallbackHeight = parseLength(root.getAttribute('height')) ?? 150;
  const [minX, minY, width, height] =
    viewBox.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0
      ? [viewBox[0]!, viewBox[1]!, viewBox[2]!, viewBox[3]!]
      : [0, 0, fallbackWidth, fallbackHeight];
  if (!(width > 0 && height > 0)) return null;
  const clipBounds = simpleClipBounds(parsed, minX, minY, width, height);
  if (!clipBounds) return null;

  const paths: AppearancePath[] = [];
  const initial: SvgStyle = {
    fill: 'black',
    stroke: 'none',
    strokeWidth: 1,
    fillRule: 2,
    lineCap: 0,
    lineJoin: 0,
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 1,
  };

  const visit = (element: Element, inherited: SvgStyle, transforms: string[]): boolean => {
    const inlineStyle = element.getAttribute('style') ?? '';
    if (
      element.getAttribute('display') === 'none' ||
      element.getAttribute('visibility') === 'hidden' ||
      /(?:^|;)\s*display\s*:\s*none(?:;|$)/i.test(inlineStyle) ||
      /(?:^|;)\s*visibility\s*:\s*hidden(?:;|$)/i.test(inlineStyle)
    ) return true;
    const style = resolveStyle(element, inherited);
    if (!style) return false;
    const transform = element.getAttribute('transform');
    const nextTransforms = transform ? [...transforms, transform] : transforms;
    const name = element.localName;
    if (name === 'svg' || name === 'g' || name === 'a' || name === 'switch') {
      for (const child of Array.from(element.children)) {
        if (!visit(child, style, nextTransforms)) return false;
      }
      return true;
    }
    if (name === 'defs' || name === 'title' || name === 'desc' || name === 'metadata' || name === 'clipPath') return true;
    const data = shapePathData(element);
    if (data === null) return false;
    if (!data) return true;
    try {
      const path = svgpath(data);
      for (const item of nextTransforms) path.transform(item);
      path.translate(-minX, -minY).scale(1 / width, 1 / height).abs().unshort().unarc();
      const segments = normalizedSegments(path);
      if (!segments.length) return true;
      const fillColor = parseColor(style.fill, style.opacity * style.fillOpacity);
      const strokeColor = parseColor(style.stroke, style.opacity * style.strokeOpacity);
      if (!fillColor && !strokeColor) return true;
      paths.push({
        segments,
        fillColor,
        strokeColor,
        strokeWidth: Math.max(0, style.strokeWidth / width),
        fillMode: fillColor ? style.fillRule : 0,
        stroke: !!strokeColor && style.strokeWidth > 0,
        lineCap: style.lineCap,
        lineJoin: style.lineJoin,
      });
      return true;
    } catch {
      return false;
    }
  };

  if (!visit(root, initial, [])) return null;
  if (
    clipBounds.some((clip) =>
      paths.some((path) =>
        path.segments.some(({ point }) =>
          point.x < clip.left - 0.001 ||
          point.x > clip.right + 0.001 ||
          point.y < clip.top - 0.001 ||
          point.y > clip.bottom + 0.001,
        ),
      ),
    )
  ) return null;
  return paths.length ? { width, height, paths } : null;
}

function simpleClipBounds(
  document: Document,
  minX: number,
  minY: number,
  width: number,
  height: number,
): Array<{ left: number; top: number; right: number; bottom: number }> | null {
  const bounds = [];
  for (const element of Array.from(document.querySelectorAll('[clip-path]'))) {
    const match = element.getAttribute('clip-path')?.trim().match(/^url\(#([^)]+)\)$/);
    if (!match) return null;
    const clip = document.getElementById(match[1]!);
    if (!clip || clip.localName !== 'clipPath' || clip.children.length !== 1) return null;
    const rect = clip.firstElementChild;
    if (!rect || rect.localName !== 'rect' || rect.hasAttribute('transform') || rect.hasAttribute('rx') || rect.hasAttribute('ry')) {
      return null;
    }
    const value = (name: string, fallback = 0): number =>
      Number.parseFloat(rect.getAttribute(name) ?? '') || fallback;
    const left = (value('x') - minX) / width;
    const top = (value('y') - minY) / height;
    bounds.push({
      left,
      top,
      right: left + value('width') / width,
      bottom: top + value('height') / height,
    });
  }
  return bounds;
}

function shapePathData(element: Element): string | null {
  const number = (name: string, fallback = 0): number => Number.parseFloat(element.getAttribute(name) ?? '') || fallback;
  switch (element.localName) {
    case 'path':
      return element.getAttribute('d') ?? '';
    case 'rect': {
      const x = number('x');
      const y = number('y');
      const width = number('width');
      const height = number('height');
      if (width <= 0 || height <= 0) return '';
      const rx = Math.min(Math.max(0, number('rx')), width / 2);
      const ry = Math.min(Math.max(0, number('ry', rx)), height / 2);
      if (!rx && !ry) return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
      return `M${x + rx} ${y}H${x + width - rx}A${rx} ${ry} 0 0 1 ${x + width} ${y + ry}` +
        `V${y + height - ry}A${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}` +
        `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + height - ry}` +
        `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle': {
      const cx = number('cx');
      const cy = number('cy');
      const r = number('r');
      return r > 0 ? ellipsePath(cx, cy, r, r) : '';
    }
    case 'ellipse': {
      const rx = number('rx');
      const ry = number('ry');
      return rx > 0 && ry > 0 ? ellipsePath(number('cx'), number('cy'), rx, ry) : '';
    }
    case 'line':
      return `M${number('x1')} ${number('y1')}L${number('x2')} ${number('y2')}`;
    case 'polyline':
    case 'polygon': {
      const points = parseNumbers(element.getAttribute('points'));
      if (points.length < 4 || points.length % 2) return '';
      let data = `M${points[0]} ${points[1]}`;
      for (let index = 2; index < points.length; index += 2) data += `L${points[index]} ${points[index + 1]}`;
      return element.localName === 'polygon' ? `${data}Z` : data;
    }
    default:
      return null;
  }
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

function normalizedSegments(path: ReturnType<typeof svgpath>): AppearancePath['segments'] {
  const result: AppearancePath['segments'] = [];
  path.iterate((segment, _index, x, y) => {
    const command = segment[0].toUpperCase();
    const at = (index: number): number => segment[index] as number;
    if (command === 'Z') {
      const previous = result[result.length - 1];
      if (previous) previous.close = true;
    } else if (command === 'M') {
      result.push({ type: 'move', point: { x: at(1), y: at(2) }, close: false });
    } else if (command === 'L') {
      result.push({ type: 'line', point: { x: at(1), y: at(2) }, close: false });
    } else if (command === 'H') {
      result.push({ type: 'line', point: { x: at(1), y }, close: false });
    } else if (command === 'V') {
      result.push({ type: 'line', point: { x, y: at(1) }, close: false });
    } else if (command === 'C') {
      result.push(
        { type: 'bezier', point: { x: at(1), y: at(2) }, close: false },
        { type: 'bezier', point: { x: at(3), y: at(4) }, close: false },
        { type: 'bezier', point: { x: at(5), y: at(6) }, close: false },
      );
    } else if (command === 'Q') {
      const endX = at(3);
      const endY = at(4);
      result.push(
        { type: 'bezier', point: { x: x + (at(1) - x) * 2 / 3, y: y + (at(2) - y) * 2 / 3 }, close: false },
        { type: 'bezier', point: { x: endX + (at(1) - endX) * 2 / 3, y: endY + (at(2) - endY) * 2 / 3 }, close: false },
        { type: 'bezier', point: { x: endX, y: endY }, close: false },
      );
    }
  }, true);
  return result;
}

function resolveStyle(element: Element, inherited: SvgStyle): SvgStyle | null {
  const inline = new Map(
    (element.getAttribute('style') ?? '').split(';').map((entry) => entry.split(':', 2).map((value) => value.trim()))
      .filter((entry) => entry.length === 2) as [string, string][],
  );
  const value = (name: string): string | null => element.getAttribute(name) ?? inline.get(name) ?? null;
  const fill = value('fill') ?? inherited.fill;
  const stroke = value('stroke') ?? inherited.stroke;
  if (fill.includes('url(') || stroke.includes('url(')) return null;
  return {
    fill,
    stroke,
    strokeWidth: numericStyle(value('stroke-width'), inherited.strokeWidth),
    fillRule: value('fill-rule') === null ? inherited.fillRule : value('fill-rule') === 'evenodd' ? 1 : 2,
    lineCap: ({ butt: 0, round: 1, square: 2 } as Record<string, number>)[value('stroke-linecap') ?? ''] ?? inherited.lineCap,
    lineJoin: ({ miter: 0, round: 1, bevel: 2 } as Record<string, number>)[value('stroke-linejoin') ?? ''] ?? inherited.lineJoin,
    opacity: inherited.opacity * numericStyle(value('opacity'), 1),
    fillOpacity: numericStyle(value('fill-opacity'), inherited.fillOpacity),
    strokeOpacity: numericStyle(value('stroke-opacity'), inherited.strokeOpacity),
  };
}

function numericStyle(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumbers(value: string | null): number[] {
  return value?.match(/[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
}

function parseLength(value: string | null): number | null {
  if (!value || /%$/.test(value.trim())) return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseColor(value: string, opacity: number): PdfAnnotationColor | null {
  const input = value.trim().toLowerCase();
  if (!input || input === 'none' || input === 'transparent') return null;
  const named: Record<string, string> = {
    black: '#000000', silver: '#c0c0c0', gray: '#808080', white: '#ffffff',
    maroon: '#800000', red: '#ff0000', purple: '#800080', fuchsia: '#ff00ff',
    green: '#008000', lime: '#00ff00', olive: '#808000', yellow: '#ffff00',
    navy: '#000080', blue: '#0000ff', teal: '#008080', aqua: '#00ffff',
  };
  const normalized = named[input] ?? input;
  let channels: number[] | null = null;
  if (/^#[0-9a-f]{3,8}$/i.test(normalized)) {
    let hex = normalized.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = hex.replace(/./g, (digit) => digit + digit);
    if (hex.length === 6) hex += 'ff';
    if (hex.length === 8) channels = [0, 2, 4, 6].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  } else {
    const match = normalized.match(/^rgba?\(([^)]+)\)$/);
    if (match) {
      const parts = match[1]!.split(/[\s,\/]+/).filter(Boolean);
      if (parts.length >= 3) {
        const component = (part: string): number =>
          part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part);
        const alpha = parts[3] === undefined
          ? 255
          : parts[3]!.endsWith('%')
            ? Number.parseFloat(parts[3]!) * 2.55
            : Number.parseFloat(parts[3]!) * 255;
        channels = [component(parts[0]!), component(parts[1]!), component(parts[2]!), alpha];
      }
    }
  }
  if (!channels?.every(Number.isFinite)) return null;
  return {
    r: Math.round(Math.max(0, Math.min(255, channels[0]!))),
    g: Math.round(Math.max(0, Math.min(255, channels[1]!))),
    b: Math.round(Math.max(0, Math.min(255, channels[2]!))),
    a: Math.round(Math.max(0, Math.min(255, channels[3]!)) * Math.max(0, Math.min(1, opacity))),
  };
}
