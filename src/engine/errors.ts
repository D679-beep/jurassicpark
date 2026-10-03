import type { Action } from './types';

export type IllegalActionCode =
  | 'GAME_OVER'
  | 'INVALID_ACTION'
  | 'UNKNOWN_UNIT'
  | 'NOT_ACTIVE_FACTION'
  | 'UNIT_CANNOT_ACT'
  | 'ALREADY_MOVED'
  | 'ALREADY_ACTED'
  | 'UNREACHABLE'
  | 'INVALID_TARGET'
  | 'DOMAIN_UNAVAILABLE'
  | 'INTERACTION_UNAVAILABLE';

/** Thrown by `applyAction` for any action `getLegalActions` would not return. */
export class IllegalActionError extends Error {
  readonly code: IllegalActionCode;
  readonly action: unknown;

  constructor(code: IllegalActionCode, message: string, action: Action | unknown) {
    super(`[${code}] ${message}`);
    this.name = 'IllegalActionError';
    this.code = code;
    this.action = action;
  }
}

/** Thrown by `createGame` when a ScenarioDef is invalid. Lists every problem found. */
export class ScenarioValidationError extends Error {
  readonly issues: string[];

  constructor(scenarioId: string, issues: string[]) {
    super(
      `Invalid scenario "${scenarioId}" (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n- ${issues.join('\n- ')}`,
    );
    this.name = 'ScenarioValidationError';
    this.issues = issues;
  }
}
