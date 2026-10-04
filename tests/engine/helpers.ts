// Shared test helpers (not a test file).
import {
  applyAction,
  createGame,
  rollInt,
  type Action,
  type GameEvent,
  type GameState,
  type PosLike,
  type Rank,
  type ScenarioDef,
  type Unit,
  type UnitPlacement,
} from '../../src/engine';

/** Builds a minimal valid scenario around an ASCII map. */
export function scenario(map: string[], units: UnitPlacement[], extra: Partial<ScenarioDef> = {}): ScenarioDef {
  return { id: 'test', name: 'Test', playerFaction: 'rebel', seed: 42, map, units, ...extra };
}

export function game(map: string[], units: UnitPlacement[], extra: Partial<ScenarioDef> = {}): GameState {
  return createGame(scenario(map, units, extra));
}

export function rebel(id: string, rank: Rank, pos: PosLike, extra: Partial<UnitPlacement> = {}): UnitPlacement {
  return { id, faction: 'rebel', rank, pos, ...extra };
}

export function loyal(id: string, rank: Rank, pos: PosLike, extra: Partial<UnitPlacement> = {}): UnitPlacement {
  return { id, faction: 'loyalist', rank, pos, ...extra };
}

/** A blank floor map of the given size. */
export function floor(w: number, h: number): string[] {
  return Array.from({ length: h }, () => '.'.repeat(w));
}

/** Returns a modified deep copy (tests may set up positions/HP directly: state is plain data). */
export function mutate(state: GameState, fn: (s: GameState) => void): GameState {
  const copy = structuredClone(state);
  fn(copy);
  return copy;
}

export function unit(state: GameState, id: string): Unit {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`unit ${id} not in play`);
  return u;
}

/** The 0..2 roll the next attack will use. */
export function nextRoll(state: GameState): number {
  return rollInt(state.rng, 0, 2)[0];
}

export interface Played {
  state: GameState;
  events: GameEvent[];
}

/** Applies actions in order, concatenating events. */
export function play(state: GameState, ...actions: Action[]): Played {
  let s = state;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = applyAction(s, a);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Ends the player phase and the AI phase: the state is at the start of the next round. */
export function nextRound(state: GameState): Played {
  return play(state, { kind: 'endTurn' }, { kind: 'endTurn' });
}

/** Ends whole rounds until `round` begins (or the game ends). */
export function advanceTo(state: GameState, round: number): Played {
  let s = state;
  const events: GameEvent[] = [];
  while (s.round < round && !s.gameOver) {
    const r = nextRound(s);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

export function eventsOf<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
