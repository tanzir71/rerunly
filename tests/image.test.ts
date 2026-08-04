import { describe, expect, it } from 'vitest';
import { comparePixelData, normalizeRedactionRects } from '../src/background/image';

describe('visual safety helpers', () => {
  it('pads and clips redaction rectangles to the viewport', () => {
    expect(
      normalizeRedactionRects(
        [{ x: 1, y: 2, width: 20, height: 10, reason: 'secret_target' }],
        100,
        100
      )
    ).toEqual([{ x: 0, y: 0, width: 26, height: 16, reason: 'secret_target' }]);
  });

  it('finds a normalized visual change region', () => {
    const before = new Uint8ClampedArray(4 * 4 * 4);
    const after = new Uint8ClampedArray(before);
    const changedPixel = (2 * 4 + 1) * 4;
    after[changedPixel] = 255;
    const diff = comparePixelData(before, after, 4, 4);
    expect(diff.changedRatio).toBe(1 / 16);
    expect(diff.changedRegion).toEqual({ x: 0.25, y: 0.5, width: 0.25, height: 0.25 });
    expect(diff.meaningfullyChanged).toBe(true);
  });

  it('rejects mismatched image buffers', () => {
    expect(() => comparePixelData(new Uint8ClampedArray(4), new Uint8ClampedArray(8), 1, 1)).toThrow();
  });
});
