// Defending a VIP that dies to an interaction (the Emperor, whom only Varek
// can Confront, from an orthogonally adjacent tile, with his action unused).
//
// Per call we work out, from the public state only:
//   - the Confront tiles: the standable tiles orthogonally next to the VIP;
//   - the confronter's ETA in turns to the nearest Confront tile, ignoring
//     units (barred doors cost the turns he needs to break them);
//   - the deepest minimum vertex cut between him and the Confront tiles: the
//     fewest tiles that, held by our units, leave him no walkable route (for
//     the prologue's Throne Hall that is the single tile inside the open door).
//     Barred doors he can strike next turn count as open.
// Downed enemies (stay on the board at 0 HP, untargetable, revived by an
// adjacent ally) get "deny" posts on their open neighbours.
import {
  TAG_NO_RESIST,
  effectiveStats,
  hasStatus,
  hasTag,
  isInert,
  manhattan,
  objectAttackDamage,
  type DoorObject,
  type GameState,
  type Pos,
  type Unit,
} from '../engine';
import { idx, moveRulesFor, neighborIdx, posOf, type Grid } from './grid';

/** Characters whose death loses the battle for the rebels (defeat if Varek or Kaela dies). */
export const IRREPLACEABLE = new Set(['varek', 'kaela']);

/**
 * True for an enemy that is out of the fight but still on the board: at 0 HP,
 * or inert for a reason other than the seal / noResist (the coming 'downed'
 * status). Read generically so the AI keeps working when the rule lands.
 */
export function isDown(u: Unit): boolean {
  if (u.hp <= 0) return true;
  if ((u.statuses as readonly string[]).includes('downed')) return true;
  return isInert(u) && !hasStatus(u, 'sealed') && !hasTag(u, TAG_NO_RESIST);
}

/** Can this unit Confront a noResist VIP? (Engine rule: only Varek.) */
export function isConfronter(u: Unit): boolean {
  return u.character === 'varek' && !isDown(u);
}

export interface VipDefense {
  vip: Unit;
  confronter: Unit | null;
  /** Standable tiles orthogonally next to the VIP. */
  tiles: Pos[];
  /** Confronter's turns to reach the nearest Confront tile ignoring units (0 when already there; Infinity without a confronter or route). */
  eta: number;
  /** 0 calm, 1 prepare (ETA <= 3), 2 high (ETA <= 2), 3 urgent (ETA <= 1). */
  alert: number;
  /** Deepest minimum vertex cut between the confronter and the Confront tiles (empty when none or not useful). */
  cut: Pos[];
  /** Confronter's travel cost from his tile to every tile (ignoring units), or null. */
  reach: Float64Array | null;
}

/** Average damage of one blow on a barred door. */
function doorBlow(u: Unit, d: DoorObject): number {
  return (objectAttackDamage(u, d, 0) + objectAttackDamage(u, d, 2)) / 2;
}

/**
 * Forward travel cost from the confronter's tile, ignoring units. Barred
 * doors are passable at the price of the turns spent breaking them.
 */
function confronterReach(g: Grid, c: Unit): Float64Array {
  const rules = moveRulesFor(g, c);
  const move = Math.max(1, effectiveStats(c).move);
  const extra = new Float64Array(g.w * g.h);
  const passable = new Uint8Array(g.w * g.h);
  for (let i = 0; i < passable.length; i++) passable[i] = g.cost[i]! >= 0 && !rules.forbidden[i] ? 1 : 0;
  for (const o of g.state.map.objects) {
    if (o.kind !== 'door' || o.destroyed) continue;
    const i = idx(g, o.pos);
    if (rules.forbidden[i]) continue;
    passable[i] = 1;
    extra[i] = Math.ceil(o.hp / Math.max(1, doorBlow(c, o))) * move;
  }
  const dist = new Float64Array(g.w * g.h).fill(Infinity);
  const start = idx(g, c.pos);
  dist[start] = 0;
  // Small Dijkstra with a sorted frontier (costs are small integers).
  const buckets: number[][] = [[start]];
  const nb = new Int32Array(4);
  for (let cost = 0; cost < buckets.length; cost++) {
    const b = buckets[cost];
    if (!b) continue;
    for (const i of b) {
      if (dist[i]! < cost) continue;
      neighborIdx(g, i, nb);
      for (let k = 0; k < 4; k++) {
        const n = nb[k]!;
        if (n < 0 || !passable[n]) continue;
        const step = (g.cost[n]! >= 0 ? g.cost[n]! : 1) + extra[n]!;
        const nc = cost + step;
        if (nc >= dist[n]!) continue;
        dist[n] = nc;
        (buckets[nc] ??= []).push(n);
      }
    }
  }
  return dist;
}

/**
 * Deepest minimum vertex cut separating `src` from `sinks` over `passable`
 * tiles (unit vertex capacities; `src` and `blocked` tiles cannot be cut).
 * Returns the cut tiles, or null when the flow exceeds `limit`.
 */
export function minVertexCut(g: Grid, passable: Uint8Array, uncuttable: Uint8Array, src: number, sinks: number[], limit: number): number[] | null {
  const n = g.w * g.h;
  const isSink = new Uint8Array(n);
  for (const s of sinks) isSink[s] = 1;
  const vflow = new Uint8Array(n); // flow through in(i) -> out(i)
  const eflow = new Int16Array(n * 4); // flow out(i) -> in(nb_k(i))
  const tflow = new Int16Array(n); // flow out(i) -> T
  const nb = new Int32Array(4);
  const cap = (i: number): number => (i === src || uncuttable[i] ? 1e9 : 1);
  // Node ids: in(i) = 2i, out(i) = 2i + 1, T = 2n.
  const T = 2 * n;
  const prev = new Int32Array(2 * n + 1);
  const prevKind = new Int8Array(2 * n + 1);
  let flow = 0;
  for (;;) {
    prev.fill(-2);
    const start = 2 * src + 1;
    prev[start] = -1;
    const queue: number[] = [start];
    let found = false;
    for (let qi = 0; qi < queue.length && !found; qi++) {
      const node = queue[qi]!;
      const i = node >> 1;
      if (node & 1) {
        // out(i): -> in(j) forward (infinite); -> T if sink; -> in(i) reverse if vflow[i] > 0
        if (isSink[i] && prev[T] === -2) {
          prev[T] = node;
          prevKind[T] = 0;
          found = true;
          break;
        }
        neighborIdx(g, i, nb);
        for (let k = 0; k < 4; k++) {
          const j = nb[k]!;
          if (j < 0 || !passable[j]) continue;
          const to = 2 * j;
          if (prev[to] !== -2) continue;
          prev[to] = node;
          prevKind[to] = 1 + k; // forward edge out(i)->in(j) via direction k
          queue.push(to);
        }
        if (vflow[i]! > 0 && prev[2 * i] === -2) {
          prev[2 * i] = node;
          prevKind[2 * i] = 10; // reverse of in(i)->out(i)
          queue.push(2 * i);
        }
      } else {
        // in(i): -> out(i) if residual; -> out(j) reverse where flow j->i > 0
        if (vflow[i]! < cap(i) && prev[node + 1] === -2) {
          prev[node + 1] = node;
          prevKind[node + 1] = 11; // forward in(i)->out(i)
          queue.push(node + 1);
        }
        neighborIdx(g, i, nb);
        for (let k = 0; k < 4; k++) {
          const j = nb[k]!;
          if (j < 0) continue;
          // flow out(j) -> in(i) is stored at eflow[j*4 + dir(j->i)]; dir(j->i) = (k + 2) % 4
          const e = j * 4 + ((k + 2) % 4);
          if (eflow[e]! <= 0) continue;
          const to = 2 * j + 1;
          if (prev[to] !== -2) continue;
          prev[to] = node;
          prevKind[to] = 20 + k; // reverse of out(j)->in(i)
          queue.push(to);
        }
      }
    }
    if (!found) break;
    // Augment by 1 along the path.
    let node = T;
    while (prev[node] !== -1) {
      const p = prev[node]!;
      const kind = prevKind[node]!;
      if (node === T) {
        tflow[p >> 1]!++;
      } else if (kind >= 1 && kind <= 4) {
        eflow[(p >> 1) * 4 + (kind - 1)]!++;
      } else if (kind === 10) {
        vflow[p >> 1]!--;
      } else if (kind === 11) {
        vflow[p >> 1]!++;
      } else if (kind >= 20) {
        // node = out(j), p = in(i); undo flow out(j)->in(i)
        const j = node >> 1;
        const k = kind - 20;
        eflow[j * 4 + ((k + 2) % 4)]!--;
      }
      node = p;
    }
    flow++;
    if (flow > limit) return null;
  }
  // Nodes that can still reach T in the residual graph (reverse BFS from T).
  const toT = new Uint8Array(2 * n + 1);
  toT[T] = 1;
  const queue: number[] = [];
  for (const s of sinks) {
    if (!toT[2 * s + 1]) {
      toT[2 * s + 1] = 1;
      queue.push(2 * s + 1);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const node = queue[qi]!;
    const i = node >> 1;
    const add = (x: number): void => {
      if (!toT[x]) {
        toT[x] = 1;
        queue.push(x);
      }
    };
    if (node & 1) {
      // predecessors of out(i): in(i) if forward residual; in(j) if flow out(i)->in(j) > 0 (reverse edge in(j)->out(i))
      if (vflow[i]! < cap(i) && passable[i]) add(2 * i);
      neighborIdx(g, i, nb);
      for (let k = 0; k < 4; k++) {
        const j = nb[k]!;
        if (j >= 0 && eflow[i * 4 + k]! > 0) add(2 * j);
      }
    } else {
      // predecessors of in(i): out(j) for passable neighbours (forward edge); out(i) if vflow[i] > 0 (reverse)
      neighborIdx(g, i, nb);
      for (let k = 0; k < 4; k++) {
        const j = nb[k]!;
        if (j >= 0 && passable[j]) add(2 * j + 1);
      }
      if (vflow[i]! > 0) add(2 * i + 1);
    }
  }
  const cut: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!passable[i] || i === src || cap(i) > 1) continue;
    if (toT[2 * i + 1] && !toT[2 * i]) cut.push(i);
  }
  return cut.length === flow ? cut : null;
}

function alertFor(eta: number): number {
  if (eta <= 1) return 3;
  if (eta <= 2) return 2;
  if (eta <= 3) return 1;
  return 0;
}

/** Defense picture for every allied VIP (noResist unit) of `faction`. */
export function analyzeVips(g: Grid, faction: Unit['faction']): VipDefense[] {
  const state = g.state;
  const out: VipDefense[] = [];
  for (const vip of state.units) {
    if (vip.faction !== faction || !hasTag(vip, TAG_NO_RESIST)) continue;
    const tiles: Pos[] = [];
    const nb = new Int32Array(4);
    neighborIdx(g, idx(g, vip.pos), nb);
    for (let k = 0; k < 4; k++) {
      const n = nb[k]!;
      if (n >= 0 && g.cost[n]! >= 0) tiles.push(posOf(g, n));
    }
    // The nearest live confronter (deterministic: state order breaks ties).
    let confronter: Unit | null = null;
    for (const e of state.units) {
      if (e.faction === faction || !isConfronter(e)) continue;
      if (!confronter || manhattan(e.pos, vip.pos) < manhattan(confronter.pos, vip.pos)) confronter = e;
    }
    if (!confronter) {
      out.push({ vip, confronter: null, tiles, eta: Infinity, alert: 0, cut: [], reach: null });
      continue;
    }
    const reach = confronterReach(g, confronter);
    const move = Math.max(1, effectiveStats(confronter).move);
    let best = Infinity;
    for (const t of tiles) best = Math.min(best, reach[idx(g, t)]!);
    const eta = tiles.some((t) => manhattan(t, confronter!.pos) === 0) ? 0 : Math.ceil(best / move);
    const alert = alertFor(eta);
    let cut: Pos[] = [];
    if (eta >= 1 && Number.isFinite(eta)) {
      const rules = moveRulesFor(g, confronter);
      const passable = new Uint8Array(g.w * g.h);
      const uncuttable = new Uint8Array(g.w * g.h);
      const reachNext = effectiveStats(confronter).move + confronter.range.max;
      for (let i = 0; i < passable.length; i++) passable[i] = g.cost[i]! >= 0 && !rules.forbidden[i] ? 1 : 0;
      for (const o of state.map.objects) {
        // A barred door he can strike next turn may be open by the end of it.
        if (o.kind === 'door' && !o.destroyed && manhattan(o.pos, confronter.pos) <= reachNext) passable[idx(g, o.pos)] = 1;
      }
      for (const u of state.units) {
        // Tiles held by his side cannot be ours this phase; the VIP's own tile is not a road.
        if (u.faction !== faction && u.id !== confronter.id) uncuttable[idx(g, u.pos)] = 1;
      }
      passable[idx(g, vip.pos)] = 0;
      const sinks = tiles.map((t) => idx(g, t)).filter((i) => passable[i]);
      const c = sinks.length > 0 ? minVertexCut(g, passable, uncuttable, idx(g, confronter.pos), sinks, tiles.length) : null;
      if (c) cut = c.map((i) => posOf(g, i));
    }
    out.push({ vip, confronter, tiles, eta, alert, cut, reach });
  }
  return out;
}
