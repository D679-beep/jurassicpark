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
// Line of sight is the engine's rule (lineOfSight: Bresenham from the
// row-major-smaller endpoint, blocked by walls and intact barred doors),
// replayed over a per-call blocker bitmap so the AI can test thousands of
// lines cheaply. Everything is computed per call and never stored in GameState.
import {
  TERRAIN,
  ZONES,
  canLeaveDuel,
  domainTiles,
  effectiveStats,
  isDueling,
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
  /** 1 when the tile blocks line of sight (wall-like terrain or an intact barred door). */
  losBlock: Uint8Array;
  /** Terrain defense bonus per tile. */
  def: Int8Array;
}

export function idx(g: Grid, p: Pos): number {
  return p.y * g.w + p.x;
}

export function posOf(g: Grid, i: number): Pos {
  return { x: i % g.w, y: Math.floor(i / g.w) };
}

export function inGrid(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.w && y < g.h;
}

export function buildGrid(state: GameState): Grid {
  const w = state.map.width;
  const h = state.map.height;
  const cost = new Int16Array(w * h);
  const occ = new Int32Array(w * h).fill(-1);
  const losBlock = new Uint8Array(w * h);
  const def = new Int8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = state.map.terrain[y];
    for (let x = 0; x < w; x++) {
      const t = row?.[x];
      const info = t ? TERRAIN[t] : undefined;
      const i = y * w + x;
      cost[i] = info && info.moveCost !== null ? info.moveCost : -1;
      losBlock[i] = !info || info.blocksLos ? 1 : 0;
      def[i] = info ? info.defense : 0;
    }
  }
  // Same rules as objectBlocksMovement / blocksLineOfSight, one pass over the objects.
  for (const o of state.map.objects) {
    if (o.kind === 'door' || o.kind === 'anchor') {
      if (o.destroyed || o.pos.x < 0 || o.pos.y < 0 || o.pos.x >= w || o.pos.y >= h) continue;
      const i = o.pos.y * w + o.pos.x;
      cost[i] = -1;
      if (o.kind === 'door') losBlock[i] = 1;
    } else if (o.kind === 'gate' && !o.open) {
      for (const t of o.tiles) if (t.x >= 0 && t.y >= 0 && t.x < w && t.y < h) cost[t.y * w + t.x] = -1;
    }
  }
  state.units.forEach((u, i) => {
    if (u.pos.x >= 0 && u.pos.y >= 0 && u.pos.x < w && u.pos.y < h) occ[u.pos.y * w + u.pos.x] = i;
  });
  return { state, w, h, cost, occ, losBlock, def };
}

/** The engine's lineOfSight, over the grid's blocker bitmap. */
export function los(g: Grid, from: Pos, to: Pos): boolean {
  let ax = from.x;
  let ay = from.y;
  let bx = to.x;
  let by = to.y;
  if (ay > by || (ay === by && ax > bx)) {
    ax = to.x;
    ay = to.y;
    bx = from.x;
    by = from.y;
  }
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  let x = ax;
  let y = ay;
  for (;;) {
    if (x === bx && y === by) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === bx && y === by) return true;
    if (!inGrid(g, x, y) || g.losBlock[y * g.w + x]) return false;
  }
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
    const c = this.c[i]!;
    this.c[i] = this.c[j]!;
    this.c[j] = c;
    const s = this.s[i]!;
    this.s[i] = this.s[j]!;
    this.s[j] = s;
    const v = this.v[i]!;
    this.v[i] = this.v[j]!;
    this.v[j] = v;
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
  /** Pops the minimum; read its cost from `lastCost`. */
  pop(): number {
    const top = this.v[0]!;
    this.lastCost = this.c[0]!;
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
  lastCost = 0;
}

/** Neighbour tile indices of i in N, E, S, W order (-1 when off the map). */
export function neighborIdx(g: Grid, i: number, out: Int32Array): void {
  const x = i % g.w;
  const y = (i - x) / g.w;
  out[0] = y > 0 ? i - g.w : -1;
  out[1] = x < g.w - 1 ? i + 1 : -1;
  out[2] = y < g.h - 1 ? i + g.w : -1;
  out[3] = x > 0 ? i - 1 : -1;
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
  const nb = new Int32Array(4);
  const faction = r.unit.faction;
  while (heap.size > 0) {
    const i = heap.pop();
    const c = heap.lastCost;
    if (c > dist[i]!) continue;
    neighborIdx(g, i, nb);
    for (let k = 0; k < 4; k++) {
      const n = nb[k]!;
      if (n < 0 || !enterable(g, r, n)) continue;
      if (g.occ[n] !== ignoreUnit && enemyAt(g, n, faction)) continue;
      const nc = c + g.cost[n]!;
      if (nc > budget || nc >= dist[n]!) continue;
      dist[n] = nc;
      heap.push(nc, n);
    }
  }
  return dist;
}

/**
 * Tiles the unit can move to this turn under the engine's rules (its
 * effective move, enemies block, allies pass but cannot be ended on),
 * excluding its own tile, row-major. Mirrors the engine's reachableTiles;
 * the AI still validates every move it issues against getLegalActions.
 */
export function reachable(g: Grid, u: Unit, rules: MoveRules = moveRulesFor(g, u)): { tiles: Pos[]; field: Float64Array } {
  const field = movementField(g, rules, u.pos, effectiveStats(u).move);
  const tiles: Pos[] = [];
  const self = idx(g, u.pos);
  for (let i = 0; i < field.length; i++) {
    if (field[i] === Infinity || i === self || g.occ[i]! >= 0) continue;
    tiles.push(posOf(g, i));
  }
  return { tiles, field };
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
  const self = idx(g, r.unit.pos);
  for (const p of goals) {
    if (p.x < 0 || p.y < 0 || p.x >= g.w || p.y >= g.h) continue;
    const i = idx(g, p);
    if (!enterable(g, r, i) && i !== self) continue;
    if (dist[i] === 0) continue;
    dist[i] = 0;
    heap.push(0, i);
  }
  const nb = new Int32Array(4);
  const faction = r.unit.faction;
  while (heap.size > 0) {
    const v = heap.pop();
    const c = heap.lastCost;
    if (c > dist[v]!) continue;
    const enter = g.cost[v]! + (enemyAt(g, v, faction) ? enemyPenalty : 0);
    const nc = c + Math.max(1, enter);
    neighborIdx(g, v, nb);
    for (let k = 0; k < 4; k++) {
      const u = nb[k]!;
      if (u < 0) continue;
      if (!enterable(g, r, u) && u !== self) continue;
      if (nc >= dist[u]!) continue;
      dist[u] = nc;
      heap.push(nc, u);
    }
  }
  return dist;
}

/** Standable tiles from which `u` could hit `target` (range + LOS), ignoring units. */
export function attackTilesAround(g: Grid, u: Unit, target: Pos): Pos[] {
  const { rangeMin, rangeMax } = effectiveStats(u);
  const rules = moveRulesFor(g, u);
  return ringTiles(g, target, rangeMin, rangeMax).filter((t) => enterable(g, rules, idx(g, t)) && los(g, t, target));
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
