// Engine: pure game rules (no DOM, seeded RNG only), fully unit-tested.
// This is the public API used by content, AI and UI.

export * from './types';
export { IllegalActionError, ScenarioValidationError, type IllegalActionCode } from './errors';
export {
  RANK_STATS,
  TERRAIN,
  TERRAIN_TYPES,
  DEFAULT_LEGEND,
  BELL_ORDER,
  BELL_NAMES,
  DEFAULT_BELL_ROUNDS,
  RULES,
  CHARACTER_DOMAINS,
  ZONES,
  OBJECTIVE_INFO,
  BARRACKS_ROUTE_TAG,
  TAG_NO_RESIST,
  TAG_ESCAPEE,
  TAG_ANCHOR_BREAKER,
  EMPEROR_LAST_WORDS,
  type RankStats,
  type TerrainInfo,
} from './data';
export { seedToRngState, nextRandom, rollInt } from './rng';
export { manhattan, posEq, posKey, neighbors4, diamondTiles, toPos } from './geometry';

export { createGame } from './scenario';
export { getLegalActions, applyAction, isLegalAction } from './actions';

export {
  inBounds,
  terrainAt,
  terrainDefense,
  findUnit,
  unitAt,
  findCharacter,
  unitsOfFaction,
  findObject,
  blockingObjectAt,
  bridgeAt,
  closedGateAt,
  objectBlocksMovement,
  gates,
  isStandable,
  zoneTiles,
  hasZone,
  isInZone,
  zonesAt,
  unitsInZone,
  exitsAt,
} from './map';
export {
  effectiveStats,
  hasStatus,
  hasTag,
  isAscendant,
  isEnemy,
  isInert,
  isDuelActive,
  isDueling,
  duelPartner,
  canLeaveDuel,
  type EffectiveStats,
} from './units';
export { lineOfSight, bresenhamLine, blocksLineOfSight } from './los';
export { reachableTiles, pathTo, pathCost, type PathOptions } from './pathfinding';
export {
  attackableTargets,
  previewDamage,
  attackTargetProblem,
  unitAttackDamage,
  objectAttackDamage,
  isNonLethalAttack,
  type AttackTarget,
  type DamagePreview,
} from './combat';
export {
  activeDomainOf,
  domainTiles,
  domainsAt,
  isInDomain,
  domainRoundsRemaining,
  domainUnavailableReason,
  allDomainTiles,
} from './domains';
export {
  getBell,
  hasBellRung,
  getNextBell,
  roundsUntilNextBell,
  waveArrivalRound,
  upcomingWaves,
  findSpawnTile,
  type NextBellInfo,
  type UpcomingWave,
} from './bells';
export { getObjective, decideGame } from './objectives';
export { availableInteractions, type InteractionOption } from './setpieces';
