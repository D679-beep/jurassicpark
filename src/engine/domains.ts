// Read-only Domain queries. Mutations (activation, ticks, expiry) live in effects.ts.
//
// Domain lifetime (unambiguous counting):
//   A Domain activated during round R (in either phase) is active for the rest
//   of round R and for all of rounds R+1 and R+2 ("lasts 3 rounds", the
//   activation round counting as the first). It expires at the START of round
//   R+3, before that round's ticks, and its owner becomes Drained then.
//   Consequently its "each round start" effects fire exactly twice, at the
//   starts of R+1 and R+2. Tempest's on-activation damage fires once at R.
import { CHARACTER_DOMAINS, RULES, ZONES } from './data';
import { diamondTiles, manhattan } from './geometry';
import { findUnit, isInZone } from './map';
import { isDueling, isInert } from './units';
import type { ActiveDomain, GameState, Pos, Unit } from './types';

export function activeDomainOf(state: GameState, unitId: string): ActiveDomain | undefined {
  return state.domains.find((d) => d.ownerId === unitId);
}

/**
 * Whether `p` lies inside an active Domain. The zone is a radius-3 Manhattan
 * diamond centred on the owner's current tile (it moves with the owner).
 * While the owner is in the Feast Hall duel the Domain cannot affect anything
 * outside feastHall, so its area is clipped to feastHall.
 */
export function isInDomain(state: GameState, d: ActiveDomain, p: Pos): boolean {
  const owner = findUnit(state, d.ownerId);
  if (!owner) return false;
  if (manhattan(owner.pos, p) > RULES.domainRadius) return false;
  if (isDueling(state, owner) && !isInZone(state, p, ZONES.feastHall)) return false;
  return true;
}

export function domainTiles(state: GameState, d: ActiveDomain): Pos[] {
  const owner = findUnit(state, d.ownerId);
  if (!owner) return [];
  return diamondTiles(owner.pos, RULES.domainRadius, state.map.width, state.map.height).filter((p) =>
    isInDomain(state, d, p),
  );
}

export function domainsAt(state: GameState, p: Pos): ActiveDomain[] {
  return state.domains.filter((d) => isInDomain(state, d, p));
}

/** Rounds left including the current one (3 on activation, 1 in its last round). */
export function domainRoundsRemaining(state: GameState, d: ActiveDomain): number {
  return Math.max(0, d.expiresAtRound - state.round);
}

/** Default Domain for a character (Ascendants only). */
export function defaultDomainFor(u: { character?: string | null }): ActiveDomain['kind'] | null {
  if (!u.character) return null;
  return CHARACTER_DOMAINS[u.character as keyof typeof CHARACTER_DOMAINS] ?? null;
}

/** Why `u` cannot activate its Domain right now, or null if it can. */
export function domainUnavailableReason(state: GameState, u: Unit): string | null {
  if (state.gameOver) return 'the battle is over';
  if (u.rank !== 'ascendant') return 'only Ascendants have a Domain';
  if (u.domain === null) return 'unit has no Domain';
  if (u.domain === 'silence') return 'Silence is reserved and not playable in this slice';
  if (u.domainUsed) return 'Domain already used this battle';
  if (isInert(u)) return 'unit cannot act';
  if (u.hasActed) return 'unit has already acted';
  return null;
}

/** Convenience for the UI: the tiles of every active Domain. */
export function allDomainTiles(state: GameState): { ownerId: string; kind: ActiveDomain['kind']; tiles: Pos[] }[] {
  return state.domains.map((d) => ({ ownerId: d.ownerId, kind: d.kind, tiles: domainTiles(state, d) }));
}
