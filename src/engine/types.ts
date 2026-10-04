// Core data types for the rules engine. Everything in GameState is plain,
// JSON-serializable data: no classes, no Map/Set, no undefined-valued fields
// (absent values are `null`).

export type Faction = 'rebel' | 'loyalist';
export type Phase = 'player' | 'ai';
export type Rank = 'soldier' | 'kindled' | 'radiant' | 'ascendant';
export type Terrain =
  | 'floor'
  | 'wall'
  | 'door'
  | 'rubble'
  | 'water'
  | 'bridge'
  | 'pillar'
  | 'throne'
  | 'dais';
export type CharacterId =
  | 'varek'
  | 'grimm'
  | 'kaela'
  | 'orsa'
  | 'elian'
  | 'mira'
  | 'halden'
  | 'sereth'
  | 'aren';
export type DomainKind = 'tempest' | 'pyre' | 'bulwark' | 'sanctuary' | 'silence';
export type Status = 'sealed' | 'dueling' | 'drained';
export type BellId = 'firstBell' | 'secondBell' | 'dawn';
export type ObjectiveId =
  | 'killEmperor'
  | 'killElian'
  | 'imprisonMira'
  | 'seizeBellTower'
  | 'burnBridges';
export type ObjectiveType = 'required' | 'optional' | 'bonus';
export type ObjectiveStatus = 'pending' | 'completed' | 'failed';
export type InteractionKind = 'confront' | 'capture' | 'burnBridge' | 'escape';
export type DamageCause = 'attack' | 'tempest' | 'pyre' | 'duel';
export type DeathCause = DamageCause | 'confront';

export interface Pos {
  x: number;
  y: number;
}

export interface Range {
  min: number;
  max: number;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface Unit {
  id: string;
  name: string;
  faction: Faction;
  rank: Rank;
  character: CharacterId | null;
  hp: number;
  maxHp: number;
  /** Base attack. Use `effectiveStats(unit)` for the value after Drained. */
  atk: number;
  def: number;
  /** Base move. Use `effectiveStats(unit)` for the value after Drained. */
  move: number;
  range: Range;
  pos: Pos;
  hasMoved: boolean;
  hasActed: boolean;
  statuses: Status[];
  tags: string[];
  /** The unit's Domain (Ascendants only). */
  domain: DomainKind | null;
  domainUsed: boolean;
  /** Zone an AI guard defends (informational, for the AI layer). */
  guardZone: string | null;
}

export interface DoorObject {
  id: string;
  kind: 'door';
  pos: Pos;
  hp: number;
  maxHp: number;
  def: number;
  /** A destroyed barred door is broken open: passable, does not block LOS. */
  destroyed: boolean;
}

export interface AnchorObject {
  id: string;
  kind: 'anchor';
  pos: Pos;
  hp: number;
  maxHp: number;
  def: number;
  destroyed: boolean;
}

export interface BridgeObject {
  id: string;
  kind: 'bridge';
  tiles: Pos[];
  tags: string[];
  burned: boolean;
}

export type DestructibleObject = DoorObject | AnchorObject;
export type MapObject = DoorObject | AnchorObject | BridgeObject;

export interface Exit {
  id: string;
  zone: string | null;
  tiles: Pos[];
  /** Unit ids or character ids allowed to escape here. Empty = any escapee. */
  units: string[];
}

export interface MapState {
  width: number;
  height: number;
  /** terrain[y][x] */
  terrain: Terrain[][];
  /** Zone id -> tiles (row-major order, deduplicated). */
  zones: Record<string, Pos[]>;
  objects: MapObject[];
  exits: Exit[];
}

export interface BellState {
  id: BellId;
  name: string;
  /** Round in the scenario's schedule, before modifiers. */
  baseRound: number;
  /** Effective round after modifiers (bell tower delay). */
  round: number;
  rung: boolean;
}

export interface WaveState {
  id: string;
  name: string;
  bell: BellId;
  /** Extra rounds after its bell, from the scenario definition. */
  delay: number;
  spawnTiles: Pos[];
  /** Fully built units; `pos` is their preferred spawn tile. */
  units: Unit[];
  spawned: boolean;
  arrivedRound: number | null;
}

export interface ActiveDomain {
  ownerId: string;
  kind: DomainKind;
  faction: Faction;
  activatedRound: number;
  /** The domain ends at the start of this round, before that round's ticks. */
  expiresAtRound: number;
}

export interface Objective {
  id: ObjectiveId;
  name: string;
  type: ObjectiveType;
  status: ObjectiveStatus;
}

export type ElianOutcome = 'killed' | 'escaped' | 'alive';
export type MiraOutcome = 'captured' | 'escaped' | 'dead' | 'free';

export interface OutcomeFlags {
  emperorKilled: boolean;
  elianOutcome: ElianOutcome;
  miraOutcome: MiraOutcome;
}

export type RemovalReason = 'died' | 'captured' | 'escaped';

export interface RemovedUnit {
  unit: Unit;
  reason: RemovalReason;
  round: number;
}

export interface DuelState {
  unitIds: [string, string];
  /** Becomes false permanently once the duel ends. */
  active: boolean;
}

export interface Modifiers {
  /** Seize the bell tower bonus applied (bells delayed). */
  bellTowerSeized: boolean;
  /** All barracksRoute bridges burned (Second Bell wave delayed). */
  bridgesBurned: boolean;
}

export interface DialogueLine {
  /** A unit id, a character id, or a free-form speaker name. */
  speaker: string;
  text: string;
}

export type DialogueTrigger =
  | 'confront'
  | 'sealBroken'
  | 'duelEnded'
  | 'miraCaptured'
  | 'miraEscaped'
  | 'miraDied'
  | 'elianKilled'
  | 'elianEscaped'
  | 'bellTowerSeized'
  | 'bridgesBurned'
  | BellId
  | `domain:${DomainKind}`;

export interface GameResult {
  /** From the point of view of `playerFaction`. */
  result: 'victory' | 'defeat';
  winner: Faction;
  reason: string;
  outcome: OutcomeFlags;
}

export interface GameState {
  scenarioId: string;
  scenarioName: string;
  seed: number;
  /** Current mulberry32 state. */
  rng: number;
  map: MapState;
  /** Units in play, in a stable order (placement order, then spawn order). */
  units: Unit[];
  removedUnits: RemovedUnit[];
  round: number;
  phase: Phase;
  activeFaction: Faction;
  playerFaction: Faction;
  aiFaction: Faction;
  bells: BellState[];
  waves: WaveState[];
  modifiers: Modifiers;
  domains: ActiveDomain[];
  duel: DuelState | null;
  sealBroken: boolean;
  objectives: Objective[];
  outcome: OutcomeFlags;
  dialogue: Partial<Record<DialogueTrigger, DialogueLine[]>>;
  gameOver: boolean;
  result: GameResult | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { kind: 'move'; unitId: string; to: Pos }
  | { kind: 'attack'; unitId: string; targetId: string }
  | { kind: 'domain'; unitId: string }
  | { kind: 'interact'; unitId: string; interaction: InteractionKind; targetId: string }
  | { kind: 'wait'; unitId: string }
  | { kind: 'endTurn' };

export type ActionKind = Action['kind'];

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface MovedEvent {
  type: 'moved';
  unitId: string;
  from: Pos;
  to: Pos;
  /** Tiles stepped through, excluding `from`, ending with `to`. */
  path: Pos[];
}

export interface DamagedEvent {
  type: 'damaged';
  targetId: string;
  targetKind: 'unit' | 'object';
  pos: Pos;
  amount: number;
  hpBefore: number;
  hpAfter: number;
  sourceId: string | null;
  cause: DamageCause;
  /** The 0..2 RNG roll for attacks; null for fixed damage. */
  roll: number | null;
}

export interface HealedEvent {
  type: 'healed';
  unitId: string;
  pos: Pos;
  amount: number;
  hpAfter: number;
  sourceId: string;
}

export interface DiedEvent {
  type: 'died';
  unitId: string;
  name: string;
  faction: Faction;
  pos: Pos;
  killerId: string | null;
  cause: DeathCause;
}

export interface ObjectDestroyedEvent {
  type: 'objectDestroyed';
  objectId: string;
  objectKind: 'door' | 'anchor';
  pos: Pos;
  byUnitId: string | null;
}

export interface DomainActivatedEvent {
  type: 'domainActivated';
  unitId: string;
  domain: DomainKind;
  center: Pos;
  radius: number;
  tiles: Pos[];
  expiresAtRound: number;
}

export interface DomainEndedEvent {
  type: 'domainEnded';
  unitId: string;
  domain: DomainKind;
  reason: 'expired' | 'ownerRemoved';
  /** True when the owner became Drained. */
  drained: boolean;
}

export interface BellRangEvent {
  type: 'bellRang';
  bell: BellId;
  name: string;
  round: number;
}

export interface BellsDelayedEvent {
  type: 'bellsDelayed';
  reason: 'bellTower' | 'bridges';
  amount: number;
  /** Bells whose ring round changed, with their new round. */
  bells: { id: BellId; round: number }[];
  /** Waves whose arrival changed, with their new arrival round. */
  waves: { id: string; round: number }[];
}

export interface ReinforcementsArrivedEvent {
  type: 'reinforcementsArrived';
  waveId: string;
  name: string;
  bell: BellId;
  units: { unitId: string; pos: Pos }[];
  /** Unit ids that could not be placed (no free tile reachable). */
  blocked: string[];
}

export interface ObjectiveCompletedEvent {
  type: 'objectiveCompleted';
  objectiveId: ObjectiveId;
  name: string;
}

export interface ObjectiveFailedEvent {
  type: 'objectiveFailed';
  objectiveId: ObjectiveId;
  name: string;
  reason: string;
}

export interface CapturedEvent {
  type: 'captured';
  unitId: string;
  byUnitId: string;
  pos: Pos;
}

export interface EscapedEvent {
  type: 'escaped';
  unitId: string;
  exitId: string;
  pos: Pos;
}

export interface BridgeBurnedEvent {
  type: 'bridgeBurned';
  bridgeId: string;
  tiles: Pos[];
  byUnitId: string | null;
  cause: 'interact' | 'pyre';
}

export interface SealBrokenEvent {
  type: 'sealBroken';
  unitIds: string[];
  reason: 'anchors' | 'secondBell';
}

export interface DuelEndedEvent {
  type: 'duelEnded';
  unitIds: [string, string];
  reason: 'leftFeastHall' | 'duelistRemoved';
}

export interface PhaseStartedEvent {
  type: 'phaseStarted';
  round: number;
  phase: Phase;
  faction: Faction;
}

export interface GameOverEvent {
  type: 'gameOver';
  result: 'victory' | 'defeat';
  winner: Faction;
  reason: string;
  outcome: OutcomeFlags;
}

export interface DialogueEvent {
  type: 'dialogue';
  trigger: DialogueTrigger;
  speakerId: string | null;
  speaker: string;
  text: string;
}

export type GameEvent =
  // The spec's list:
  | MovedEvent
  | DamagedEvent
  | DiedEvent
  | DomainActivatedEvent
  | BellRangEvent
  | ReinforcementsArrivedEvent
  | ObjectiveCompletedEvent
  | ObjectiveFailedEvent
  | CapturedEvent
  | GameOverEvent
  | DialogueEvent
  // Extra events for state changes the spec's list cannot express:
  | HealedEvent
  | ObjectDestroyedEvent
  | DomainEndedEvent
  | BellsDelayedEvent
  | EscapedEvent
  | BridgeBurnedEvent
  | SealBrokenEvent
  | DuelEndedEvent
  | PhaseStartedEvent;

export type GameEventType = GameEvent['type'];

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

// ---------------------------------------------------------------------------
// Scenario definition (authored content)
// ---------------------------------------------------------------------------

/** `{x, y}` or the terser `[x, y]`. */
export type PosLike = Pos | readonly [number, number];

export interface RectDef {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A single rectangle, or any union of rectangles and tiles. */
export type ZoneDef = RectDef | { rects?: RectDef[]; tiles?: PosLike[] };

/**
 * Per-unit overrides of the rank baseline. `hp` alone sets both current and
 * max HP; give `maxHp` as well to start a unit wounded.
 */
export interface StatOverrides {
  hp?: number;
  maxHp?: number;
  atk?: number;
  def?: number;
  move?: number;
  rangeMin?: number;
  rangeMax?: number;
}

export interface UnitPlacement {
  id: string;
  name?: string;
  faction: Faction;
  rank: Rank;
  /** Required for starting units; optional preferred spawn tile for wave units. */
  pos?: PosLike;
  character?: CharacterId;
  tags?: string[];
  statuses?: Status[];
  stats?: StatOverrides;
  /** Defaults from the character (varek: tempest, grimm: pyre, ...). Ascendants only. */
  domain?: DomainKind | null;
  guardZone?: string;
}

export type ObjectDef =
  | { id: string; kind: 'door'; pos: PosLike; hp?: number; def?: number }
  | { id: string; kind: 'anchor'; pos: PosLike; hp?: number; def?: number }
  | { id: string; kind: 'bridge'; tiles: PosLike[]; tags?: string[] };

export interface WaveDef {
  id: string;
  name?: string;
  bell: BellId;
  /** Extra rounds after the bell before this wave arrives. Default 0. */
  delay?: number;
  spawnTiles: PosLike[];
  units: UnitPlacement[];
}

export interface ExitDef {
  id: string;
  zone?: string;
  tiles: PosLike[];
  /** Unit ids or character ids allowed to use this exit. Omitted = any escapee. */
  units?: string[];
}

export interface ScenarioDef {
  id: string;
  name: string;
  playerFaction: Faction;
  seed: number;
  /** Rows of characters, top row first. All rows must have equal length. */
  map: string[];
  /** Char -> terrain. Merged over DEFAULT_LEGEND. */
  legend?: Record<string, Terrain>;
  zones?: Record<string, ZoneDef>;
  units: UnitPlacement[];
  objects?: ObjectDef[];
  waves?: WaveDef[];
  exits?: ExitDef[];
  /** Override the default bell rounds (5 / 9 / 13). */
  bells?: Partial<Record<BellId, number>>;
  /** Defaults to every objective whose prerequisites exist in the scenario. */
  objectives?: ObjectiveId[];
  dialogue?: Partial<Record<DialogueTrigger, DialogueLine[]>>;
}
