// AI-side grid helpers built on the public engine API.
//
// The engine's pathTo/pathCost answer one query per call and refuse routes a
// unit cannot legally take right now (a pinned duelist has no path out of the
// Feast Hall). The AI needs whole distance fields ("how far is every tile
// from the exit?") and hypothetical movement fields for enemy units on our
// turn, so it builds them here from the same rules:
//   - terrain move cost (TERRAIN), impassable terrain, intact barred doors,
//     ward anchors and closed gates (objectBlocksMovement) block;
//   - tiles inside an enemy Bulwark cannot be entered;
//   - a pinned duelist (isDueling && !canLeaveDuel) is confined to feastHall;
//   - enemy units block movement, allies can be passed through.
// Everything is computed per call and never stored in GameState.
import {
  TERRAIN,
  ZONES,
  canLeaveDuel,
  domainTiles,
  isDueling,
  objectBlocksMovement,
  terrainAt,
  zoneTiles,
  type GameState,
  type Pos,
  type Unit,
} from '../engine';

export interface Grid {
  state: GameState;
  w: number;
  h: number;
  /** Base move cost per tile, -1 when impassable (terrain or blocking object). */
  cost: Int16Array;
  /** Index into state.units of the unit on each tile, -1 when empty. */
  occ: Int32Array;
}

export function idx(g: Grid, p: Pos): number {
  return p.y * g.w + p.x;
}

export function posOf(g: Grid, i: number): Pos {
  return { x: i % g.w, y: Math.floor(i / g.w) };
}

export function buildGrid(state: GameState): Grid {
  const w = state.map.width;
  const h = state.map.height;
  const cost = new Int16Array(w * h);
  const occ = new Int32Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = { x, y };
      const t = terrainAt(state, p);
      const c = t ? TERRAIN[t].moveCost : null;
      cost[y * w + x] = c === null || objectBlocksMovement(state, p) ? -1 : c;
    }
  }
  state.units.forEach((u, i) => {
    if (u.pos.x >= 0 && u.pos.y >= 0 && u.pos.x < w && u.pos.y < h) occ[u.pos.y * w + u.pos.x] = i;
  });
  return { state, w, h, cost, occ };
}

/** Per-unit movement restrictions: enemy Bulwark tiles and duel confinement. */
export interface MoveRules {
  unit: Unit;
  /** 1 = this unit may never step here. */
  forbidden: Uint8Array;
}

export function moveRulesFor(g: Grid, unit: Unit): MoveRules {
  const forbidden = new Uint8Array(g.w * g.h);
  for (const d of g.state.domains) {
    if (d.kind === 'bulwark' && d.faction !== unit.faction) {
      for (const t of domainTiles(g.state, d)) forbidden[idx(g, t)] = 1;
    }
  }
  if (isDueling(g.state, unit) && !canLeaveDuel(g.state, unit)) {
    const allowed = new Uint8Array(g.w * g.h);
    for (const t of zoneTiles(g.state, ZONES.feastHall)) allowed[idx(g, t)] = 1;
    for (let i = 0; i < forbidden.length; i++) if (!allowed[i]) forbidden[i] = 1;
  }
  return { unit, forbidden };
}

/** Whether the unit can step onto tile i at all (ignoring units). */
export function enterable(g: Grid, r: MoveRules, i: number): boolean {
  return g.cost[i]! >= 0 && !r.forbidden[i];
}

/** True when tile i holds a unit hostile to `faction`. */
export function enemyAt(g: Grid, i: number, faction: Unit['faction']): boolean {
  const o = g.occ[i]!;
  return o >= 0 && g.state.units[o]!.faction !== faction;
}

// --- a tiny binary heap keyed by (cost, insertion seq) for determinism -------

class Heap {
  private c: number[] = [];
  private s: number[] = [];
  private v: number[] = [];
  private seq = 0;
  get size(): number {
    return this.v.length;
  }
  private less(i: number, j: number): boolean {
    return this.c[i]! < this.c[j]! || (this.c[i] === this.c[j] && this.s[i]! < this.s[j]!);
  }
  private swap(i: number, j: number): void {
    [this.c[i], this.c[j]] = [this.c[j]!, this.c[i]!];
    [this.s[i], this.s[j]] = [this.s[j]!, this.s[i]!];
    [this.v[i], this.v[j]] = [this.v[j]!, this.v[i]!];
  }
  push(cost: number, value: number): void {
    this.c.push(cost);
    this.s.push(this.seq++);
    this.v.push(value);
    let i = this.v.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.c[0]!, this.v[0]!];
    const lc = this.c.pop()!;
    const ls = this.s.pop()!;
    const lv = this.v.pop()!;
    if (this.v.length > 0) {
      this.c[0] = lc;
      this.s[0] = ls;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.v.length && this.less(l, m)) m = l;
        if (r < this.v.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

const DIRS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function forEachNeighbor(g: Grid, i: number, fn: (n: number) => void): void {
  const x = i % g.w;
  const y = (i - x) / g.w;
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
    fn(ny * g.w + nx);
  }
}

/**
 * Tiles a unit could reach with `budget` move from `from`, as tile index ->
 * cost. Enemy units block; allies may be passed. The caller decides which
 * tiles can be ended on.
 */
export function movementField(g: Grid, r: MoveRules, from: Pos, budget: number, ignoreUnit = -1): Float64Array {
  const dist = new Float64Array(g.w * g.h).fill(Infinity);
  const start = idx(g, from);
  dist[start] = 0;
  const heap = new Heap();
  heap.push(0, start);
  while (heap.size > 0) {
    const [c, i] = heap.pop();
    if (c > dist[i]!) continue;
    forEachNeighbor(g, i, (n) => {
      if (!enterable(g, r, n) || (g.occ[n] !== ignoreUnit && enemyAt(g, n, r.unit.faction))) return;
      const nc = c + g.cost[n]!;
      if (nc > budget || nc >= dist[n]!) return;
      dist[n] = nc;
      heap.push(nc, n);
    });
  }
  return dist;
}

/**
 * Cost for the unit to travel from every tile to the nearest goal tile
 * (reverse Dijkstra: stepping onto a tile costs that tile's move cost). Enemy
 * units are not walls here, since they move, but tiles they stand on cost
 * `enemyPenalty` extra. Unreachable tiles are Infinity.
 */
export function distanceField(g: Grid, r: MoveRules, goals: Pos[], enemyPenalty = 3): Float64Array {
  const dist = new Float64Array(g.w * g.h).fill(Infinity);
  const heap = new Heap();
  for (const p of goals) {
    if (p.x < 0 || p.y < 0 || p.x >= g.w || p.y >= g.h) continue;
    const i = idx(g, p);
    if (!enterable(g, r, i) && i !== idx(g, r.unit.pos)) continue;
    if (dist[i] === 0) continue;
    dist[i] = 0;
    heap.push(0, i);
  }
  while (heap.size > 0) {
    const [c, v] = heap.pop();
    if (c > dist[v]!) continue;
    const enter = g.cost[v]! + (enemyAt(g, v, r.unit.faction) ? enemyPenalty : 0);
    forEachNeighbor(g, v, (u) => {
      if (!enterable(g, r, u) && u !== idx(g, r.unit.pos)) return;
      const nc = c + Math.max(1, enter);
      if (nc >= dist[u]!) return;
      dist[u] = nc;
      heap.push(nc, u);
    });
  }
  return dist;
}

/** Tiles within Manhattan [min, max] of p, in bounds, row-major. */
export function ringTiles(g: Grid, p: Pos, min: number, max: number): Pos[] {
  const out: Pos[] = [];
  for (let y = p.y - max; y <= p.y + max; y++) {
    if (y < 0 || y >= g.h) continue;
    const span = max - Math.abs(y - p.y);
    for (let x = p.x - span; x <= p.x + span; x++) {
      if (x < 0 || x >= g.w) continue;
      const d = Math.abs(x - p.x) + Math.abs(y - p.y);
      if (d >= min) out.push({ x, y });
    }
  }
  return out;
}
