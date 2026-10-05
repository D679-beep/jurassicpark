// Interactions (Confront, Capture, Burn Bridge, ...) as clickable map targets,
// and "move, then interact" approaches. Pure: every option is derived from the
// engine (getLegalActions / availableInteractions), never guessed; the
// controller applies the resulting actions one after the other through the
// normal animated path.
import {
  availableInteractions,
  findObject,
  findUnit,
  getLegalActions,
  getObjective,
  pathCost,
  posEq,
  terrainDefense,
  type Action,
  type GameState,
  type InteractionKind,
  type ObjectiveId,
  type Pos,
  type Unit,
} from '../engine';
import { INTERACTION_NAMES, humanize, makeNameLookup, type NameLookup } from './names';

/** An interaction whose target is on the map: click one of `tiles` to perform it. */
export interface InteractTarget {
  /** Same key as the matching HUD command, e.g. "interact:confront:halden". */
  key: string;
  /** Unit or object id. */
  id: string;
  interaction: InteractionKind;
  kind: 'unit' | 'object';
  /** Tiles that carry the target (a bridge has several). Never the actor's own tile. */
  tiles: Pos[];
  action: Action;
  /** "Confront Emperor Halden". */
  label: string;
  /** One or two sentences for the hover tooltip. */
  hint: string;
}

/**
 * An interaction that is not possible from where the unit stands but is from
 * tiles it can still reach this turn. Clicking the target walks the unit to
 * `best`, then performs the interaction (a FollowUp).
 */
export interface ApproachOption {
  key: string;
  /** Target unit id. */
  id: string;
  interaction: InteractionKind;
  label: string;
  hint: string;
  /** The target's tile: the click target. */
  pos: Pos;
  /** Reachable tiles from which the interaction is legal ("Confront from here"). */
  stand: Pos[];
  /** The stand tile a click on `pos` walks to. */
  best: Pos;
}

/** The interaction to perform once a move has finished. */
export interface FollowUp {
  unitId: string;
  interaction: InteractionKind;
  targetId: string;
}

/** The objective an interaction completes, for tooltips. */
const INTERACTION_OBJECTIVE: Partial<Record<InteractionKind, ObjectiveId>> = {
  confront: 'killEmperor',
  capture: 'imprisonMira',
};

export function interactionName(kind: InteractionKind): string {
  return (INTERACTION_NAMES as Record<string, string | undefined>)[kind] ?? humanize(String(kind));
}

/** "Confront Emperor Halden"; "Escape" has no target name. */
export function interactionLabel(kind: InteractionKind, targetName: string): string {
  return kind === 'escape' ? interactionName(kind) : `${interactionName(kind)} ${targetName}`;
}

/** What an interaction does, as a short sentence for the tooltip. */
export function interactionHint(state: GameState, kind: InteractionKind, targetId: string, name: NameLookup): string {
  const who = name(targetId);
  const objId = INTERACTION_OBJECTIVE[kind];
  const obj = objId ? getObjective(state, objId) : undefined;
  const goal = obj && obj.status === 'pending' ? ` Completes the ${obj.type} objective: ${obj.name}.` : '';
  switch (kind) {
    case 'confront':
      return `Kills ${who}.${goal}`;
    case 'capture':
      return `Takes ${who} prisoner.${goal}`;
    case 'burnBridge':
      return `Burns ${who}: it turns to water and cannot be crossed.`;
    case 'escape':
      return 'Leave the battlefield here.';
    default:
      return `${interactionName(kind)} ${who}.`;
  }
}

/**
 * The unit's interactions whose target stands on the map (a unit, a bridge, a
 * door), from its legal `actions`. Interactions with no tile to click (escape)
 * are left to the HUD buttons.
 */
export function interactionTargets(state: GameState, unit: Unit, actions: readonly Action[]): InteractTarget[] {
  const name = makeNameLookup(state);
  const out: InteractTarget[] = [];
  for (const a of actions) {
    if (a.kind !== 'interact') continue;
    let tiles: Pos[];
    let kind: 'unit' | 'object';
    const tu = findUnit(state, a.targetId);
    if (tu) {
      kind = 'unit';
      tiles = [{ ...tu.pos }];
    } else {
      const o = findObject(state, a.targetId);
      if (!o) continue;
      kind = 'object';
      tiles = o.kind === 'bridge' || o.kind === 'gate' ? o.tiles.map((t) => ({ ...t })) : [{ ...o.pos }];
    }
    tiles = tiles.filter((t) => !posEq(t, unit.pos));
    if (tiles.length === 0) continue;
    out.push({
      key: `interact:${a.interaction}:${a.targetId}`,
      id: a.targetId,
      interaction: a.interaction,
      kind,
      tiles,
      action: a,
      label: interactionLabel(a.interaction, name(a.targetId)),
      hint: interactionHint(state, a.interaction, a.targetId, name),
    });
  }
  return out;
}

/**
 * Unit-targeted interactions that become possible after one of `moves` (the
 * unit's legal move destinations) but are not possible now. Asks the engine
 * with the unit placed on each tile; the controller re-derives the real action
 * from getLegalActions after the move, so a wrong answer here can only cost a
 * notice, never an illegal action.
 */
export function approachOptions(
  state: GameState,
  unit: Unit,
  moves: readonly Pos[],
  direct: readonly InteractTarget[],
): ApproachOption[] {
  if (unit.hasMoved || unit.hasActed || moves.length === 0) return [];
  const groups = new Map<string, { interaction: InteractionKind; targetId: string; stand: Pos[] }>();
  for (const m of moves) {
    for (const i of availableInteractions(state, { ...unit, pos: { ...m } })) {
      if (!findUnit(state, i.targetId)) continue; // bridges, exits: not approached
      if (direct.some((d) => d.interaction === i.interaction && d.id === i.targetId)) continue;
      const key = `${i.interaction}:${i.targetId}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { interaction: i.interaction, targetId: i.targetId, stand: [] }));
      g.stand.push({ ...m });
    }
  }
  const name = makeNameLookup(state);
  const out: ApproachOption[] = [];
  for (const g of groups.values()) {
    const target = findUnit(state, g.targetId)!;
    const ranked = g.stand
      .map((p) => ({ p, cost: pathCost(state, unit.id, p) ?? Number.POSITIVE_INFINITY, def: terrainDefense(state, p) }))
      .sort((a, b) => a.cost - b.cost || b.def - a.def || a.p.y - b.p.y || a.p.x - b.p.x);
    const label = interactionLabel(g.interaction, name(g.targetId));
    out.push({
      key: `approach:${g.interaction}:${g.targetId}`,
      id: g.targetId,
      interaction: g.interaction,
      label,
      hint: `Walks ${unit.name} to the nearest tile beside ${name(g.targetId)}, then performs ${interactionName(g.interaction)}.`,
      pos: { ...target.pos },
      stand: g.stand,
      best: { ...ranked[0]!.p },
    });
  }
  return out;
}

/** The real engine action for a follow-up, or null if it is no longer legal (the state moved on). */
export function resolveFollowUp(state: GameState, f: FollowUp): Action | null {
  for (const a of getLegalActions(state, f.unitId)) {
    if (a.kind === 'interact' && a.interaction === f.interaction && a.targetId === f.targetId) return a;
  }
  return null;
}
