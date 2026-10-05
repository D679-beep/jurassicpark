// Enemy threat overlay data: which tiles the other side can attack next turn
// (move plus attack range), from the AI's read-only threat map. Pure.
import { threatMapFor } from '../ai';
import type { GameState, Pos } from '../engine';

export interface ThreatView {
  w: number;
  h: number;
  /** The enemies the map counts (those that can act and hurt), by id. */
  enemyIds: string[];
  /** Per tile (row-major): indices into `enemyIds` that can attack it next turn. */
  byTile: readonly (readonly number[])[];
}

/** What the renderer draws: a set of tiles, stronger where more enemies reach. */
export interface ThreatOverlay {
  tiles: Pos[];
  /** Parallel to `tiles`: how many enemies reach the tile (always 1 for a single unit's reach). */
  counts: number[];
  /** Set when the overlay is one enemy's reach (hovered), null for the whole faction. */
  unitId: string | null;
}

/** Threat to the player's side in `state`. Compute once per state, then derive overlays from it. */
export function buildThreatView(state: GameState): ThreatView {
  const map = threatMapFor(state, state.playerFaction);
  return { w: state.map.width, h: state.map.height, enemyIds: map.enemies.map((e) => e.id), byTile: map.byTile };
}

/** Every tile any enemy can attack next turn. */
export function overlayAll(view: ThreatView): ThreatOverlay {
  const tiles: Pos[] = [];
  const counts: number[] = [];
  view.byTile.forEach((list, i) => {
    if (list.length === 0) return;
    tiles.push({ x: i % view.w, y: Math.floor(i / view.w) });
    counts.push(list.length);
  });
  return { tiles, counts, unitId: null };
}

/** One enemy's reach (where it can move to and strike), or null when it is not a threat (inert, sealed, unknown). */
export function overlayFor(view: ThreatView, enemyId: string): ThreatOverlay | null {
  const ei = view.enemyIds.indexOf(enemyId);
  if (ei < 0) return null;
  const tiles: Pos[] = [];
  view.byTile.forEach((list, i) => {
    if (list.includes(ei)) tiles.push({ x: i % view.w, y: Math.floor(i / view.w) });
  });
  return { tiles, counts: tiles.map(() => 1), unitId: enemyId };
}

/** Ids of the enemies that can attack a tile next turn. */
export function threatenersAt(view: ThreatView, p: Pos): string[] {
  if (p.x < 0 || p.y < 0 || p.x >= view.w || p.y >= view.h) return [];
  return (view.byTile[p.y * view.w + p.x] ?? []).map((ei) => view.enemyIds[ei]!);
}
