// Role assignment: what each AI unit is trying to do this phase.
//
// Roles are derived from the state every call (never stored), keyed by
// character ids, tags and guardZone so the same code can drive either side:
//   flee       escapee with a usable exit (Mira; Elian once unsealed)
//   duelist    bound by the Feast Hall duel (Orsa while dueling)
//   breaker    tag anchorBreaker while the seal over an ally still holds
//   guard      has a guardZone that still means something: an allied ward
//              stands in it, or it is a plain area post that never had one
//              (a guard whose ward died or walked out escorts the ward or
//              joins the reinforcements)
//   assassin   a unit with a set-piece interaction against an enemy
//              (Varek -> Confront Halden, Kaela -> Capture Mira); rebel AI only
//   reinforce  everyone else (wave units, a freed Orsa, breakers after the
//              seal broke): head for the most threatened thing worth
//              defending, or hunt when nothing is left to defend
import {
  TAG_ANCHOR_BREAKER,
  TAG_ESCAPEE,
  TAG_NO_RESIST,
  duelPartner,
  findCharacter,
  findUnit,
  hasStatus,
  hasTag,
  hasZone,
  isAscendant,
  isDueling,
  isInert,
  isInZone,
  manhattan,
  zoneTiles,
  type Exit,
  type GameState,
  type Pos,
  type Unit,
} from '../engine';
import { attackTilesAround, ringTiles, type Grid } from './grid';
import { targetValue } from './scoring';
import { pressureNear } from './threat';

export type Role =
  | { kind: 'inert' }
  | { kind: 'flee'; exits: Pos[]; attacksOnlyIfCornered: boolean }
  | { kind: 'duelist'; partnerId: string }
  | { kind: 'breaker' }
  | { kind: 'guard'; zone: string }
  | { kind: 'assassin'; targetId: string }
  | { kind: 'reinforce'; wardId?: string };

export function exitAllows(e: Exit, u: Unit): boolean {
  return e.units.length === 0 || e.units.includes(u.id) || (u.character !== null && e.units.includes(u.character));
}

/** Exit tiles the unit may escape through (only escapees can use the escape interaction). */
export function exitTilesFor(state: GameState, u: Unit): Pos[] {
  if (!hasTag(u, TAG_ESCAPEE)) return [];
  return state.map.exits.filter((e) => exitAllows(e, u)).flatMap((e) => e.tiles);
}

/** True while intact ward anchors keep a unit of `u`'s faction sealed. */
export function anchorsHoldAlly(state: GameState, u: Unit): boolean {
  if (state.sealBroken) return false;
  const sealedAlly = state.units.some((x) => x.faction === u.faction && hasStatus(x, 'sealed'));
  return sealedAlly && state.map.objects.some((o) => o.kind === 'anchor' && !o.destroyed);
}

function isWard(a: Unit): boolean {
  return hasTag(a, TAG_NO_RESIST) || hasTag(a, TAG_ESCAPEE) || hasStatus(a, 'sealed');
}

/** Within `slack` (Manhattan) of the zone. */
function nearZone(state: GameState, zone: string, p: Pos, slack: number): boolean {
  if (isInZone(state, p, zone)) return true;
  if (slack <= 0) return false;
  return zoneTiles(state, zone).some((t) => manhattan(t, p) <= slack);
}

/**
 * What a guard of `zone` is for right now:
 *   'guard'  an allied ward is in (or next to) the zone, or the zone never
 *            held one (a plain area post such as the bell tower);
 *   a ward id  the zone's escapee has left it: escort her;
 *   null     the zone's ward is gone (the Emperor died there): nothing left
 *            to guard.
 */
export function guardDuty(state: GameState, u: Unit, zone: string): 'guard' | string | null {
  for (const a of state.units) {
    if (a.faction === u.faction && a.id !== u.id && isWard(a) && nearZone(state, zone, a.pos, 1)) return 'guard';
  }
  // An escapee whose exit belongs to this zone has walked out: escort her.
  for (const a of state.units) {
    if (a.faction !== u.faction || !hasTag(a, TAG_ESCAPEE)) continue;
    if (state.map.exits.some((e) => e.zone === zone && exitAllows(e, a))) return a.id;
  }
  // A ward of ours left play from inside the zone: the post is empty for good.
  for (const r of state.removedUnits) {
    if (r.unit.faction === u.faction && isWard(r.unit) && nearZone(state, zone, r.unit.pos, 1)) return null;
  }
  // Same for an escapee whose exit belonged to this zone.
  for (const r of state.removedUnits) {
    if (r.unit.faction !== u.faction || !hasTag(r.unit, TAG_ESCAPEE)) continue;
    if (state.map.exits.some((e) => e.zone === zone && exitAllows(e, r.unit))) return null;
  }
  return 'guard';
}

export function assignRole(state: GameState, u: Unit): Role {
  if (isInert(u) || u.hp <= 0) return { kind: 'inert' };
  if (isDueling(state, u)) {
    const partner = duelPartner(state, u);
    if (partner) return { kind: 'duelist', partnerId: partner.id };
  }
  const exits = exitTilesFor(state, u);
  if (exits.length > 0) {
    // Elian's Vow: he runs, and fights only when there is nowhere to run.
    return { kind: 'flee', exits, attacksOnlyIfCornered: u.character === 'elian' };
  }
  if (hasTag(u, TAG_ANCHOR_BREAKER) && anchorsHoldAlly(state, u)) return { kind: 'breaker' };
  if (u.guardZone !== null && hasZone(state, u.guardZone)) {
    const duty = guardDuty(state, u, u.guardZone);
    if (duty === 'guard') return { kind: 'guard', zone: u.guardZone };
    if (duty !== null) return { kind: 'reinforce', wardId: duty };
    return { kind: 'reinforce' };
  }
  if (u.character === 'varek') {
    const h = findCharacter(state, 'halden');
    if (h && h.faction !== u.faction) return { kind: 'assassin', targetId: h.id };
  }
  if (u.character === 'kaela') {
    const m = findCharacter(state, 'mira');
    if (m && m.faction !== u.faction) return { kind: 'assassin', targetId: m.id };
  }
  return { kind: 'reinforce' };
}

// --- what a faction defends --------------------------------------------------

export interface Ward {
  unitId: string;
  /** Spec priority: the Emperor (Throne Hall) 3, Mira (Princess Tower) 2, Elian (Wellspring Hall) 1. */
  weight: number;
}

/**
 * Allied units worth defending, by spec priority. noResist units (the Emperor)
 * first, then non-Ascendant escapees (Mira), then Ascendant escapees or sealed
 * units (Elian). Each objective is defended where its unit currently is, so
 * a fleeing Mira or Elian is escorted rather than her empty tower.
 */
export function wardsOf(state: GameState, u: Unit): Ward[] {
  const out: Ward[] = [];
  for (const a of state.units) {
    if (a.faction !== u.faction || a.id === u.id) continue;
    if (hasTag(a, TAG_NO_RESIST)) out.push({ unitId: a.id, weight: 3 });
    else if (hasTag(a, TAG_ESCAPEE) && !isAscendant(a)) out.push({ unitId: a.id, weight: 2 });
    else if ((hasTag(a, TAG_ESCAPEE) && isAscendant(a)) || hasStatus(a, 'sealed')) out.push({ unitId: a.id, weight: 1 });
  }
  return out;
}

export const WARD_RADIUS = 12;

/** The ward under the most pressure (weight x nearby enemies), or null if none. */
export function mostThreatenedWard(state: GameState, u: Unit): { ward: Unit; pressure: number } | null {
  let best: { ward: Unit; pressure: number; score: number } | null = null;
  for (const w of wardsOf(state, u)) {
    const ward = state.units.find((x) => x.id === w.unitId)!;
    const pressure = pressureNear(state, u.faction, ward.pos, WARD_RADIUS);
    const score = w.weight * (0.3 + pressure);
    if (!best || score > best.score) best = { ward, pressure, score };
  }
  return best ? { ward: best.ward, pressure: best.pressure } : null;
}

/** An enemy worth chasing: not the untouchable Emperor, not out of the fight. */
function huntable(e: Unit): boolean {
  return !hasTag(e, TAG_NO_RESIST) && e.hp > 0 && !isInert(e);
}

/**
 * The most valuable reachable prey when there is nothing left to defend:
 * value to this hunter (a non-Ascendant barely scratches an Ascendant)
 * against distance.
 */
export function preyFor(state: GameState, u: Unit): Unit | null {
  let prey: Unit | null = null;
  let best = -Infinity;
  for (const e of state.units) {
    if (e.faction === u.faction || !huntable(e)) continue;
    let v = targetValue(u, e);
    if (!isAscendant(u) && isAscendant(e)) v = 4;
    const s = v * 2 - manhattan(e.pos, u.pos) * 3;
    if (s > best) {
      prey = e;
      best = s;
    }
  }
  return prey;
}

/** Goal tiles for a reinforcement: around the ward it defends, at the enemies pressing it, or at its prey. */
export function reinforceGoals(state: GameState, g: Grid, u: Unit, role?: Role): Pos[] {
  const wardId = role && role.kind === 'reinforce' ? role.wardId : undefined;
  const fixed = wardId ? findUnit(state, wardId) : undefined;
  const w = fixed ? { ward: fixed, pressure: pressureNear(state, u.faction, fixed.pos, WARD_RADIUS) } : mostThreatenedWard(state, u);
  if (w) {
    if (w.pressure > 0) {
      // Go for the enemy nearest the threatened ward.
      let best: Unit | null = null;
      for (const e of state.units) {
        if (e.faction === u.faction || !huntable(e)) continue;
        const d = manhattan(e.pos, w.ward.pos);
        if (d > WARD_RADIUS) continue;
        if (!best || d < manhattan(best.pos, w.ward.pos)) best = e;
      }
      if (best) return [...attackTilesAround(g, u, best.pos), ...ringTiles(g, w.ward.pos, 1, 2)];
    }
    return ringTiles(g, w.ward.pos, 1, 2);
  }
  const prey = preyFor(state, u);
  return prey ? attackTilesAround(g, u, prey.pos) : [];
}
