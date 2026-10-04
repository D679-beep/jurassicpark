// Shared helpers for AI tests (not a test file).
import { applyAction, getLegalActions, rollInt, type Action, type GameEvent, type GameState } from '../../src/engine';
import { chooseAiAction } from '../../src/ai';

/** True when `a` is one of the unit's legal actions (or endTurn). */
export function isListedLegal(state: GameState, a: Action): boolean {
  if (a.kind === 'endTurn') return true;
  return getLegalActions(state, a.unitId).some((l) => JSON.stringify(l) === JSON.stringify(a));
}

export interface PhaseLog {
  state: GameState;
  actions: Action[];
  events: GameEvent[];
}

/**
 * Plays the active faction's phase with the AI, checking every action is
 * legal and that the phase ends within 2 x units + 1 calls.
 */
export function aiPhase(state: GameState, check: (ok: boolean, msg: string) => void = defaultCheck): PhaseLog {
  const bound = 2 * state.units.filter((u) => u.faction === state.activeFaction).length + 1;
  let s = state;
  const actions: Action[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i <= bound; i++) {
    if (s.gameOver) return { state: s, actions, events };
    const a = chooseAiAction(s);
    check(isListedLegal(s, a), `illegal AI action ${JSON.stringify(a)} in round ${s.round}`);
    const r = applyAction(s, a);
    actions.push(a);
    events.push(...r.events);
    s = r.state;
    if (a.kind === 'endTurn') return { state: s, actions, events };
  }
  check(false, `AI phase did not end within ${bound} actions`);
  return { state: s, actions, events };
}

function defaultCheck(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

/** Rebels do nothing. */
export function passiveRebels(state: GameState): PhaseLog {
  const r = applyAction(state, { kind: 'endTurn' });
  return { state: r.state, actions: [{ kind: 'endTurn' }], events: r.events };
}

/** Deterministic pseudo-random rebel driver: up to `n` random legal unit actions, then endTurn. */
export function randomRebels(state: GameState, rng: { s: number }, n = 12): PhaseLog {
  let s = state;
  const actions: Action[] = [];
  const events: GameEvent[] = [];
  const roll = (max: number): number => {
    const [v, next] = rollInt(rng.s, 0, max - 1);
    rng.s = next;
    return v;
  };
  for (let i = 0; i < n && !s.gameOver; i++) {
    const units = s.units.filter((u) => u.faction === s.activeFaction);
    if (units.length === 0) break;
    const u = units[roll(units.length)]!;
    const legal = getLegalActions(s, u.id).filter((a) => a.kind !== 'endTurn');
    if (legal.length === 0) continue;
    // Bias toward attacks and interactions so fights actually happen.
    const hits = legal.filter((a) => a.kind === 'attack' || a.kind === 'interact' || a.kind === 'domain');
    const pool = hits.length > 0 && roll(2) === 0 ? hits : legal;
    const a = pool[roll(pool.length)]!;
    const r = applyAction(s, a);
    actions.push(a);
    events.push(...r.events);
    s = r.state;
  }
  if (!s.gameOver) {
    const r = applyAction(s, { kind: 'endTurn' });
    actions.push({ kind: 'endTurn' });
    events.push(...r.events);
    s = r.state;
  }
  return { state: s, actions, events };
}

/** Plays whole rounds: `rebels` drives the player phase, the AI the other. */
export function playRounds(
  state: GameState,
  rounds: number,
  rebels: (s: GameState) => PhaseLog = passiveRebels,
): PhaseLog {
  let s = state;
  const actions: Action[] = [];
  const events: GameEvent[] = [];
  const stopAt = s.round + rounds;
  while (!s.gameOver && s.round < stopAt) {
    const phase = s.activeFaction === s.playerFaction ? rebels(s) : aiPhase(s);
    actions.push(...phase.actions);
    events.push(...phase.events);
    s = phase.state;
  }
  return { state: s, actions, events };
}
