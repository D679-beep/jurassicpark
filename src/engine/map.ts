// Read-only lookups over GameState: tiles, zones, objects and units.
import { TERRAIN } from './data';
import { posEq } from './geometry';
import type {
  AnchorObject,
  BridgeObject,
  CharacterId,
  DestructibleObject,
  DoorObject,
  Exit,
  Faction,
  GameState,
  GateObject,
  MapObject,
  Pos,
  Terrain,
  Unit,
} from './types';

export function inBounds(state: GameState, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < state.map.width && p.y < state.map.height;
}

export function terrainAt(state: GameState, p: Pos): Terrain | undefined {
  return state.map.terrain[p.y]?.[p.x];
}

/** Terrain defense bonus of a tile (0 when out of bounds). */
export function terrainDefense(state: GameState, p: Pos): number {
  const t = terrainAt(state, p);
  return t ? TERRAIN[t].defense : 0;
}

// --- units -----------------------------------------------------------------

export function findUnit(state: GameState, unitId: string): Unit | undefined {
  return state.units.find((u) => u.id === unitId);
}

export function unitAt(state: GameState, p: Pos): Unit | undefined {
  return state.units.find((u) => posEq(u.pos, p));
}

export function findCharacter(state: GameState, character: CharacterId): Unit | undefined {
  return state.units.find((u) => u.character === character);
}

export function unitsOfFaction(state: GameState, faction: Faction): Unit[] {
  return state.units.filter((u) => u.faction === faction);
}

// --- objects ---------------------------------------------------------------

export function findObject(state: GameState, id: string): MapObject | undefined {
  return state.map.objects.find((o) => o.id === id);
}

export function isDestructible(o: MapObject): o is DestructibleObject {
  return o.kind === 'door' || o.kind === 'anchor';
}

/** The intact barred door or ward anchor on a tile, if any (these block movement). */
export function blockingObjectAt(state: GameState, p: Pos): DestructibleObject | undefined {
  for (const o of state.map.objects) {
    if (isDestructible(o) && !o.destroyed && posEq(o.pos, p)) return o;
  }
  return undefined;
}

export function barredDoorAt(state: GameState, p: Pos): DoorObject | undefined {
  const o = blockingObjectAt(state, p);
  return o && o.kind === 'door' ? o : undefined;
}

export function bridgeAt(state: GameState, p: Pos): BridgeObject | undefined {
  for (const o of state.map.objects) {
    if (o.kind === 'bridge' && o.tiles.some((t) => posEq(t, p))) return o;
  }
  return undefined;
}

export function gates(state: GameState): GateObject[] {
  return state.map.objects.filter((o): o is GateObject => o.kind === 'gate');
}

/**
 * The closed gate (portcullis) covering a tile, if any. A closed gate blocks
 * movement, standing and spawning on its tiles, but not line of sight (it is a
 * grate); it cannot be attacked. It opens when its wave arrives (bells.ts).
 */
export function closedGateAt(state: GameState, p: Pos): GateObject | undefined {
  for (const o of state.map.objects) {
    if (o.kind === 'gate' && !o.open && o.tiles.some((t) => posEq(t, p))) return o;
  }
  return undefined;
}

/** True when an object stops units entering a tile: an intact barred door or ward anchor, or a closed gate. */
export function objectBlocksMovement(state: GameState, p: Pos): boolean {
  for (const o of state.map.objects) {
    if (o.kind === 'door' || o.kind === 'anchor') {
      if (!o.destroyed && posEq(o.pos, p)) return true;
    } else if (o.kind === 'gate') {
      if (!o.open && o.tiles.some((t) => posEq(t, p))) return true;
    }
  }
  return false;
}

export function anchors(state: GameState): AnchorObject[] {
  return state.map.objects.filter((o): o is AnchorObject => o.kind === 'anchor');
}

export function bridges(state: GameState): BridgeObject[] {
  return state.map.objects.filter((o): o is BridgeObject => o.kind === 'bridge');
}

/**
 * Tiles a unit can stand on, ignoring units: in bounds, passable terrain, no
 * intact barred door or ward anchor, no closed gate.
 */
export function isStandable(state: GameState, p: Pos): boolean {
  if (!inBounds(state, p)) return false;
  const t = terrainAt(state, p);
  if (!t || TERRAIN[t].moveCost === null) return false;
  return !objectBlocksMovement(state, p);
}

// --- zones -----------------------------------------------------------------

export function zoneTiles(state: GameState, zoneId: string): Pos[] {
  return state.map.zones[zoneId] ?? [];
}

export function hasZone(state: GameState, zoneId: string): boolean {
  return state.map.zones[zoneId] !== undefined;
}

export function isInZone(state: GameState, p: Pos, zoneId: string): boolean {
  return zoneTiles(state, zoneId).some((t) => posEq(t, p));
}

/** Ids of every zone containing a tile. */
export function zonesAt(state: GameState, p: Pos): string[] {
  return Object.keys(state.map.zones).filter((id) => isInZone(state, p, id));
}

export function unitsInZone(state: GameState, zoneId: string, faction?: Faction): Unit[] {
  return state.units.filter(
    (u) => (faction === undefined || u.faction === faction) && isInZone(state, u.pos, zoneId),
  );
}

// --- exits -----------------------------------------------------------------

export function exitsAt(state: GameState, p: Pos): Exit[] {
  return state.map.exits.filter((e) => e.tiles.some((t) => posEq(t, p)));
}
