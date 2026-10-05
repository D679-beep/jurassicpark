// "Why can't I Confront yet?": a live, plain-language status for the required
// objective (kill the Emperor), plus the state of the crown marker on the
// board. Pure: derived from the engine (movement field, interactions, doors).
import {
  TERRAIN,
  availableInteractions,
  blockingObjectAt,
  closedGateAt,
  effectiveStats,
  findCharacter,
  getObjective,
  manhattan,
  neighbors4,
  pathTo,
  reachableTiles,
  terrainAt,
  type GameState,
  type Pos,
  type Unit,
} from '../engine';
import { objectName } from './names';
import { isPlayerTurn } from './phase';

export type GuidanceKind = 'done' | 'ready' | 'approach' | 'acted' | 'waiting' | 'far' | 'barred' | 'blocked' | 'lost';
export type GuidanceTone = 'ok' | 'info' | 'warn' | 'bad';

export interface Guidance {
  kind: GuidanceKind;
  tone: GuidanceTone;
  /** The line shown in the HUD. */
  text: string;
  /** The Emperor's tile (for the board marker); null once he is gone. */
  target: Pos | null;
  /** The unit that has to do it (Varek); null when nobody can. */
  actorId: string | null;
}

/** State of the crown marker on the Emperor's tile. */
export type MarkState = 'idle' | 'reachable' | 'ready';

export function markState(g: Guidance | null): MarkState {
  return g?.kind === 'ready' ? 'ready' : g?.kind === 'approach' ? 'reachable' : 'idle';
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How much a barred door or anchor adds to a route, in steps: open routes win unless they are far longer. */
const BREACH_COST = 6;

/**
 * Names of the barred doors / ward anchors on the cheapest route from `from`
 * to one of `goals` if every one of them were broken; `[]` when the route is
 * already open, null when even breaking everything leaves no route (water,
 * walls, a closed portcullis). Units are ignored: they move.
 */
export function breachRoute(state: GameState, from: Pos, goals: readonly Pos[]): string[] | null {
  const w = state.map.width;
  const h = state.map.height;
  const idx = (p: Pos): number => p.y * w + p.x;
  const dist = new Float64Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const done = new Uint8Array(w * h);
  const passable = (p: Pos): boolean => {
    if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) return false;
    const t = terrainAt(state, p);
    return t !== undefined && TERRAIN[t].moveCost !== null && !closedGateAt(state, p);
  };
  const stepCost = (p: Pos): number => TERRAIN[terrainAt(state, p)!].moveCost! + (blockingObjectAt(state, p) ? BREACH_COST : 0);
  dist[idx(from)] = 0;
  const goalSet = new Set(goals.map(idx));
  for (;;) {
    let best = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i]! < Infinity && (best < 0 || dist[i]! < dist[best]!)) best = i;
    if (best < 0) return null;
    done[best] = 1;
    if (goalSet.has(best)) {
      const names: string[] = [];
      for (let i = best; i >= 0; i = prev[i]!) {
        const o = blockingObjectAt(state, { x: i % w, y: Math.floor(i / w) });
        if (o) names.unshift(objectName(o));
      }
      return names;
    }
    for (const n of neighbors4({ x: best % w, y: Math.floor(best / w) })) {
      if (!passable(n)) continue;
      const nd = dist[best]! + stepCost(n);
      if (nd < dist[idx(n)]!) {
        dist[idx(n)] = nd;
        prev[idx(n)] = best;
      }
    }
  }
}

function canConfrontFrom(state: GameState, varek: Unit, haldenId: string, at: Pos): boolean {
  return availableInteractions(state, { ...varek, pos: at }).some((i) => i.interaction === 'confront' && i.targetId === haldenId);
}

/**
 * The status line for "kill the Emperor", or null when the scenario has no
 * such objective. `selectedId` only changes the wording of the hint.
 */
export function emperorGuidance(state: GameState, selectedId: string | null = null): Guidance | null {
  const obj = getObjective(state, 'killEmperor');
  if (!obj) return null;
  if (obj.status === 'completed') return { kind: 'done', tone: 'ok', text: 'The Emperor has fallen.', target: null, actorId: null };
  if (obj.status === 'failed') return { kind: 'lost', tone: 'bad', text: 'The Emperor can no longer be reached.', target: null, actorId: null };
  const halden = findCharacter(state, 'halden');
  if (!halden) return null;
  const target = { ...halden.pos };
  const varek = findCharacter(state, 'varek');
  if (!varek) return { kind: 'lost', tone: 'bad', text: 'Varek has fallen: nobody can Confront the Emperor.', target, actorId: null };
  const who = varek.name;
  const yourTurn = isPlayerTurn(state) && varek.faction === state.activeFaction;
  const say = (kind: GuidanceKind, tone: GuidanceTone, text: string): Guidance => ({ kind, tone, text, target, actorId: varek.id });

  if (yourTurn && canConfrontFrom(state, varek, halden.id, varek.pos)) {
    return say(
      'ready',
      'ok',
      selectedId === varek.id ? 'Ready: click the Emperor to Confront.' : `Ready: select ${who}, then click the Emperor to Confront.`,
    );
  }
  if (manhattan(varek.pos, halden.pos) === 1) {
    if (!yourTurn) return say('waiting', 'info', `${who} stands beside the Emperor. Confront on your turn.`);
    if (varek.hasActed) return say('acted', 'info', `${who} has already acted. Confront next turn.`);
    return say('blocked', 'warn', `${who} is beside the Emperor but cannot Confront right now.`);
  }
  if (yourTurn && !varek.hasMoved && !varek.hasActed) {
    const reach = reachableTiles(state, varek.id).some((t) => manhattan(t, halden.pos) === 1 && canConfrontFrom(state, varek, halden.id, t));
    if (reach) {
      return say(
        'approach',
        'ok',
        selectedId === varek.id
          ? `${who} can reach the Emperor this turn: click him to walk up and Confront.`
          : `${who} can reach the Emperor this turn: select ${who}, then click the Emperor.`,
      );
    }
  }

  // Too far: how far, and how long.
  const sides = neighbors4(halden.pos);
  let best: { tiles: number; cost: number } | null = null;
  for (const n of sides) {
    const path = pathTo(state, varek.id, n, { ignoreMoveLimit: true, ignoreUnits: true });
    if (!path) continue;
    const cost = path.reduce((sum, p) => sum + (TERRAIN[terrainAt(state, p) ?? 'floor'].moveCost ?? 1), 0);
    // "Tiles from the Emperor" counts the last step onto his own tile; the walk itself ends beside him.
    if (!best || cost < best.cost) best = { tiles: path.length + 1, cost };
  }
  if (best) {
    const move = Math.max(1, effectiveStats(varek).move);
    const turns = Math.max(1, Math.ceil(best.cost / move));
    return say('far', 'info', `${who} is ${plural(best.tiles, 'tile')} from the Emperor (~${plural(turns, 'turn')}).`);
  }
  const breach = breachRoute(state, varek.pos, sides);
  if (breach && breach.length > 0) return say('barred', 'warn', `The way is barred: break ${breach.join(' and ')} to get through.`);
  return say('blocked', 'bad', 'No route to the Emperor is open.');
}
