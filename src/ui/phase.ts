// Whose phase it is. Pure; shared by selection, guidance and the controller
// (kept in its own module so none of them import each other in a cycle).
import type { GameState } from '../engine';

/** True when it is the player's phase and the battle is still on. */
export function isPlayerTurn(state: GameState): boolean {
  return !state.gameOver && state.phase === 'player' && state.activeFaction === state.playerFaction;
}
