// Threat: which tiles the opposing faction can attack on its next turn.
//
// For every hostile unit that can act we flood its movement field (its
// effective move, blocked by our units, by our Bulwark and by duel
// confinement), take every tile it could end on, and mark every tile within
// its attack range that has line of sight. The map remembers which enemies
// reach each tile so per-target damage can be estimated later.
//
// This is a one-turn lookahead from the current positions; it ignores that our
// own units will have moved and that enemies may kill blockers first.
import {
  RULES,
  domainsAt,
  hasTag,
  isAscendant,
  isDueling,
  duelPartner,
  isInert,
  unitAttackDamage,
  effectiveStats,
  TAG_NO_RESIST,
  type Faction,
  type GameState,
  type Pos,
  type Unit,
} from '../engine';
import { buildGrid, idx, los, moveRulesFor, movementField, type Grid } from './grid';

export interface ThreatMap {
  /** The faction being threatened. */
  faction: Faction;
  enemies: Unit[];
  /** Per tile: indices into `enemies` that can attack it next turn. */
  byTile: number[][];
}

/** Enemies that can never act on their turn are not a threat. */
function canThreaten(u: Unit): boolean {
  return !isInert(u) && u.hp > 0 && effectiveStats(u).atk > 0;
}

/**
 * `ignoreUnitId`: a unit of `faction` treated as absent (the unit being
 * planned, which will not block the tile it is about to leave).
 */
export function computeThreat(g: Grid, faction: Faction, ignoreUnitId: string | null = null): ThreatMap {
  const state = g.state;
  const ignore = ignoreUnitId === null ? -1 : state.units.findIndex((u) => u.id === ignoreUnitId);
  const enemies = state.units.filter((u) => u.faction !== faction && canThreaten(u));
  const byTile: number[][] = Array.from({ length: g.w * g.h }, () => []);
  const stamp = new Int32Array(g.w * g.h).fill(-1);
  enemies.forEach((e, ei) => {
    const rules = moveRulesFor(g, e);
    const field = movementField(g, rules, e.pos, effectiveStats(e).move, ignore);
    const { rangeMin, rangeMax } = effectiveStats(e);
    const self = state.units.indexOf(e);
    for (let i = 0; i < field.length; i++) {
      if (field[i] === Infinity) continue;
      const occ = g.occ[i]!;
      if (occ >= 0 && occ !== ignore && occ !== self) continue; // cannot end on an occupied tile
      const fx = i % g.w;
      const fy = (i - fx) / g.w;
      for (let y = Math.max(0, fy - rangeMax); y <= Math.min(g.h - 1, fy + rangeMax); y++) {
        const span = rangeMax - Math.abs(y - fy);
        for (let x = Math.max(0, fx - span); x <= Math.min(g.w - 1, fx + span); x++) {
          if (Math.abs(x - fx) + Math.abs(y - fy) < rangeMin) continue;
          const ti = y * g.w + x;
          if (stamp[ti] === ei) continue;
          if (rangeMax > 1 && !los(g, { x: fx, y: fy }, { x, y })) continue;
          stamp[ti] = ei;
          byTile[ti]!.push(ei);
        }
      }
    }
  });
  return { faction, enemies, byTile };
}

/** Convenience for tests and tools: the threat map for `faction` in `state`. */
export function threatMapFor(state: GameState, faction: Faction, ignoreUnitId: string | null = null): ThreatMap {
  return computeThreat(buildGrid(state), faction, ignoreUnitId);
}

/** Expected damage (roll 1) from `attacker` to `target` if the target stood on `tile`. */
export function estimateHit(state: GameState, attacker: Unit, target: Unit, tile: Pos): number {
  const moved: Unit = { ...target, pos: tile };
  return unitAttackDamage(state, attacker, moved, attacker.pos, 1);
}

export interface TileDanger {
  /** Enemies able to attack the tile. */
  count: number;
  /** Expected focus fire on the unit there next turn (melee limited by the free tiles around it), plus round-start Domain damage. */
  damage: number;
  /** Damage would be lethal. */
  lethal: boolean;
  /** An enemy that could Capture this unit can reach it (e.g. Kaela vs Mira at <= 50% HP). */
  captureRisk: boolean;
  /** Fixed damage the unit takes at the next round start (Tempest / Pyre ticks) if it ends here. */
  roundStart: number;
}

/** Can `enemy` Capture `unit` (Kaela -> Mira) once adjacent? */
function capturer(enemy: Unit, unit: Unit): boolean {
  return enemy.character === 'kaela' && unit.character === 'mira';
}

/** Whether an enemy can direct an attack at `unit` at all (duelists only fight each other, noResist cannot be hit). */
function canTarget(state: GameState, enemy: Unit, unit: Unit): boolean {
  if (hasTag(unit, TAG_NO_RESIST)) return false;
  if (isDueling(state, enemy) && duelPartner(state, enemy)?.id !== unit.id) return false;
  return true;
}

/**
 * Fixed damage `unit` takes at the start of the next round if it ends its
 * phase on `tile`: enemy Tempest (3) and any other unit's Pyre (4), after its
 * own side's Bulwark. A Domain that expires at that round start does not tick.
 */
export function roundStartDamage(state: GameState, unit: Unit, tile: Pos): number {
  if (hasTag(unit, TAG_NO_RESIST)) return 0;
  let dmg = 0;
  let bulwark = false;
  for (const d of domainsAt(state, tile)) {
    if (d.kind === 'bulwark' && d.faction === unit.faction) bulwark = true;
    if (d.expiresAtRound <= state.round + 1) continue;
    if (d.kind === 'tempest' && d.faction !== unit.faction) dmg += RULES.tempestTickDamage;
    if (d.kind === 'pyre' && d.ownerId !== unit.id) dmg += RULES.pyreTickDamage;
  }
  if (dmg > 0 && bulwark) dmg = Math.max(1, Math.floor(dmg / 2));
  return dmg;
}

/**
 * Danger to `unit` if it ends its phase on `tile`. Every enemy that can reach
 * the tile is assumed to attack it, except that melee attackers need a free
 * tile beside it: only as many of them as there are open neighbours (not
 * walls, not allies of `unit`) are counted, the hardest hitters first.
 */
export function dangerAt(g: Grid, threat: ThreatMap, unit: Unit, tile: Pos): TileDanger {
  const state = g.state;
  const ti = idx(g, tile);
  const list = threat.byTile[ti] ?? [];
  let capturerNear = false;
  const melee: number[] = [];
  let ranged = 0;
  let others = 0;
  for (const ei of list) {
    const e = threat.enemies[ei]!;
    if (!canTarget(state, e, unit)) continue;
    if (capturer(e, unit)) capturerNear = true;
    const hit = estimateHit(state, e, unit, tile);
    if (!capturer(e, unit)) others += hit;
    if (effectiveStats(e).rangeMax <= 1) melee.push(hit);
    else ranged += hit;
  }
  let damage = ranged;
  if (melee.length > 0) {
    // Open neighbours: passable tiles not held by one of our units (the planned unit's own tile excluded).
    let slots = 0;
    const x = tile.x;
    const y = tile.y;
    const nbs = [ti - g.w, ti + 1, ti + g.w, ti - 1];
    const ok = [y > 0, x < g.w - 1, y < g.h - 1, x > 0];
    for (let k = 0; k < 4; k++) {
      if (!ok[k]) continue;
      const n = nbs[k]!;
      if (g.cost[n]! < 0) continue;
      const o = g.occ[n]!;
      if (o >= 0) {
        const other = state.units[o]!;
        if (other.faction === unit.faction && other.id !== unit.id) continue;
      }
      slots++;
    }
    melee.sort((a, b) => b - a);
    for (let k = 0; k < Math.min(slots, melee.length); k++) damage += melee[k]!;
  }
  const roundStart = roundStartDamage(state, unit, tile);
  damage += roundStart;
  const lethal = damage >= unit.hp;
  // Capture needs Mira at or below half HP before Kaela's action. Assume the
  // other attackers strike first.
  const captureRisk = capturerNear && (unit.hp - others - roundStart) * 2 <= unit.maxHp;
  return { count: list.length, damage, lethal, captureRisk, roundStart };
}

/** Rough total threat an Ascendant-weighted group of enemies poses near a point. */
export function pressureNear(state: GameState, faction: Faction, p: Pos, radius: number): number {
  let s = 0;
  for (const e of state.units) {
    if (e.faction === faction || !canThreaten(e)) continue;
    const d = Math.abs(e.pos.x - p.x) + Math.abs(e.pos.y - p.y);
    if (d > radius) continue;
    s += (1 - d / (radius + 1)) * (isAscendant(e) ? 2 : 1);
  }
  return s;
}
