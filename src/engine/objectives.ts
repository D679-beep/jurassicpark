// Objectives, victory/defeat and outcome flags (Rebel player, per the spec).
//
// Objective statuses are derived from outcome flags and modifiers and only
// ever move from 'pending' to 'completed' or 'failed', once.
//
// Game over, checked in this order (first match wins, so defeat beats victory
// when both become true at the same moment):
//   1. Varek died                          -> rebel defeat
//   2. Kaela died                          -> rebel defeat
//   3. Dawn rang and the Emperor is alive  -> rebel defeat
//   4. Emperor dead and both the Elian and Mira objectives resolved
//      (completed or failed; an objective absent from the scenario counts as
//      resolved)                           -> rebel victory
//   5. Dawn rang and the Emperor is dead   -> rebel victory
// `result` is expressed from playerFaction's point of view.
import { OBJECTIVE_INFO } from './data';
import { emit, type Ctx } from './effects';
import { hasBellRung } from './bells';
import type { CharacterId, Faction, GameState, Objective, ObjectiveId, ObjectiveStatus } from './types';

export function getObjective(state: GameState, id: ObjectiveId): Objective | undefined {
  return state.objectives.find((o) => o.id === id);
}

function desiredStatus(state: GameState, id: ObjectiveId): { status: ObjectiveStatus; reason: string } {
  const o = state.outcome;
  switch (id) {
    case 'killEmperor':
      if (o.emperorKilled) return { status: 'completed', reason: '' };
      if (hasBellRung(state, 'dawn')) return { status: 'failed', reason: 'Dawn arrived first' };
      break;
    case 'killElian':
      if (o.elianOutcome === 'killed') return { status: 'completed', reason: '' };
      if (o.elianOutcome === 'escaped') return { status: 'failed', reason: 'Elian escaped' };
      break;
    case 'imprisonMira':
      if (o.miraOutcome === 'captured') return { status: 'completed', reason: '' };
      if (o.miraOutcome === 'escaped') return { status: 'failed', reason: 'Mira escaped' };
      if (o.miraOutcome === 'dead') return { status: 'failed', reason: 'Mira died' };
      break;
    case 'seizeBellTower':
      if (state.modifiers.bellTowerSeized) return { status: 'completed', reason: '' };
      break;
    case 'burnBridges':
      if (state.modifiers.bridgesBurned) return { status: 'completed', reason: '' };
      break;
  }
  return { status: 'pending', reason: '' };
}

export function evaluateObjectives(ctx: Ctx): void {
  for (const obj of ctx.state.objectives) {
    if (obj.status !== 'pending') continue;
    const { status, reason } = desiredStatus(ctx.state, obj.id);
    if (status === 'pending') continue;
    obj.status = status;
    if (status === 'completed') emit(ctx, { type: 'objectiveCompleted', objectiveId: obj.id, name: OBJECTIVE_INFO[obj.id].name });
    else emit(ctx, { type: 'objectiveFailed', objectiveId: obj.id, name: OBJECTIVE_INFO[obj.id].name, reason });
  }
}

function characterDied(state: GameState, c: CharacterId): boolean {
  return state.removedUnits.some((r) => r.reason === 'died' && r.unit.character === c);
}

function isResolved(state: GameState, id: ObjectiveId): boolean {
  const o = getObjective(state, id);
  return !o || o.status !== 'pending';
}

/** Returns [winner, reason] if the battle is decided, else null. Pure. */
export function decideGame(state: GameState): [Faction, string] | null {
  const dawn = hasBellRung(state, 'dawn');
  const emperorDead = state.outcome.emperorKilled;
  if (characterDied(state, 'varek')) return ['loyalist', 'Varek has fallen'];
  if (characterDied(state, 'kaela')) return ['loyalist', 'Kaela has fallen'];
  if (dawn && !emperorDead) return ['loyalist', 'Dawn arrived with the Emperor still alive'];
  if (emperorDead && isResolved(state, 'killElian') && isResolved(state, 'imprisonMira')) {
    return ['rebel', 'The Emperor is dead and the fates of Elian and Mira are sealed'];
  }
  if (dawn && emperorDead) return ['rebel', 'Dawn arrived with the Emperor dead'];
  return null;
}

export function evaluateGameOver(ctx: Ctx): void {
  const s = ctx.state;
  if (s.gameOver) return;
  const decided = decideGame(s);
  if (!decided) return;
  const [winner, reason] = decided;
  const result = winner === s.playerFaction ? 'victory' : 'defeat';
  s.gameOver = true;
  s.result = { result, winner, reason, outcome: { ...s.outcome } };
  emit(ctx, { type: 'gameOver', result, winner, reason, outcome: { ...s.outcome } });
}
