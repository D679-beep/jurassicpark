// Pure layout math: fit scaling, tile <-> pixel conversion, path interpolation
// and tooltip placement. No DOM access, so it is unit-testable in node.
import type { Pos } from '../engine';

/**
 * Laptop layout: the board on the left, the HUD column on the right, the
 * hovered-tile strip under the board. Targets 1280x720 up to 1920x1080; on
 * 16:9 screens the board is width-bound, so the HUD gets a minimum width that
 * grows with the viewport and then absorbs whatever the integer tile size
 * leaves over. Narrower windows shrink the tiles (cramped but playable).
 */
export const LAPTOP_MIN: Viewport = { width: 1280, height: 720 };
export const LAPTOP_MAX: Viewport = { width: 1920, height: 1080 };
/** Page padding around everything (CSS px). */
export const GUTTER = 8;
/** Gap between the board column and the HUD (CSS px). */
export const COLUMN_GAP = 10;
/** Gap between the board and the tile-info strip under it (CSS px). */
export const STRIP_GAP = 4;
/** Minimum HUD width at LAPTOP_MIN and LAPTOP_MAX width (linear in between). */
export const HUD_MIN_AT_LAPTOP_MIN = 290;
export const HUD_MIN_AT_LAPTOP_MAX = 400;
/** Absolute HUD width bounds (CSS px). */
export const HUD_FLOOR = 240;
export const HUD_MAX = 460;
/** Root font size bounds (CSS px): HUD, strip, tooltip and cards scale with it. */
export const FONT_MIN = 13;
export const FONT_MAX = 16;
/** Tile-info strip: two lines at this fraction of the root font and line height, plus padding and border. */
export const STRIP_FONT = 0.95;
export const STRIP_LINE = 1.25;
export const STRIP_CHROME = 8;
export const MIN_TILE = 8;
export const MAX_TILE = 64;

export interface Viewport {
  width: number;
  height: number;
}

export interface BoardLayout {
  /** Tile edge in CSS px, always an integer so tiles land on whole pixels. */
  tile: number;
  /** Board (canvas) size in CSS px. */
  width: number;
  height: number;
  /** HUD column width in CSS px. */
  hudWidth: number;
  /** Root font size in CSS px (1rem). */
  fontSize: number;
  /** Height of the tile-info strip under the board in CSS px. */
  infoHeight: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 0 at LAPTOP_MIN, 1 at LAPTOP_MAX (per axis, clamped). */
function laptopT(v: number, lo: number, hi: number): number {
  return clamp((v - lo) / (hi - lo), 0, 1);
}

/**
 * Root font size: 13px at 1280x720 rising to 16px at 1920x1080, driven by the
 * tighter axis so a wide-but-short window does not overflow the HUD.
 * Rounded to a quarter pixel.
 */
export function uiFontSize(vp: Viewport): number {
  const t = Math.min(
    laptopT(vp.width, LAPTOP_MIN.width, LAPTOP_MAX.width),
    laptopT(vp.height, LAPTOP_MIN.height, LAPTOP_MAX.height),
  );
  return Math.round((FONT_MIN + (FONT_MAX - FONT_MIN) * t) * 4) / 4;
}

/** Minimum HUD width for a viewport width: 290px at 1280 up to 400px at 1920. */
export function hudMinWidth(vp: Viewport): number {
  const slope = (HUD_MIN_AT_LAPTOP_MAX - HUD_MIN_AT_LAPTOP_MIN) / (LAPTOP_MAX.width - LAPTOP_MIN.width);
  return Math.round(clamp(HUD_MIN_AT_LAPTOP_MIN + (vp.width - LAPTOP_MIN.width) * slope, HUD_FLOOR, HUD_MIN_AT_LAPTOP_MAX));
}

/** Height of the two-line tile-info strip for a root font size. */
export function infoStripHeight(fontSize: number): number {
  return Math.ceil(2 * STRIP_LINE * STRIP_FONT * fontSize + STRIP_CHROME);
}

/**
 * Largest integer tile size that fits the whole map beside a HUD of at least
 * its minimum width and above the tile-info strip, with no page scroll. The
 * HUD then takes the width the board does not use (up to HUD_MAX); any rest
 * centres the board.
 */
export function computeBoardLayout(vp: Viewport, mapW: number, mapH: number): BoardLayout {
  const fontSize = uiFontSize(vp);
  const infoHeight = infoStripHeight(fontSize);
  const hudMin = hudMinWidth(vp);
  const availW = vp.width - 2 * GUTTER - COLUMN_GAP - hudMin;
  const availH = vp.height - 2 * GUTTER - STRIP_GAP - infoHeight;
  const fit = Math.floor(Math.min(availW / Math.max(1, mapW), availH / Math.max(1, mapH)));
  const tile = clamp(fit, MIN_TILE, MAX_TILE);
  const width = tile * mapW;
  const hudWidth = Math.round(clamp(vp.width - 2 * GUTTER - COLUMN_GAP - width, hudMin, HUD_MAX));
  return { tile, width, height: tile * mapH, hudWidth, fontSize, infoHeight };
}

/** Backing-store size for a CSS size at a device pixel ratio (integer, at least 1). */
export function backingSize(css: number, dpr: number): number {
  return Math.max(1, Math.round(css * (dpr > 0 ? dpr : 1)));
}

/** Tile under a point in board CSS px, or null when outside the map. */
export function tileAtPixel(px: number, py: number, tile: number, mapW: number, mapH: number): Pos | null {
  if (tile <= 0 || px < 0 || py < 0) return null;
  const x = Math.floor(px / tile);
  const y = Math.floor(py / tile);
  if (x >= mapW || y >= mapH) return null;
  return { x, y };
}

/** Top-left corner of a tile in board CSS px. */
export function tileOrigin(p: Pos, tile: number): { x: number; y: number } {
  return { x: p.x * tile, y: p.y * tile };
}

/** Centre of a (possibly fractional) tile position in board CSS px. */
export function tileCenter(p: Pos, tile: number): { x: number; y: number } {
  return { x: (p.x + 0.5) * tile, y: (p.y + 0.5) * tile };
}

/**
 * Fractional tile position along a movement path at progress t in [0, 1].
 * `path` excludes `from` and ends at the destination (as in the `moved`
 * event); each step takes an equal share of the time.
 */
export function lerpPath(from: Pos, path: readonly Pos[], t: number): Pos {
  if (path.length === 0) return { ...from };
  const clamped = Math.min(1, Math.max(0, t));
  const f = clamped * path.length;
  const i = Math.min(path.length - 1, Math.floor(f));
  const a = i === 0 ? from : path[i - 1]!;
  const b = path[i]!;
  const local = clamped >= 1 ? 1 : f - i;
  return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
}

/**
 * Places a tooltip of size (w, h) near an anchor point, preferring the
 * bottom-right, flipping to the other side when it would overflow, and
 * finally clamping into the bounds.
 */
export function placeTooltip(
  anchorX: number,
  anchorY: number,
  w: number,
  h: number,
  boundsW: number,
  boundsH: number,
  offset = 14,
): { left: number; top: number } {
  let left = anchorX + offset;
  let top = anchorY + offset;
  if (left + w > boundsW) left = anchorX - offset - w;
  if (top + h > boundsH) top = anchorY - offset - h;
  left = Math.max(0, Math.min(left, boundsW - w));
  top = Math.max(0, Math.min(top, boundsH - h));
  return { left, top };
}

/**
 * Where to put a zone's name label: the left end of a run of `span` zone
 * tiles in one row with none of them blocked (units, objects, exits). Tries
 * the top row first, then the bottom row, then the rows in between; falls
 * back to the zone's top-left corner.
 */
export function placeZoneLabel(tiles: readonly Pos[], span: number, blocked: (p: Pos) => boolean): Pos | null {
  if (tiles.length === 0) return null;
  const inZone = new Set(tiles.map((p) => `${p.x},${p.y}`));
  const ys = [...new Set(tiles.map((p) => p.y))].sort((a, b) => a - b);
  const order = ys.length > 1 ? [ys[0]!, ys[ys.length - 1]!, ...ys.slice(1, -1)] : ys;
  const n = Math.max(1, span);
  for (const y of order) {
    const xs = tiles.filter((p) => p.y === y).map((p) => p.x).sort((a, b) => a - b);
    for (const x0 of xs) {
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const q = { x: x0 + i, y };
        ok = inZone.has(`${q.x},${q.y}`) && !blocked(q);
      }
      if (ok) return { x: x0, y };
    }
  }
  const minY = ys[0]!;
  const minX = Math.min(...tiles.filter((p) => p.y === minY).map((p) => p.x));
  return { x: minX, y: minY };
}
