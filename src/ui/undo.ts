// Undo move. A move uses no randomness, so putting back the state from before
// it is safe. Only pure movement is recorded: any other player action (attack,
// Wait, Domain, interact, End Turn) empties the stack, and so does a move that
// did more than walk (it ended a duel, say), so an undo can never rewind
// something the player has already seen resolve. Pure and immutable.
import { posEq, type Action, type GameEvent, type GameState, type MovedEvent, type Pos } from '../engine';
import { isPlayerTurn } from './phase';

export interface UndoEntry {
  unitId: string;
  /** The state before the move. */
  before: GameState;
  /** The state the move produced (the state the player is looking at while this is the top entry). */
  after: GameState;
  from: Pos;
  to: Pos;
  /** The tiles walked, as in the `moved` event (excluding `from`, ending at `to`). */
  path: Pos[];
}

export type UndoStack = readonly UndoEntry[];

export const NO_UNDO: UndoStack = [];

/** True for a result made of walking and nothing else. */
export function isPureMove(events: readonly GameEvent[]): events is MovedEvent[] {
  return events.length > 0 && events.every((e) => e.type === 'moved');
}

/** The stack after the player applied `action` to `before`, producing `after` and `events`. */
export function recordPlayerAction(stack: UndoStack, before: GameState, after: GameState, action: Action, events: readonly GameEvent[]): UndoStack {
  if (action.kind !== 'move' || !isPureMove(events)) return NO_UNDO;
  const mv = events[events.length - 1]!;
  return [...stack, { unitId: action.unitId, before, after, from: { ...mv.from }, to: { ...mv.to }, path: mv.path.map((p) => ({ ...p })) }];
}

/**
 * The move that Undo would take back, or null. The current state must be
 * exactly the one that move produced (so nothing else has happened since) and
 * it must still be the player's turn.
 */
export function undoableMove(state: GameState, stack: UndoStack): UndoEntry | null {
  const top = stack[stack.length - 1];
  if (!top || top.after !== state || !isPlayerTurn(state)) return null;
  const u = state.units.find((x) => x.id === top.unitId);
  return u && posEq(u.pos, top.to) ? top : null;
}

/** The stack without its top entry. */
export function popUndo(stack: UndoStack): UndoStack {
  return stack.slice(0, -1);
}

/** The `moved` event that animates the move being taken back: from where the unit stands now to where it started. */
export function reverseMove(entry: UndoEntry): MovedEvent {
  const back = entry.path.slice(0, -1).reverse();
  return { type: 'moved', unitId: entry.unitId, from: { ...entry.to }, to: { ...entry.from }, path: [...back, { ...entry.from }] };
}

/** Why Undo is unavailable, for the button's tooltip. */
export function undoUnavailableReason(state: GameState, stack: UndoStack): string | null {
  if (!isPlayerTurn(state)) return 'Undo is only available on your turn.';
  if (undoableMove(state, stack)) return null;
  return 'Nothing to undo. Only moves can be undone, until a unit attacks or acts or the turn ends.';
}
