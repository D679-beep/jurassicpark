// State mutations. Every function here mutates `ctx.state` in place: callers
// (applyAction) always work on a private deep copy, never on the input state.
import { RULES, TAG_NO_RESIST } from './data';
import { domainsAt, domainTiles, isInDomain } from './domains';
import { findUnit } from './map';
import { duelPartner, hasStatus, hasTag, isAscendant, isDuelActive } from './units';
import type {
  ActiveDomain,
  BridgeObject,
  DamageCause,
  DeathCause,
  DestructibleObject,
  DialogueTrigger,
  GameEvent,
  GameState,
  RemovalReason,
  Unit,
} from './types';

export interface Ctx {
  state: GameState;
  events: GameEvent[];
}

export function emit(ctx: Ctx, e: GameEvent): void {
  ctx.events.push(e);
}

function resolveSpeaker(state: GameState, speaker: string): { speakerId: string | null; speaker: string } {
  const all = [...state.units, ...state.removedUnits.map((r) => r.unit)];
  const u = all.find((x) => x.id === speaker) ?? all.find((x) => x.character === speaker);
  return u ? { speakerId: u.id, speaker: u.name } : { speakerId: null, speaker };
}

/** Emits the scenario's dialogue lines for a trigger, if any. */
export function emitDialogue(ctx: Ctx, trigger: DialogueTrigger): void {
  const lines = ctx.state.dialogue[trigger] ?? [];
  for (const line of lines) {
    emit(ctx, { type: 'dialogue', trigger, ...resolveSpeaker(ctx.state, line.speaker), text: line.text });
  }
}

// --- removal ---------------------------------------------------------------

/** Removes a unit from play and updates outcome flags and its Domain. */
export function removeUnit(ctx: Ctx, unit: Unit, reason: RemovalReason): void {
  const s = ctx.state;
  s.units = s.units.filter((u) => u.id !== unit.id);
  s.removedUnits.push({ unit, reason, round: s.round });

  if (unit.character === 'halden' && reason === 'died') s.outcome.emperorKilled = true;
  if (unit.character === 'elian') {
    if (reason === 'died') s.outcome.elianOutcome = 'killed';
    if (reason === 'escaped') s.outcome.elianOutcome = 'escaped';
  }
  if (unit.character === 'mira') {
    s.outcome.miraOutcome = reason === 'died' ? 'dead' : reason;
  }

  const d = s.domains.find((x) => x.ownerId === unit.id);
  if (d) {
    s.domains = s.domains.filter((x) => x !== d);
    emit(ctx, { type: 'domainEnded', unitId: unit.id, domain: d.kind, reason: 'ownerRemoved', drained: false });
  }
}

export function killUnit(ctx: Ctx, unit: Unit, killerId: string | null, cause: DeathCause): void {
  emit(ctx, {
    type: 'died',
    unitId: unit.id,
    name: unit.name,
    faction: unit.faction,
    pos: { ...unit.pos },
    killerId,
    cause,
  });
  removeUnit(ctx, unit, 'died');
  if (unit.character === 'elian') emitDialogue(ctx, 'elianKilled');
  if (unit.character === 'mira') emitDialogue(ctx, 'miraDied');
}

// --- damage & healing ------------------------------------------------------

/** Applies final damage to a unit, emitting `damaged` and, at 0 HP, `died`. */
export function damageUnit(
  ctx: Ctx,
  unit: Unit,
  amount: number,
  cause: DamageCause,
  sourceId: string | null,
  roll: number | null,
): void {
  const hpBefore = unit.hp;
  unit.hp = Math.max(0, unit.hp - amount);
  emit(ctx, {
    type: 'damaged',
    targetId: unit.id,
    targetKind: 'unit',
    pos: { ...unit.pos },
    amount: hpBefore - unit.hp,
    hpBefore,
    hpAfter: unit.hp,
    sourceId,
    cause,
    roll,
  });
  if (unit.hp <= 0) killUnit(ctx, unit, sourceId, cause);
}

/** Bulwark: allies of its owner (owner included) inside take half damage (floor, min 1). */
export function applyBulwark(state: GameState, target: Unit, amount: number): number {
  let d = amount;
  for (const dom of domainsAt(state, target.pos)) {
    if (dom.kind === 'bulwark' && dom.faction === target.faction) d = Math.max(1, Math.floor(d / 2));
  }
  return d;
}

/**
 * Final amount of fixed Domain damage (Tempest, Pyre) to `target`, or null if
 * the target is immune: noResist units are immune to all damage, sealed units
 * to non-Ascendant sources. Bulwark halving applies; the Ascendant bonus/cap
 * apply only to attacks.
 */
export function domainDamageAmount(state: GameState, target: Unit, amount: number, source: Unit): number | null {
  if (hasTag(target, TAG_NO_RESIST)) return null;
  if (hasStatus(target, 'sealed') && !isAscendant(source)) return null;
  return applyBulwark(state, target, amount);
}

export function healUnit(ctx: Ctx, unit: Unit, amount: number, sourceId: string): void {
  const healed = Math.min(amount, unit.maxHp - unit.hp);
  if (healed <= 0) return;
  unit.hp += healed;
  emit(ctx, { type: 'healed', unitId: unit.id, pos: { ...unit.pos }, amount: healed, hpAfter: unit.hp, sourceId });
}

export function damageObject(
  ctx: Ctx,
  obj: DestructibleObject,
  amount: number,
  sourceId: string | null,
  roll: number | null,
): void {
  const hpBefore = obj.hp;
  obj.hp = Math.max(0, obj.hp - amount);
  emit(ctx, {
    type: 'damaged',
    targetId: obj.id,
    targetKind: 'object',
    pos: { ...obj.pos },
    amount: hpBefore - obj.hp,
    hpBefore,
    hpAfter: obj.hp,
    sourceId,
    cause: 'attack',
    roll,
  });
  if (obj.hp <= 0 && !obj.destroyed) {
    obj.destroyed = true;
    emit(ctx, { type: 'objectDestroyed', objectId: obj.id, objectKind: obj.kind, pos: { ...obj.pos }, byUnitId: sourceId });
  }
}

// --- set-piece state changes ----------------------------------------------

/** Burns a bridge: every tile becomes water. Units standing on it stay put. */
export function burnBridge(ctx: Ctx, bridge: BridgeObject, byUnitId: string | null, cause: 'interact' | 'pyre'): void {
  if (bridge.burned) return;
  bridge.burned = true;
  for (const t of bridge.tiles) {
    const row = ctx.state.map.terrain[t.y];
    if (row) row[t.x] = 'water';
  }
  emit(ctx, { type: 'bridgeBurned', bridgeId: bridge.id, tiles: bridge.tiles.map((t) => ({ ...t })), byUnitId, cause });
}

/** Pyre: bridges with any tile inside an active Pyre burn (whole bridge). */
export function burnBridgesInPyres(ctx: Ctx): void {
  const s = ctx.state;
  for (const d of s.domains) {
    if (d.kind !== 'pyre') continue;
    for (const o of s.map.objects) {
      if (o.kind === 'bridge' && !o.burned && o.tiles.some((t) => isInDomain(s, d, t))) {
        burnBridge(ctx, o, d.ownerId, 'pyre');
      }
    }
  }
}

/** Breaks the Wellspring seal: every sealed unit loses `sealed`. Once only. */
export function breakSeal(ctx: Ctx, reason: 'anchors' | 'secondBell'): void {
  const s = ctx.state;
  if (s.sealBroken) return;
  s.sealBroken = true;
  const ids: string[] = [];
  for (const u of s.units) {
    if (hasStatus(u, 'sealed')) {
      u.statuses = u.statuses.filter((x) => x !== 'sealed');
      ids.push(u.id);
    }
  }
  if (ids.length > 0) {
    emit(ctx, { type: 'sealBroken', unitIds: ids, reason });
    emitDialogue(ctx, 'sealBroken');
  }
}

/** Ends the duel permanently once its conditions no longer hold. */
export function updateDuel(ctx: Ctx): void {
  const s = ctx.state;
  const duel = s.duel;
  if (!duel || !duel.active || isDuelActive(s)) return;
  duel.active = false;
  let removed = false;
  for (const id of duel.unitIds) {
    const u = findUnit(s, id);
    if (!u) removed = true;
    else u.statuses = u.statuses.filter((x) => x !== 'dueling');
  }
  emit(ctx, {
    type: 'duelEnded',
    unitIds: [duel.unitIds[0], duel.unitIds[1]],
    reason: removed ? 'duelistRemoved' : 'leftFeastHall',
  });
  emitDialogue(ctx, 'duelEnded');
}

/** Round-start duel damage: both duelists take a fixed 3 (no modifiers). */
export function tickDuel(ctx: Ctx): void {
  const s = ctx.state;
  if (!s.duel || !isDuelActive(s)) return;
  const pair = s.duel.unitIds.map((id) => findUnit(s, id)).filter((u): u is Unit => u !== undefined);
  const partners = pair.map((u) => duelPartner(s, u)?.id ?? null);
  pair.forEach((u, i) => {
    if (findUnit(s, u.id)) damageUnit(ctx, u, RULES.duelTickDamage, 'duel', partners[i] ?? null, null);
  });
}

// --- Domains ---------------------------------------------------------------

function unitsInDomain(state: GameState, d: ActiveDomain): Unit[] {
  return state.units.filter((u) => isInDomain(state, d, u.pos));
}

function dealDomainDamage(ctx: Ctx, d: ActiveDomain, owner: Unit, targets: Unit[], amount: number, cause: DamageCause): void {
  for (const t of targets) {
    const live = findUnit(ctx.state, t.id);
    if (!live) continue;
    const dmg = domainDamageAmount(ctx.state, live, amount, owner);
    if (dmg === null) continue;
    damageUnit(ctx, live, dmg, cause, d.ownerId, null);
  }
}

export function activateDomain(ctx: Ctx, unit: Unit): void {
  const s = ctx.state;
  const kind = unit.domain;
  if (!kind) return;
  unit.domainUsed = true;
  unit.hasActed = true;
  const d: ActiveDomain = {
    ownerId: unit.id,
    kind,
    faction: unit.faction,
    activatedRound: s.round,
    expiresAtRound: s.round + RULES.domainDuration,
  };
  s.domains.push(d);
  emit(ctx, {
    type: 'domainActivated',
    unitId: unit.id,
    domain: kind,
    center: { ...unit.pos },
    radius: RULES.domainRadius,
    tiles: domainTiles(s, d),
    expiresAtRound: d.expiresAtRound,
  });
  emitDialogue(ctx, `domain:${kind}`);
  if (kind === 'tempest') {
    const enemies = unitsInDomain(s, d).filter((u) => u.faction !== unit.faction);
    dealDomainDamage(ctx, d, unit, enemies, RULES.tempestActivationDamage, 'tempest');
  }
  if (kind === 'pyre') burnBridgesInPyres(ctx);
}

/** Round start step: Domains whose time is up end; owners become Drained. */
export function expireDomains(ctx: Ctx): void {
  const s = ctx.state;
  const expiring = s.domains.filter((d) => d.expiresAtRound <= s.round);
  s.domains = s.domains.filter((d) => d.expiresAtRound > s.round);
  for (const d of expiring) {
    const owner = findUnit(s, d.ownerId);
    if (owner && !hasStatus(owner, 'drained')) owner.statuses.push('drained');
    emit(ctx, { type: 'domainEnded', unitId: d.ownerId, domain: d.kind, reason: 'expired', drained: owner !== undefined });
  }
}

/** Round start step: each active Domain's per-round effect, in activation order. */
export function tickDomains(ctx: Ctx): void {
  const s = ctx.state;
  for (const d of [...s.domains]) {
    if (!s.domains.includes(d)) continue; // owner removed earlier in this tick
    const owner = findUnit(s, d.ownerId);
    if (!owner) continue;
    const inside = unitsInDomain(s, d);
    if (d.kind === 'tempest') {
      dealDomainDamage(ctx, d, owner, inside.filter((u) => u.faction !== owner.faction), RULES.tempestTickDamage, 'tempest');
    } else if (d.kind === 'pyre') {
      dealDomainDamage(ctx, d, owner, inside.filter((u) => u.id !== owner.id), RULES.pyreTickDamage, 'pyre');
      burnBridgesInPyres(ctx);
    } else if (d.kind === 'sanctuary') {
      for (const u of inside) {
        const live = findUnit(s, u.id);
        if (live && live.faction === owner.faction) healUnit(ctx, live, RULES.sanctuaryHeal, owner.id);
      }
    }
  }
}
