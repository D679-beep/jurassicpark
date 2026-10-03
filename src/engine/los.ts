// Line of sight: Bresenham line, blocked by walls and barred (intact) doors.
import { TERRAIN } from './data';
import { comparePos } from './geometry';
import { barredDoorAt, terrainAt } from './map';
import type { GameState, Pos } from './types';

/** Every tile on the Bresenham line from a to b, both endpoints included. */
export function bresenhamLine(a: Pos, b: Pos): Pos[] {
  const out: Pos[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

export function blocksLineOfSight(state: GameState, p: Pos): boolean {
  const t = terrainAt(state, p);
  if (t === undefined) return true;
  if (TERRAIN[t].blocksLos) return true;
  return barredDoorAt(state, p) !== undefined;
}

/**
 * True when no tile strictly between `from` and `to` blocks sight. Endpoints
 * never block (so a barred door can be shot at). Units do not block sight.
 * The line is always traced from the row-major-smaller endpoint so the result
 * is symmetric.
 */
export function lineOfSight(state: GameState, from: Pos, to: Pos): boolean {
  const [a, b] = comparePos(from, to) <= 0 ? [from, to] : [to, from];
  const line = bresenhamLine(a, b);
  for (let i = 1; i < line.length - 1; i++) {
    const p = line[i];
    if (p && blocksLineOfSight(state, p)) return false;
  }
  return true;
}
