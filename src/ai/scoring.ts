// Action scoring. Higher is better; <= 0 means "not worth the action".
//
// Attack ordering (spec): kills first, then high-value targets, then lowest
// HP. A non-Ascendant hitting an Ascendant deals at most 1, so such attacks
// score almost nothing unless they finish the target; any other target wins.
import {
  RULES,
  TAG_NO_RESIST,
  findObject,
  findUnit,
  hasStatus,
  hasTag,
  isAscendant,
  manhattan,
  previewDamage,
  type GameState,
  type Pos,
  type Unit,
} from '../engine';
import type { Role } from './roles';

/** How much the attacker's side wants a target gone (before damage/kill terms). */
export function targetValue(_attacker: Unit, target: Unit): number {
  // Killing Varek or Kaela ends the battle for the loyalists.
  const byCharacter: Partial<Record<string, number>> = {
    varek: 100,
    kaela: 80,
    grimm: 40,
    orsa: 40,
    elian: 40,
    mira: 30,
  };
  const c = target.character ? byCharacter[target.character] : undefined;
  if (c !== undefined) return c;
  switch (target.rank) {
    case 'ascendant':
      return 30;
    case 'radiant':
      return 16;
    case 'kindled':
      return 12;
    default:
      return 8;
  }
}

export const KILL_BONUS = 200;
export const POINTLESS_ATTACK = 2;

export interface ScoredAction {
  kind: 'attack' | 'interact' | 'domain';
  targetId: string | null;
  interaction?: 'confront' | 'capture' | 'escape' | 'burnBridge';
  value: number;
}

/** Score an attack on a unit or object from `from` (the attack's legality is checked elsewhere). */
export function scoreAttack(state: GameState, attacker: Unit, targetId: string, from: Pos, role: Role): number {
  const p = previewDamage(state, attacker.id, targetId, from);
  if (!p) return 0;
  const n = p.outcomes.length;
  const expected = p.outcomes.reduce((a, b) => a + b, 0) / n;
  const killP = p.outcomes.filter((d) => d >= p.targetHp).length / n;

  if (p.targetKind === 'object') {
    const obj = findObject(state, targetId);
    if (!obj || obj.kind !== 'anchor') return 0; // the AI never opens barred doors
    // Anchors hold a seal; only worth breaking when the sealed unit is ours.
    const sealedAlly = state.units.some((u) => u.faction === attacker.faction && hasStatus(u, 'sealed'));
    if (!sealedAlly || state.sealBroken) return 0;
    const base = role.kind === 'breaker' ? 300 : 40;
    return base + killP * 150 + expected * 4;
  }

  const target = findUnit(state, targetId);
  if (!target || hasTag(target, TAG_NO_RESIST)) return 0;
  const tv = targetValue(attacker, target);

  // The rebels want Mira alive: only Kaela (whose hits are non-lethal) may strike her.
  if (target.character === 'mira' && attacker.faction === 'rebel' && attacker.character !== 'kaela') return -50;

  if (!isAscendant(attacker) && isAscendant(target) && killP === 0) return POINTLESS_ATTACK;
  if (expected <= 0) return 0;

  const hpAfter = Math.max(0, p.targetHp - expected);
  return killP * (KILL_BONUS + tv * 4) + tv * 2 + expected * 4 + (40 - Math.min(40, hpAfter)) * 0.5;
}

// --- Domains -----------------------------------------------------------------

function within(a: Pos, b: Pos, r: number): boolean {
  return manhattan(a, b) <= r;
}

/**
 * Value of activating the unit's Domain while standing on `at`. Negative
 * when it should be kept for later (it is once per battle).
 */
export function scoreDomain(state: GameState, u: Unit, at: Pos): number {
  const R = RULES.domainRadius;
  const allies = state.units.filter((x) => x.faction === u.faction && x.id !== u.id);
  const enemies = state.units.filter((x) => x.faction !== u.faction && !hasTag(x, TAG_NO_RESIST));
  switch (u.domain) {
    case 'bulwark': {
      // Protect the Emperor: enemies cannot walk into the zone, so a Bulwark
      // that covers every tile next to him stops a Confront for 3 rounds.
      for (const vip of allies.filter((a) => hasTag(a, TAG_NO_RESIST))) {
        if (!within(at, vip.pos, R - 1)) continue;
        const confronter = enemies.find((e) => e.character === 'varek');
        const near = enemies.filter((e) => within(e.pos, vip.pos, 10)).length;
        const adjacentEnemy = enemies.some((e) => manhattan(e.pos, vip.pos) === 1);
        if ((confronter && within(confronter.pos, vip.pos, 12)) || near >= 2) return adjacentEnemy ? 150 : 500;
      }
      // A crowded fight: shield allies at a chokepoint.
      const covered = allies.filter((a) => within(a.pos, at, R)).length;
      const pressing = enemies.filter((e) => within(e.pos, at, R + 3)).length;
      if (covered >= 3 && pressing >= 2) return 100 + 10 * covered;
      return -1;
    }
    case 'sanctuary': {
      let v = 0;
      for (const a of [u, ...allies]) {
        const p = a.id === u.id ? at : a.pos;
        if (within(p, at, R)) v += Math.min(RULES.sanctuaryHeal, a.maxHp - a.hp) * 2;
      }
      const close = enemies.filter((e) => within(e.pos, at, R + 2)).length;
      v += close * 10;
      return close > 0 && v >= 30 ? v : -1;
    }
    case 'tempest': {
      let v = 0;
      let hits = 0;
      for (const e of enemies) {
        if (!within(e.pos, at, R)) continue;
        if (hasStatus(e, 'sealed') && !isAscendant(u)) continue;
        hits++;
        v += 30 + (e.hp <= RULES.tempestActivationDamage ? KILL_BONUS + targetValue(u, e) * 2 : 0);
      }
      return hits >= 2 || v >= KILL_BONUS ? v : -1;
    }
    case 'pyre': {
      let v = 0;
      for (const e of enemies) if (within(e.pos, at, R)) v += 30;
      for (const a of allies) if (within(a.pos, at, R)) v -= 40;
      return v >= 60 ? v : -1;
    }
    default:
      return -1;
  }
}

export function scoreInteraction(interaction: string): number {
  switch (interaction) {
    case 'confront':
      return 20000;
    case 'capture':
      return 15000;
    case 'escape':
      return 10000;
    default:
      return 0; // burnBridge: not pursued by the AI
  }
}
