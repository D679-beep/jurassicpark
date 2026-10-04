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
  isAscendant,
  isInert,
  lineOfSight,
  unitAttackDamage,
  effectiveStats,
  type Faction,
  type GameState,
  type Pos,
  type Unit,
} from '../engine';
import { buildGrid, idx, moveRulesFor, movementField, posOf, ringTiles, type Grid } from './grid';

export interface ThreatMap {
  /** The faction being threatened. */
  faction: Faction;
  enemies: Unit[];
  /** Per tile: indices into `enemies` that can attack it next turn. */
  byTile: number[][];
}

/** Enemies that can never act on their turn are not a threat. */
function canThreaten(u: Unit): boolean {
  return !isInert(u) && effectiveStats(u).atk > 0;
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
    for (let i = 0; i < field.length; i++) {
      if (field[i] === Infinity) continue;
      const occ = g.occ[i]!;
      if (occ >= 0 && occ !== ignore && state.units[occ]!.id !== e.id) continue; // cannot end on an occupied tile
      const from = posOf(g, i);
      for (const t of ringTiles(g, from, rangeMin, rangeMax)) {
        const ti = idx(g, t);
        if (stamp[ti] === ei) continue;
        if (rangeMax > 1 && !lineOfSight(state, from, t)) continue;
        stamp[ti] = ei;
        byTile[ti]!.push(ei);
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
  /** Sum of every such enemy's expected hit on the unit (pessimistic focus fire). */
  damage: number;
  /** Damage would be lethal. */
  lethal: boolean;
  /** An enemy that could Capture this unit can reach it (e.g. Kaela vs Mira at <= 50% HP). */
  captureRisk: boolean;
}

/** Can `enemy` Capture `unit` (Kaela -> Mira) once adjacent? */
function capturer(enemy: Unit, unit: Unit): boolean {
  return enemy.character === 'kaela' && unit.character === 'mira';
}

export function dangerAt(g: Grid, threat: ThreatMap, unit: Unit, tile: Pos): TileDanger {
  const list = threat.byTile[idx(g, tile)] ?? [];
  let damage = 0;
  let capturerNear = false;
  for (const ei of list) {
    const e = threat.enemies[ei]!;
    if (capturer(e, unit)) capturerNear = true;
    damage += estimateHit(g.state, e, unit, tile);
  }
  const lethal = damage >= unit.hp;
  // Capture needs Mira at or below half HP before Kaela's action. Assume the
  // other attackers strike first.
  let captureRisk = false;
  if (capturerNear) {
    const others = list
      .map((ei) => threat.enemies[ei]!)
      .filter((e) => !capturer(e, unit))
      .reduce((s, e) => s + estimateHit(g.state, e, unit, tile), 0);
    captureRisk = (unit.hp - others) * 2 <= unit.maxHp;
  }
  return { count: list.length, damage, lethal, captureRisk };
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
