// The single entry point for state changes (applyAction) and the single
// source of truth for what a unit may do (getLegalActions).
//
// Per turn each unit has one move and one action, in either order.
// Actions: attack, domain, interact, wait. `wait` ends the unit's turn
// (it consumes both its move and its action). `endTurn` ends the active
// faction's phase and needs no unit.
import { attackTargetProblem, attackableTargets, performAttack } from './combat';
import { domainUnavailableReason } from './domains';
import { activateDomain, emit, type Ctx } from './effects';
import { IllegalActionError } from './errors';
import { posEq } from './geometry';
import { findUnit } from './map';
import { pathTo, reachableTiles } from './pathfinding';
import { availableInteractions, performInteraction } from './setpieces';
import { endTurn, evaluate } from './turn';
import { isInert } from './units';
import type { Action, ActionResult, GameState, InteractionKind, Unit } from './types';

const INTERACTIONS: readonly InteractionKind[] = ['confront', 'capture', 'burnBridge', 'escape', 'revive'];

/**
 * Every action the unit may take now, in a stable order: moves (row-major),
 * attacks, domain, interactions, wait, then endTurn. Units of the inactive
 * faction, removed units, and a finished game yield [].
 */
export function getLegalActions(state: GameState, unitId: string): Action[] {
  if (state.gameOver) return [];
  const u = findUnit(state, unitId);
  if (!u || u.faction !== state.activeFaction) return [];
  const out: Action[] = [];
  for (const to of reachableTiles(state, unitId)) out.push({ kind: 'move', unitId, to });
  for (const t of attackableTargets(state, unitId)) out.push({ kind: 'attack', unitId, targetId: t.id });
  if (domainUnavailableReason(state, u) === null) out.push({ kind: 'domain', unitId });
  for (const i of availableInteractions(state, u)) {
    out.push({ kind: 'interact', unitId, interaction: i.interaction, targetId: i.targetId });
  }
  if (canWait(u)) out.push({ kind: 'wait', unitId });
  out.push({ kind: 'endTurn' });
  return out;
}

function canWait(u: Unit): boolean {
  return !isInert(u) && !(u.hasMoved && u.hasActed);
}

function fail(code: ConstructorParameters<typeof IllegalActionError>[0], msg: string, action: unknown): never {
  throw new IllegalActionError(code, msg, action);
}

/** Throws IllegalActionError unless `action` is legal in `state`. Returns the acting unit. */
function validate(state: GameState, action: Action): Unit | null {
  if (state.gameOver) fail('GAME_OVER', 'the battle is over', action);
  if (typeof action !== 'object' || action === null || typeof (action as { kind?: unknown }).kind !== 'string') {
    fail('INVALID_ACTION', 'action must be an object with a kind', action);
  }
  if (action.kind === 'endTurn') return null;
  const known = ['move', 'attack', 'domain', 'interact', 'wait'];
  if (!known.includes(action.kind)) fail('INVALID_ACTION', `unknown action kind "${String(action.kind)}"`, action);

  const u = findUnit(state, action.unitId);
  if (!u) fail('UNKNOWN_UNIT', `no unit "${action.unitId}" in play`, action);
  if (u.faction !== state.activeFaction) {
    fail('NOT_ACTIVE_FACTION', `"${u.id}" (${u.faction}) cannot act during the ${state.activeFaction} phase`, action);
  }
  switch (action.kind) {
    case 'move': {
      const to = action.to;
      if (typeof to !== 'object' || to === null || !Number.isInteger(to.x) || !Number.isInteger(to.y)) {
        fail('INVALID_ACTION', 'move.to must be an {x, y} tile', action);
      }
      if (isInert(u)) fail('UNIT_CANNOT_ACT', `"${u.id}" cannot move`, action);
      if (u.hasMoved) fail('ALREADY_MOVED', `"${u.id}" has already moved this turn`, action);
      if (!reachableTiles(state, u.id).some((p) => posEq(p, to))) {
        fail('UNREACHABLE', `"${u.id}" cannot reach (${to.x},${to.y})`, action);
      }
      return u;
    }
    case 'attack': {
      if (isInert(u)) fail('UNIT_CANNOT_ACT', `"${u.id}" cannot act`, action);
      if (u.hasActed) fail('ALREADY_ACTED', `"${u.id}" has already acted this turn`, action);
      const problem = attackTargetProblem(state, u, action.targetId);
      if (problem) fail('INVALID_TARGET', `"${u.id}" cannot attack "${action.targetId}": ${problem}`, action);
      return u;
    }
    case 'domain': {
      const reason = domainUnavailableReason(state, u);
      if (reason) fail('DOMAIN_UNAVAILABLE', `"${u.id}" cannot use a Domain: ${reason}`, action);
      return u;
    }
    case 'interact': {
      if (!INTERACTIONS.includes(action.interaction)) {
        fail('INVALID_ACTION', `unknown interaction "${String(action.interaction)}"`, action);
      }
      const ok = availableInteractions(state, u).some(
        (i) => i.interaction === action.interaction && i.targetId === action.targetId,
      );
      if (!ok) {
        fail('INTERACTION_UNAVAILABLE', `"${u.id}" cannot ${action.interaction} "${action.targetId}" now`, action);
      }
      return u;
    }
    case 'wait': {
      if (!canWait(u)) fail('UNIT_CANNOT_ACT', `"${u.id}" has nothing left to wait out`, action);
      return u;
    }
  }
}

/**
 * Applies a legal action and returns the new state plus ordered events.
 * Pure: the input state is never mutated (it may be deeply frozen).
 * Throws IllegalActionError for anything getLegalActions would not return.
 */
export function applyAction(state: GameState, action: Action): ActionResult {
  validate(state, action);
  const ctx: Ctx = { state: structuredClone(state), events: [] };
  const s = ctx.state;
  if (action.kind === 'endTurn') {
    endTurn(ctx);
    return { state: s, events: ctx.events };
  }
  const u = findUnit(s, action.unitId)!;
  switch (action.kind) {
    case 'move': {
      const path = pathTo(s, u.id, action.to) ?? [action.to];
      const from = { ...u.pos };
      u.pos = { x: action.to.x, y: action.to.y };
      u.hasMoved = true;
      emit(ctx, { type: 'moved', unitId: u.id, from, to: { ...u.pos }, path });
      break;
    }
    case 'attack':
      performAttack(ctx, u, action.targetId);
      break;
    case 'domain':
      activateDomain(ctx, u);
      break;
    case 'interact':
      performInteraction(ctx, u, action.interaction, action.targetId);
      break;
    case 'wait':
      u.hasMoved = true;
      u.hasActed = true;
      break;
  }
  evaluate(ctx);
  return { state: s, events: ctx.events };
}

/** True when applyAction would accept the action. */
export function isLegalAction(state: GameState, action: Action): boolean {
  try {
    validate(state, action);
    return true;
  } catch (e) {
    if (e instanceof IllegalActionError) return false;
    throw e;
  }
}
