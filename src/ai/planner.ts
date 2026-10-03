// Per-unit planning: pick where to stand and what to do this turn.
//
// A plan is a destination tile plus at most one action, in one of two orders:
//   moveFirst: walk to the tile, then act from there (or just walk);
//   actFirst:  act from the current tile, then walk away (kiting, retreat).
// Score = positionValue(tile) + actionValue(action from where it is taken).
// positionValue depends on the unit's role (see roles.ts) plus common terms:
// expected incoming damage next turn, terrain defense, enemy Domains.
//
// Only the next step of the plan is returned; the caller applies it and the
// AI re-plans from the new state, so plans never go stale.
import {
  TAG_NO_RESIST,
  attackableTargets,
  availableInteractions,
  domainUnavailableReason,
  domainsAt,
  findUnit,
  isInZone,
  lineOfSight,
  manhattan,
  posEq,
  reachableTiles,
  terrainDefense,
  zoneTiles,
  effectiveStats,
  type GameState,
  type Pos,
  type Unit,
} from '../engine';
import { distanceField, enterable, idx, moveRulesFor, ringTiles, type Grid } from './grid';
import { WARD_RADIUS, assignRole, mostThreatenedWard, type Role } from './roles';
import { scoreAttack, scoreDomain, scoreInteraction, targetValue, type ScoredAction } from './scoring';
import { dangerAt, type ThreatMap } from './threat';

export interface AiContext {
  state: GameState;
  grid: Grid;
  threat: ThreatMap;
}

export interface Plan {
  unitId: string;
  role: Role;
  tile: Pos;
  action: ScoredAction | null;
  order: 'moveFirst' | 'actFirst';
  score: number;
}

/** How far outside its zone a guard may stand and still count as holding it. */
export const GUARD_SLACK = 2;
/** A guard engages targets at most this far (Manhattan) from its zone. */
export const GUARD_REACH = 3;

function zoneManhattan(state: GameState, zone: string, p: Pos): number {
  let best = Infinity;
  for (const t of zoneTiles(state, zone)) best = Math.min(best, manhattan(t, p));
  return best;
}

/** Standable tiles from which `u` could hit `target` (range + LOS), ignoring units. */
function attackTilesAround(ctx: AiContext, u: Unit, target: Pos): Pos[] {
  const { rangeMin, rangeMax } = effectiveStats(u);
  const rules = moveRulesFor(ctx.grid, u);
  return ringTiles(ctx.grid, target, rangeMin, rangeMax).filter(
    (t) => enterable(ctx.grid, rules, idx(ctx.grid, t)) && lineOfSight(ctx.state, t, target),
  );
}

/** Characters whose death loses the battle for their side. */
const IRREPLACEABLE = new Set(['varek', 'kaela']);

function riskWeight(u: Unit, role: Role): number {
  if (u.character !== null && IRREPLACEABLE.has(u.character) && u.faction === 'rebel') return 3;
  switch (role.kind) {
    case 'flee':
      return 4;
    case 'duelist':
      return 0;
    case 'breaker':
    case 'guard':
      return 0.5;
    case 'assassin':
      return 1;
    default:
      return u.rank === 'radiant' ? 2 : 1;
  }
}

/** Builds the role-specific term of the position value, as a function of tile. */
function roleTerm(ctx: AiContext, u: Unit, role: Role): (t: Pos) => number {
  const { state, grid } = ctx;
  const rules = moveRulesFor(grid, u);
  const fieldTerm = (goals: Pos[], weight: number, penalty = 3): ((t: Pos) => number) => {
    if (goals.length === 0) return () => 0;
    const f = distanceField(grid, rules, goals, penalty);
    return (t) => {
      const d = f[idx(grid, t)]!;
      return d === Infinity ? -weight * 60 : -weight * d;
    };
  };

  switch (role.kind) {
    case 'inert':
      return () => 0;
    case 'flee':
      return fieldTerm(role.exits, 10, 6);
    case 'duelist': {
      const p = findUnit(state, role.partnerId);
      return p ? fieldTerm(attackTilesAround(ctx, u, p.pos), 4) : () => 0;
    }
    case 'breaker': {
      const goals = state.map.objects
        .filter((o) => o.kind === 'anchor' && !o.destroyed)
        .flatMap((o) => (o.kind === 'anchor' ? attackTilesAround(ctx, u, o.pos) : []));
      return fieldTerm(goals, 5);
    }
    case 'guard': {
      const zt = zoneTiles(state, role.zone);
      const f = distanceField(grid, rules, zt, 3);
      return (t) => {
        const d = f[idx(grid, t)]!;
        const dd = d === Infinity ? zoneManhattan(state, role.zone, t) : d;
        return dd <= GUARD_SLACK ? 0 : -6 * (dd - GUARD_SLACK);
      };
    }
    case 'assassin': {
      const target = findUnit(state, role.targetId);
      return target ? fieldTerm(ringTiles(grid, target.pos, 1, 1), 6) : () => 0;
    }
    case 'reinforce': {
      const w = mostThreatenedWard(state, u);
      if (w) {
        if (w.pressure > 0) {
          // Go for the enemy nearest the threatened ward.
          let best: Unit | null = null;
          for (const e of state.units) {
            if (e.faction === u.faction || e.tags.includes(TAG_NO_RESIST)) continue;
            const d = manhattan(e.pos, w.ward.pos);
            if (d > WARD_RADIUS) continue;
            if (!best || d < manhattan(best.pos, w.ward.pos)) best = e;
          }
          if (best) return fieldTerm([...attackTilesAround(ctx, u, best.pos), ...ringTiles(grid, w.ward.pos, 1, 2)], 4);
        }
        return fieldTerm(ringTiles(grid, w.ward.pos, 1, 2), 4);
      }
      // Nothing to defend: hunt, preferring valuable targets.
      let prey: Unit | null = null;
      let preyScore = Infinity;
      for (const e of state.units) {
        if (e.faction === u.faction || e.tags.includes(TAG_NO_RESIST)) continue;
        const s = manhattan(e.pos, u.pos) - targetValue(u, e) / 10;
        if (s < preyScore) {
          prey = e;
          preyScore = s;
        }
      }
      return prey ? fieldTerm(attackTilesAround(ctx, u, prey.pos), 4) : () => 0;
    }
  }
}

/**
 * Standing next to the Emperor denies Varek a Confront tile (he must kill the
 * blocker first). Guards of the Emperor's zone always like those tiles; once
 * the confronter is within striking distance every defender values them above
 * its own safety.
 */
function postBonus(state: GameState, u: Unit, role: Role): (t: Pos) => number {
  if (role.kind !== 'guard' && role.kind !== 'reinforce') return () => 0;
  const vips = state.units.filter((a) => a.faction === u.faction && a.tags.includes(TAG_NO_RESIST));
  const confronter = state.units.find((e) => e.faction !== u.faction && e.character === 'varek');
  const weights = vips.map((vip) => {
    const near = confronter !== undefined && manhattan(confronter.pos, vip.pos) <= CONFRONT_ALERT;
    if (near) return 40;
    return role.kind === 'guard' && isInZone(state, vip.pos, role.zone) ? 10 : 0;
  });
  if (weights.every((w) => w === 0)) return () => 0;
  return (t) => {
    let v = 0;
    vips.forEach((vip, i) => {
      if (manhattan(t, vip.pos) !== 1) return;
      v += weights[i]!;
      if (posEq(t, u.pos)) v += 5; // keep the post: swapping posts just moves the gap
    });
    return v;
  };
}

/** Manhattan distance at which Varek counts as closing in on the Emperor. */
export const CONFRONT_ALERT = 12;

function domainPenalty(state: GameState, u: Unit, t: Pos): number {
  let p = 0;
  for (const d of domainsAt(state, t)) {
    if (d.faction === u.faction || d.ownerId === u.id) continue;
    p += d.kind === 'tempest' || d.kind === 'pyre' ? 12 : d.kind === 'sanctuary' ? 6 : 0;
  }
  return p;
}

export function positionEvaluator(ctx: AiContext, u: Unit, role: Role): (t: Pos) => number {
  const term = roleTerm(ctx, u, role);
  const post = postBonus(ctx.state, u, role);
  const rw = riskWeight(u, role);
  return (t) => {
    let v = term(t) + post(t);
    if (rw > 0) {
      const d = dangerAt(ctx.grid, ctx.threat, u, t);
      v -= rw * d.damage;
      if (d.lethal) v -= rw * 25;
      if (role.kind === 'flee') v -= d.count * 6 + (d.captureRisk ? 150 : 0);
    }
    v += terrainDefense(ctx.state, t) * 2;
    v -= domainPenalty(ctx.state, u, t);
    if (posEq(t, u.pos)) v += 1; // do not shuffle for nothing
    return v;
  };
}

/** Best action available from `at` (null when nothing scores above zero). */
function bestActionAt(ctx: AiContext, u: Unit, role: Role, at: Pos, allowDomain: boolean, attackScale: number): ScoredAction | null {
  if (u.hasActed) return null;
  const { state } = ctx;
  let best: ScoredAction | null = null;
  const consider = (a: ScoredAction): void => {
    if (a.value > 0 && (!best || a.value > best.value)) best = a;
  };
  if (attackScale > 0) {
    for (const t of attackableTargets(state, u.id, at)) {
      if (role.kind === 'guard' && zoneManhattan(state, role.zone, t.pos) > GUARD_REACH) continue;
      consider({ kind: 'attack', targetId: t.id, value: scoreAttack(state, u, t.id, at, role) * attackScale });
    }
  }
  const moved: Unit = { ...u, pos: at };
  for (const i of availableInteractions(state, moved)) {
    consider({ kind: 'interact', targetId: i.targetId, interaction: i.interaction, value: scoreInteraction(i.interaction) });
  }
  if (allowDomain && domainUnavailableReason(state, u) === null) {
    consider({ kind: 'domain', targetId: null, value: scoreDomain(state, u, at) });
  }
  return best;
}

export function planUnit(ctx: AiContext, u: Unit): Plan {
  const role = assignRole(ctx.state, u);
  const posValue = positionEvaluator(ctx, u, role);
  const tiles = u.hasMoved ? [u.pos] : [u.pos, ...reachableTiles(ctx.state, u.id)];
  const values = tiles.map(posValue);

  let attackScale = 1;
  if (role.kind === 'flee') {
    // Mira may take a free shot; Elian (his Vow) only fights when cornered.
    attackScale = 0.1;
    if (role.attacksOnlyIfCornered) {
      const f = distanceField(ctx.grid, moveRulesFor(ctx.grid, u), role.exits, 6);
      const here = f[idx(ctx.grid, u.pos)]!;
      const canRun = here !== Infinity && tiles.some((t) => f[idx(ctx.grid, t)]! < here);
      attackScale = canRun ? 0 : 1;
    }
  }

  let best: Plan = { unitId: u.id, role, tile: u.pos, action: null, order: 'moveFirst', score: -Infinity };
  tiles.forEach((t, i) => {
    const a = bestActionAt(ctx, u, role, t, true, attackScale);
    const s = values[i]! + (a?.value ?? 0);
    if (s > best.score) best = { unitId: u.id, role, tile: t, action: a, order: 'moveFirst', score: s };
  });

  if (!u.hasMoved && !u.hasActed) {
    const a = bestActionAt(ctx, u, role, u.pos, false, attackScale);
    if (a) {
      let bi = 0;
      values.forEach((v, i) => {
        if (v > values[bi]!) bi = i;
      });
      const s = a.value + values[bi]!;
      if (s > best.score) best = { unitId: u.id, role, tile: tiles[bi]!, action: a, order: 'actFirst', score: s };
    }
  }
  return best;
}
