// Pure guard around the AI: validates its choice and caps actions per phase
// so a misbehaving AI can never hang the game.
import { isLegalAction, type Action, type GameState } from '../engine';

export type AiChooser = (state: GameState) => Action;

export interface AiDecision {
  action: Action;
  /** Set when the driver overrode the AI and forced an endTurn. */
  forced: null | { reason: 'cap' | 'error' | 'illegal'; detail: string };
}

/** Actions the AI may take in one phase before the driver forces endTurn. */
export function aiActionCap(state: GameState): number {
  const aiUnits = state.units.filter((u) => u.faction === state.activeFaction).length;
  return Math.max(40, aiUnits * 4 + 10);
}

export function decideAiAction(state: GameState, choose: AiChooser, actionsThisPhase: number, cap = aiActionCap(state)): AiDecision {
  const end: Action = { kind: 'endTurn' };
  if (actionsThisPhase >= cap) {
    return { action: end, forced: { reason: 'cap', detail: `AI took ${actionsThisPhase} actions this phase (cap ${cap})` } };
  }
  let action: Action;
  try {
    action = choose(state);
  } catch (e) {
    return { action: end, forced: { reason: 'error', detail: e instanceof Error ? e.message : String(e) } };
  }
  if (!action || typeof action !== 'object' || !isLegalAction(state, action)) {
    return { action: end, forced: { reason: 'illegal', detail: `AI returned an illegal action: ${JSON.stringify(action)}` } };
  }
  return { action, forced: null };
}
