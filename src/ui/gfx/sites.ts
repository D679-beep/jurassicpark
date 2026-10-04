// Per-map analysis for the renderer (visual-style.md 3.2, 3.3, 4.1, 4.6-4.8, 10).
// Owner: WS0 (Foundation). Pure: MapState in, MapSites out. Everything is
// derived from terrain, zones, exits and static object placement, never from
// coordinates, so the renderer follows the geometry pass (2-wide canal,
// multi-tile bridges, tables, crates, steps, braziers, bell, pool, gate).
import { TERRAIN, type MapState, type Pos, type Terrain } from '../../engine';
import { LIGHT } from '../palette';
import { clamp } from './ease';
import { hash } from './noise';
import type {
  Axis,
  BridgeSpan,
  Dir,
  DoorSite,
  EdgeSite,
  ExitSite,
  GateSite,
  LightSite,
  LightSource,
  MapSites,
  Material,
  OverheadSite,
  ReflectionPair,
  StairSite,
  WaterTile,
  ZoneBox,
} from './types';

/** Zones under the open sky (3.3). Every other zone is an interior. */
export const OUTDOOR_ZONES: ReadonlySet<string> = new Set(['quay', 'innerGate', 'eastCourt']);

/** Floor material per zone, in priority order (first match wins, 4.1). */
export const MATERIAL_BY_ZONE: readonly (readonly [string, Material])[] = [
  ['throneHall', 'marble'],
  ['wellspringHall', 'well'],
  ['feastHall', 'plank'],
  ['princessTower', 'parquet'],
  ['bellTower', 'boards'],
  ['innerGate', 'plaza'],
  ['servantsTunnel', 'tunnel'],
  ['eastCourt', 'cobble'],
  ['quay', 'flag'],
  ['antechamber', 'slab'],
];

/** Ground a wall lantern may face (3.2): never doors, steps, water, bridges or blocking furniture. */
export const LANTERN_GROUND: ReadonlySet<Terrain> = new Set<Terrain>(['floor', 'pillar', 'rubble', 'throne', 'dais', 'table', 'crates']);

export const LANTERN_CHANCE = 0.17;
export const CANDLE_CHANCE = 0.5;
/** Max rows between a light and a water tile it reflects on (4.6). */
export const REFLECTION_ROWS = 3.2;

const OFF: Dir = { dx: 0, dy: 1 };

function grid<T>(w: number, h: number, v: T): T[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => v));
}

/** Terrain as built: bridge objects' tiles count as 'bridge' even once burned. */
export function baseTerrain(map: MapState): Terrain[][] {
  const base = map.terrain.map((row) => row.slice());
  for (const o of map.objects) {
    if (o.kind !== 'bridge') continue;
    for (const t of o.tiles) {
      const row = base[t.y];
      if (row && t.x >= 0 && t.x < row.length) row[t.x] = 'bridge';
    }
  }
  return base;
}

/**
 * Cache key for a map: scenario id, size, terrain as built, zones, exits and
 * static objects. Unchanged for a whole battle (bridges burning, doors
 * breaking and gates opening do not change it).
 */
export function sitesKey(map: MapState, scenarioId = ''): string {
  const base = baseTerrain(map);
  const zones = Object.entries(map.zones)
    .map(([id, ts]) => `${id}:${ts.length}:${ts[0]?.x ?? ''},${ts[0]?.y ?? ''}`)
    .join(';');
  const exits = map.exits.map((e) => `${e.id}:${e.tiles.map((t) => `${t.x},${t.y}`).join(' ')}`).join(';');
  const objs = map.objects
    .map((o) => (o.kind === 'bridge' || o.kind === 'gate' ? `${o.id}:${o.tiles.length}` : `${o.id}:${o.pos.x},${o.pos.y}`))
    .join(';');
  return `${scenarioId}|${map.width}x${map.height}|${base.map((r) => r.join(',')).join(';')}|${zones}|${exits}|${objs}`;
}

/** Off-map direction for a tile (nearest border; ties prefer W, E, N, S). */
export function offMapDir(p: Pos, w: number, h: number): Dir {
  const dW = p.x;
  const dE = w - 1 - p.x;
  const dN = p.y;
  const dS = h - 1 - p.y;
  const m = Math.min(dW, dE, dN, dS);
  if (m === dW) return { dx: -1, dy: 0 };
  if (m === dE) return { dx: 1, dy: 0 };
  if (m === dN) return { dx: 0, dy: -1 };
  return { dx: 0, dy: 1 };
}

export function buildSites(map: MapState, scenarioId = ''): MapSites {
  const w = map.width;
  const h = map.height;
  const base = baseTerrain(map);
  const at = (x: number, y: number): Terrain | undefined => base[y]?.[x];
  const inB = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  /** Out of bounds counts as wall for corridor tests. */
  const wallish = (x: number, y: number): boolean => !inB(x, y) || at(x, y) === 'wall';

  // --- zones -----------------------------------------------------------------
  const zone = grid<string | null>(w, h, null);
  const interiorZoned = grid(w, h, false);
  const outdoorZoned = grid(w, h, false);
  const zoneMembers = new Map<string, Set<string>>();
  const zoneBoxes: Record<string, ZoneBox> = {};
  for (const [id, tiles] of Object.entries(map.zones)) {
    const members = new Set<string>();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const t of tiles) {
      if (!inB(t.x, t.y)) continue;
      members.add(`${t.x},${t.y}`);
      if (zone[t.y]![t.x] === null) zone[t.y]![t.x] = id;
      if (OUTDOOR_ZONES.has(id)) outdoorZoned[t.y]![t.x] = true;
      else interiorZoned[t.y]![t.x] = true;
      x0 = Math.min(x0, t.x);
      y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x);
      y1 = Math.max(y1, t.y);
    }
    zoneMembers.set(id, members);
    if (members.size > 0) zoneBoxes[id] = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  const inAnyZone = (x: number, y: number): boolean => zone[y]![x] !== null;

  // --- corridors ---------------------------------------------------------------
  const corridor = grid<Axis | null>(w, h, null);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (at(x, y) === 'wall' || inAnyZone(x, y)) continue;
      if (wallish(x - 1, y) && wallish(x + 1, y)) corridor[y]![x] = 'ns';
      else if (wallish(x, y - 1) && wallish(x, y + 1)) corridor[y]![x] = 'ew';
    }
  }

  // --- water -------------------------------------------------------------------
  const isWaterish = (t: Terrain | undefined): boolean => t === 'water' || t === 'bridge';
  const canal = grid(w, h, false);
  const pool = grid(w, h, false);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at(x, y);
      if (!isWaterish(t)) continue;
      if (interiorZoned[y]![x]) {
        if (t === 'water') pool[y]![x] = true;
      } else canal[y]![x] = true;
    }
  }

  // --- outdoor (3.3) -------------------------------------------------------------
  const outdoor = grid(w, h, false);
  const queue: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at(x, y);
      if (t === 'wall' || t === undefined) continue;
      const seed = (outdoorZoned[y]![x] && !interiorZoned[y]![x]) || canal[y]![x] || (t === 'stairs' && !interiorZoned[y]![x]);
      if (seed) {
        outdoor[y]![x] = true;
        queue.push(x, y);
      }
    }
  }
  for (let i = 0; i < queue.length; i += 2) {
    const x = queue[i]!;
    const y = queue[i + 1]!;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const) {
      if (!inB(nx, ny) || outdoor[ny]![nx]) continue;
      const t = at(nx, ny);
      if (t === 'wall' || t === 'door' || inAnyZone(nx, ny) || corridor[ny]![nx] !== null) continue;
      outdoor[ny]![nx] = true;
      queue.push(nx, ny);
    }
  }

  // --- materials (4.1) -------------------------------------------------------------
  const material = grid<Material>(w, h, 'wall');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at(x, y);
      let m: Material;
      if (t === undefined || t === 'wall') m = 'wall';
      else if (t === 'stairs') m = 'flag';
      else if (pool[y]![x]) m = 'pool';
      else if (canal[y]![x]) m = 'canal';
      else {
        m = outdoor[y]![x] ? 'cobble' : 'slab';
        const k = `${x},${y}`;
        for (const [id, mat] of MATERIAL_BY_ZONE) {
          if (zoneMembers.get(id)?.has(k)) {
            m = mat;
            break;
          }
        }
      }
      material[y]![x] = m;
    }
  }

  // --- passable --------------------------------------------------------------------
  const passable = grid(w, h, false);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at(x, y);
      passable[y]![x] = t !== undefined && TERRAIN[t].moveCost !== null;
    }
  }

  // --- light sites (3.2) -------------------------------------------------------------
  const staticLights: LightSource[] = [];
  const addLight = (l: LightSource): number => {
    staticLights.push(Object.freeze(l));
    return staticLights.length - 1;
  };
  const lanterns: LightSite[] = [];
  const braziers: LightSite[] = [];
  const candles: LightSite[] = [];
  const bells: LightSite[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const below = at(x, y + 1);
      if (at(x, y) === 'wall' && below !== undefined && LANTERN_GROUND.has(below) && hash(x, y, 99) < LANTERN_CHANCE) {
        const seed = hash(x, y, 7);
        const lx = x + 0.5;
        const ly = y + 0.85;
        const light = addLight({ kind: 'lantern', x: lx, y: ly, radius: 2.7, intensity: 0.85, color: LIGHT.lantern, flicker: 0.1, seed, lamp: true });
        lanterns.push({ x, y, lx, ly, seed, light });
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) !== 'brazier') continue;
      const seed = hash(x, y, 8);
      const lx = x + 0.5;
      const ly = y + 0.35;
      const light = addLight({ kind: 'brazier', x: lx, y: ly, radius: 3.4, intensity: 0.95, color: LIGHT.brazier, flicker: 0.16, seed, lamp: true });
      braziers.push({ x, y, lx, ly, seed, light });
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) !== 'table' || hash(x, y, 5) >= CANDLE_CHANCE) continue;
      const seed = hash(x, y, 9);
      const lx = x + 0.5;
      const ly = y + 0.45;
      const light = addLight({ kind: 'candle', x: lx, y: ly, radius: 1.3, intensity: 0.35, color: LIGHT.lantern, flicker: 0.08, seed, lamp: true });
      candles.push({ x, y, lx, ly, seed, light });
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) !== 'bell') continue;
      const seed = hash(x, y, 10);
      const lx = x + 0.5;
      const ly = y + 0.5;
      const light = addLight({ kind: 'bell', x: lx, y: ly, radius: 1.6, intensity: 0.3, color: LIGHT.overhead, flicker: 0, seed, lamp: true });
      bells.push({ x, y, lx, ly, seed, light });
    }
  }
  const overheads: OverheadSite[] = [];
  for (const id of Object.keys(map.zones)) {
    const box = zoneBoxes[id];
    if (!box || OUTDOOR_ZONES.has(id)) continue;
    const long = Math.max(box.w, box.h);
    const short = Math.min(box.w, box.h);
    const n = Math.max(1, Math.round(long / 6));
    const radius = clamp(0.45 * short + 1.2, 2.2, 3.4);
    for (let i = 0; i < n; i++) {
      const along = (i + 0.5) / n;
      const x = box.w >= box.h ? box.x + along * box.w : box.x + box.w / 2;
      const y = box.w >= box.h ? box.y + box.h / 2 : box.y + along * box.h;
      const light = addLight({
        kind: 'overhead',
        x,
        y,
        radius,
        intensity: 0.5,
        color: LIGHT.overhead,
        flicker: 0.05,
        seed: hash(Math.floor(x * 10), Math.floor(y * 10), 11),
        lamp: true,
      });
      overheads.push({ zone: id, x, y, radius, light });
    }
  }

  // --- water tiles and reflections (4.6) ------------------------------------------------
  const bridgeAt = new Map<string, string>();
  for (const o of map.objects) if (o.kind === 'bridge') for (const t of o.tiles) bridgeAt.set(`${t.x},${t.y}`, o.id);
  const water: WaterTile[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (canal[y]![x] || pool[y]![x]) water.push({ x, y, pool: pool[y]![x]!, bridge: bridgeAt.get(`${x},${y}`) ?? null });
    }
  }
  const reflections: ReflectionPair[] = [];
  staticLights.forEach((l, i) => {
    if (l.kind !== 'lantern' && l.kind !== 'brazier') return;
    const col = Math.floor(l.x);
    for (const wt of water) {
      if (wt.x !== col) continue;
      const dy = Math.abs(wt.y + 0.5 - l.y);
      if (dy <= REFLECTION_ROWS) reflections.push({ light: i, x: wt.x, y: wt.y, dy });
    }
  });

  // --- bridges -------------------------------------------------------------------------
  const bridges: BridgeSpan[] = [];
  for (const o of map.objects) {
    if (o.kind !== 'bridge') continue;
    const own = new Set(o.tiles.map((t) => `${t.x},${t.y}`));
    let ew = 0;
    let ns = 0;
    const wet = (x: number, y: number): boolean => !own.has(`${x},${y}`) && isWaterish(at(x, y));
    for (const t of o.tiles) {
      if (wet(t.x - 1, t.y)) ew++;
      if (wet(t.x + 1, t.y)) ew++;
      if (wet(t.x, t.y - 1)) ns++;
      if (wet(t.x, t.y + 1)) ns++;
    }
    // Water beside the deck to the W/E means the canal flows east-west: travel is north-south.
    const axis: Axis = ew >= ns ? 'ns' : 'ew';
    const tiles = o.tiles.map((t) => ({ x: t.x, y: t.y })).sort((a, b) => (axis === 'ns' ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y));
    bridges.push({ id: o.id, tiles, axis });
  }

  // --- doors ---------------------------------------------------------------------------
  const doorObjAt = new Map<string, string>();
  for (const o of map.objects) if (o.kind === 'door') doorObjAt.set(`${o.pos.x},${o.pos.y}`, o.id);
  const doors: DoorSite[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) !== 'door') continue;
      // The passage runs between the two open sides; walls decide when both or neither pair is open.
      const openEW = !wallish(x - 1, y) && !wallish(x + 1, y);
      const openNS = !wallish(x, y - 1) && !wallish(x, y + 1);
      const axis: Axis =
        openEW !== openNS ? (openEW ? 'ew' : 'ns') : wallish(x - 1, y) && wallish(x + 1, y) ? 'ns' : wallish(x, y - 1) && wallish(x, y + 1) ? 'ew' : 'ns';
      doors.push({ x, y, axis, objectId: doorObjAt.get(`${x},${y}`) ?? null });
    }
  }

  // --- stairs --------------------------------------------------------------------------
  const stairs: StairSite[] = [];
  const DIRS: readonly Dir[] = [
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) !== 'stairs') continue;
      let dir: Dir | null = null;
      for (let reach = 1; reach <= 3 && !dir; reach++) {
        for (const d of DIRS) {
          if (isWaterish(at(x + d.dx * reach, y + d.dy * reach))) {
            dir = d;
            break;
          }
        }
      }
      stairs.push({ x, y, dir: dir ?? OFF });
    }
  }

  // --- exits, edges, gates -----------------------------------------------------------------
  const exitTile = new Map<string, string>();
  const exits: ExitSite[] = map.exits.map((e) => {
    for (const t of e.tiles) exitTile.set(`${t.x},${t.y}`, e.id);
    const first = e.tiles[0] ?? { x: 0, y: 0 };
    return { id: e.id, tiles: e.tiles.map((t) => ({ x: t.x, y: t.y })), dir: offMapDir(first, w, h), units: [...e.units] };
  });
  const edges: EdgeSite[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x !== 0 && y !== 0 && x !== w - 1 && y !== h - 1) continue;
      const t = at(x, y);
      if (t === undefined || t === 'wall') continue;
      edges.push({ x, y, dir: offMapDir({ x, y }, w, h), exit: exitTile.get(`${x},${y}`) ?? null });
    }
  }
  const gates: GateSite[] = [];
  for (const o of map.objects) {
    if (o.kind !== 'gate' || o.tiles.length === 0) continue;
    const ys = new Set(o.tiles.map((t) => t.y));
    const axis: Axis = ys.size === 1 ? 'ew' : 'ns';
    const cx = o.tiles.reduce((s, t) => s + t.x, 0) / o.tiles.length;
    const cy = o.tiles.reduce((s, t) => s + t.y, 0) / o.tiles.length;
    gates.push({ id: o.id, tiles: o.tiles.map((t) => ({ x: t.x, y: t.y })), wave: o.wave, axis, outward: offMapDir({ x: Math.round(cx), y: Math.round(cy) }, w, h) });
  }

  return {
    key: sitesKey(map, scenarioId),
    w,
    h,
    base,
    material,
    outdoor,
    passable,
    zone,
    corridor,
    zoneBoxes,
    lanterns,
    braziers,
    candles,
    bells,
    overheads,
    staticLights,
    water,
    reflections,
    bridges,
    doors,
    stairs,
    exits,
    edges,
    gates,
  };
}
