import type { Pos, PosLike } from './types';

export function toPos(p: PosLike): Pos {
  if (Array.isArray(p)) {
    const t = p as readonly [number, number];
    return { x: t[0], y: t[1] };
  }
  const o = p as Pos;
  return { x: o.x, y: o.y };
}

export function posKey(p: Pos): string {
  return `${p.x},${p.y}`;
}

export function posEq(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Row-major ordering (top to bottom, then left to right). */
export function comparePos(a: Pos, b: Pos): number {
  return a.y - b.y || a.x - b.x;
}

/** 4-directional neighbour order used everywhere: N, E, S, W. */
export const DIRECTIONS: readonly Pos[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function neighbors4(p: Pos): Pos[] {
  return DIRECTIONS.map((d) => ({ x: p.x + d.x, y: p.y + d.y }));
}

/** Tiles within Manhattan `radius` of `center`, clipped to the map, row-major. */
export function diamondTiles(center: Pos, radius: number, width: number, height: number): Pos[] {
  const out: Pos[] = [];
  for (let y = center.y - radius; y <= center.y + radius; y++) {
    if (y < 0 || y >= height) continue;
    const span = radius - Math.abs(y - center.y);
    for (let x = center.x - span; x <= center.x + span; x++) {
      if (x < 0 || x >= width) continue;
      out.push({ x, y });
    }
  }
  return out;
}
