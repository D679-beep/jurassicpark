// Objectives, victory/defeat and outcome flags (Rebel player, per the spec).
//
// Objective statuses are derived from outcome flags and modifiers and only
// ever move from 'pending' to 'completed' or 'failed', once.
// `holdUntilDawn` is resolved by the battle's result: completed when the
// rebels win, failed (with the defeat reason) when they lose.
//
// Game over, checked in this order (first match wins, so defeat beats victory
// when both become true at the same moment):
//   1. A hero (tag `hero`: Varek, Kaela) actually died, i.e. was killed after
//      its revive was spent or bled out  -> that hero's side loses
//   2. No rebel unit is left in play     -> rebel defeat
//   3. Dawn rang and the Emperor is alive -> rebel defeat
//   4. Dawn rang and the Emperor is dead  -> rebel victory ("the night is held")
//   5. Rout: the Emperor is dead, the Third Bell has rung and every
//      reinforcement wave due before Dawn has arrived, and no loyalist unit
//      that can act (not inert) is left in play -> rebel victory
// Killing the Emperor alone no longer ends the battle: the rebels must then
// hold until Dawn (or rout the loyalists).
// `result` is expressed from playerFaction's point of view.
import { OBJECTIVE_INFO } from './data';
import { emit, type Ctx } from './effects';
import { hasBellRung } from './bells';
import { isHero, isInert } from './units';
import type { Faction, GameState, Objective, ObjectiveId, ObjectiveStatus } from './types';

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
    case 'holdUntilDawn':
      break; // resolved with the battle's result (evaluateGameOver)
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

function setStatus(ctx: Ctx, obj: Objective, status: 'completed' | 'failed', reason: string): void {
  obj.status = status;
  if (status === 'completed') emit(ctx, { type: 'objectiveCompleted', objectiveId: obj.id, name: OBJECTIVE_INFO[obj.id].name });
  else emit(ctx, { type: 'objectiveFailed', objectiveId: obj.id, name: OBJECTIVE_INFO[obj.id].name, reason });
}

export function evaluateObjectives(ctx: Ctx): void {
  for (const obj of ctx.state.objectives) {
    if (obj.status !== 'pending') continue;
    const { status, reason } = desiredStatus(ctx.state, obj.id);
    if (status === 'pending') continue;
    setStatus(ctx, obj, status, reason);
  }
}

/** The first hero that actually died (killed or bled out), if any. */
function fallenHero(state: GameState): { name: string; faction: Faction } | null {
  const r = state.removedUnits.find((x) => x.reason === 'died' && isHero(x.unit));
  return r ? { name: r.unit.name, faction: r.unit.faction } : null;
}

/**
 * True once every reinforcement wave due before Dawn has arrived: the Third
 * Bell has rung and every wave not tied to Dawn has spawned.
 */
export function allWavesArrived(state: GameState): boolean {
  return hasBellRung(state, 'thirdBell') && state.waves.every((w) => w.bell === 'dawn' || w.spawned);
}

/** Rout (early victory): Emperor dead, every pre-Dawn wave arrived, and no loyalist left that can act. */
export function loyalistsRouted(state: GameState): boolean {
  if (!state.outcome.emperorKilled || !allWavesArrived(state)) return false;
  return !state.units.some((u) => u.faction === 'loyalist' && !isInert(u));
}

/** Returns [winner, reason] if the battle is decided, else null. Pure. */
export function decideGame(state: GameState): [Faction, string] | null {
  const dawn = hasBellRung(state, 'dawn');
  const emperorDead = state.outcome.emperorKilled;
  const hero = fallenHero(state);
  if (hero) return [hero.faction === 'rebel' ? 'loyalist' : 'rebel', `${hero.name} has fallen`];
  if (!state.units.some((u) => u.faction === 'rebel')) return ['loyalist', 'Every rebel has fallen'];
  if (dawn && !emperorDead) return ['loyalist', 'Dawn arrived with the Emperor still alive'];
  if (dawn && emperorDead) return ['rebel', 'The night is held: Dawn breaks with the Emperor dead'];
  if (loyalistsRouted(state)) return ['rebel', 'The loyalists are routed before Dawn'];
  return null;
}

export function evaluateGameOver(ctx: Ctx): void {
  const s = ctx.state;
  if (s.gameOver) return;
  const decided = decideGame(s);
  if (!decided) return;
  const [winner, reason] = decided;
  const hold = getObjective(s, 'holdUntilDawn');
  if (hold && hold.status === 'pending') setStatus(ctx, hold, winner === 'rebel' ? 'completed' : 'failed', reason);
  const result = winner === s.playerFaction ? 'victory' : 'defeat';
  s.gameOver = true;
  s.result = { result, winner, reason, outcome: { ...s.outcome } };
  emit(ctx, { type: 'gameOver', result, winner, reason, outcome: { ...s.outcome } });
}
