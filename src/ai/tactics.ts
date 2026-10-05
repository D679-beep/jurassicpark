// Phase-level coordination, recomputed from the state on every call (so the
// AI stays a pure function of GameState):
//   posts    tiles that must be held this phase: the Confront tiles next to
//            the Emperor, the chokepoint cut in front of them once Varek is
//            close, and "deny" tiles beside a downed enemy hero. Each post
//            gets the sturdiest unit that can stand on it this phase; a
//            holder that would not survive is swapped out when a better one
//            can take over.
//   kills    attackers are grouped on the targets they can kill together this
//            phase (Kaela first: her death ends the battle), with no more
//            attackers than the kill needs.
//   pacing   members of a reinforcement wave that is not yet in contact keep
//            within a few tiles of the wave's rear instead of trickling in.
import {
  TAG_NO_RESIST,
  attackTargetProblem,
  effectiveStats,
  hasTag,
  isAscendant,
  isInZone,
  manhattan,
  unitAttackDamage,
  type GameState,
  type Pos,
  type Unit,
} from '../engine';
import { IRREPLACEABLE, analyzeVips, isDown, type VipDefense } from './defense';
import { distanceField, idx, los, moveRulesFor, neighborIdx, posOf, reachable, type Grid, type MoveRules } from './grid';
import { assignRole, reinforceGoals, type Role } from './roles';
import { targetValue } from './scoring';
import { dangerAt, type ThreatMap } from './threat';

export interface Post {
  tile: Pos;
  importance: number;
  kind: 'cut' | 'confront' | 'deny';
  /** While calm, only guards of this zone take the post (null: anyone). */
  zone: string | null;
  /** Units may be pulled toward it from this many turns away (0: only units that reach it this phase). */
  pullTurns: number;
}

export interface Assignment {
  post: Post;
  /** hold: stand on it this phase; approach: walk toward it. */
  mode: 'hold' | 'approach';
}

export interface KillPlan {
  targetId: string;
  attackers: string[];
  pKill: number;
}

export interface Pace {
  field: Float64Array;
  /** The member should end on a tile whose field value is at least this. */
  limit: number;
}

export interface UnitReach {
  rules: MoveRules;
  /** Movement cost from the unit's tile (Infinity where it cannot go this turn). */
  field: Float64Array;
  /** Tiles it may end on this turn, its own tile first. */
  tiles: Pos[];
}

export interface Tactics {
  grid: Grid;
  /** Threat to our side with every unit where it stands. */
  threat: ThreatMap;
  vips: VipDefense[];
  posts: Post[];
  assignment: Map<string, Assignment>;
  /** Units that must step off the post they stand on (a sturdier unit takes it). */
  vacate: Set<string>;
  /** Tile index -> id of the unit assigned to hold it. */
  heldBy: Map<number, string>;
  /** Attacker id -> target id it should strike this phase. */
  focus: Map<string, string>;
  plans: KillPlan[];
  pace: Map<string, Pace>;
  roles: Map<string, Role>;
  reachOf(u: Unit): UnitReach;
}

const HOLDABLE_ROLES = new Set<Role['kind']>(['guard', 'reinforce', 'breaker']);

function rowMajor(a: Pos, b: Pos): number {
  return a.y - b.y || a.x - b.x;
}

function buildPosts(state: GameState, g: Grid, vips: VipDefense[], faction: Unit['faction']): Post[] {
  const posts: Post[] = [];
  for (const v of vips) {
    if (!v.confronter || v.eta === 0) continue;
    const reach = v.reach!;
    const zone = Object.keys(state.map.zones).find((z) => isInZone(state, v.vip.pos, z)) ?? null;
    const calm = v.alert === 0;
    const tiles = [...v.tiles].sort((a, b) => reach[idx(g, a)]! - reach[idx(g, b)]! || rowMajor(a, b));
    tiles.forEach((t, i) => {
      posts.push({
        tile: t,
        importance: 100 - 2 * i + (v.alert >= 2 ? 20 : 0),
        kind: 'confront',
        zone: calm ? zone : null,
        pullTurns: v.alert >= 1 ? 2 : 0,
      });
    });
    if (v.alert >= 2) {
      for (const t of v.cut) {
        if (v.tiles.some((c) => c.x === t.x && c.y === t.y)) continue;
        posts.push({ tile: t, importance: 140, kind: 'cut', zone: null, pullTurns: v.alert >= 3 ? 1 : 2 });
      }
    }
  }
  // Deny posts: the open tiles beside a downed enemy (a revive needs an adjacent ally).
  const nb = new Int32Array(4);
  for (const e of state.units) {
    if (e.faction === faction || !isDown(e)) continue;
    const hero = e.character !== null && IRREPLACEABLE.has(e.character);
    neighborIdx(g, idx(g, e.pos), nb);
    for (let k = 0; k < 4; k++) {
      const n = nb[k]!;
      if (n < 0 || g.cost[n]! < 0) continue;
      posts.push({ tile: posOf(g, n), importance: hero ? 135 : 45, kind: 'deny', zone: null, pullTurns: 2 });
    }
  }
  return posts.sort((a, b) => b.importance - a.importance || rowMajor(a.tile, b.tile));
}

/** P(sum of independent uniform-roll hits >= hp). */
export function killProbability(hits: number[][], hp: number): number {
  if (hp <= 0) return 1;
  let dist = new Float64Array(hp + 1);
  dist[0] = 1;
  for (const outcomes of hits) {
    const next = new Float64Array(hp + 1);
    const p = 1 / outcomes.length;
    for (let s = 0; s <= hp; s++) {
      const m = dist[s]!;
      if (m === 0) continue;
      for (const d of outcomes) next[Math.min(hp, s + d)]! += m * p;
    }
    dist = next;
  }
  return dist[hp]!;
}

export function buildTactics(state: GameState, g: Grid, threat: ThreatMap): Tactics {
  const faction = state.activeFaction;
  const roles = new Map<string, Role>();
  const mine = state.units.filter((u) => u.faction === faction);
  for (const u of mine) roles.set(u.id, assignRole(state, u));
  const reachCache = new Map<string, UnitReach>();
  const reachOf = (u: Unit): UnitReach => {
    let r = reachCache.get(u.id);
    if (!r) {
      const rules = moveRulesFor(g, u);
      if (u.hasMoved) {
        const field = new Float64Array(g.w * g.h).fill(Infinity);
        field[idx(g, u.pos)] = 0;
        r = { rules, field, tiles: [u.pos] };
      } else {
        const rr = reachable(g, u, rules);
        r = { rules, field: rr.field, tiles: [u.pos, ...rr.tiles] };
      }
      reachCache.set(u.id, r);
    }
    return r;
  };

  const vips = analyzeVips(g, faction);
  const posts = buildPosts(state, g, vips, faction);
  const assignment = new Map<string, Assignment>();
  const vacate = new Set<string>();
  const heldBy = new Map<number, string>();
  const taken = new Set<string>();

  const eligible = (u: Unit, p: Post): boolean => {
    if (isDown(u) || hasTag(u, TAG_NO_RESIST)) return false;
    const role = roles.get(u.id)!;
    if (!HOLDABLE_ROLES.has(role.kind)) return false;
    if (p.zone !== null && u.guardZone !== p.zone) return false;
    return true;
  };
  const quality = (u: Unit, p: Post): number => u.hp - dangerAt(g, threat, u, p.tile).damage;
  /** Turns for `u` to stand on `p` (0: already there, 1: this phase, k: later). */
  const turnsTo = (u: Unit, p: Post, fieldCache: Map<string, Float64Array>): number => {
    if (u.pos.x === p.tile.x && u.pos.y === p.tile.y) return 0;
    if (u.hasMoved) return Infinity;
    const r = reachOf(u);
    const c = r.field[idx(g, p.tile)]!;
    if (c !== Infinity) return 1;
    let f = fieldCache.get(u.id);
    if (!f) {
      f = distanceField(g, r.rules, [p.tile], 3);
      fieldCache.set(u.id, f);
    }
    const d = f[idx(g, u.pos)]!;
    return d === Infinity ? Infinity : Math.max(2, Math.ceil(d / Math.max(1, effectiveStats(u).move)));
  };

  for (const p of posts) {
    const ti = idx(g, p.tile);
    const o = g.occ[ti]!;
    let occ = o >= 0 ? state.units[o]! : null;
    if (occ && occ.faction !== faction) continue;
    if (occ && occ.hasMoved) {
      // Whoever already moved onto it holds it.
      if (!taken.has(occ.id) && eligible(occ, p)) {
        assignment.set(occ.id, { post: p, mode: 'hold' });
        taken.add(occ.id);
        heldBy.set(ti, occ.id);
      }
      continue;
    }
    if (occ && taken.has(occ.id)) {
      // It is off to a more important post: it leaves first, then the tile is free.
      vacate.add(occ.id);
      occ = null;
    } else if (occ && !eligible(occ, p)) {
      continue;
    }
    const fieldCache = new Map<string, Float64Array>();
    let best: Unit | null = null;
    let bestQ = -Infinity;
    for (const u of mine) {
      if (taken.has(u.id) || u === occ || u.hasMoved || !eligible(u, p)) continue;
      if (u.pos.x === p.tile.x && u.pos.y === p.tile.y) continue;
      const t = turnsTo(u, p, fieldCache);
      if (t > 1) continue;
      const q = quality(u, p);
      if (q > bestQ) {
        best = u;
        bestQ = q;
      }
    }
    if (occ) {
      const qi = quality(occ, p);
      if (best && qi <= 0 && bestQ > qi + 4) {
        assignment.set(best.id, { post: p, mode: 'hold' });
        taken.add(best.id);
        heldBy.set(ti, best.id);
        vacate.add(occ.id);
        taken.add(occ.id);
      } else {
        assignment.set(occ.id, { post: p, mode: 'hold' });
        taken.add(occ.id);
        heldBy.set(ti, occ.id);
      }
      continue;
    }
    if (best) {
      assignment.set(best.id, { post: p, mode: 'hold' });
      taken.add(best.id);
      heldBy.set(ti, best.id);
      continue;
    }
    if (p.pullTurns < 2) continue;
    // Nobody can stand on it this phase: pull the nearest suitable unit toward it.
    let pull: Unit | null = null;
    let pullT = Infinity;
    for (const u of mine) {
      if (taken.has(u.id) || u.hasMoved || !eligible(u, p)) continue;
      const role = roles.get(u.id)!;
      if (role.kind === 'breaker') continue;
      const t = turnsTo(u, p, fieldCache);
      if (t <= p.pullTurns && t < pullT) {
        pull = u;
        pullT = t;
      }
    }
    if (pull) {
      assignment.set(pull.id, { post: p, mode: 'approach' });
      taken.add(pull.id);
    }
  }

  // --- kill plans --------------------------------------------------------------
  const focus = new Map<string, string>();
  const plans: KillPlan[] = [];
  interface Option {
    unit: Unit;
    tiles: number[];
    outcomes: number[];
    exp: number;
  }
  const enemies = state.units.filter((e) => e.faction !== faction && !isDown(e) && !hasTag(e, TAG_NO_RESIST));
  const attackers = mine.filter((u) => {
    if (u.hasActed || effectiveStats(u).atk <= 0) return false;
    const role = roles.get(u.id)!;
    if (role.kind === 'inert' || role.kind === 'duelist') return false;
    if (role.kind === 'flee' && role.attacksOnlyIfCornered) return false; // Elian's Vow: he runs
    return true;
  });
  const reserved = new Set<number>(heldBy.keys());
  const tilesFor = (u: Unit): number[] => {
    const a = assignment.get(u.id);
    const role = roles.get(u.id)!;
    if (a && a.mode === 'hold') {
      const ti = idx(g, a.post.tile);
      return u.pos.x === a.post.tile.x && u.pos.y === a.post.tile.y ? [ti] : reachOf(u).field[ti] !== Infinity ? [ti] : [idx(g, u.pos)];
    }
    if (u.hasMoved || role.kind === 'flee') return [idx(g, u.pos)];
    return reachOf(u)
      .tiles.map((t) => idx(g, t))
      .filter((i) => !reserved.has(i) || heldBy.get(i) === u.id);
  };
  const optionsByTarget = new Map<string, Option[]>();
  for (const u of attackers) {
    const tiles = tilesFor(u);
    const { rangeMin, rangeMax } = effectiveStats(u);
    for (const e of enemies) {
      const fits: number[] = [];
      for (const ti of tiles) {
        const x = ti % g.w;
        const y = (ti - x) / g.w;
        const d = Math.abs(x - e.pos.x) + Math.abs(y - e.pos.y);
        if (d < rangeMin || d > rangeMax) continue;
        if (rangeMax > 1 && !los(g, { x, y }, e.pos)) continue;
        fits.push(ti);
      }
      if (fits.length === 0) continue;
      const from = posOf(g, fits[0]!);
      if (attackTargetProblem(state, { ...u, pos: from }, e.id, from) !== null) continue;
      const outcomes = [0, 1, 2].map((r) => unitAttackDamage(state, u, e, from, r));
      const exp = (outcomes[0]! + outcomes[1]! + outcomes[2]!) / 3;
      if (exp <= 0) continue;
      const list = optionsByTarget.get(e.id) ?? [];
      list.push({ unit: u, tiles: fits, outcomes, exp });
      optionsByTarget.set(e.id, list);
    }
  }
  const gameEnding = (e: Unit): boolean => e.character !== null && IRREPLACEABLE.has(e.character);
  const order = enemies
    .filter((e) => optionsByTarget.has(e.id))
    .map((e, i) => ({ e, i, v: (gameEnding(e) ? 1000 : 0) + targetValue(attackers[0] ?? e, e) }))
    .sort((a, b) => b.v - a.v || a.e.hp - b.e.hp || a.i - b.i)
    .map((x) => x.e);
  const committed = new Set<string>();
  for (const e of order) {
    const opts = optionsByTarget
      .get(e.id)!
      .filter((o) => !committed.has(o.unit.id))
      .sort((a, b) => b.exp - a.exp || state.units.indexOf(a.unit) - state.units.indexOf(b.unit));
    const chosen: Option[] = [];
    const usedTiles = new Set<number>();
    let p = 0;
    for (const o of opts) {
      const free = o.tiles.find((t) => !usedTiles.has(t));
      if (free === undefined) continue;
      chosen.push(o);
      usedTiles.add(free);
      p = killProbability(
        chosen.map((c) => c.outcomes),
        e.hp,
      );
      if (p >= 0.85) break;
    }
    const threshold = gameEnding(e) ? 0.3 : 0.5;
    if (chosen.length === 0 || p < threshold) continue;
    for (const c of chosen) {
      committed.add(c.unit.id);
      focus.set(c.unit.id, e.id);
    }
    plans.push({ targetId: e.id, attackers: chosen.map((c) => c.unit.id), pKill: p });
  }

  // --- wave pacing ----------------------------------------------------------
  const pace = new Map<string, Pace>();
  for (const w of state.waves) {
    if (!w.spawned) continue;
    const ids = new Set(w.units.map((u) => u.id));
    const members = mine.filter((u) => ids.has(u.id) && roles.get(u.id)!.kind === 'reinforce' && !assignment.has(u.id));
    if (members.length < 2) continue;
    const engaged = members.some((u) => {
      if ((threat.byTile[idx(g, u.pos)] ?? []).length > 0) return true;
      const reachR = effectiveStats(u).move + effectiveStats(u).rangeMax;
      return enemies.some((e) => manhattan(e.pos, u.pos) <= reachR);
    });
    if (engaged) continue;
    const lead = members[0]!;
    const goals = reinforceGoals(state, g, lead);
    if (goals.length === 0) continue;
    const field = distanceField(g, moveRulesFor(g, lead), goals, 3);
    const dists = members.map((u) => field[idx(g, u.pos)]!).filter((d) => d !== Infinity);
    if (dists.length < 2) continue;
    dists.sort((a, b) => b - a);
    const rear = dists.length >= 3 ? dists[1]! : dists[0]!;
    const minMove = Math.min(...members.map((u) => effectiveStats(u).move));
    const limit = rear - minMove - 2;
    for (const u of members) if (!u.hasMoved) pace.set(u.id, { field, limit });
  }

  return { grid: g, threat, vips, posts, assignment, vacate, heldBy, focus, plans, pace, roles, reachOf };
}

/** Whether `u` is an Ascendant that can still raise a Domain (used for ordering). */
export function hasDomainLeft(u: Unit): boolean {
  return isAscendant(u) && u.domain !== null && !u.domainUsed;
}
