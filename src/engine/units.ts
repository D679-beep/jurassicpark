// Unit predicates and derived stats.
import { RULES, TAG_HERO, TAG_NO_RESIST, ZONES } from './data';
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
 * Units that can never take unit actions this phase: sealed units, downed
 * heroes and units tagged noResist (the Emperor).
 */
export function isInert(u: Unit): boolean {
  return hasStatus(u, 'sealed') || hasStatus(u, 'downed') || hasTag(u, TAG_NO_RESIST);
}

/** A hero (tag `hero`): downed instead of killed at 0 HP while it has a revive left. */
export function isHero(u: Unit): boolean {
  return hasTag(u, TAG_HERO);
}

/** A downed hero: 0 HP, on its tile, inert, untargetable, bleeding out. */
export function isDowned(u: Unit): boolean {
  return hasStatus(u, 'downed');
}

/** Whether a hit that takes `u` to 0 HP downs it (true) or kills it (false). */
export function wouldBeDowned(u: Unit): boolean {
  return isHero(u) && u.revives < RULES.maxRevives;
}

/**
 * Round in which a unit downed right now bleeds out: at the start of its own
 * side's phase, after its side has had RULES.bleedOutPhases phases to revive
 * it. A fall during the other side's phase leaves the current round's own
 * phase behind it; a fall during its own side's phase (in practice: round-start
 * damage, before anyone acts) counts that phase as the first. For the rebels
 * (who move first each round) that is round + 3 after a fall in the loyalist
 * phase and round + 2 after one at round start.
 */
export function bleedOutRoundFor(state: GameState, u: Unit): number {
  const ownPhase = u.faction === state.playerFaction ? 'player' : 'ai';
  const ownPhaseAlreadyOver = ownPhase === 'player' && state.phase === 'ai';
  return state.round + RULES.bleedOutPhases + (ownPhaseAlreadyOver ? 1 : 0);
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
