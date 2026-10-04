// Movement: Dijkstra over terrain move cost, 4-directional (N, E, S, W).
// Ties are broken by insertion order, so paths are deterministic.
//
// A unit may step onto a tile when it is in bounds, its terrain is passable,
// it holds no intact barred door or ward anchor, it holds no enemy unit, it is
// not inside an enemy Bulwark, and (for a pinned duelist) it is inside
// feastHall. Allies may be passed through but not ended on.
import { TERRAIN, ZONES } from './data';
import { comparePos, neighbors4, posEq, posKey } from './geometry';
import { domainTiles } from './domains';
import { blockingObjectAt, findUnit, inBounds, terrainAt, unitAt, zoneTiles } from './map';
import { canLeaveDuel, effectiveStats, hasStatus, isDuelActive, isInert } from './units';
import type { GameState, Pos, Unit } from './types';

export interface PathOptions {
  /** Plan beyond this turn's movement budget (for AI planning). */
  ignoreMoveLimit?: boolean;
  /** Treat every unit as absent (for AI planning around temporary blockers). */
  ignoreUnits?: boolean;
}

interface FieldNode {
  pos: Pos;
  cost: number;
  prev: string | null;
}

class MinHeap {
  private items: { cost: number; seq: number; pos: Pos }[] = [];
  get size(): number {
    return this.items.length;
  }
  private less(i: number, j: number): boolean {
    const a = this.items[i]!;
    const b = this.items[j]!;
    return a.cost < b.cost || (a.cost === b.cost && a.seq < b.seq);
  }
  private swap(i: number, j: number): void {
    const t = this.items[i]!;
    this.items[i] = this.items[j]!;
    this.items[j] = t;
  }
  push(item: { cost: number; seq: number; pos: Pos }): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): { cost: number; seq: number; pos: Pos } | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.less(l, m)) m = l;
        if (r < this.items.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

interface MoveConstraints {
  enemyBulwark: Set<string>;
  /** When non-null, the unit may only step on these tiles (pinned duelist). */
  confinedTo: Set<string> | null;
}

function constraintsFor(state: GameState, unit: Unit): MoveConstraints {
  const enemyBulwark = new Set<string>();
  for (const d of state.domains) {
    if (d.kind === 'bulwark' && d.faction !== unit.faction) {
      for (const t of domainTiles(state, d)) enemyBulwark.add(posKey(t));
    }
  }
  let confinedTo: Set<string> | null = null;
  if (hasStatus(unit, 'dueling') && isDuelActive(state) && !canLeaveDuel(state, unit)) {
    confinedTo = new Set(zoneTiles(state, ZONES.feastHall).map(posKey));
  }
  return { enemyBulwark, confinedTo };
}

/** Cost to step onto `p` for `unit`, or null if it cannot enter. */
function stepCost(
  state: GameState,
  unit: Unit,
  p: Pos,
  c: MoveConstraints,
  ignoreUnits: boolean,
): number | null {
  if (!inBounds(state, p)) return null;
  const t = terrainAt(state, p);
  if (!t) return null;
  const cost = TERRAIN[t].moveCost;
  if (cost === null) return null;
  if (blockingObjectAt(state, p)) return null;
  const k = posKey(p);
  if (c.enemyBulwark.has(k)) return null;
  if (c.confinedTo && !c.confinedTo.has(k)) return null;
  if (!ignoreUnits) {
    const other = unitAt(state, p);
    if (other && other.faction !== unit.faction) return null;
  }
  return cost;
}

function movementField(state: GameState, unit: Unit, opts: PathOptions): Map<string, FieldNode> {
  const budget = opts.ignoreMoveLimit ? Number.POSITIVE_INFINITY : effectiveStats(unit).move;
  const ignoreUnits = opts.ignoreUnits === true;
  const c = constraintsFor(state, unit);
  const field = new Map<string, FieldNode>();
  const done = new Set<string>();
  const heap = new MinHeap();
  let seq = 0;
  field.set(posKey(unit.pos), { pos: unit.pos, cost: 0, prev: null });
  heap.push({ cost: 0, seq: seq++, pos: unit.pos });
  while (heap.size > 0) {
    const cur = heap.pop()!;
    const k = posKey(cur.pos);
    if (done.has(k)) continue;
    done.add(k);
    for (const n of neighbors4(cur.pos)) {
      const step = stepCost(state, unit, n, c, ignoreUnits);
      if (step === null) continue;
      const nc = cur.cost + step;
      if (nc > budget) continue;
      const nk = posKey(n);
      const existing = field.get(nk);
      if (!existing || nc < existing.cost) {
        field.set(nk, { pos: n, cost: nc, prev: k });
        heap.push({ cost: nc, seq: seq++, pos: n });
      }
    }
  }
  return field;
}

function canEndOn(state: GameState, unit: Unit, p: Pos, ignoreUnits: boolean): boolean {
  if (ignoreUnits) return true;
  const other = unitAt(state, p);
  return other === undefined || other.id === unit.id;
}

/**
 * Tiles the unit can move to right now (excluding its current tile), sorted
 * row-major. Empty if the unit has moved, cannot act, or it is not its turn.
 */
export function reachableTiles(state: GameState, unitId: string): Pos[] {
  const unit = findUnit(state, unitId);
  if (!unit || state.gameOver) return [];
  if (unit.faction !== state.activeFaction || unit.hasMoved || isInert(unit)) return [];
  const field = movementField(state, unit, {});
  const out: Pos[] = [];
  for (const node of field.values()) {
    if (posEq(node.pos, unit.pos)) continue;
    if (canEndOn(state, unit, node.pos, false)) out.push(node.pos);
  }
  return out.sort(comparePos);
}

/**
 * Cheapest path for the unit to `to`, excluding its start tile and ending at
 * `to`; `[]` if already there; null if unreachable. Applies the unit's
 * movement rules but not turn flags (hasMoved, phase), so the AI can plan.
 */
export function pathTo(state: GameState, unitId: string, to: Pos, opts: PathOptions = {}): Pos[] | null {
  const unit = findUnit(state, unitId);
  if (!unit) return null;
  if (posEq(unit.pos, to)) return [];
  const field = movementField(state, unit, opts);
  const target = field.get(posKey(to));
  if (!target || !canEndOn(state, unit, to, opts.ignoreUnits === true)) return null;
  const path: Pos[] = [];
  let node: FieldNode | undefined = target;
  while (node && node.prev !== null) {
    path.push(node.pos);
    node = field.get(node.prev);
  }
  return path.reverse();
}

/** Total move cost of `pathTo`, or null if unreachable. */
export function pathCost(state: GameState, unitId: string, to: Pos, opts: PathOptions = {}): number | null {
  const unit = findUnit(state, unitId);
  if (!unit) return null;
  if (posEq(unit.pos, to)) return 0;
  const node = movementField(state, unit, opts).get(posKey(to));
  if (!node || !canEndOn(state, unit, to, opts.ignoreUnits === true)) return null;
  return node.cost;
}
