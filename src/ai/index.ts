// AI: computer opponent that reads GameState and returns Actions (no DOM).
//
// Design (see the modules for detail):
//   roles.ts    what each unit is for (flee, duelist, breaker, guard, ...)
//   threat.ts   which tiles the other side can hit next turn, and how hard
//   scoring.ts  attack / interaction / Domain values
//   planner.ts  per unit: best (tile, action, order) by role-specific score
//   grid.ts     distance and movement fields built on the public engine API
//
// Each call picks ONE unit of the active faction that still has its move or
// action, plans its whole turn, and returns the plan's next step. Units are
// visited in a fixed priority order, and every returned unit action consumes
// that unit's move and/or action (a unit with nothing useful to do `wait`s,
// which consumes both), so a phase takes at most 2 x units + 1 calls.
// No randomness: ties are broken by tile order (row-major) and unit order.
import {
  applyAction,
  getLegalActions,
  isInert,
  manhattan,
  posEq,
  type Action,
  type GameEvent,
  type GameState,
  type Unit,
} from '../engine';
import { buildGrid } from './grid';
import { planUnit, type AiContext, type Plan } from './planner';
import { assignRole } from './roles';
import { computeThreat } from './threat';

export { assignRole, type Role } from './roles';
export { planUnit, type Plan } from './planner';
export { threatMapFor } from './threat';

function hasTurnLeft(u: Unit): boolean {
  return !isInert(u) && !(u.hasMoved && u.hasActed);
}

/**
 * Order in which units take their turns: a unit already half-way through its
 * turn finishes first; then escapees (so they claim the road out before allies
 * clutter it), then free Ascendants (Bulwark before the others move), then
 * everyone else nearest-to-the-enemy first, so front-liners take the attack
 * tiles and the rest fill in behind. Ties keep state.units order.
 */
function turnOrder(state: GameState): Unit[] {
  const faction = state.activeFaction;
  const enemies = state.units.filter((e) => e.faction !== faction && !isInert(e));
  const nearest = (u: Unit): number => enemies.reduce((m, e) => Math.min(m, manhattan(u.pos, e.pos)), 1e9);
  const rank = (u: Unit): number => {
    if (u.hasMoved !== u.hasActed) return 0;
    const role = assignRole(state, u);
    if (role.kind === 'flee') return 1;
    if (u.rank === 'ascendant' && role.kind !== 'duelist') return 2;
    return 3;
  };
  return state.units
    .map((u, i) => ({ u, i }))
    .filter(({ u }) => u.faction === faction && hasTurnLeft(u))
    .map(({ u, i }) => ({ u, i, r: rank(u), d: nearest(u) }))
    .sort((a, b) => a.r - b.r || a.d - b.d || a.i - b.i)
    .map(({ u }) => u);
}

/** Converts a plan into its next concrete step. */
function nextStep(u: Unit, plan: Plan): Action {
  const actNow = (): Action | null => {
    const a = plan.action;
    if (!a) return null;
    if (a.kind === 'attack' && a.targetId) return { kind: 'attack', unitId: u.id, targetId: a.targetId };
    if (a.kind === 'domain') return { kind: 'domain', unitId: u.id };
    if (a.kind === 'interact' && a.targetId && a.interaction) {
      return { kind: 'interact', unitId: u.id, interaction: a.interaction, targetId: a.targetId };
    }
    return null;
  };
  const move: Action | null = !u.hasMoved && !posEq(plan.tile, u.pos) ? { kind: 'move', unitId: u.id, to: plan.tile } : null;
  if (plan.order === 'actFirst') return actNow() ?? move ?? { kind: 'wait', unitId: u.id };
  return move ?? actNow() ?? { kind: 'wait', unitId: u.id };
}

function sameAction(a: Action, b: Action): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'move':
      return b.kind === 'move' && a.unitId === b.unitId && posEq(a.to, b.to);
    case 'attack':
      return b.kind === 'attack' && a.unitId === b.unitId && a.targetId === b.targetId;
    case 'interact':
      return b.kind === 'interact' && a.unitId === b.unitId && a.interaction === b.interaction && a.targetId === b.targetId;
    case 'domain':
    case 'wait':
      return 'unitId' in b && a.unitId === b.unitId;
    case 'endTurn':
      return true;
  }
}

/**
 * Contract: return the next action for the faction whose phase it is.
 * Callers apply it with applyAction and call again until it returns
 * { kind: 'endTurn' }. Only returns actions from getLegalActions (or endTurn).
 * When the game is over it returns endTurn, which the caller must not apply.
 */
export function chooseAiAction(state: GameState): Action {
  if (state.gameOver) return { kind: 'endTurn' };
  const order = turnOrder(state);
  if (order.length === 0) return { kind: 'endTurn' };
  const grid = buildGrid(state);
  for (const u of order) {
    const ctx: AiContext = { state, grid, threat: computeThreat(grid, state.activeFaction, u.id) };
    const legal = getLegalActions(state, u.id);
    const step = nextStep(u, planUnit(ctx, u));
    if (legal.some((a) => sameAction(a, step))) return step;
    // Safety net: never emit an illegal action. `wait` always ends the unit's turn.
    const wait = legal.find((a) => a.kind === 'wait');
    if (wait) return wait;
  }
  return { kind: 'endTurn' };
}

export interface AiPhaseResult {
  state: GameState;
  actions: Action[];
  events: GameEvent[];
}

/**
 * Plays the active faction's whole phase with chooseAiAction, including the
 * final endTurn (skipped if the game ends first). `maxSteps` is a guard.
 */
export function runAiPhase(state: GameState, maxSteps = 1000): AiPhaseResult {
  let s = state;
  const actions: Action[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < maxSteps && !s.gameOver; i++) {
    const a = chooseAiAction(s);
    const r = applyAction(s, a);
    actions.push(a);
    events.push(...r.events);
    s = r.state;
    if (a.kind === 'endTurn') break;
  }
  return { state: s, actions, events };
}
