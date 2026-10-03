// Unit predicates and derived stats.
import { RULES, TAG_NO_RESIST, ZONES } from './data';
import { findUnit, isInZone } from './map';
import type { GameState, Status, Unit } from './types';

export function hasStatus(u: Unit, s: Status): boolean {
  return u.statuses.includes(s);
}

export function hasTag(u: Unit, tag: string): boolean {
  return u.tags.includes(tag);
}

export function isAscendant(u: Unit): boolean {
  return u.rank === 'ascendant';
}

export function isEnemy(a: Unit, b: Unit): boolean {
  return a.faction !== b.faction;
}

export interface EffectiveStats {
  atk: number;
  def: number;
  move: number;
  rangeMin: number;
  rangeMax: number;
}

/** Stats after Drained (-2 ATK, -1 move). */
export function effectiveStats(u: Unit): EffectiveStats {
  const drained = hasStatus(u, 'drained');
  return {
    atk: Math.max(0, u.atk - (drained ? RULES.drainAtk : 0)),
    def: u.def,
    move: Math.max(0, u.move - (drained ? RULES.drainMove : 0)),
    rangeMin: u.range.min,
    rangeMax: u.range.max,
  };
}

/**
 * Units that can never take unit actions this phase: sealed units and units
 * tagged noResist (the Emperor).
 */
export function isInert(u: Unit): boolean {
  return hasStatus(u, 'sealed') || hasTag(u, TAG_NO_RESIST);
}

/**
 * The Feast Hall duel is in force while both duelists are in play, both still
 * carry `dueling`, and both stand inside feastHall.
 */
export function isDuelActive(state: GameState): boolean {
  const duel = state.duel;
  if (!duel || !duel.active) return false;
  return duel.unitIds.every((id) => {
    const u = findUnit(state, id);
    return u !== undefined && hasStatus(u, 'dueling') && isInZone(state, u.pos, ZONES.feastHall);
  });
}

/** True when `u` is currently bound by an active duel. */
export function isDueling(state: GameState, u: Unit): boolean {
  return hasStatus(u, 'dueling') && isDuelActive(state);
}

/** The other duelist, if `u` is in an active duel. */
export function duelPartner(state: GameState, u: Unit): Unit | undefined {
  if (!isDueling(state, u) || !state.duel) return undefined;
  const otherId = state.duel.unitIds.find((id) => id !== u.id);
  return otherId === undefined ? undefined : findUnit(state, otherId);
}

/**
 * Interpretation: the spec says neither duelist may leave feastHall, but also
 * that the player may move Grimm out to end the duel. Resolved as: the
 * duelist belonging to the player's faction may walk out (ending the duel);
 * the AI faction's duelist is pinned inside feastHall.
 */
export function canLeaveDuel(state: GameState, u: Unit): boolean {
  return u.faction === state.playerFaction;
}
