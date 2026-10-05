// Attacks: target legality, the damage pipeline, previews and resolution.
//
// Damage to a unit (attacks only), in this order:
//   1. base   = max(1, ATK - DEF - terrainDefense(target tile)) + roll(0..2)
//              (ATK is effective ATK, i.e. after Drained)
//   2. Ascendant attacker vs non-Ascendant target: floor(x * 1.5)
//   3. attacker inside an enemy Sanctuary: max(1, x - 3)
//   4. target inside its own side's Bulwark: max(1, floor(x / 2))
//   5. non-Ascendant attacker vs Ascendant target: min(x, 1)
//   6. non-lethal attacker (Elian's Vow; Kaela vs Mira): min(x, hp - 1)
// Damage to an object (barred door, ward anchor):
//   max(1, ATK - objectDef) + roll  (no rank or Domain modifiers)
// Every attack consumes exactly one RNG roll, even when the result is capped.
import { RULES, TAG_NO_RESIST } from './data';
import { manhattan } from './geometry';
import { applyBulwark, damageObject, damageUnit, type Ctx } from './effects';
import { domainsAt } from './domains';
import { lineOfSight } from './los';
import { findObject, findUnit, isDestructible, terrainDefense } from './map';
import { rollInt } from './rng';
import { duelPartner, effectiveStats, hasStatus, hasTag, isAscendant, isDowned, isDueling, isInert } from './units';
import type { DestructibleObject, GameState, Pos, Unit } from './types';

export interface AttackTarget {
  id: string;
  kind: 'unit' | 'object';
  pos: Pos;
}

/** Elian's Vow, and Kaela's orders to take Mira alive: attacks cannot reduce the target below 1 HP. */
export function isNonLethalAttack(attacker: Unit, target: Unit): boolean {
  if (attacker.character === 'elian') return true;
  return attacker.character === 'kaela' && target.character === 'mira';
}

/** Why `attacker` (standing at `from`) may not attack `targetId`, or null if it may. Ignores turn flags. */
export function attackTargetProblem(state: GameState, attacker: Unit, targetId: string, from: Pos = attacker.pos): string | null {
  if (isInert(attacker)) return 'attacker cannot act';
  const stats = effectiveStats(attacker);
  const unitTarget = findUnit(state, targetId);
  let targetPos: Pos;
  if (unitTarget) {
    if (unitTarget.id === attacker.id) return 'cannot attack itself';
    if (unitTarget.faction === attacker.faction) return 'cannot attack an ally';
    if (hasTag(unitTarget, TAG_NO_RESIST)) return 'target cannot be damaged by attacks';
    if (isDowned(unitTarget)) return 'a downed hero cannot be attacked';
    if (hasStatus(unitTarget, 'sealed') && !isAscendant(attacker)) return 'sealed target can only be harmed by an Ascendant';
    if (isDueling(state, attacker) && duelPartner(state, attacker)?.id !== unitTarget.id) {
      return 'a duelist may only attack the other duelist';
    }
    targetPos = unitTarget.pos;
  } else {
    const obj = findObject(state, targetId);
    if (!obj) return `no unit or object "${targetId}"`;
    if (!isDestructible(obj)) return 'object cannot be attacked';
    if (obj.destroyed) return 'object already destroyed';
    if (isDueling(state, attacker)) return 'a duelist may only attack the other duelist';
    targetPos = obj.pos;
  }
  const dist = manhattan(from, targetPos);
  if (dist < stats.rangeMin || dist > stats.rangeMax) return 'target out of range';
  if (!lineOfSight(state, from, targetPos)) return 'no line of sight';
  return null;
}

/**
 * Targets the unit could legally attack now, from its tile or from `fromTile`
 * (to preview move-then-attack). Empty if the unit has acted, cannot act, or
 * it is not its faction's turn.
 */
export function attackableTargets(state: GameState, unitId: string, fromTile?: Pos): AttackTarget[] {
  const u = findUnit(state, unitId);
  if (!u || state.gameOver || u.faction !== state.activeFaction || u.hasActed || isInert(u)) return [];
  const from = fromTile ?? u.pos;
  const out: AttackTarget[] = [];
  for (const t of state.units) {
    if (attackTargetProblem(state, u, t.id, from) === null) out.push({ id: t.id, kind: 'unit', pos: { ...t.pos } });
  }
  for (const o of state.map.objects) {
    if (isDestructible(o) && attackTargetProblem(state, u, o.id, from) === null) {
      out.push({ id: o.id, kind: 'object', pos: { ...o.pos } });
    }
  }
  return out;
}

/** Final attack damage to a unit for a given roll (see pipeline above). */
export function unitAttackDamage(state: GameState, attacker: Unit, target: Unit, attackerPos: Pos, roll: number): number {
  const atk = effectiveStats(attacker).atk;
  let dmg = Math.max(1, atk - target.def - terrainDefense(state, target.pos)) + roll;
  if (isAscendant(attacker) && !isAscendant(target)) dmg = Math.floor(dmg * RULES.ascendantBonus);
  for (const d of domainsAt(state, attackerPos)) {
    if (d.kind === 'sanctuary' && d.faction !== attacker.faction) dmg = Math.max(1, dmg - RULES.sanctuaryPenalty);
  }
  dmg = applyBulwark(state, target, dmg);
  if (!isAscendant(attacker) && isAscendant(target)) dmg = Math.min(dmg, RULES.nonAscendantCap);
  if (isNonLethalAttack(attacker, target)) dmg = Math.min(dmg, Math.max(0, target.hp - 1));
  return dmg;
}

export function objectAttackDamage(attacker: Unit, obj: DestructibleObject, roll: number): number {
  return Math.max(1, effectiveStats(attacker).atk - obj.def) + roll;
}

export interface DamagePreview {
  attackerId: string;
  targetId: string;
  targetKind: 'unit' | 'object';
  /** Damage for each roll: index 0 is roll 0, ... index 2 is roll 2. */
  outcomes: number[];
  min: number;
  max: number;
  targetHp: number;
  /** Some roll kills / destroys the target. */
  canKill: boolean;
  /** Every roll kills / destroys the target. */
  willKill: boolean;
}

/**
 * Damage the attacker would deal to the target, for every possible roll,
 * from its tile or from `fromTile`. Does not check legality (use
 * attackableTargets for that). Returns null for unknown ids.
 */
export function previewDamage(state: GameState, attackerId: string, targetId: string, fromTile?: Pos): DamagePreview | null {
  const attacker = findUnit(state, attackerId);
  if (!attacker) return null;
  const from = fromTile ?? attacker.pos;
  const rolls: number[] = [];
  for (let r = RULES.rollMin; r <= RULES.rollMax; r++) rolls.push(r);
  const unitTarget = findUnit(state, targetId);
  let outcomes: number[];
  let hp: number;
  let kind: 'unit' | 'object';
  if (unitTarget) {
    const immune =
      hasTag(unitTarget, TAG_NO_RESIST) || isDowned(unitTarget) || (hasStatus(unitTarget, 'sealed') && !isAscendant(attacker));
    outcomes = rolls.map((r) => (immune ? 0 : unitAttackDamage(state, attacker, unitTarget, from, r)));
    hp = unitTarget.hp;
    kind = 'unit';
  } else {
    const obj = findObject(state, targetId);
    if (!obj || !isDestructible(obj)) return null;
    outcomes = rolls.map((r) => objectAttackDamage(attacker, obj, r));
    hp = obj.hp;
    kind = 'object';
  }
  return {
    attackerId,
    targetId,
    targetKind: kind,
    outcomes,
    min: Math.min(...outcomes),
    max: Math.max(...outcomes),
    targetHp: hp,
    canKill: outcomes.some((d) => d >= hp),
    willKill: outcomes.every((d) => d >= hp),
  };
}

/** Resolves a (validated) attack: one RNG roll, damage, death/destruction. */
export function performAttack(ctx: Ctx, attacker: Unit, targetId: string): void {
  const s = ctx.state;
  const [roll, next] = rollInt(s.rng, RULES.rollMin, RULES.rollMax);
  s.rng = next;
  attacker.hasActed = true;
  const unitTarget = findUnit(s, targetId);
  if (unitTarget) {
    damageUnit(ctx, unitTarget, unitAttackDamage(s, attacker, unitTarget, attacker.pos, roll), 'attack', attacker.id, roll);
    return;
  }
  const obj = findObject(s, targetId);
  if (obj && isDestructible(obj)) damageObject(ctx, obj, objectAttackDamage(attacker, obj, roll), attacker.id, roll);
}
