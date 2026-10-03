// Time: the Bells. Bell schedule queries, bell ringing, reinforcement waves.
//
// - A bell rings at the start of the round equal to its effective `round`
//   (base schedule + bell-tower delay).
// - A wave arrives at: its bell's effective round + the wave's own `delay`
//   + 2 if it is a Second Bell wave and every barracksRoute bridge was burned
//   before it arrived. A wave never arrives before its bell has rung.
// - Spawning: unit i prefers its own `pos` if given, else spawnTiles[i % n].
//   (resolved when the game is created). If that tile is not free, the nearest free tile is found by breadth-first
//   search over standable tiles (passable terrain, no barred door/anchor;
//   units do not block the search), neighbour order N, E, S, W. A unit with no
//   reachable free tile is not placed and is listed in `blocked`.
import { BELL_ORDER, RULES } from './data';
import { neighbors4, posKey } from './geometry';
import { breakSeal, emit, emitDialogue, type Ctx } from './effects';
import { isStandable, unitAt } from './map';
import type { BellId, BellState, GameState, Pos, WaveState } from './types';

export function getBell(state: GameState, id: BellId): BellState | undefined {
  return state.bells.find((b) => b.id === id);
}

export function hasBellRung(state: GameState, id: BellId): boolean {
  return getBell(state, id)?.rung === true;
}

export interface NextBellInfo {
  id: BellId;
  name: string;
  /** Effective round on which it rings. */
  round: number;
  /** round - current round (0 never happens: a bell rings as its round starts). */
  roundsRemaining: number;
}

/** The next bell that has not rung yet, or null if all have rung. */
export function getNextBell(state: GameState): NextBellInfo | null {
  const pending = state.bells.filter((b) => !b.rung).sort((a, b) => a.round - b.round);
  const b = pending[0];
  if (!b) return null;
  return { id: b.id, name: b.name, round: b.round, roundsRemaining: b.round - state.round };
}

/** Rounds until the next bell, or null if none remain. */
export function roundsUntilNextBell(state: GameState): number | null {
  return getNextBell(state)?.roundsRemaining ?? null;
}

/** Round on which a wave arrives, with every modifier applied so far. */
export function waveArrivalRound(state: GameState, wave: WaveState): number {
  if (wave.arrivedRound !== null) return wave.arrivedRound;
  const bell = getBell(state, wave.bell);
  const bellRound = bell ? bell.round : Number.POSITIVE_INFINITY;
  const bridgeDelay = wave.bell === 'secondBell' && state.modifiers.bridgesBurned ? RULES.bridgeDelay : 0;
  return bellRound + wave.delay + bridgeDelay;
}

export interface UpcomingWave {
  id: string;
  name: string;
  bell: BellId;
  round: number;
  roundsRemaining: number;
  unitCount: number;
}

/** Waves that have not arrived yet, soonest first. */
export function upcomingWaves(state: GameState): UpcomingWave[] {
  return state.waves
    .filter((w) => !w.spawned)
    .map((w) => {
      const round = waveArrivalRound(state, w);
      return { id: w.id, name: w.name, bell: w.bell, round, roundsRemaining: round - state.round, unitCount: w.units.length };
    })
    .sort((a, b) => a.round - b.round);
}

/** Delays every bell that has not rung yet. */
export function delayRemainingBells(ctx: Ctx, amount: number): void {
  const s = ctx.state;
  const changed: { id: BellId; round: number }[] = [];
  for (const b of s.bells) {
    if (!b.rung) {
      b.round += amount;
      changed.push({ id: b.id, round: b.round });
    }
  }
  const waves = s.waves.filter((w) => !w.spawned).map((w) => ({ id: w.id, round: waveArrivalRound(s, w) }));
  emit(ctx, { type: 'bellsDelayed', reason: 'bellTower', amount, bells: changed, waves });
}

/** Round-start step: ring every due bell, in schedule order. Second Bell breaks the seal. */
export function ringDueBells(ctx: Ctx): void {
  const s = ctx.state;
  const order = (id: BellId): number => BELL_ORDER.indexOf(id);
  const due = s.bells.filter((b) => !b.rung && b.round <= s.round).sort((a, b) => a.round - b.round || order(a.id) - order(b.id));
  for (const b of due) {
    b.rung = true;
    emit(ctx, { type: 'bellRang', bell: b.id, name: b.name, round: s.round });
    emitDialogue(ctx, b.id);
    if (b.id === 'secondBell') breakSeal(ctx, 'secondBell');
  }
}

/** Nearest free standable tile to `preferred` (see header), or null. */
export function findSpawnTile(state: GameState, preferred: Pos): Pos | null {
  if (isStandable(state, preferred) && !unitAt(state, preferred)) return { ...preferred };
  const seen = new Set<string>([posKey(preferred)]);
  const queue: Pos[] = [preferred];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    for (const n of neighbors4(cur)) {
      const k = posKey(n);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!isStandable(state, n)) continue;
      if (!unitAt(state, n)) return n;
      queue.push(n);
    }
  }
  return null;
}

/** Round-start step: spawn every wave whose arrival round has come. */
export function spawnDueWaves(ctx: Ctx): void {
  const s = ctx.state;
  for (const w of s.waves) {
    if (w.spawned) continue;
    const bell = getBell(s, w.bell);
    if (!bell || !bell.rung) continue;
    if (waveArrivalRound(s, w) > s.round) continue;
    const placed: { unitId: string; pos: Pos }[] = [];
    const blocked: string[] = [];
    for (const template of w.units) {
      // template.pos is the preferred tile, resolved by createGame.
      const tile = findSpawnTile(s, template.pos);
      if (!tile) {
        blocked.push(template.id);
        continue;
      }
      s.units.push({ ...structuredClone(template), pos: tile, hasMoved: false, hasActed: false });
      placed.push({ unitId: template.id, pos: { ...tile } });
    }
    w.spawned = true;
    w.arrivedRound = s.round;
    emit(ctx, { type: 'reinforcementsArrived', waveId: w.id, name: w.name, bell: w.bell, units: placed, blocked });
  }
}
