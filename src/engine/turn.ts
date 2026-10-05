// Turn flow.
//
// A round is the player phase followed by the AI phase. Round 1 (Midnight)
// begins in the player phase; createGame performs no round-start processing.
//
// endTurn during the PLAYER phase:
//   1. If the faction ending its phase is the rebels: bell tower check
//      (rebel unit in bellTower, no loyalist -> remaining bells +2, once).
//   2. phase = 'ai', activeFaction = aiFaction; the AI faction's units get
//      hasMoved = hasActed = false. Event: phaseStarted.
//   3. Bleed-out: downed AI-faction units whose bleedOutRound <= round die
//      (died, cause 'bledOut').
//   4. evaluate().
//
// endTurn during the AI phase (same bell tower check first if the AI is the
// rebel side), then ROUND START processing for round N+1, in this order:
//   1. round += 1, phase = 'player', activeFaction = playerFaction; the
//      player faction's units get hasMoved = hasActed = false.
//      Event: phaseStarted.
//   2. Bleed-out: downed player-faction units whose bleedOutRound <= round
//      die (died, cause 'bledOut'). evaluate().
//   3. Domain expiry: every Domain with expiresAtRound <= round ends (no tick
//      this round) and its owner becomes Drained (-2 ATK, -1 move).
//   4. Domain ticks, in activation order, on units inside at this moment:
//      Tempest 3 to enemies; Pyre 4 to every other unit (and bridges inside
//      burn); Sanctuary heals allies (owner included) 5. Bulwark: no tick.
//      Downed heroes are skipped (no damage, no healing).
//   5. evaluate() — deaths from ticks may end the duel or the game.
//   6. Duel damage: if the Feast Hall duel is active, both duelists take 3.
//   7. evaluate().
//   8. Bells: every unrung bell whose effective round <= round rings
//      (bellRang); the Second Bell breaks the Wellspring seal.
//   9. Reinforcements: every unspawned wave whose bell has rung and whose
//      arrival round <= round spawns (reinforcementsArrived).
//  10. evaluate() — objectives, Dawn, rout, victory/defeat.
//   Processing stops at the first step after which the game is over.
//
// evaluate() runs after every action and at the points above:
//   Pyre bridge burning -> bridges bonus -> seal anchors -> duel end check ->
//   objectives -> game over.
import { bleedOutDue, burnBridgesInPyres, emit, expireDomains, tickDomains, tickDuel, updateDuel, type Ctx } from './effects';
import { ringDueBells, spawnDueWaves } from './bells';
import { evaluateGameOver, evaluateObjectives } from './objectives';
import { checkBellTower, checkBridgesBonus, checkSealAnchors } from './setpieces';
import type { Faction } from './types';

export function evaluate(ctx: Ctx): void {
  if (ctx.state.gameOver) return;
  burnBridgesInPyres(ctx);
  checkBridgesBonus(ctx);
  checkSealAnchors(ctx);
  updateDuel(ctx);
  evaluateObjectives(ctx);
  evaluateGameOver(ctx);
}

function resetFaction(ctx: Ctx, faction: Faction): void {
  for (const u of ctx.state.units) {
    if (u.faction === faction) {
      u.hasMoved = false;
      u.hasActed = false;
    }
  }
}

export function startRound(ctx: Ctx): void {
  const s = ctx.state;
  s.round += 1;
  s.phase = 'player';
  s.activeFaction = s.playerFaction;
  resetFaction(ctx, s.playerFaction);
  emit(ctx, { type: 'phaseStarted', round: s.round, phase: 'player', faction: s.playerFaction });

  bleedOutDue(ctx, s.playerFaction);
  evaluate(ctx);
  if (s.gameOver) return;

  expireDomains(ctx);
  tickDomains(ctx);
  evaluate(ctx);
  if (s.gameOver) return;

  tickDuel(ctx);
  evaluate(ctx);
  if (s.gameOver) return;

  ringDueBells(ctx);
  spawnDueWaves(ctx);
  evaluate(ctx);
}

export function endTurn(ctx: Ctx): void {
  const s = ctx.state;
  checkBellTower(ctx, s.activeFaction);
  if (s.phase === 'player') {
    s.phase = 'ai';
    s.activeFaction = s.aiFaction;
    resetFaction(ctx, s.aiFaction);
    emit(ctx, { type: 'phaseStarted', round: s.round, phase: 'ai', faction: s.aiFaction });
    bleedOutDue(ctx, s.aiFaction);
    evaluate(ctx);
    return;
  }
  startRound(ctx);
}
