import { describe, expect, it } from 'vitest';
import {
  GUTTER,
  MAX_TILE,
  backingSize,
  computeBoardLayout,
  isNarrow,
  lerpPath,
  placeTooltip,
  tileAtPixel,
  tileCenter,
  tileOrigin,
} from '../../src/ui/layout';

describe('computeBoardLayout', () => {
  it('fits the 32x22 prologue beside the HUD on a laptop', () => {
    const l = computeBoardLayout({ width: 1280, height: 800 }, 32, 22);
    expect(l.narrow).toBe(false);
    expect(Number.isInteger(l.tile)).toBe(true);
    expect(l.tile).toBeGreaterThanOrEqual(24);
    expect(l.width).toBe(l.tile * 32);
    expect(l.width).toBeLessThanOrEqual(1280 - 340 - 3 * GUTTER);
    expect(l.height).toBeLessThanOrEqual(800 - 2 * GUTTER);
  });

  it('stacks on a phone and never overflows the width', () => {
    const l = computeBoardLayout({ width: 390, height: 844 }, 32, 22);
    expect(l.narrow).toBe(true);
    expect(l.width).toBeLessThanOrEqual(390 - 2 * GUTTER);
    expect(l.tile).toBeGreaterThanOrEqual(10);
  });

  it('works for any map size', () => {
    const tiny = computeBoardLayout({ width: 1280, height: 800 }, 4, 3);
    expect(tiny.tile).toBe(MAX_TILE);
    const huge = computeBoardLayout({ width: 390, height: 844 }, 200, 150);
    expect(huge.width).toBeLessThanOrEqual(390 - 2 * GUTTER);
    expect(huge.tile).toBeGreaterThanOrEqual(1);
  });

  it('uses the breakpoint', () => {
    expect(isNarrow({ width: 819, height: 900 })).toBe(true);
    expect(isNarrow({ width: 820, height: 900 })).toBe(false);
  });
});

describe('tile <-> pixel', () => {
  it('maps pixels to tiles and rejects points outside', () => {
    expect(tileAtPixel(0, 0, 20, 10, 5)).toEqual({ x: 0, y: 0 });
    expect(tileAtPixel(19.9, 39.9, 20, 10, 5)).toEqual({ x: 0, y: 1 });
    expect(tileAtPixel(199, 99, 20, 10, 5)).toEqual({ x: 9, y: 4 });
    expect(tileAtPixel(200, 50, 20, 10, 5)).toBeNull();
    expect(tileAtPixel(-1, 5, 20, 10, 5)).toBeNull();
    expect(tileAtPixel(5, 5, 0, 10, 5)).toBeNull();
  });

  it('round-trips through tile centres', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 31, y: 21 }, { x: 7, y: 13 }]) {
      const c = tileCenter(p, 27);
      expect(tileAtPixel(c.x, c.y, 27, 32, 22)).toEqual(p);
      expect(tileOrigin(p, 27)).toEqual({ x: p.x * 27, y: p.y * 27 });
    }
  });

  it('computes integer backing sizes', () => {
    expect(backingSize(100, 2)).toBe(200);
    expect(backingSize(101, 1.5)).toBe(152);
    expect(backingSize(0, 2)).toBe(1);
    expect(backingSize(50, 0)).toBe(50);
  });
});

describe('lerpPath', () => {
  const from = { x: 0, y: 0 };
  const path = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }];

  it('starts at from and ends at the destination', () => {
    expect(lerpPath(from, path, 0)).toEqual(from);
    expect(lerpPath(from, path, 1)).toEqual({ x: 2, y: 1 });
    expect(lerpPath(from, path, 5)).toEqual({ x: 2, y: 1 });
  });

  it('walks each step in equal time', () => {
    expect(lerpPath(from, path, 1 / 3)).toEqual({ x: 1, y: 0 });
    const mid = lerpPath(from, path, 0.5);
    expect(mid.x).toBeCloseTo(1);
    expect(mid.y).toBeCloseTo(0.5);
  });

  it('handles an empty path', () => {
    expect(lerpPath({ x: 3, y: 4 }, [], 0.5)).toEqual({ x: 3, y: 4 });
  });
});

describe('placeTooltip', () => {
  it('prefers bottom-right of the anchor', () => {
    expect(placeTooltip(10, 10, 50, 20, 400, 300)).toEqual({ left: 24, top: 24 });
  });
  it('flips when overflowing and clamps into bounds', () => {
    expect(placeTooltip(390, 290, 50, 20, 400, 300)).toEqual({ left: 326, top: 256 });
    expect(placeTooltip(20, 20, 500, 400, 400, 300)).toEqual({ left: 0, top: 0 });
  });
});
