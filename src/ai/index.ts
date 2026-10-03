// AI: computer opponent that reads GameState and returns Actions (no DOM).
import type { Action, GameState } from '../engine';

/**
 * Contract: return the next action for the faction whose phase it is.
 * Callers apply it with applyAction and call again until it returns
 * { kind: 'endTurn' }. Must only return actions from getLegalActions.
 *
 * Stub: ends the phase immediately. Replaced by the real AI.
 */
export function chooseAiAction(_state: GameState): Action {
  return { kind: 'endTurn' };
}
