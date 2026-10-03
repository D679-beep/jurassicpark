// Tactical toolkit for scripted rebel players in the balance simulator.
//
// A strategy gives every rebel unit an Order each phase (where to go, what it
// may attack, which interactions and Domain it may use, how careful to be).
// `planTurn` turns an Order into concrete actions with a one-turn greedy
// search over every reachable tile, scored as:
//   - distance to the order's goal tiles (a reverse Dijkstra field),
//   - expected incoming damage next AI phase (the AI's own threat map),
//   - the best action available from that tile (attack value, interaction,
//     Domain).
// Every action is taken from getLegalActions, so scripted players can never
// do anything a human could not.
import {
  applyAction,
  attackableTargets,
  availableInteractions,
  domainUnavailableReason,
  findUnit,
  getLegalActions,
  isAscendant,
  isInZone,
  manhattan,
  posEq,
  previewDamage,
  reachableTiles,
  terrainDefense,
  unitAttackDamage,
  type Action,
  type GameEvent,
  type GameState,
  type InteractionKind,
  type Pos,
  type Unit,
} from '../../src/engine';
import { buildGrid, distanceField, idx, moveRulesFor, ringTiles, type Grid } from '../../src/ai/grid';
import { computeThreat } from '../../src/ai/threat';

export interface Order {
  /** Tiles to head for. Empty: no pull, the unit fights where it stands. */
  goals: Pos[];
  /** Score lost per tile of distance to the nearest goal (default 4). */
  goalWeight?: number;
  /** Weight on expected incoming damage (default 1). Lethal tiles cost a lot more. */
  risk?: number;
  /** Never end on a tile where the worst-case focus fire (max rolls) would kill the unit. */
  avoidLethal?: boolean;
  /** Interactions the unit may perform, optionally pinned to a target id. */
  interactions?: { kind: InteractionKind; targetId?: string; value?: number }[];
  /** Destructible objects the unit is allowed to attack, with a value weight. */
  objects?: Record<string, number>;
  /** Extra value per enemy unit id (focus fire), added to the default scorer. */
  focus?: Record<string, number>;
  /** Only attack these unit ids (plus objects). */
  onlyTargets?: string[];
  /** Domain policy: value of activating from `at` (<= 0 means no). */
  domain?: (s: GameState, u: Unit, at: Pos) => number;
  /** Never step outside this zone. */
  confine?: string;
  /** Do not move at all. */
  hold?: boolean;
  /** Skip the unit entirely this phase. */
  idle?: boolean;
}

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function worth(t: Unit): number {
  switch (t.character) {
    case 'orsa':
    case 'elian':
      return 25;
    case 'mira':
      return 0;
    default:
  }
  switch (t.rank) {
    case 'ascendant':
      return 25;
    case 'radiant':
      return 12;
    case 'kindled':
      return 10;
    default:
      return 6;
  }
}

/** Default value of attacking `targetId` from `from`; null when the order forbids it. */
export function attackValue(s: GameState, u: Unit, targetId: string, from: Pos, order: Order): number | null {
  const p = previewDamage(s, u.id, targetId, from);
  if (!p) return null;
  const exp = avg(p.outcomes);
  const killP = p.outcomes.filter((d) => d >= p.targetHp).length / p.outcomes.length;
  const target = findUnit(s, targetId);
  if (!target) {
    const w = order.objects?.[targetId];
    if (w === undefined) return null;
    return w * (exp + killP * 10);
  }
  if (order.onlyTargets && !order.onlyTargets.includes(targetId)) return null;
  const focus = order.focus?.[targetId] ?? 0;
  if (target.character === 'mira') {
    const aboveHalf = target.hp * 2 > target.maxHp;
    if (u.character === 'kaela') return aboveHalf ? 60 + exp * 5 + focus : null;
    // A Wolf may soften Mira only while no roll can kill her and she is above half.
    if (!aboveHalf || p.max >= target.hp) return null;
    return 30 + exp * 3 + focus;
  }
  if (!isAscendant(u) && isAscendant(target)) return (killP > 0 ? 200 : 2) + focus;
  return killP * (60 + worth(target) * 3) + exp * 3 + worth(target) + focus;
}

export interface PlannedTurn {
  actions: Action[];
  score: number;
}

interface ActOption {
  action: Action;
  value: number;
}

function bestActionAt(s: GameState, u: Unit, at: Pos, order: Order, allowDomain: boolean): ActOption | null {
  if (u.hasActed) return null;
  let best: ActOption | null = null;
  const consider = (o: ActOption): void => {
    if (o.value > 0 && (!best || o.value > best.value)) best = o;
  };
  for (const t of attackableTargets(s, u.id, at)) {
    const v = attackValue(s, u, t.id, at, order);
    if (v !== null) consider({ action: { kind: 'attack', unitId: u.id, targetId: t.id }, value: v });
  }
  const moved: Unit = { ...u, pos: at };
  for (const i of availableInteractions(s, moved)) {
    const want = order.interactions?.find((w) => w.kind === i.interaction && (w.targetId === undefined || w.targetId === i.targetId));
    if (!want) continue;
    const base = i.interaction === 'confront' ? 100000 : i.interaction === 'capture' ? 50000 : 300;
    consider({ action: { kind: 'interact', unitId: u.id, interaction: i.interaction, targetId: i.targetId }, value: want.value ?? base });
  }
  if (allowDomain && order.domain && domainUnavailableReason(s, u) === null) {
    consider({ action: { kind: 'domain', unitId: u.id }, value: order.domain(s, u, at) });
  }
  return best;
}

/** One unit's turn under `order`: [move?, action?] or [action, move?]. */
export function planTurn(s: GameState, unitId: string, order: Order, grid: Grid = buildGrid(s)): PlannedTurn {
  const u = findUnit(s, unitId);
  if (!u || order.idle) return { actions: [], score: 0 };
  let tiles: Pos[] = [u.pos];
  if (!u.hasMoved && !order.hold) tiles = tiles.concat(reachableTiles(s, u.id));
  if (order.confine) tiles = tiles.filter((t) => isInZone(s, t, order.confine!));
  if (tiles.length === 0) tiles = [u.pos];

  const rules = moveRulesFor(grid, u);
  const field = order.goals.length > 0 ? distanceField(grid, rules, order.goals, 3) : null;
  const gw = order.goalWeight ?? 4;
  const risk = order.risk ?? 1;
  const threat = risk > 0 ? computeThreat(grid, u.faction, u.id) : null;
  const dangerOf = (t: Pos, removed: string | null): { exp: number; worst: number } => {
    const moved: Unit = { ...u, pos: t };
    let exp = 0;
    let worst = 0;
    if (!threat) return { exp, worst };
    for (const ei of threat.byTile[idx(grid, t)] ?? []) {
      const e = threat.enemies[ei]!;
      if (e.id === removed) continue;
      // A duelist can only hit the other duelist.
      if (e.statuses.includes('dueling') && !u.statuses.includes('dueling')) continue;
      exp += unitAttackDamage(s, e, moved, e.pos, 1);
      worst += unitAttackDamage(s, e, moved, e.pos, 2);
    }
    return { exp, worst };
  };
  /** Value of ending the turn on `t`; `removed` is an enemy this turn's action takes off the board. */
  const posValue = (t: Pos, removed: string | null = null): number => {
    let v = 0;
    if (field) {
      const d = field[idx(grid, t)]!;
      v -= d === Infinity ? 1000 : gw * d;
    }
    if (threat) {
      const d = dangerOf(t, removed);
      v -= risk * d.exp;
      if (d.exp >= u.hp) v -= risk * 60;
      if (order.avoidLethal && d.worst >= u.hp) v -= 5000;
    }
    v += terrainDefense(s, t) * 0.5;
    if (posEq(t, u.pos)) v += 0.25;
    return v;
  };
  const removes = (a: ActOption | null, at: Pos): string | null => {
    if (!a) return null;
    if (a.action.kind === 'interact' && a.action.interaction === 'capture') return a.action.targetId;
    if (a.action.kind === 'attack') {
      const p = previewDamage(s, u.id, a.action.targetId, at);
      if (p?.willKill) return a.action.targetId;
    }
    return null;
  };
  const values = tiles.map((t) => posValue(t));

  let best: PlannedTurn = { actions: [], score: -Infinity };
  tiles.forEach((t, i) => {
    const a = bestActionAt(s, u, t, order, true);
    const gone = removes(a, t);
    const score = (gone ? posValue(t, gone) : values[i]!) + (a?.value ?? 0);
    if (score > best.score) {
      const acts: Action[] = [];
      if (!posEq(t, u.pos)) acts.push({ kind: 'move', unitId: u.id, to: t });
      if (a) acts.push(a.action);
      best = { actions: acts, score };
    }
  });
  if (!u.hasMoved && !u.hasActed && !order.hold) {
    const a = bestActionAt(s, u, u.pos, order, true);
    if (a) {
      const gone = removes(a, u.pos);
      const after = gone ? tiles.map((t) => posValue(t, gone)) : values;
      let bi = 0;
      after.forEach((v, i) => {
        if (v > after[bi]!) bi = i;
      });
      const score = a.value + after[bi]!;
      if (score > best.score) {
        const acts: Action[] = [a.action];
        if (!posEq(tiles[bi]!, u.pos)) acts.push({ kind: 'move', unitId: u.id, to: tiles[bi]! });
        best = { actions: acts, score };
      }
    }
  }
  return best;
}

function sameAction(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Applies `a` if it is currently legal; returns the new state and events, or null. */
export function tryApply(s: GameState, a: Action): { state: GameState; events: GameEvent[] } | null {
  if (s.gameOver) return null;
  if (a.kind !== 'endTurn' && !getLegalActions(s, a.unitId).some((l) => sameAction(l, a))) return null;
  return applyAction(s, a);
}

/** Plays one unit's planned turn. A move-then-act is re-planned after the move. */
export function playUnit(s: GameState, unitId: string, order: Order): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let state = s;
  for (let step = 0; step < 3 && !state.gameOver; step++) {
    const u = findUnit(state, unitId);
    if (!u || (u.hasMoved && u.hasActed)) break;
    const plan = planTurn(state, unitId, order);
    const first = plan.actions[0];
    if (!first) break;
    const r = tryApply(state, first);
    if (!r) break;
    state = r.state;
    events.push(...r.events);
    // After acting first, the loop re-plans the move with the new board
    // (a kill may have freed the tile the unit wants).
  }
  return { state, events };
}

// --- geometry helpers ---------------------------------------------------------

export function adjacentTiles(p: Pos): Pos[] {
  return [
    { x: p.x, y: p.y - 1 },
    { x: p.x + 1, y: p.y },
    { x: p.x, y: p.y + 1 },
    { x: p.x - 1, y: p.y },
  ];
}

export function ring(s: GameState, p: Pos, min: number, max: number): Pos[] {
  return ringTiles(buildGrid(s), p, min, max);
}

export function enemiesWithin(s: GameState, u: Unit, at: Pos, r: number): Unit[] {
  return s.units.filter((e) => e.faction !== u.faction && !e.tags.includes('noResist') && manhattan(e.pos, at) <= r);
}
