// Pure layout math: fit scaling, tile <-> pixel conversion, path interpolation
// and tooltip placement. No DOM access, so it is unit-testable in node.
import type { Pos } from '../engine';

/** Below this viewport width the HUD stacks under the map. */
export const NARROW_BREAKPOINT = 820;
/** Width of the HUD column on wide screens (CSS px). */
export const HUD_WIDTH = 340;
/** Page padding around the board (CSS px). */
export const GUTTER = 16;
/** Fraction of the viewport height the board may use on narrow screens. */
export const NARROW_BOARD_HEIGHT = 0.62;
/** Height reserved under the map for the hovered-tile info strip (CSS px). */
export const INFO_BAR = 64;
export const MIN_TILE = 8;
export const MAX_TILE = 56;

export interface Viewport {
  width: number;
  height: number;
}

export interface BoardLayout {
  narrow: boolean;
  /** Tile edge in CSS px, always an integer so tiles land on whole pixels. */
  tile: number;
  /** Board (canvas) size in CSS px. */
  width: number;
  height: number;
}

export function isNarrow(vp: Viewport): boolean {
  return vp.width < NARROW_BREAKPOINT;
}

/**
 * Largest integer tile size that fits the map into the space left for the
 * board: beside the HUD on wide screens, above it on narrow ones.
 */
export function computeBoardLayout(vp: Viewport, mapW: number, mapH: number): BoardLayout {
  const narrow = isNarrow(vp);
  const availW = narrow ? vp.width - 2 * GUTTER : vp.width - HUD_WIDTH - 3 * GUTTER;
  const availH = narrow ? vp.height * NARROW_BOARD_HEIGHT : vp.height - 2 * GUTTER - INFO_BAR;
  const fit = Math.floor(Math.min(availW / Math.max(1, mapW), availH / Math.max(1, mapH)));
  // On a phone the width is the hard limit: never overflow horizontally.
  const widthCap = Math.floor((vp.width - 2 * GUTTER) / Math.max(1, mapW));
  const tile = Math.max(Math.min(MIN_TILE, widthCap), Math.min(MAX_TILE, fit));
  return { narrow, tile, width: tile * mapW, height: tile * mapH };
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
