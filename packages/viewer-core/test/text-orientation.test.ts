import { composeTextRotation } from '../src/text-orientation.js';
import { describe, expect, it } from 'vitest';

describe('composeTextRotation', () => {
  it('composes page-relative text with page rotation', () => {
    expect(composeTextRotation(0, 'page', 90)).toBe(90);
    expect(composeTextRotation(270, 'page', 90)).toBe(0);
    expect(composeTextRotation(180, 'page', 270)).toBe(90);
  });

  it('keeps upright text independent from page rotation', () => {
    expect(composeTextRotation(0, 'upright', 270)).toBe(0);
    expect(composeTextRotation(90, 'upright', 180)).toBe(90);
  });
});
