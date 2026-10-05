// End-turn safeguard: while units can still act, the first End Turn press only
// warns; a second press within a few seconds ends the turn. Pure: the caller
// keeps `armedAt` and passes the clock in.

/** How long the warning stays armed. */
export const END_TURN_CONFIRM_MS = 4000;
/** A second press sooner than this is ignored (a double-click is not a decision). */
export const END_TURN_MIN_GAP_MS = 300;

export interface EndTurnInput {
  /** Player units that can still do something this turn. */
  readyCount: number;
  /** The settings toggle. */
  enabled: boolean;
  /** When the warning was shown, or null if it is not armed. */
  armedAt: number | null;
  now: number;
}

export interface EndTurnDecision {
  /** End the turn now. */
  proceed: boolean;
  /** The new armed time (null = disarmed). */
  armedAt: number | null;
  /** The line to show when not proceeding. */
  message: string | null;
}

export function endTurnWarning(readyCount: number): string {
  return `${readyCount} ${readyCount === 1 ? 'unit' : 'units'} can still act — press again to end the turn`;
}

export function decideEndTurn({ readyCount, enabled, armedAt, now }: EndTurnInput): EndTurnDecision {
  if (!enabled || readyCount <= 0) return { proceed: true, armedAt: null, message: null };
  const live = armedAt !== null && now - armedAt <= END_TURN_CONFIRM_MS;
  if (live && now - armedAt! >= END_TURN_MIN_GAP_MS) return { proceed: true, armedAt: null, message: null };
  if (live) return { proceed: false, armedAt, message: endTurnWarning(readyCount) };
  return { proceed: false, armedAt: now, message: endTurnWarning(readyCount) };
}

/** True while an armed warning is still showing. */
export function isArmed(armedAt: number | null, now: number): boolean {
  return armedAt !== null && now - armedAt <= END_TURN_CONFIRM_MS;
}
