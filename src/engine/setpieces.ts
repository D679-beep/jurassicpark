// Set-piece rules: interactions (Confront, Capture, Burn Bridge, Escape,
// Revive), the Wellspring seal anchors, and the bell modifiers (bell tower,
// bridges).
import { BARRACKS_ROUTE_TAG, EMPEROR_LAST_WORDS, RULES, TAG_ESCAPEE, ZONES } from './data';
import { manhattan, posEq } from './geometry';
import { delayRemainingBells, waveArrivalRound } from './bells';
import { breakSeal, burnBridge, emit, emitDialogue, killUnit, removeUnit, reviveUnit, type Ctx } from './effects';
import { anchors, bridges, exitsAt, findCharacter, findObject, findUnit, hasZone, unitsInZone } from './map';
import { getObjective } from './objectives';
import { hasTag, isDowned, isDueling, isInert } from './units';
import type { Faction, GameState, InteractionKind, Unit } from './types';

export interface InteractionOption {
  interaction: InteractionKind;
  /** Halden / Mira / downed-hero unit id, bridge object id, or exit id. */
  targetId: string;
}

/**
 * Interactions the unit could perform now (ignoring whose turn it is).
 * - confront:   Varek, orthogonally adjacent to Halden.
 * - capture:    Kaela, orthogonally adjacent to Mira, Mira at or below 50% HP.
 * - burnBridge: any unit orthogonally adjacent to an unburned bridge tile and
 *               not standing on that bridge.
 * - escape:     a unit tagged `escapee` standing on an exit tile it may use.
 * - revive:     any unit orthogonally adjacent to a downed ally.
 * Every interaction uses the unit's action. Inert units (a downed Varek too),
 * units that have acted, and duelists (who may not affect anything outside the
 * duel) cannot interact.
 */
export function availableInteractions(state: GameState, u: Unit): InteractionOption[] {
  if (isInert(u) || u.hasActed || isDueling(state, u)) return [];
  const out: InteractionOption[] = [];
  if (u.character === 'varek') {
    const halden = findCharacter(state, 'halden');
    if (halden && manhattan(u.pos, halden.pos) === 1) out.push({ interaction: 'confront', targetId: halden.id });
  }
  if (u.character === 'kaela') {
    const mira = findCharacter(state, 'mira');
    if (mira && mira.faction !== u.faction && manhattan(u.pos, mira.pos) === 1 && mira.hp * 2 <= mira.maxHp) {
      out.push({ interaction: 'capture', targetId: mira.id });
    }
  }
  for (const b of bridges(state)) {
    if (b.burned) continue;
    if (b.tiles.some((t) => posEq(t, u.pos))) continue;
    if (b.tiles.some((t) => manhattan(t, u.pos) === 1)) out.push({ interaction: 'burnBridge', targetId: b.id });
  }
  if (hasTag(u, TAG_ESCAPEE)) {
    for (const e of exitsAt(state, u.pos)) {
      const allowed = e.units.length === 0 || e.units.includes(u.id) || (u.character !== null && e.units.includes(u.character));
      if (allowed) out.push({ interaction: 'escape', targetId: e.id });
    }
  }
  for (const ally of state.units) {
    if (ally.faction === u.faction && ally.id !== u.id && isDowned(ally) && manhattan(u.pos, ally.pos) === 1) {
      out.push({ interaction: 'revive', targetId: ally.id });
    }
  }
  return out;
}

/** Resolves a (validated) interaction. */
export function performInteraction(ctx: Ctx, u: Unit, interaction: InteractionKind, targetId: string): void {
  const s = ctx.state;
  u.hasActed = true;
  switch (interaction) {
    case 'confront': {
      const halden = findUnit(s, targetId);
      if (!halden) return;
      emitDialogue(ctx, 'confront');
      emit(ctx, { type: 'dialogue', trigger: 'confront', speakerId: halden.id, speaker: halden.name, text: EMPEROR_LAST_WORDS });
      killUnit(ctx, halden, u.id, 'confront');
      return;
    }
    case 'capture': {
      const mira = findUnit(s, targetId);
      if (!mira) return;
      emit(ctx, { type: 'captured', unitId: mira.id, byUnitId: u.id, pos: { ...mira.pos } });
      removeUnit(ctx, mira, 'captured');
      emitDialogue(ctx, 'miraCaptured');
      return;
    }
    case 'burnBridge': {
      const b = findObject(s, targetId);
      if (b && b.kind === 'bridge') burnBridge(ctx, b, u.id, 'interact');
      return;
    }
    case 'escape': {
      emit(ctx, { type: 'escaped', unitId: u.id, exitId: targetId, pos: { ...u.pos } });
      removeUnit(ctx, u, 'escaped');
      if (u.character === 'elian') emitDialogue(ctx, 'elianEscaped');
      if (u.character === 'mira') emitDialogue(ctx, 'miraEscaped');
      return;
    }
    case 'revive': {
      const hero = findUnit(s, targetId);
      if (hero) reviveUnit(ctx, hero, u.id);
      return;
    }
  }
}

/**
 * The seal breaks when every ward anchor is destroyed. With no anchors in the
 * scenario the seal can only break at the Second Bell.
 */
export function checkSealAnchors(ctx: Ctx): void {
  const list = anchors(ctx.state);
  if (!ctx.state.sealBroken && list.length > 0 && list.every((a) => a.destroyed)) breakSeal(ctx, 'anchors');
}

/**
 * Burn the canal bridges: once every barracksRoute bridge has burned (by
 * interaction or Pyre), Second Bell waves not yet arrived come 2 rounds later.
 * Applies only when the burnBridges objective is in play. The bell itself
 * (and so the Second Bell seal break) is not delayed.
 */
export function checkBridgesBonus(ctx: Ctx): void {
  const s = ctx.state;
  if (s.modifiers.bridgesBurned || !getObjective(s, 'burnBridges')) return;
  const route = bridges(s).filter((b) => b.tags.includes(BARRACKS_ROUTE_TAG));
  if (route.length === 0 || !route.every((b) => b.burned)) return;
  s.modifiers.bridgesBurned = true;
  const waves = s.waves
    .filter((w) => !w.spawned && w.bell === 'secondBell')
    .map((w) => ({ id: w.id, round: waveArrivalRound(s, w) }));
  emit(ctx, { type: 'bellsDelayed', reason: 'bridges', amount: RULES.bridgeDelay, bells: [], waves });
  emitDialogue(ctx, 'bridgesBurned');
}

/**
 * Seize the bell tower: checked when the rebel phase ends. A (standing, not
 * downed) rebel unit in bellTower and no loyalist in it delays every bell not
 * yet rung by 2 rounds. One time only; requires the seizeBellTower objective
 * to be in play.
 */
export function checkBellTower(ctx: Ctx, endingFaction: Faction): void {
  const s = ctx.state;
  if (endingFaction !== 'rebel' || s.modifiers.bellTowerSeized) return;
  if (!getObjective(s, 'seizeBellTower') || !hasZone(s, ZONES.bellTower)) return;
  if (unitsInZone(s, ZONES.bellTower, 'rebel').filter((u) => !isDowned(u)).length === 0) return;
  if (unitsInZone(s, ZONES.bellTower, 'loyalist').length > 0) return;
  s.modifiers.bellTowerSeized = true;
  delayRemainingBells(ctx, RULES.bellTowerDelay);
  emitDialogue(ctx, 'bellTowerSeized');
}
