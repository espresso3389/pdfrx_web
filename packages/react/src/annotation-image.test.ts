import { describe, expect, it } from 'vitest';
import { centeredImageRect } from './annotation-image.js';

describe('centeredImageRect', () => {
  it('centers an image at its natural size', () => {
    expect(centeredImageRect({ width: 600, height: 800 }, 200, 100)).toEqual({
      left: 200,
      bottom: 350,
      right: 400,
      top: 450,
    });
  });

  it('scales an oversized image proportionally to fit the page', () => {
    expect(centeredImageRect({ width: 600, height: 800 }, 1200, 1200)).toEqual({
      left: 180,
      bottom: 280,
      right: 420,
      top: 520,
    });
  });

  it('still fits the image when the page is smaller than the toolbar size', () => {
    expect(centeredImageRect({ width: 120, height: 200 }, 300, 150)).toEqual({
      left: 0,
      bottom: 70,
      right: 120,
      top: 130,
    });
  });
});
