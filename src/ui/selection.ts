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
import { explainUnitClick } from './explain';
import {
  approachOptions,
  interactionLabel,
  interactionName,
  interactionTargets,
  type ApproachOption,
  type FollowUp,
  type InteractTarget,
} from './interactions';
import { DOMAIN_NAMES, makeNameLookup } from './names';
import { isPlayerTurn } from './phase';

export { isPlayerTurn };
export type { ApproachOption, FollowUp, InteractTarget };

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
      /** Attack targets (red). */
      targets: TargetOption[];
      commands: CommandOption[];
      /** Interactions whose target is on the map: Confront, Capture, Burn Bridge (amber). */
      interactions: InteractTarget[];
      /** Interactions reachable after a move: "Confront from here". */
      approaches: ApproachOption[];
    };

export const NO_SELECTION: Selection = { mode: 'none' };

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
  const actions = unitActions(state, unitId);
  for (const a of actions) {
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
      case 'interact':
        commands.push({
          key: `interact:${a.interaction}:${a.targetId}`,
          label: interactionLabel(a.interaction, name(a.targetId)),
          kind: 'interact',
          interaction: a.interaction,
          action: a,
        });
        break;
      case 'wait':
        commands.push({ key: 'wait', label: 'Wait', kind: 'wait', action: a });
        break;
    }
  }
  const interactions = interactionTargets(state, u, actions);
  const approaches = approachOptions(state, u, moves, interactions);
  return { mode: 'unit', unitId, moves, targets, commands, interactions, approaches };
}

/** Re-derives the selection after the state changed (keeps the same unit if still ready). */
export function refreshSelection(state: GameState, sel: Selection): Selection {
  return sel.mode === 'unit' ? selectUnit(state, sel.unitId) : NO_SELECTION;
}

/**
 * After the selected unit has nothing left to do: the next ready unit after it
 * in state order (wrapping), or NO_SELECTION when nobody is ready.
 */
export function selectNextReadyAfter(state: GameState, unitId: string): Selection {
  const ready = new Set(readyUnitIds(state));
  if (ready.size === 0) return NO_SELECTION;
  const order = state.units.map((u) => u.id);
  const at = order.indexOf(unitId);
  for (let i = 1; i <= order.length; i++) {
    const id = order[(Math.max(0, at) + i) % order.length]!;
    if (ready.has(id)) return selectUnit(state, id);
  }
  return NO_SELECTION;
}

export function targetAt(sel: Selection, p: Pos): TargetOption | undefined {
  return sel.mode === 'unit' ? sel.targets.find((t) => posEq(t.pos, p)) : undefined;
}

export function isMoveTile(sel: Selection, p: Pos): boolean {
  return sel.mode === 'unit' && sel.moves.some((m) => posEq(m, p));
}

/** What a click on a tile would do for the current selection. */
export type TileIntent =
  | { kind: 'attack'; target: TargetOption; alsoInteract?: InteractTarget }
  | { kind: 'interact'; target: InteractTarget; alsoAttack?: TargetOption }
  /** Walk to the best tile beside the target, then interact. */
  | { kind: 'approach'; option: ApproachOption }
  /** A move tile from which an interaction becomes possible. */
  | { kind: 'stand'; options: ApproachOption[] }
  | { kind: 'move' };

/**
 * Priority: attack or interaction with a unit on the tile (the interaction wins
 * when both exist, unless `preferAttack`), then walking up to an interaction
 * target, then plain moves, then interactions with objects (a bridge tile is a
 * move first: crossing bridges is the common case).
 */
export function intentAt(sel: Selection, p: Pos, preferAttack = false): TileIntent | null {
  if (sel.mode !== 'unit') return null;
  const attack = sel.targets.find((t) => posEq(t.pos, p));
  const interact = sel.interactions.find((t) => t.tiles.some((q) => posEq(q, p)));
  const unitInteract = interact && interact.kind === 'unit' ? interact : undefined;
  if (attack && unitInteract) {
    return preferAttack
      ? { kind: 'attack', target: attack, alsoInteract: unitInteract }
      : { kind: 'interact', target: unitInteract, alsoAttack: attack };
  }
  if (attack) return { kind: 'attack', target: attack };
  if (unitInteract) return { kind: 'interact', target: unitInteract };
  const approach = sel.approaches.find((a) => posEq(a.pos, p));
  if (approach) return { kind: 'approach', option: approach };
  if (isMoveTile(sel, p)) {
    const options = sel.approaches.filter((a) => a.stand.some((s) => posEq(s, p)));
    return options.length > 0 ? { kind: 'stand', options } : { kind: 'move' };
  }
  if (interact) return { kind: 'interact', target: interact };
  return null;
}

export interface ClickResult {
  selection: Selection;
  /** Action to apply, if the click issued one. */
  action: Action | null;
  /** Perform this once the action (a move) has finished. */
  followUp?: FollowUp;
  /** A short explanation for the player when the click did nothing useful. */
  notice?: string;
}

export interface ClickOptions {
  /** Shift-click: attack instead of interacting when a tile offers both (Kaela beside a weakened Mira). */
  preferAttack?: boolean;
}

/**
 * The ready player unit that can interact with the unit `targetId` right now
 * (direct first, else after a move), for a click on that unit with nothing selected.
 */
export function actorForTarget(state: GameState, targetId: string): { unitId: string; target: InteractTarget | ApproachOption } | null {
  let via: { unitId: string; target: ApproachOption } | null = null;
  for (const id of readyUnitIds(state)) {
    const sel = selectUnit(state, id);
    if (sel.mode !== 'unit') continue;
    const direct = sel.interactions.find((t) => t.kind === 'unit' && t.id === targetId);
    if (direct) return { unitId: id, target: direct };
    const approach = sel.approaches.find((a) => a.id === targetId);
    if (approach && !via) via = { unitId: id, target: approach };
  }
  return via;
}

/**
 * Handles a click on a map tile:
 *   - with a unit selected: attack / interaction target > walk-up to an
 *     interaction target > move tile > select another ready unit > clicking the
 *     selected unit or anywhere else deselects;
 *   - with nothing selected: select a ready player unit on the tile; clicking a
 *     unit that some ready unit can interact with (the Emperor) selects that unit;
 *   - a click that does nothing carries a `notice` saying why.
 * Outside the player's turn nothing happens.
 */
export function clickTile(state: GameState, sel: Selection, p: Pos, opts: ClickOptions = {}): ClickResult {
  if (!isPlayerTurn(state)) return { selection: NO_SELECTION, action: null };
  const occupant = state.units.find((u) => posEq(u.pos, p));
  if (sel.mode === 'unit') {
    const intent = intentAt(sel, p, opts.preferAttack === true);
    if (intent) {
      switch (intent.kind) {
        case 'attack':
          return { selection: sel, action: intent.target.action };
        case 'interact':
          return { selection: sel, action: intent.target.action };
        case 'approach':
          return {
            selection: sel,
            action: { kind: 'move', unitId: sel.unitId, to: { ...intent.option.best } },
            followUp: { unitId: sel.unitId, interaction: intent.option.interaction, targetId: intent.option.id },
          };
        case 'stand':
        case 'move':
          return { selection: sel, action: { kind: 'move', unitId: sel.unitId, to: { ...p } } };
      }
    }
    if (occupant && occupant.id === sel.unitId) return { selection: NO_SELECTION, action: null };
  }
  if (occupant && isReady(state, occupant.id)) return { selection: selectUnit(state, occupant.id), action: null };
  if (!occupant) return { selection: NO_SELECTION, action: null };

  // A unit we cannot select or hit.
  const selectedId = sel.mode === 'unit' ? sel.unitId : null;
  if (occupant.faction !== state.playerFaction) {
    const actor = actorForTarget(state, occupant.id);
    if (actor && actor.unitId !== selectedId) {
      const next = selectUnit(state, actor.unitId);
      const who = findUnit(state, actor.unitId)!.name;
      const verb = interactionName(actor.target.interaction);
      const notice =
        'stand' in actor.target
          ? `${who} is selected and can walk up to ${occupant.name}. Click ${occupant.name} again to ${verb}.`
          : `${who} is selected. Click ${occupant.name} again to ${verb}.`;
      return { selection: next, action: null, notice };
    }
    const why = explainUnitClick(state, selectedId, occupant);
    // Keep the selected unit: a failed attack attempt should not throw the selection away.
    return { selection: sel.mode === 'unit' ? sel : NO_SELECTION, action: null, ...(why ? { notice: why } : {}) };
  }
  const why = explainUnitClick(state, selectedId, occupant);
  return { selection: NO_SELECTION, action: null, ...(why ? { notice: why } : {}) };
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
