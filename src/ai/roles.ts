// Role assignment: what each AI unit is trying to do this phase.
//
// Roles are derived from the state every call (never stored), keyed by
// character ids, tags and guardZone so the same code can drive either side:
//   flee       escapee with a usable exit (Mira; Elian once unsealed)
//   duelist    bound by the Feast Hall duel (Orsa while dueling)
//   breaker    tag anchorBreaker while the seal over an ally still holds
//   guard      has a guardZone
//   assassin   a unit with a set-piece interaction against an enemy
//              (Varek -> Confront Halden, Kaela -> Capture Mira); rebel AI only
//   reinforce  everyone else (wave units, a freed Orsa, breakers after the
//              seal broke): head for the most threatened thing worth defending
import {
  TAG_ANCHOR_BREAKER,
  TAG_ESCAPEE,
  TAG_NO_RESIST,
  duelPartner,
  findCharacter,
  hasStatus,
  hasTag,
  hasZone,
  isAscendant,
  isDueling,
  isInert,
  type Exit,
  type GameState,
  type Pos,
  type Unit,
} from '../engine';
import { pressureNear } from './threat';

export type Role =
  | { kind: 'inert' }
  | { kind: 'flee'; exits: Pos[]; attacksOnlyIfCornered: boolean }
  | { kind: 'duelist'; partnerId: string }
  | { kind: 'breaker' }
  | { kind: 'guard'; zone: string }
  | { kind: 'assassin'; targetId: string }
  | { kind: 'reinforce' };

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

export function assignRole(state: GameState, u: Unit): Role {
  if (isInert(u)) return { kind: 'inert' };
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
  if (u.guardZone !== null && hasZone(state, u.guardZone)) return { kind: 'guard', zone: u.guardZone };
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
