import { describe, expect, it } from 'vitest';
import { parseSvgAnnotation } from './svg-annotation.js';

describe('parseSvgAnnotation', () => {
  it('normalizes paths and preserves solid fill/stroke styling', () => {
    const appearance = parseSvgAnnotation(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100">
        <path d="M10 20 L210 20 L210 120 Z" fill="#ff0000" stroke="#0000ff" stroke-width="4"/>
      </svg>
    `);
    expect(appearance).not.toBeNull();
    expect(appearance?.width).toBe(200);
    expect(appearance?.height).toBe(100);
    expect(appearance?.paths[0]).toMatchObject({
      fillColor: { r: 255, g: 0, b: 0, a: 255 },
      strokeColor: { r: 0, g: 0, b: 255, a: 255 },
      strokeWidth: 0.02,
      stroke: true,
    });
    expect(appearance?.paths[0]?.segments[0]?.point).toEqual({ x: 0, y: 0 });
    expect(appearance?.paths[0]?.segments[1]?.point).toEqual({ x: 1, y: 0 });
  });

  it('converts transformed basic shapes and arcs to cubic paths', () => {
    const appearance = parseSvgAnnotation(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
        <g transform="translate(10 0)">
          <circle cx="20" cy="25" r="10" fill="green"/>
        </g>
      </svg>
    `);
    expect(appearance?.paths[0]?.segments.some((segment) => segment.type === 'bezier')).toBe(true);
    expect(appearance?.paths[0]?.segments[0]?.point.x).toBeCloseTo(0.2);
  });

  it('requests raster fallback for text and paint servers', () => {
    expect(parseSvgAnnotation('<svg xmlns="http://www.w3.org/2000/svg"><text>PDF</text></svg>')).toBeNull();
    expect(parseSvgAnnotation(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <path d="M0 0L1 1" stroke="url(#gradient)"/>
      </svg>
    `)).toBeNull();
    expect(parseSvgAnnotation(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <path class="themed" d="M0 0L1 1"/>
      </svg>
    `)).toBeNull();
  });

  it('accepts a rectangular clip path that contains the artwork', () => {
    const appearance = parseSvgAnnotation(`
      <svg viewBox="0 0 648 50" xmlns="http://www.w3.org/2000/svg">
        <g clip-path="url(#bounds)"><path d="M0 0H20V20H0Z"/></g>
        <defs><clipPath id="bounds"><rect width="647.637" height="50"/></clipPath></defs>
      </svg>
    `);
    expect(appearance?.paths).toHaveLength(1);
  });

  it('requests raster fallback when a clip path changes the artwork', () => {
    expect(parseSvgAnnotation(`
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <g clip-path="url(#crop)"><path d="M0 0H100V100H0Z"/></g>
        <defs><clipPath id="crop"><rect width="50" height="50"/></clipPath></defs>
      </svg>
    `)).toBeNull();
  });
});
