import { describe, expect, it } from 'vitest';
import {
  COLUMN_GAP,
  FONT_MAX,
  FONT_MIN,
  GUTTER,
  HUD_MAX,
  MAX_TILE,
  MIN_TILE,
  STRIP_GAP,
  backingSize,
  computeBoardLayout,
  hudMinWidth,
  infoStripHeight,
  lerpPath,
  placeTooltip,
  placeZoneLabel,
  tileAtPixel,
  tileCenter,
  tileOrigin,
  uiFontSize,
  type Viewport,
} from '../../src/ui/layout';

const MAP_W = 32;
const MAP_H = 22;
const LAPTOPS: Viewport[] = [
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
  { width: 1920, height: 1200 },
];

/** Everything the page lays out must fit the viewport (no page scroll). */
function expectFits(vp: Viewport, mapW = MAP_W, mapH = MAP_H): void {
  const l = computeBoardLayout(vp, mapW, mapH);
  expect(Number.isInteger(l.tile)).toBe(true);
  expect(l.width).toBe(l.tile * mapW);
  expect(l.height).toBe(l.tile * mapH);
  expect(2 * GUTTER + l.width + COLUMN_GAP + l.hudWidth).toBeLessThanOrEqual(vp.width);
  expect(2 * GUTTER + l.height + STRIP_GAP + l.infoHeight).toBeLessThanOrEqual(vp.height);
}

describe('computeBoardLayout (laptop)', () => {
  it('shows the whole 32x22 map with no page scroll at every laptop size', () => {
    for (const vp of LAPTOPS) expectFits(vp);
  });

  it('uses the largest integer tile that fits', () => {
    for (const vp of LAPTOPS) {
      const l = computeBoardLayout(vp, MAP_W, MAP_H);
      const bigger = l.tile + 1;
      const wFits = 2 * GUTTER + bigger * MAP_W + COLUMN_GAP + hudMinWidth(vp) <= vp.width;
      const hFits = 2 * GUTTER + bigger * MAP_H + STRIP_GAP + l.infoHeight <= vp.height;
      expect(wFits && hFits).toBe(false);
    }
  });

  it('gives the expected tile and HUD sizes at the reference laptops', () => {
    const at = (width: number, height: number): { tile: number; hud: number } => {
      const l = computeBoardLayout({ width, height }, MAP_W, MAP_H);
      return { tile: l.tile, hud: l.hudWidth };
    };
    expect(at(1280, 720)).toEqual({ tile: 30, hud: 294 });
    expect(at(1366, 768)).toEqual({ tile: 32, hud: 316 });
    expect(at(1920, 1080)).toEqual({ tile: 46, hud: 422 });
    // Clearly bigger tiles on a 1080p screen than on the smallest laptop.
    expect(at(1920, 1080).tile).toBeGreaterThanOrEqual(40);
  });

  it('grows the tile and the HUD with the viewport', () => {
    let prev = computeBoardLayout({ width: 1280, height: 720 }, MAP_W, MAP_H);
    for (const vp of [
      { width: 1366, height: 768 },
      { width: 1536, height: 864 },
      { width: 1920, height: 1080 },
    ]) {
      const l = computeBoardLayout(vp, MAP_W, MAP_H);
      expect(l.tile).toBeGreaterThan(prev.tile);
      expect(l.hudWidth).toBeGreaterThan(prev.hudWidth);
      prev = l;
    }
  });

  it('keeps the HUD between ~290px at 1280 and ~400px at 1920', () => {
    expect(hudMinWidth({ width: 1280, height: 720 })).toBe(290);
    expect(hudMinWidth({ width: 1920, height: 1080 })).toBe(400);
    for (const vp of LAPTOPS) {
      const l = computeBoardLayout(vp, MAP_W, MAP_H);
      expect(l.hudWidth).toBeGreaterThanOrEqual(hudMinWidth(vp));
      expect(l.hudWidth).toBeLessThanOrEqual(HUD_MAX);
    }
  });

  it('scales the root font between 13px and 16px by the tighter axis', () => {
    expect(uiFontSize({ width: 1280, height: 720 })).toBe(FONT_MIN);
    expect(uiFontSize({ width: 1920, height: 1080 })).toBe(FONT_MAX);
    expect(uiFontSize({ width: 2560, height: 1440 })).toBe(FONT_MAX);
    expect(uiFontSize({ width: 1024, height: 600 })).toBe(FONT_MIN);
    // Wide but short: limited by the height.
    expect(uiFontSize({ width: 1920, height: 720 })).toBe(FONT_MIN);
    const mid = uiFontSize({ width: 1600, height: 900 });
    expect(mid).toBeGreaterThan(FONT_MIN);
    expect(mid).toBeLessThan(FONT_MAX);
  });

  it('sizes the info strip for two lines of text', () => {
    expect(infoStripHeight(13)).toBeGreaterThanOrEqual(2 * 13 + 8);
    expect(infoStripHeight(16)).toBeGreaterThan(infoStripHeight(13));
  });

  it('stays playable below 1280 without overflowing', () => {
    for (const vp of [
      { width: 1024, height: 768 },
      { width: 1100, height: 650 },
      { width: 900, height: 600 },
    ]) {
      expectFits(vp);
      expect(computeBoardLayout(vp, MAP_W, MAP_H).tile).toBeGreaterThanOrEqual(MIN_TILE);
    }
  });

  it('caps the HUD on an ultrawide screen (the board is centred in the rest)', () => {
    const l = computeBoardLayout({ width: 2560, height: 1080 }, MAP_W, MAP_H);
    expect(l.hudWidth).toBe(HUD_MAX);
    expectFits({ width: 2560, height: 1080 });
  });

  it('works for any map size', () => {
    const tiny = computeBoardLayout({ width: 1280, height: 800 }, 4, 3);
    expect(tiny.tile).toBe(MAX_TILE);
    const huge = computeBoardLayout({ width: 1280, height: 720 }, 200, 150);
    expect(huge.tile).toBe(MIN_TILE);
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

describe('placeZoneLabel', () => {
  // A 4x3 room at (2..5, 1..3).
  const room = [1, 2, 3].flatMap((y) => [2, 3, 4, 5].map((x) => ({ x, y })));
  const none = (): boolean => false;

  it('uses the top-left corner when it is free', () => {
    expect(placeZoneLabel(room, 2, none)).toEqual({ x: 2, y: 1 });
  });

  it('slides along the top row past a unit, then tries the bottom row', () => {
    const unitAt = (bx: number, by: number) => (p: { x: number; y: number }) => p.x === bx && p.y === by;
    expect(placeZoneLabel(room, 2, unitAt(2, 1))).toEqual({ x: 3, y: 1 });
    const topBlocked = (p: { x: number; y: number }): boolean => p.y === 1 && p.x !== 2;
    expect(placeZoneLabel(room, 2, topBlocked)).toEqual({ x: 2, y: 3 });
  });

  it('never runs a label out of the zone and falls back to the corner', () => {
    expect(placeZoneLabel(room, 5, none)).toEqual({ x: 2, y: 1 });
    expect(placeZoneLabel([], 1, none)).toBeNull();
  });
});
