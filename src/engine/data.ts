// Rules data tables. Content may override rank stats per unit.
import type {
  BellId,
  CharacterId,
  DomainKind,
  Faction,
  ObjectiveId,
  ObjectiveType,
  Rank,
  Status,
  Terrain,
} from './types';

export interface RankStats {
  hp: number;
  atk: number;
  def: number;
  move: number;
  rangeMin: number;
  rangeMax: number;
}

export const RANK_STATS: Readonly<Record<Rank, Readonly<RankStats>>> = {
  soldier: { hp: 10, atk: 4, def: 1, move: 4, rangeMin: 1, rangeMax: 1 },
  kindled: { hp: 16, atk: 6, def: 2, move: 5, rangeMin: 1, rangeMax: 1 },
  radiant: { hp: 18, atk: 6, def: 2, move: 4, rangeMin: 1, rangeMax: 3 },
  ascendant: { hp: 40, atk: 10, def: 4, move: 5, rangeMin: 1, rangeMax: 2 },
};

export interface TerrainInfo {
  /** null = impassable. */
  moveCost: number | null;
  defense: number;
  blocksLos: boolean;
}

export const TERRAIN: Readonly<Record<Terrain, Readonly<TerrainInfo>>> = {
  floor: { moveCost: 1, defense: 0, blocksLos: false },
  wall: { moveCost: null, defense: 0, blocksLos: true },
  // A door is passable and open unless a barred-door object sits on it.
  door: { moveCost: 1, defense: 0, blocksLos: false },
  rubble: { moveCost: 2, defense: 1, blocksLos: false },
  water: { moveCost: null, defense: 0, blocksLos: false },
  bridge: { moveCost: 1, defense: 0, blocksLos: false },
  pillar: { moveCost: 2, defense: 2, blocksLos: false },
  throne: { moveCost: 1, defense: 1, blocksLos: false },
  dais: { moveCost: 1, defense: 1, blocksLos: false },
  table: { moveCost: 2, defense: 1, blocksLos: false },
  crates: { moveCost: 2, defense: 1, blocksLos: false },
  stairs: { moveCost: 1, defense: 0, blocksLos: false },
  brazier: { moveCost: null, defense: 0, blocksLos: false },
  bell: { moveCost: null, defense: 0, blocksLos: false },
};

export const TERRAIN_TYPES = Object.keys(TERRAIN) as Terrain[];

/** Default ASCII legend. A scenario's `legend` is merged over this. */
export const DEFAULT_LEGEND: Readonly<Record<string, Terrain>> = {
  '.': 'floor',
  '#': 'wall',
  '+': 'door',
  '%': 'rubble',
  '~': 'water',
  '=': 'bridge',
  O: 'pillar',
  T: 'throne',
  '^': 'dais',
};

export const BELL_ORDER: readonly BellId[] = ['firstBell', 'secondBell', 'dawn'];
export const DEFAULT_BELL_ROUNDS: Readonly<Record<BellId, number>> = {
  firstBell: 5,
  secondBell: 9,
  dawn: 13,
};
export const BELL_NAMES: Readonly<Record<BellId, string>> = {
  firstBell: 'First Bell',
  secondBell: 'Second Bell',
  dawn: 'Dawn',
};

/** Numeric rule constants from the spec. */
export const RULES = {
  domainRadius: 3,
  /** Rounds a Domain lasts, counting the activation round as the first. */
  domainDuration: 3,
  drainAtk: 2,
  drainMove: 1,
  tempestActivationDamage: 8,
  tempestTickDamage: 3,
  pyreTickDamage: 4,
  sanctuaryHeal: 5,
  sanctuaryPenalty: 3,
  duelTickDamage: 3,
  bellTowerDelay: 2,
  bridgeDelay: 2,
  anchorHp: 12,
  defaultDoorHp: 15,
  ascendantBonus: 1.5,
  nonAscendantCap: 1,
  rollMin: 0,
  rollMax: 2,
} as const;

export const CHARACTER_DOMAINS: Readonly<Partial<Record<CharacterId, DomainKind>>> = {
  varek: 'tempest',
  grimm: 'pyre',
  orsa: 'bulwark',
  elian: 'sanctuary',
  sereth: 'silence',
};

/** Well-known zone ids used by set-piece rules and objectives. */
export const ZONES = {
  throneHall: 'throneHall',
  wellspringHall: 'wellspringHall',
  feastHall: 'feastHall',
  princessTower: 'princessTower',
  bellTower: 'bellTower',
  innerGate: 'innerGate',
  servantsTunnel: 'servantsTunnel',
} as const;

/** Tag on bridges whose burning delays the Second Bell wave. */
export const BARRACKS_ROUTE_TAG = 'barracksRoute';
export const TAG_NO_RESIST = 'noResist';
export const TAG_ESCAPEE = 'escapee';
export const TAG_ANCHOR_BREAKER = 'anchorBreaker';

export const OBJECTIVE_INFO: Readonly<Record<ObjectiveId, { name: string; type: ObjectiveType }>> = {
  killEmperor: { name: 'Kill Emperor Halden', type: 'required' },
  killElian: { name: 'Kill Crown Prince Elian', type: 'optional' },
  imprisonMira: { name: 'Imprison Princess Mira', type: 'optional' },
  seizeBellTower: { name: 'Seize the bell tower', type: 'bonus' },
  burnBridges: { name: 'Burn the canal bridges', type: 'bonus' },
};
export const OBJECTIVE_ORDER: readonly ObjectiveId[] = [
  'killEmperor',
  'killElian',
  'imprisonMira',
  'seizeBellTower',
  'burnBridges',
];

export const FACTIONS: readonly Faction[] = ['rebel', 'loyalist'];
export const RANKS: readonly Rank[] = ['soldier', 'kindled', 'radiant', 'ascendant'];
export const STATUSES: readonly Status[] = ['sealed', 'dueling', 'drained'];
export const DOMAIN_KINDS: readonly DomainKind[] = ['tempest', 'pyre', 'bulwark', 'sanctuary', 'silence'];
export const CHARACTER_IDS: readonly CharacterId[] = [
  'varek',
  'grimm',
  'kaela',
  'orsa',
  'elian',
  'mira',
  'halden',
  'sereth',
  'aren',
];

/** Halden's last words are withheld. */
export const EMPEROR_LAST_WORDS = '...';
