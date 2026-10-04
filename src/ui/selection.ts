// Selection state machine: turns clicks on tiles and HUD buttons into engine
// Actions. Pure: everything is derived from getLegalActions, never guessed.
import {
  findObject,
  findUnit,
  getLegalActions,
  posEq,
  previewDamage,
  type Action,
  type GameState,
  type InteractionKind,
  type Pos,
} from '../engine';
import { DOMAIN_NAMES, INTERACTION_NAMES, makeNameLookup } from './names';

export interface TargetOption {
  id: string;
  kind: 'unit' | 'object';
  pos: Pos;
  action: Action;
}

export interface CommandOption {
  /** Stable key, e.g. "domain", "interact:confront:halden", "wait". */
  key: string;
  label: string;
  kind: 'domain' | 'interact' | 'wait';
  interaction?: InteractionKind;
  action: Action;
}

export type Selection =
  | { mode: 'none' }
  | {
      mode: 'unit';
      unitId: string;
      moves: Pos[];
      targets: TargetOption[];
      commands: CommandOption[];
    };

export const NO_SELECTION: Selection = { mode: 'none' };

/** True when it is the player's phase and the battle is still on. */
export function isPlayerTurn(state: GameState): boolean {
  return !state.gameOver && state.phase === 'player' && state.activeFaction === state.playerFaction;
}

function unitActions(state: GameState, unitId: string): Action[] {
  return getLegalActions(state, unitId).filter((a) => a.kind !== 'endTurn');
}

/** A player unit with at least one legal action (move, attack, domain, interact or wait). */
export function isReady(state: GameState, unitId: string): boolean {
  if (!isPlayerTurn(state)) return false;
  const u = findUnit(state, unitId);
  if (!u || u.faction !== state.playerFaction) return false;
  return unitActions(state, unitId).length > 0;
}

/** Ready player units in stable state order. */
export function readyUnitIds(state: GameState): string[] {
  return state.units.filter((u) => isReady(state, u.id)).map((u) => u.id);
}

/** Builds the selection for a unit, or NO_SELECTION if it cannot be selected. */
export function selectUnit(state: GameState, unitId: string): Selection {
  if (!isReady(state, unitId)) return NO_SELECTION;
  const name = makeNameLookup(state);
  const moves: Pos[] = [];
  const targets: TargetOption[] = [];
  const commands: CommandOption[] = [];
  const u = findUnit(state, unitId)!;
  for (const a of unitActions(state, unitId)) {
    switch (a.kind) {
      case 'move':
        moves.push(a.to);
        break;
      case 'attack': {
        const tu = findUnit(state, a.targetId);
        const to = tu ? undefined : findObject(state, a.targetId);
        const pos = tu?.pos ?? (to && to.kind !== 'bridge' && to.kind !== 'gate' ? to.pos : null);
        if (pos) targets.push({ id: a.targetId, kind: tu ? 'unit' : 'object', pos: { ...pos }, action: a });
        break;
      }
      case 'domain':
        commands.push({
          key: 'domain',
          label: `Domain: ${u.domain ? DOMAIN_NAMES[u.domain] : '?'}`,
          kind: 'domain',
          action: a,
        });
        break;
      case 'interact': {
        const base = INTERACTION_NAMES[a.interaction];
        const label = a.interaction === 'escape' ? base : `${base} ${name(a.targetId)}`;
        commands.push({
          key: `interact:${a.interaction}:${a.targetId}`,
          label,
          kind: 'interact',
          interaction: a.interaction,
          action: a,
        });
        break;
      }
      case 'wait':
        commands.push({ key: 'wait', label: 'Wait', kind: 'wait', action: a });
        break;
    }
  }
  return { mode: 'unit', unitId, moves, targets, commands };
}

/** Re-derives the selection after the state changed (keeps the same unit if still ready). */
export function refreshSelection(state: GameState, sel: Selection): Selection {
  return sel.mode === 'unit' ? selectUnit(state, sel.unitId) : NO_SELECTION;
}

export function targetAt(sel: Selection, p: Pos): TargetOption | undefined {
  return sel.mode === 'unit' ? sel.targets.find((t) => posEq(t.pos, p)) : undefined;
}

export function isMoveTile(sel: Selection, p: Pos): boolean {
  return sel.mode === 'unit' && sel.moves.some((m) => posEq(m, p));
}

export interface ClickResult {
  selection: Selection;
  /** Action to apply, if the click issued one. */
  action: Action | null;
}

/**
 * Handles a click on a map tile:
 *   - with a unit selected: attack target > move tile > select another ready
 *     unit > clicking the selected unit or anywhere else deselects;
 *   - with nothing selected: select a ready player unit on the tile.
 * Outside the player's turn nothing happens.
 */
export function clickTile(state: GameState, sel: Selection, p: Pos): ClickResult {
  if (!isPlayerTurn(state)) return { selection: NO_SELECTION, action: null };
  const occupant = state.units.find((u) => posEq(u.pos, p));
  if (sel.mode === 'unit') {
    const target = targetAt(sel, p);
    if (target) return { selection: sel, action: target.action };
    if (isMoveTile(sel, p)) return { selection: sel, action: { kind: 'move', unitId: sel.unitId, to: { ...p } } };
    if (occupant && occupant.id === sel.unitId) return { selection: NO_SELECTION, action: null };
  }
  if (occupant && isReady(state, occupant.id)) return { selection: selectUnit(state, occupant.id), action: null };
  return { selection: NO_SELECTION, action: null };
}

/** Tab: the next ready unit after the selected one (wrapping), or the first. */
export function cycleSelection(state: GameState, sel: Selection, direction: 1 | -1 = 1): Selection {
  const ids = readyUnitIds(state);
  if (ids.length === 0) return NO_SELECTION;
  const cur = sel.mode === 'unit' ? ids.indexOf(sel.unitId) : -1;
  const next = cur === -1 ? (direction === 1 ? 0 : ids.length - 1) : (cur + direction + ids.length) % ids.length;
  return selectUnit(state, ids[next]!);
}

export interface AttackForecast {
  min: number;
  max: number;
  targetHp: number;
  /** Probability in [0, 1] that the attack kills / destroys the target (rolls are uniform). */
  killChance: number;
  /** Damage is capped (Ascendant immunity, non-lethal) so the hit cannot kill. */
  outcomes: number[];
}

export function attackForecast(state: GameState, attackerId: string, targetId: string): AttackForecast | null {
  const p = previewDamage(state, attackerId, targetId);
  if (!p) return null;
  const kills = p.outcomes.filter((d) => d >= p.targetHp).length;
  return {
    min: p.min,
    max: p.max,
    targetHp: p.targetHp,
    killChance: p.outcomes.length > 0 ? kills / p.outcomes.length : 0,
    outcomes: p.outcomes,
  };
}

export function forecastText(f: AttackForecast): string {
  const dmg = f.min === f.max ? `${f.min}` : `${f.min}–${f.max}`;
  const pct = Math.round(f.killChance * 100);
  return `${dmg} dmg · ${pct}% kill`;
}
