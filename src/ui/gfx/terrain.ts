// Static terrain cache (visual-style.md 4.1-4.8 and 10; layer 1) and terrain
// light sources (layer 7).
// Owner: WS1 (Terrain & objects).
//
// Layer 1 is one offscreen canvas per (T, dpr, map, displayed bridge burns,
// baked era desaturation). Everything is derived from `f.sites` (terrain as
// built, materials, zones, light sites, bridges, doors, stairs, exits,
// edges), never from coordinates. Paint order inside the cache:
//   floors per material -> canal base, kerbs and bank lines -> pool basin and
//   rim -> flat room decor -> steps -> wall contact shadows -> low cover
//   (rubble, crates, tables, pillars) and blocking furniture (braziers, the
//   bell) -> bridges (deck or charred) -> open doors -> 2.5D walls (contained
//   in their own tiles) -> wall decor and lantern fixtures -> map-edge fades
//   and escape thresholds -> era desaturation.
// Layer 7 (`drawSources`, above the darkness): lantern cores, brazier fire,
// table candle flames and the escape-exit chevrons.
import type { MapObject, Pos, Terrain } from '../../engine';
import type { DisplayOverrides } from '../animation';
import {
  BELL,
  BRAZIER,
  BRIDGE,
  CRATE,
  DOOR,
  LIGHT,
  MAT,
  NIGHT,
  PILLAR,
  POOL,
  STAIR,
  STATUS,
  TABLE,
  WALL,
  WATER,
} from '../palette';
import { hairline, paintFloor } from './materials';
import { hash } from './noise';
import { OUTDOOR_ZONES } from './sites';
import type { Axis, Dir, GfxFrame, LightSite, MapSites, TerrainPass } from './types';

const R = Math.round;
const TAU = Math.PI * 2;

// --- pure helpers (tested in tests/ui/ws1-terrain.test.ts) -----------------------------

/**
 * Bit mask of bridges drawn burned: bit i = the i-th bridge object in
 * `objects` is burned and not pending (overrides.unburnedBridges). No
 * allocation, so it is cheap to compute every frame for the cache key.
 */
export function burnedBridgeMask(objects: readonly MapObject[], overrides: Pick<DisplayOverrides, 'unburnedBridges'>): number {
  let mask = 0;
  let i = 0;
  for (const o of objects) {
    if (o.kind !== 'bridge') continue;
    if (o.burned && overrides.unburnedBridges[o.id] === undefined && i < 31) mask |= 1 << i;
    i++;
  }
  return mask;
}

/** Ids of the bridges drawn burned for a mask from `burnedBridgeMask`. */
export function burnedBridgeIds(objects: readonly MapObject[], mask: number): Set<string> {
  const ids = new Set<string>();
  let i = 0;
  for (const o of objects) {
    if (o.kind !== 'bridge') continue;
    if (i < 31 && mask & (1 << i)) ids.add(o.id);
    i++;
  }
  return ids;
}

/** Desaturation baked into the terrain cache: only once the era transition has settled (3.4). */
export function bakedDesat(eraT: number, desat: number): number {
  return eraT >= 1 ? Math.round(desat * 100) / 100 : 0;
}

/** Wall tiles show a front face when their south neighbour is inside the map and not a wall (4.2). */
export function wallHasFace(base: readonly (readonly Terrain[])[], x: number, y: number): boolean {
  const below = base[y + 1]?.[x];
  return base[y]?.[x] === 'wall' && below !== undefined && below !== 'wall';
}

export interface TableTile {
  readonly x: number;
  readonly y: number;
  /** Long axis of the table run this tile belongs to. */
  readonly axis: Axis;
  /** First / last tile of the run along its axis. */
  readonly start: boolean;
  readonly end: boolean;
}

/** Adjacent table tiles merge into one long table (section 10). */
export function tableTiles(base: readonly (readonly Terrain[])[]): TableTile[] {
  const out: TableTile[] = [];
  const isT = (x: number, y: number): boolean => base[y]?.[x] === 'table';
  for (let y = 0; y < base.length; y++) {
    const row = base[y]!;
    for (let x = 0; x < row.length; x++) {
      if (!isT(x, y)) continue;
      const ew = isT(x - 1, y) || isT(x + 1, y) || !(isT(x, y - 1) || isT(x, y + 1));
      if (ew) out.push({ x, y, axis: 'ew', start: !isT(x - 1, y), end: !isT(x + 1, y) });
      else out.push({ x, y, axis: 'ns', start: !isT(x, y - 1), end: !isT(x, y + 1) });
    }
  }
  return out;
}

/** Room decoration sites, derived from terrain and zones (4.3). Tile coordinates. */
export interface DecorPlan {
  /** Throne Hall carpet: columns x0..x1, rows y0..y1 (inclusive), drawn on floor tiles. */
  readonly carpet: { x0: number; x1: number; y0: number; y1: number } | null;
  /** Throne back on the wall row above the dais centre columns. */
  readonly throneBack: { x0: number; x1: number; y: number } | null;
  /** Wellspring rune ring centre (tile units) and the zone it belongs to. */
  readonly runeRing: { cx: number; cy: number; zone: string } | null;
  /** Antechamber banners (wall tiles with a face). */
  readonly banners: readonly Pos[];
  /** Princess's Tower bookshelves (wall tiles with a face). */
  readonly shelves: readonly Pos[];
  /** Spilled goblets in the Feast Hall (floor tiles next to tables). */
  readonly goblets: readonly Pos[];
  /** Bell ropes: bell tile -> coil tile. */
  readonly ropes: readonly { bell: Pos; coil: Pos }[];
  /** Princess's Tower rug: tiles of the zone's top two rows. */
  readonly rug: readonly Pos[];
}

const DAIS: ReadonlySet<Terrain> = new Set<Terrain>(['throne', 'dais']);
const FLOORISH: ReadonlySet<Terrain> = new Set<Terrain>(['floor']);

export function decorPlan(s: MapSites): DecorPlan {
  const at = (x: number, y: number): Terrain | undefined => s.base[y]?.[x];
  const zoneTiles = (id: string): Pos[] => {
    const out: Pos[] = [];
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.zone[y]![x] === id) out.push({ x, y });
    return out;
  };
  const lanternAt = new Set(s.lanterns.map((l) => `${l.x},${l.y}`));

  // Throne Hall: carpet down the dais's centre columns, throne back above it.
  let carpet: DecorPlan['carpet'] = null;
  let throneBack: DecorPlan['throneBack'] = null;
  const dais = zoneTiles('throneHall').filter((p) => DAIS.has(at(p.x, p.y)!));
  const box = s.zoneBoxes.throneHall;
  if (dais.length > 0 && box) {
    const minX = Math.min(...dais.map((p) => p.x));
    const maxX = Math.max(...dais.map((p) => p.x));
    const x0 = Math.floor((minX + maxX) / 2);
    const x1 = Math.ceil((minX + maxX) / 2);
    const centre = dais.filter((p) => p.x >= x0 && p.x <= x1);
    const bottom = Math.max(...centre.map((p) => p.y));
    const top = Math.min(...centre.map((p) => p.y));
    if (bottom + 1 <= box.y + box.h - 1) carpet = { x0, x1, y0: bottom + 1, y1: box.y + box.h - 1 };
    let wallRow = true;
    for (let x = x0; x <= x1; x++) if (at(x, top - 1) !== 'wall') wallRow = false;
    if (wallRow) throneBack = { x0, x1, y: top - 1 };
  }

  // Wellspring Hall rune ring: centred on its rite dais, else the zone centre.
  let runeRing: DecorPlan['runeRing'] = null;
  const wbox = s.zoneBoxes.wellspringHall;
  if (wbox) {
    const rite = zoneTiles('wellspringHall').filter((p) => DAIS.has(at(p.x, p.y)!));
    if (rite.length > 0) {
      runeRing = {
        cx: rite.reduce((a, p) => a + p.x, 0) / rite.length + 0.5,
        cy: rite.reduce((a, p) => a + p.y, 0) / rite.length + 0.5,
        zone: 'wellspringHall',
      };
    } else runeRing = { cx: wbox.x + wbox.w / 2, cy: wbox.y + wbox.h / 2, zone: 'wellspringHall' };
  }

  // Antechamber banners: at most 4 wall faces above its tiles, lowest hash, no lantern, not next to a door.
  const bannerCands: Pos[] = [];
  for (const p of zoneTiles('antechamber')) {
    const wx = p.x;
    const wy = p.y - 1;
    if (at(p.x, p.y) === 'wall' || !wallHasFace(s.base, wx, wy) || lanternAt.has(`${wx},${wy}`)) continue;
    if (at(wx - 1, wy) === 'door' || at(wx + 1, wy) === 'door' || at(p.x, p.y) === 'door') continue;
    bannerCands.push({ x: wx, y: wy });
  }
  bannerCands.sort((a, b) => hash(a.x, a.y, 31) - hash(b.x, b.y, 31));
  const banners = bannerCands.slice(0, 4);

  // Princess's Tower: bookshelves on wall faces above its tiles, a rug over its top two rows.
  const shelves: Pos[] = [];
  const rug: Pos[] = [];
  const pbox = s.zoneBoxes.princessTower;
  for (const p of zoneTiles('princessTower')) {
    const t = at(p.x, p.y);
    if (t === 'wall') continue;
    if (pbox && p.y < pbox.y + 2 && t === 'floor') rug.push(p);
    const wy = p.y - 1;
    if (wallHasFace(s.base, p.x, wy) && !lanternAt.has(`${p.x},${wy}`) && at(p.x - 1, wy) !== 'door' && at(p.x + 1, wy) !== 'door' && hash(p.x, wy, 41) < 0.7) {
      shelves.push({ x: p.x, y: wy });
    }
  }

  // Feast Hall goblets next to tables.
  const goblets: Pos[] = [];
  for (const p of zoneTiles('feastHall')) {
    if (!FLOORISH.has(at(p.x, p.y)!)) continue;
    const nextToTable = at(p.x - 1, p.y) === 'table' || at(p.x + 1, p.y) === 'table' || at(p.x, p.y - 1) === 'table' || at(p.x, p.y + 1) === 'table';
    if (nextToTable && hash(p.x, p.y, 17) < 0.3) goblets.push(p);
  }

  // Bell ropes: from the yoke to a coil on the nearest floor tile.
  const ropes: { bell: Pos; coil: Pos }[] = [];
  const NEAR: readonly (readonly [number, number])[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (const b of s.bells) {
    for (const [dx, dy] of NEAR) {
      const t = at(b.x + dx, b.y + dy);
      if (t === 'floor' || t === 'rubble') {
        ropes.push({ bell: { x: b.x, y: b.y }, coil: { x: b.x + dx, y: b.y + dy } });
        break;
      }
    }
  }

  return { carpet, throneBack, runeRing, banners, shelves, goblets, ropes, rug };
}

// --- the pass --------------------------------------------------------------------------

export function createTerrain(): TerrainPass {
  let cache: HTMLCanvasElement | null = null;
  let cacheT = 0;
  let cacheDpr = 0;
  let cacheSites: MapSites | null = null;
  let cacheMask = -1;
  let cacheDesat = -1;
  let halo: HTMLCanvasElement | null = null;
  let haloT = 0;

  return {
    reset() {
      cacheT = 0;
      cacheSites = null;
      halo = null;
    },
    clear() {
      cacheMask = -1;
    },
    draw(f: GfxFrame) {
      const mask = burnedBridgeMask(f.state.map.objects, f.input.overrides);
      const desat = bakedDesat(f.era.t, f.env.desat);
      if (!cache || cacheT !== f.T || cacheDpr !== f.dpr || cacheSites !== f.sites || cacheMask !== mask || cacheDesat !== desat) {
        cache = buildCache(cache, f.sites, f.T, burnedBridgeIds(f.state.map.objects, mask), desat);
        cacheT = f.T;
        cacheDpr = f.dpr;
        cacheSites = f.sites;
        cacheMask = mask;
        cacheDesat = desat;
      }
      if (cache) f.ctx.drawImage(cache, 0, 0);
    },
    drawSources(f: GfxFrame) {
      if (!halo || haloT !== f.T) {
        halo = makeHalo(f.T);
        haloT = f.T;
      }
      drawSourcesImpl(f, halo);
    },
  };
}

// --- cache build ---------------------------------------------------------------------------

interface Ctx {
  readonly g: CanvasRenderingContext2D;
  readonly s: MapSites;
  readonly T: number;
  readonly lw: number;
  readonly burned: ReadonlySet<string>;
  /** Bridge id per tile (as built). */
  readonly bridgeOf: Map<number, string>;
  /** Canal base gradient per canal tile (y*w+x), for refilling water around decks. */
  readonly canalGrad: Map<number, CanvasGradient>;
}

const at = (c: Ctx, x: number, y: number): Terrain | undefined => c.s.base[y]?.[x];
const isWall = (c: Ctx, x: number, y: number): boolean => {
  const t = at(c, x, y);
  return t === undefined || t === 'wall';
};
/** Canal or pool tile showing water (an intact bridge covers its water). */
function isWet(c: Ctx, x: number, y: number): boolean {
  const m = c.s.material[y]?.[x];
  if (m !== 'canal' && m !== 'pool') return false;
  const b = c.bridgeOf.get(y * c.s.w + x);
  return b === undefined || c.burned.has(b);
}
/** Open standable ground next to water (not water, not a deck, not a wall or furniture that blocks). */
function isGround(c: Ctx, x: number, y: number): boolean {
  const m = c.s.material[y]?.[x];
  if (m === undefined || m === 'canal' || m === 'pool' || m === 'wall') return false;
  return c.s.passable[y]![x]!;
}

function buildCache(prev: HTMLCanvasElement | null, s: MapSites, T: number, burned: ReadonlySet<string>, desat: number): HTMLCanvasElement | null {
  const cv = prev ?? document.createElement('canvas');
  cv.width = T * s.w;
  cv.height = T * s.h;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = NIGHT.void;
  g.fillRect(0, 0, cv.width, cv.height);
  g.lineCap = 'butt';
  g.lineJoin = 'miter';

  const bridgeOf = new Map<number, string>();
  for (const b of s.bridges) for (const t of b.tiles) bridgeOf.set(t.y * s.w + t.x, b.id);
  const c: Ctx = { g, s, T, lw: hairline(T), burned, bridgeOf, canalGrad: new Map() };
  const plan = decorPlan(s);

  // Floors.
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) paintFloor(g, s.material[y]![x]!, x, y, T);
  paintCanal(c);
  paintPool(c);
  paintRoomDecor(c, plan);
  for (const st of s.stairs) paintStairs(c, st.x, st.y, st.dir);
  paintContactShadows(c);

  // Cover and furniture.
  const tables = tableTiles(s.base);
  const candleAt = new Set(s.candles.map((l) => `${l.x},${l.y}`));
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const t = s.base[y]![x]!;
      if (t === 'rubble') paintRubble(c, x, y);
      else if (t === 'crates') paintCrates(c, x, y);
      else if (t === 'pillar') paintPillar(c, x, y, OUTDOOR_ZONES.has(s.zone[y]![x] ?? '') || s.outdoor[y]![x]!);
      else if (t === 'brazier') paintBrazier(c, x, y);
    }
  }
  for (const tt of tables) paintTable(c, tt, candleAt.has(`${tt.x},${tt.y}`));
  for (const r of plan.ropes) paintRope(c, r.bell, r.coil);
  for (const b of s.bells) paintBell(c, b.x, b.y);
  for (const b of s.bridges) paintBridge(c, b.id, b.tiles);
  for (const d of s.doors) paintDoorway(c, d.x, d.y, d.axis, d.objectId !== null);

  // Walls and wall decor.
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.base[y]![x] === 'wall') paintWall(c, x, y);
  if (plan.throneBack) paintThroneBack(c, plan.throneBack);
  for (const p of plan.banners) paintBanner(c, p.x, p.y);
  for (const p of plan.shelves) paintShelf(c, p.x, p.y);
  for (const l of s.lanterns) paintLanternFixture(c, l);

  paintEdges(c);

  if (desat > 0) {
    g.globalCompositeOperation = 'saturation';
    g.globalAlpha = desat;
    g.fillStyle = '#808080';
    g.fillRect(0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  return cv;
}

// --- water base ----------------------------------------------------------------------------

function paintCanal(c: Ctx): void {
  const { g, s, T, lw } = c;
  // One vertical gradient per canal column run: deep - mid - bright surface band - mid - deep.
  for (let x = 0; x < s.w; x++) {
    let y = 0;
    while (y < s.h) {
      if (s.material[y]![x] !== 'canal') {
        y++;
        continue;
      }
      let y1 = y;
      while (y1 + 1 < s.h && s.material[y1 + 1]![x] === 'canal') y1++;
      const top = y * T;
      const bot = (y1 + 1) * T;
      const grad = g.createLinearGradient(0, top, 0, bot);
      grad.addColorStop(0, WATER.deep);
      grad.addColorStop(0.22, WATER.mid);
      grad.addColorStop(0.5, WATER.surface);
      grad.addColorStop(0.78, WATER.mid);
      grad.addColorStop(1, WATER.deep);
      g.fillStyle = grad;
      g.fillRect(x * T, top, T, bot - top);
      for (let yy = y; yy <= y1; yy++) c.canalGrad.set(yy * s.w + x, grad);
      // Faint cold moon sheen on the surface band.
      g.fillStyle = 'rgba(180,200,255,0.10)';
      const mid = (top + bot) / 2;
      g.fillRect(x * T, R(mid - T * 0.1), T, R(T * 0.2));
      y = y1 + 1;
    }
  }
  // Kerbs (quay retaining wall) and the bank line.
  const kerbFace = R(T * 0.16);
  const lip = Math.max(1, R(T * 0.06));
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (s.material[y]![x] !== 'canal' || !isWet(c, x, y)) continue;
      const x0 = x * T;
      const y0 = y * T;
      const n = at(c, x, y - 1);
      if (isGround(c, x, y - 1) && n !== 'stairs') {
        g.fillStyle = WATER.kerbFace;
        g.fillRect(x0, y0, T, kerbFace);
        g.fillStyle = 'rgba(160,180,220,0.18)';
        g.fillRect(x0, y0, T, lw);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x0, y0 + kerbFace, T, R(T * 0.08));
        g.fillStyle = WATER.bank;
        g.fillRect(x0, y0 + kerbFace, T, lw);
      } else if (n === 'stairs') {
        g.fillStyle = WATER.bank;
        g.fillRect(x0, y0, T, lw);
      }
      if (isGround(c, x, y + 1)) {
        g.fillStyle = WATER.kerb;
        g.fillRect(x0, y0 + T - lip, T, lip);
        g.fillStyle = WATER.bank;
        g.fillRect(x0, y0 + T - lip - lw, T, lw);
      }
      if (isGround(c, x - 1, y)) {
        g.fillStyle = WATER.kerb;
        g.fillRect(x0, y0, lip, T);
        g.fillStyle = WATER.bank;
        g.fillRect(x0 + lip, y0, lw, T);
      }
      if (isGround(c, x + 1, y)) {
        g.fillStyle = WATER.kerb;
        g.fillRect(x0 + T - lip, y0, lip, T);
        g.fillStyle = WATER.bank;
        g.fillRect(x0 + T - lip - lw, y0, lw, T);
      }
    }
  }
}

function paintPool(c: Ctx): void {
  const { g, s, T, lw } = c;
  const rim = Math.max(2, R(T * 0.1));
  const isPool = (x: number, y: number): boolean => s.material[y]?.[x] === 'pool';
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (!isPool(x, y)) continue;
      const x0 = x * T;
      const y0 = y * T;
      g.fillStyle = POOL.water;
      g.fillRect(x0, y0, T, T);
      // Basin of small square tiles under the water.
      g.fillStyle = POOL.deep;
      for (let k = 0; k < 3; k++) {
        g.fillRect(R(x0 + (k * T) / 3), y0, lw, T);
        g.fillRect(x0, R(y0 + (k * T) / 3), T, lw);
      }
      g.fillStyle = 'rgba(120,200,230,0.06)';
      g.fillRect(x0, R(y0 + T * 0.35), T, R(T * 0.3));
      // Raised stone rim on every edge that meets the floor, with a lit top and a shadow inside.
      const n = !isPool(x, y - 1);
      const so = !isPool(x, y + 1);
      const w = !isPool(x - 1, y);
      const e = !isPool(x + 1, y);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      if (n) g.fillRect(x0, y0 + rim, T, R(T * 0.08));
      if (w) g.fillRect(x0 + rim, y0, R(T * 0.06), T);
      g.fillStyle = POOL.rim;
      if (n) g.fillRect(x0, y0, T, rim);
      if (so) g.fillRect(x0, y0 + T - rim, T, rim);
      if (w) g.fillRect(x0, y0, rim, T);
      if (e) g.fillRect(x0 + T - rim, y0, rim, T);
      g.fillStyle = POOL.rimTop;
      if (n) g.fillRect(x0, y0, T, lw);
      if (so) g.fillRect(x0, y0 + T - rim, T, lw);
      if (w) g.fillRect(x0, y0, lw, T);
      if (e) g.fillRect(x0 + T - rim, y0, lw, T);
    }
  }
}

// --- room decor (flat) --------------------------------------------------------------------

function paintRoomDecor(c: Ctx, plan: DecorPlan): void {
  const { g, s, T, lw } = c;

  // Corridor runners.
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const ax = s.corridor[y]![x];
      if (!ax || s.base[y]![x] !== 'floor') continue;
      const x0 = x * T;
      const y0 = y * T;
      const wid = R(T * 0.56);
      const off = R((T - wid) / 2);
      g.fillStyle = MAT.runner.base;
      g.fillStyle = MAT.runner.base;
      if (ax === 'ns') g.fillRect(x0 + off, y0, wid, T);
      else g.fillRect(x0, y0 + off, T, wid);
      g.fillStyle = MAT.runner.trim;
      const tr = R(T * 0.05);
      if (ax === 'ns') {
        g.fillRect(x0 + off + tr, y0, lw, T);
        g.fillRect(x0 + off + wid - tr - lw, y0, lw, T);
      } else {
        g.fillRect(x0, y0 + off + tr, T, lw);
        g.fillRect(x0, y0 + off + wid - tr - lw, T, lw);
      }
    }
  }

  // Throne Hall carpet runner.
  const cp = plan.carpet;
  if (cp) {
    const inset = T * 0.12;
    const trim = T * 0.2;
    for (let y = cp.y0; y <= cp.y1; y++) {
      for (let x = cp.x0; x <= cp.x1; x++) {
        if (s.base[y]?.[x] !== 'floor') continue;
        const left = x === cp.x0 ? inset : 0;
        const right = x === cp.x1 ? inset : 0;
        const x0 = x * T;
        const y0 = y * T;
        g.fillStyle = MAT.carpet.base;
        g.fillRect(R(x0 + left), y0, R(T - left - right), T);
        // Woven texture: faint cross rows.
        g.fillStyle = 'rgba(0,0,0,0.12)';
        for (let k = 1; k < 4; k++) g.fillRect(R(x0 + left), R(y0 + (k * T) / 4), R(T - left - right), lw);
        g.fillStyle = MAT.carpet.trim;
        g.globalAlpha = 0.75;
        if (x === cp.x0) g.fillRect(R(x0 + trim), y0, lw, T);
        if (x === cp.x1) g.fillRect(R(x0 + T - trim) - lw, y0, lw, T);
        if (y === cp.y1) g.fillRect(R(x0 + (x === cp.x0 ? trim : 0)), R(y0 + T - T * 0.12), R(T - (x === cp.x0 ? trim : 0) - (x === cp.x1 ? trim : 0)), lw);
        g.globalAlpha = 1;
      }
    }
  }

  // Dais tiles (red, with a low step) and the Wellspring rite dais (flat glowing font).
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const t = s.base[y]![x]!;
      if (!DAIS.has(t)) continue;
      if (s.zone[y]![x] === 'wellspringHall') paintRiteDais(c, x, y);
      else paintDais(c, x, y);
    }
  }

  // Wellspring rune ring on the hall's floor tiles.
  const rr = plan.runeRing;
  if (rr) {
    g.save();
    g.beginPath();
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.zone[y]![x] === rr.zone && s.base[y]![x] === 'floor') g.rect(x * T, y * T, T, T);
    g.clip();
    const cx = rr.cx * T;
    const cy = rr.cy * T;
    g.strokeStyle = MAT.well.rune;
    g.lineWidth = Math.max(1, R(T / 30));
    for (const k of [1.35, 1.6]) {
      g.beginPath();
      g.ellipse(cx, cy, T * k * 1.6, T * k * 0.85, 0, 0, TAU);
      g.stroke();
    }
    g.fillStyle = MAT.well.rune;
    const km = 1.475;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const px = cx + Math.cos(a) * T * km * 1.6;
      const py = cy + Math.sin(a) * T * km * 0.85;
      g.fillRect(R(px - T * 0.04), R(py - T * 0.06), Math.max(1, R(T * 0.08)), Math.max(1, R(T * 0.12)));
    }
    g.restore();
  }

  // Princess's Tower rug (violet, inset at the outer edge).
  for (const p of plan.rug) {
    const inZone = (x: number, y: number): boolean => s.zone[y]?.[x] === 'princessTower' && s.base[y]?.[x] === 'floor';
    const inRug = (x: number, y: number): boolean => plan.rug.some((q) => q.x === x && q.y === y);
    const l = !inRug(p.x - 1, p.y) || !inZone(p.x - 1, p.y) ? T * 0.3 : 0;
    const r = !inRug(p.x + 1, p.y) || !inZone(p.x + 1, p.y) ? T * 0.3 : 0;
    const tp = !inRug(p.x, p.y - 1) ? T * 0.3 : 0;
    const bt = !inRug(p.x, p.y + 1) ? T * 0.3 : 0;
    g.fillStyle = MAT.parquet.rug;
    g.fillRect(R(p.x * T + l), R(p.y * T + tp), R(T - l - r), R(T - tp - bt));
  }

  // Spilled goblets.
  for (const p of plan.goblets) {
    g.fillStyle = 'rgba(201,162,74,0.35)';
    g.beginPath();
    g.arc(p.x * T + T * (0.25 + 0.5 * hash(p.x, p.y, 18)), p.y * T + T * (0.25 + 0.5 * hash(p.x, p.y, 19)), T * 0.05, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(120,30,40,0.18)';
    g.beginPath();
    g.ellipse(p.x * T + T * (0.3 + 0.4 * hash(p.x, p.y, 18)), p.y * T + T * (0.35 + 0.4 * hash(p.x, p.y, 19)), T * 0.1, T * 0.05, 0.4, 0, TAU);
    g.fill();
  }
}

function paintDais(c: Ctx, x: number, y: number): void {
  const { g, T, lw } = c;
  const x0 = x * T;
  const y0 = y * T;
  const isD = (xx: number, yy: number): boolean => DAIS.has(at(c, xx, yy)!) && c.s.zone[yy]?.[xx] === c.s.zone[y]![x];
  g.fillStyle = MAT.carpet.dark;
  g.fillRect(x0, y0, T, T);
  const ins = R(T * 0.06);
  g.fillStyle = MAT.carpet.base;
  g.fillRect(x0 + (isD(x - 1, y) ? 0 : ins), y0 + (isD(x, y - 1) ? 0 : ins), T - (isD(x - 1, y) ? 0 : ins) - (isD(x + 1, y) ? 0 : ins), T - (isD(x, y - 1) ? 0 : ins) - (isD(x, y + 1) ? 0 : ins));
  g.fillStyle = 'rgba(201,162,74,0.22)';
  const cx = x0 + T / 2;
  const cy = y0 + T / 2;
  const r = T * 0.2;
  g.beginPath();
  g.moveTo(cx, cy - r);
  g.lineTo(cx + r, cy);
  g.lineTo(cx, cy + r);
  g.lineTo(cx - r, cy);
  g.closePath();
  g.fill();
  // Gold trim along the outer edge of the dais shape.
  g.fillStyle = 'rgba(201,162,74,0.55)';
  const tr = R(T * 0.1);
  if (!isD(x, y - 1)) g.fillRect(x0, y0 + tr, T, lw);
  if (!isD(x - 1, y)) g.fillRect(x0 + tr, y0, lw, T);
  if (!isD(x + 1, y)) g.fillRect(x0 + T - tr - lw, y0, lw, T);
  // A low step face (dais is +1 DEF) and its short shadow on the floor below.
  if (!isD(x, y + 1)) {
    const sh = R(T * 0.13);
    g.fillStyle = '#6e5a3a';
    g.fillRect(x0, y0 + T - sh, T, sh);
    g.fillStyle = MAT.carpet.trim;
    g.fillRect(x0, y0 + T - sh, T, lw);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x0, y0 + T - sh + lw, T, lw);
    const below = at(c, x, y + 1);
    if (below !== undefined && below !== 'wall') {
      g.fillStyle = 'rgba(0,0,0,0.32)';
      g.fillRect(x0, y0 + T, T, R(T * 0.1));
    }
  }
}

function paintRiteDais(c: Ctx, x: number, y: number): void {
  const { g, T } = c;
  const x0 = x * T;
  const y0 = y * T;
  const ins = R(T * 0.08);
  g.fillStyle = '#16323c';
  g.fillRect(x0 + ins, y0 + ins, T - 2 * ins, T - 2 * ins);
  g.strokeStyle = 'rgba(140,230,255,0.45)';
  g.lineWidth = Math.max(1, R(T / 30));
  const i2 = T * 0.22;
  g.strokeRect(R(x0 + i2) + 0.5, R(y0 + i2) + 0.5, R(T - 2 * i2), R(T - 2 * i2));
  g.fillStyle = 'rgba(140,230,255,0.18)';
  g.beginPath();
  g.arc(x0 + T / 2, y0 + T / 2, T * 0.1, 0, TAU);
  g.fill();
}

// --- steps ---------------------------------------------------------------------------------

function paintStairs(c: Ctx, x: number, y: number, dir: Dir): void {
  const { g, T, lw } = c;
  g.save();
  g.translate(x * T + T / 2, y * T + T / 2);
  // Rotate so local +y points down the steps (toward the water).
  const ang = dir.dy === 1 ? 0 : dir.dy === -1 ? Math.PI : dir.dx === 1 ? -Math.PI / 2 : Math.PI / 2;
  g.rotate(ang);
  const h = T / 2;
  const n = 4;
  for (let j = 0; j < n; j++) {
    const ty = R(-h + (j * T) / n);
    const tb = R(-h + ((j + 1) * T) / n);
    g.fillStyle = STAIR.tread;
    g.fillRect(-h, ty, T, tb - ty);
    // Each tread a little darker toward the water.
    g.fillStyle = `rgba(0,0,0,${(0.07 * j).toFixed(2)})`;
    g.fillRect(-h, ty, T, tb - ty);
    if (j > 0) {
      g.fillStyle = STAIR.riser;
      g.fillRect(-h, ty, T, lw);
    }
    g.fillStyle = STAIR.nosing;
    g.fillRect(-h, ty + (j > 0 ? lw : 0), T, lw);
  }
  g.restore();
  // Side strings where the flight meets non-step ground.
  g.fillStyle = 'rgba(0,0,0,0.3)';
  const x0 = x * T;
  const y0 = y * T;
  if (dir.dy !== 0) {
    if (at(c, x - 1, y) !== 'stairs') g.fillRect(x0, y0, lw, T);
    if (at(c, x + 1, y) !== 'stairs') g.fillRect(x0 + T - lw, y0, lw, T);
  } else {
    if (at(c, x, y - 1) !== 'stairs') g.fillRect(x0, y0, T, lw);
    if (at(c, x, y + 1) !== 'stairs') g.fillRect(x0, y0 + T - lw, T, lw);
  }
}

// --- wall contact shadows ------------------------------------------------------------------

function paintContactShadows(c: Ctx): void {
  const { g, s, T } = c;
  const sh = Math.max(2, R(T * 0.42));
  const sw = Math.max(2, R(T * 0.2));
  const n = g.createLinearGradient(0, 0, 0, sh);
  n.addColorStop(0, WALL.contact);
  n.addColorStop(1, 'rgba(0,0,0,0)');
  const w = g.createLinearGradient(0, 0, sw, 0);
  w.addColorStop(0, WALL.contactSide);
  w.addColorStop(1, 'rgba(0,0,0,0)');
  const e = g.createLinearGradient(0, 0, sw, 0);
  e.addColorStop(0, 'rgba(0,0,0,0)');
  e.addColorStop(1, WALL.contactSide);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (s.base[y]![x] === 'wall') continue;
      const x0 = x * T;
      const y0 = y * T;
      if (y > 0 && isWall(c, x, y - 1)) {
        g.save();
        g.translate(x0, y0);
        g.fillStyle = n;
        g.fillRect(0, 0, T, sh);
        g.restore();
      }
      if (x > 0 && isWall(c, x - 1, y)) {
        g.save();
        g.translate(x0, y0);
        g.fillStyle = w;
        g.fillRect(0, 0, sw, T);
        g.restore();
      }
      if (x < s.w - 1 && isWall(c, x + 1, y)) {
        g.save();
        g.translate(x0 + T - sw, y0);
        g.fillStyle = e;
        g.fillRect(0, 0, sw, T);
        g.restore();
      }
    }
  }
}

// --- low cover and furniture ----------------------------------------------------------------

function paintRubble(c: Ctx, x: number, y: number): void {
  const { g, T, lw } = c;
  const x0 = x * T;
  const y0 = y * T;
  // One fallen block in a corner chosen by hash.
  const corner = Math.floor(hash(x, y, 51) * 4);
  const bw = T * 0.3;
  const bh = T * 0.18;
  const bx = x0 + (corner % 2 === 0 ? T * 0.1 : T * 0.6);
  const by = y0 + (corner < 2 ? T * 0.12 : T * 0.66);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(R(bx + T * 0.03), R(by + T * 0.05), R(bw), R(bh));
  g.fillStyle = PILLAR.body;
  g.fillRect(R(bx), R(by), R(bw), R(bh));
  g.fillStyle = PILLAR.top;
  g.fillRect(R(bx), R(by), R(bw), Math.max(lw, R(T * 0.05)));
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(R(bx + bw * 0.55), R(by + T * 0.05), lw, R(bh - T * 0.05));
  // Five broken stones around the edge; the centre stays free for the unit.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + hash(x, y, 60 + i) * 0.9 + corner;
    const rad = T * (0.3 + 0.1 * hash(x, y, 70 + i));
    const cx = x0 + T / 2 + Math.cos(a) * rad;
    const cy = y0 + T / 2 + Math.sin(a) * rad * 0.85;
    const sz = T * (0.06 + 0.08 * hash(x, y, 80 + i));
    const stone = (ox: number, oy: number): void => {
      g.beginPath();
      g.moveTo(cx - sz + ox, cy + oy);
      g.lineTo(cx - sz * 0.3 + ox, cy - sz * 0.8 + oy);
      g.lineTo(cx + sz + ox, cy - sz * 0.2 + oy);
      g.lineTo(cx + sz * 0.4 + ox, cy + sz * 0.7 + oy);
      g.closePath();
      g.fill();
    };
    g.fillStyle = 'rgba(0,0,0,0.4)';
    stone(T * 0.025, T * 0.035);
    g.fillStyle = i % 2 === 0 ? '#4b4654' : '#3a3644';
    stone(0, 0);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(R(cx - sz * 0.3), R(cy - sz * 0.7), Math.max(1, R(sz * 0.8)), lw);
  }
}

function paintCrate(c: Ctx, x: number, y: number, s: number): void {
  const { g, T, lw } = c;
  const px = R(x);
  const py = R(y);
  const ps = R(s);
  const front = Math.max(1, R(T * 0.06));
  // Shadow to the south-east (<= 0.08T).
  g.fillStyle = 'rgba(0,0,0,0.42)';
  g.fillRect(px + R(T * 0.05), py + R(T * 0.05), ps, ps + front);
  // Front face (low, <= 0.12T) and top.
  g.fillStyle = CRATE.dark;
  g.fillRect(px, py + ps, ps, front);
  g.fillStyle = CRATE.wood;
  g.fillRect(px, py, ps, ps);
  // Lit top-left, dark outline, diagonal brace, corner bands.
  g.fillStyle = 'rgba(255,225,170,0.16)';
  g.fillRect(px, py, ps, lw);
  g.fillRect(px, py, lw, ps);
  g.strokeStyle = CRATE.dark;
  g.lineWidth = Math.max(1, R(T / 30));
  g.strokeRect(px + 0.5, py + 0.5, ps - 1, ps - 1);
  g.beginPath();
  g.moveTo(px + ps * 0.12, py + ps * 0.88);
  g.lineTo(px + ps * 0.88, py + ps * 0.12);
  g.stroke();
  g.fillStyle = CRATE.band;
  const b = Math.max(1, R(ps * 0.16));
  g.fillRect(px, py, b, lw * 2);
  g.fillRect(px, py, lw * 2, b);
  g.fillRect(px + ps - b, py + ps - lw * 2, b, lw * 2);
  g.fillRect(px + ps - lw * 2, py + ps - b, lw * 2, b);
  g.fillRect(px + ps - b, py, b, lw * 2);
  g.fillRect(px, py + ps - lw * 2, b, lw * 2);
}

function paintCrates(c: Ctx, x: number, y: number): void {
  const T = c.T;
  const x0 = x * T;
  const y0 = y * T;
  const flip = hash(x, y, 91) < 0.5;
  const big = T * 0.38;
  const small = T * 0.31;
  // Toward the back corners so a unit standing here reads as behind cover.
  const bx = flip ? x0 + T * 0.54 : x0 + T * 0.08;
  const sx = flip ? x0 + T * 0.12 : x0 + T * 0.6;
  paintCrate(c, sx, y0 + T * 0.16, small);
  paintCrate(c, bx, y0 + T * 0.1, big);
  if (hash(x, y, 92) < 0.6) paintCrate(c, bx + T * 0.04, y0 + T * 0.02, small * 0.82);
}

function paintTable(c: Ctx, tt: TableTile, candle: boolean): void {
  const { g, T, lw } = c;
  const x0 = tt.x * T;
  const y0 = tt.y * T;
  const inset = T * 0.08;
  let l: number;
  let r: number;
  let top: number;
  let bot: number;
  if (tt.axis === 'ew') {
    l = tt.start ? x0 + inset : x0;
    r = tt.end ? x0 + T - inset : x0 + T;
    top = y0 + T * 0.14;
    bot = y0 + T * 0.76;
  } else {
    l = x0 + inset;
    r = x0 + T - inset;
    top = tt.start ? y0 + T * 0.14 : y0;
    bot = tt.end ? y0 + T * 0.76 : y0 + T;
  }
  l = R(l);
  r = R(r);
  top = R(top);
  bot = R(bot);
  const southEdge = tt.axis === 'ew' || tt.end;
  if (southEdge) {
    // Short front edge and its shadow (low cover: <= 0.12T and <= 0.10T).
    const fe = R(T * 0.1);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(l, bot + fe, r - l, R(T * 0.08));
    g.fillStyle = TABLE.front;
    g.fillRect(l, bot, r - l, fe);
  }
  g.fillStyle = TABLE.top;
  g.fillRect(l, top, r - l, bot - top);
  // Grain along the long axis.
  g.fillStyle = 'rgba(0,0,0,0.16)';
  if (tt.axis === 'ew') {
    for (let k = 1; k < 4; k++) g.fillRect(l, R(top + ((bot - top) * k) / 4), r - l, lw);
  } else {
    for (let k = 1; k < 4; k++) g.fillRect(R(l + ((r - l) * k) / 4), top, lw, bot - top);
  }
  // Lit north / west edges on the run's outline only.
  g.fillStyle = TABLE.topEdge;
  if (tt.axis === 'ew' || tt.start) g.fillRect(l, top, r - l, lw);
  if (tt.axis === 'ns' || tt.start) g.fillRect(l, top, lw, bot - top);
  // Red runner along the long axis.
  g.fillStyle = TABLE.runner;
  const rw = R(T * 0.18);
  const cx = R((l + r) / 2);
  const cy = R((top + bot) / 2);
  if (tt.axis === 'ew') g.fillRect(tt.start ? l + R(T * 0.06) : l, cy - R(rw / 2), r - l - (tt.start ? R(T * 0.06) : 0) - (tt.end ? R(T * 0.06) : 0), rw);
  else g.fillRect(cx - R(rw / 2), tt.start ? top + R(T * 0.06) : top, rw, bot - top - (tt.start ? R(T * 0.06) : 0) - (tt.end ? R(T * 0.06) : 0));
  // Two plates and a goblet per tile.
  const plate = (px: number, py: number): void => {
    g.fillStyle = TABLE.plate;
    g.beginPath();
    g.arc(px, py, T * 0.07, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(60,40,30,0.55)';
    g.beginPath();
    g.arc(px, py, T * 0.045, 0, TAU);
    g.fill();
  };
  if (tt.axis === 'ew') {
    plate(x0 + T * 0.27, top + (cy - top) * 0.45);
    plate(x0 + T * 0.73, cy + (bot - cy) * 0.55);
    g.fillStyle = TABLE.goblet;
    g.beginPath();
    g.arc(x0 + T * (hash(tt.x, tt.y, 3) < 0.5 ? 0.62 : 0.4), top + (cy - top) * 0.45, Math.max(1, T * 0.035), 0, TAU);
    g.fill();
  } else {
    plate(l + (cx - l) * 0.45, y0 + T * 0.27);
    plate(cx + (r - cx) * 0.55, y0 + T * 0.73);
    g.fillStyle = TABLE.goblet;
    g.beginPath();
    g.arc(l + (cx - l) * 0.45, y0 + T * 0.6, Math.max(1, T * 0.035), 0, TAU);
    g.fill();
  }
  if (candle) {
    // Candle stick (the flame tip is redrawn in layer 7).
    const cw = Math.max(1, R(T * 0.04));
    const ch = Math.max(2, R(T * 0.1));
    const ccx = x0 + R(T * 0.5);
    const ccy = y0 + R(T * 0.45);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(ccx - R(cw / 2) + lw, ccy - ch + lw, cw, ch);
    g.fillStyle = '#efe6d2';
    g.fillRect(ccx - R(cw / 2), ccy - ch, cw, ch);
  }
}

function paintPillar(c: Ctx, x: number, y: number, pier: boolean): void {
  const { g, T, lw } = c;
  const x0 = x * T;
  const y0 = y * T;
  const cx = x0 + T / 2;
  // Shadow ellipse.
  g.fillStyle = PILLAR.shadow;
  g.beginPath();
  g.ellipse(cx + T * 0.1, y0 + T * 0.53, T * 0.3, T * 0.11, 0, 0, TAU);
  g.fill();
  // Plinth.
  g.fillStyle = PILLAR.plinth;
  g.fillRect(R(cx - T * 0.28), R(y0 + T * 0.46), R(T * 0.56), R(T * 0.1));
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(R(cx - T * 0.28), R(y0 + T * 0.46), R(T * 0.56), lw);
  // Shaft, lit from the left.
  const sl = R(cx - T * 0.2);
  const sr = R(cx + T * 0.2);
  const st = R(y0 + T * 0.1);
  const sb = R(y0 + T * 0.47);
  const grad = g.createLinearGradient(sl, 0, sr, 0);
  grad.addColorStop(0, PILLAR.top);
  grad.addColorStop(0.45, PILLAR.body);
  grad.addColorStop(1, '#25222e');
  g.fillStyle = grad;
  g.fillRect(sl, st, sr - sl, sb - st);
  if (!pier) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = 1; k <= 3; k++) g.fillRect(R(sl + ((sr - sl) * k) / 4), st, lw, sb - st);
  } else {
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(sl, R(st + (sb - st) / 2), sr - sl, lw);
  }
  // Capital.
  g.fillStyle = PILLAR.top;
  g.fillRect(R(cx - T * 0.27), R(y0 + T * 0.05), R(T * 0.54), R(T * 0.09));
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(R(cx - T * 0.27), R(y0 + T * 0.14) - lw, R(T * 0.54), lw);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(R(cx - T * 0.27), R(y0 + T * 0.05), R(T * 0.54), lw);
}

function paintBrazier(c: Ctx, x: number, y: number): void {
  const { g, T, lw } = c;
  const x0 = x * T;
  const y0 = y * T;
  const cx = x0 + T / 2;
  // Stone plinth with a shadow (raised, blocking).
  const pl = R(x0 + T * 0.15);
  const pw = R(T * 0.7);
  const pt = R(y0 + T * 0.24);
  const ph = R(T * 0.6);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(pl + R(T * 0.06), pt + R(T * 0.08), pw, ph + R(T * 0.04));
  g.fillStyle = '#3a3644';
  g.fillRect(pl, pt, pw, ph);
  g.fillStyle = '#1f1c26';
  g.fillRect(pl, pt + ph - R(T * 0.1), pw, R(T * 0.1));
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(pl, pt, pw, lw);
  g.fillRect(pl, pt, lw, ph - R(T * 0.1));
  // Three legs.
  g.strokeStyle = BRAZIER.legs;
  g.lineWidth = Math.max(1, R(T * 0.05));
  g.beginPath();
  g.moveTo(cx - T * 0.2, y0 + T * 0.36);
  g.lineTo(cx - T * 0.25, y0 + T * 0.7);
  g.moveTo(cx + T * 0.2, y0 + T * 0.36);
  g.lineTo(cx + T * 0.25, y0 + T * 0.7);
  g.moveTo(cx, y0 + T * 0.4);
  g.lineTo(cx, y0 + T * 0.76);
  g.stroke();
  // Bowl: deep iron body under a rim ellipse at y 0.30T, glowing coals inside.
  const ry = T * 0.12;
  const rx = T * 0.31;
  const by = y0 + T * 0.3;
  g.fillStyle = BRAZIER.iron;
  g.beginPath();
  g.ellipse(cx, by, rx, ry, 0, 0, Math.PI);
  g.lineTo(cx - rx * 0.55, by + T * 0.16);
  g.lineTo(cx + rx * 0.55, by + T * 0.16);
  g.closePath();
  g.fill();
  g.beginPath();
  g.ellipse(cx, by, rx, ry, 0, 0, Math.PI);
  g.fill();
  g.fillStyle = 'rgba(255,190,120,0.12)';
  g.fillRect(R(cx - rx * 0.7), R(by + T * 0.04), R(rx * 0.3), Math.max(1, R(T * 0.08)));
  g.fillStyle = '#5a2210';
  g.beginPath();
  g.ellipse(cx, by, rx * 0.86, ry * 0.75, 0, 0, TAU);
  g.fill();
  g.fillStyle = BRAZIER.coal;
  g.beginPath();
  g.ellipse(cx, by + ry * 0.1, rx * 0.66, ry * 0.5, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#ffd08a';
  for (let i = 0; i < 4; i++) g.fillRect(R(cx + (hash(x, y, 100 + i) - 0.5) * rx * 1.1), R(by + (hash(x, y, 110 + i) - 0.5) * ry * 0.7), lw * 2, lw);
  g.strokeStyle = BRAZIER.rim;
  g.lineWidth = Math.max(1, R(T / 26));
  g.beginPath();
  g.ellipse(cx, by, rx, ry, 0, 0, TAU);
  g.stroke();
}

function paintBell(c: Ctx, x: number, y: number): void {
  const { g, T, lw } = c;
  const x0 = x * T;
  const y0 = y * T;
  const cx = x0 + T / 2;
  const cy = y0 + T / 2;
  // Cast shadow (it hangs: raised, blocking).
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  g.arc(cx + T * 0.06, cy + T * 0.08, T * 0.4, 0, TAU);
  g.fill();
  g.fillStyle = BELL.dark;
  g.beginPath();
  g.arc(cx, cy, T * 0.4, 0, TAU);
  g.fill();
  g.fillStyle = BELL.bronze;
  g.beginPath();
  g.arc(cx, cy, T * 0.34, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(78,58,26,0.7)';
  g.lineWidth = Math.max(1, R(T / 40));
  g.beginPath();
  g.arc(cx, cy, T * 0.24, 0, TAU);
  g.stroke();
  g.fillStyle = BELL.hi;
  g.beginPath();
  g.arc(cx, cy, T * 0.14, 0, TAU);
  g.fill();
  g.strokeStyle = BELL.hi;
  g.lineWidth = Math.max(1, R(T / 22));
  g.beginPath();
  g.arc(cx, cy, T * 0.3, Math.PI * 1.05, Math.PI * 1.55);
  g.stroke();
  // Timber yoke across the bell with iron caps.
  const yh = R(T * 0.12);
  g.fillStyle = DOOR.woodDark;
  g.fillRect(x0 + R(T * 0.04), R(cy - yh / 2), T - R(T * 0.08), yh);
  g.fillStyle = 'rgba(255,220,170,0.12)';
  g.fillRect(x0 + R(T * 0.04), R(cy - yh / 2), T - R(T * 0.08), lw);
  g.fillStyle = '#16110c';
  g.fillRect(x0 + R(T * 0.04), R(cy - yh / 2), R(T * 0.06), yh);
  g.fillRect(x0 + T - R(T * 0.1), R(cy - yh / 2), R(T * 0.06), yh);
}

function paintRope(c: Ctx, bell: Pos, coil: Pos): void {
  const { g, T } = c;
  const dx = coil.x - bell.x;
  const dy = coil.y - bell.y;
  const sx = bell.x * T + T / 2 + dx * T * 0.36;
  const sy = bell.y * T + T / 2 + dy * T * 0.1;
  const ex = coil.x * T + T * 0.5 - dx * T * 0.1;
  const ey = coil.y * T + T * 0.62;
  g.strokeStyle = BELL.rope;
  g.globalAlpha = 0.75;
  g.lineWidth = Math.max(1, R(T / 23));
  g.beginPath();
  g.moveTo(sx, sy);
  g.quadraticCurveTo((sx + ex) / 2, Math.max(sy, ey) + T * 0.1, ex, ey);
  g.stroke();
  for (const r of [0.13, 0.08]) {
    g.beginPath();
    g.ellipse(ex, ey, T * r, T * r * 0.6, 0, 0, TAU);
    g.stroke();
  }
  g.globalAlpha = 1;
}

// --- bridges ---------------------------------------------------------------------------------

type Side = 'deck' | 'land' | 'water';

function paintBridge(c: Ctx, id: string, tiles: readonly Pos[]): void {
  const { g, s, T, lw } = c;
  const own = new Set(tiles.map((t) => t.y * s.w + t.x));
  const burned = c.burned.has(id);
  const span = s.bridges.find((b) => b.id === id);
  const axis: Axis = span?.axis ?? 'ns';
  const side = (x: number, y: number): Side => (own.has(y * s.w + x) ? 'deck' : isGround(c, x, y) ? 'land' : 'water');
  const ins = R(T * 0.1);
  const rail = Math.max(2, R(T * 0.09));
  const post = Math.max(2, R(T * 0.13));
  for (const t of tiles) {
    const x0 = t.x * T;
    const y0 = t.y * T;
    const N = side(t.x, t.y - 1);
    const S = side(t.x, t.y + 1);
    const W = side(t.x - 1, t.y);
    const E = side(t.x + 1, t.y);
    const l = x0 + (W === 'water' ? ins : 0);
    const r = x0 + T - (E === 'water' ? ins : 0);
    const tp = y0 + (N === 'water' ? ins : 0);
    const bt = y0 + T - (S === 'water' ? ins : 0);
    if (burned) {
      paintCharred(c, t.x, t.y, N, S, W, E, axis);
      continue;
    }
    // Drop shadow on the water beside the deck.
    g.fillStyle = 'rgba(0,0,0,0.45)';
    if (W === 'water') g.fillRect(x0, y0, ins, T);
    if (E === 'water') g.fillRect(r, y0, ins, T);
    if (N === 'water') g.fillRect(x0, y0, T, ins);
    if (S === 'water') g.fillRect(x0, bt, T, ins);
    // Deck with plank seams across the direction of travel (aligned to the map grid so spans are seamless).
    g.fillStyle = BRIDGE.wood;
    g.fillRect(l, tp, r - l, bt - tp);
    const step = T * 0.2;
    for (let k = 0; k < 5; k++) {
      g.fillStyle = hash(t.x * 5 + k, t.y, 120) < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,220,170,0.05)';
      if (axis === 'ns') g.fillRect(l, R(y0 + k * step), r - l, R(step));
      else g.fillRect(R(x0 + k * step), tp, R(step), bt - tp);
      g.fillStyle = BRIDGE.dark;
      if (axis === 'ns') g.fillRect(l, R(y0 + k * step), r - l, lw);
      else g.fillRect(R(x0 + k * step), tp, lw, bt - tp);
    }
    // Rails along every side that faces water, for the whole span.
    const railRect = (rx: number, ry: number, rw: number, rh: number): void => {
      g.fillStyle = BRIDGE.dark;
      g.fillRect(rx, ry + lw, rw, rh);
      g.fillStyle = BRIDGE.rail;
      g.fillRect(rx, ry, rw, rh - lw);
      g.fillStyle = 'rgba(255,225,170,0.25)';
      g.fillRect(rx, ry, rw, lw);
    };
    if (W === 'water') railRect(l, tp, rail, bt - tp);
    if (E === 'water') railRect(r - rail, tp, rail, bt - tp);
    if (N === 'water') railRect(l, tp, r - l, rail);
    if (S === 'water') railRect(l, bt - rail, r - l, rail);
    // Inner corners of an L/T-shaped deck: water in the diagonal notch, rails meeting in an L.
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      if (side(t.x + dx, t.y) !== 'deck' || side(t.x, t.y + dy) !== 'deck' || side(t.x + dx, t.y + dy) !== 'water') continue;
      const qx = dx < 0 ? x0 : x0 + T - ins;
      const qy = dy < 0 ? y0 : y0 + T - ins;
      const grad = c.canalGrad.get(t.y * s.w + t.x);
      g.fillStyle = grad ?? WATER.mid;
      g.fillRect(qx, qy, ins, ins);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(qx, qy, ins, ins);
      const ax = dx < 0 ? x0 + ins : x0 + T - ins - rail;
      const ay = dy < 0 ? y0 + ins : y0 + T - ins - rail;
      railRect(dx < 0 ? x0 : ax, ay, dx < 0 ? ins + rail : ins + rail, rail);
      railRect(ax, dy < 0 ? y0 : ay, rail, ins + rail);
    }
    // Posts only where a rail meets the bank (the two ends of the span).
    const postAt = (px: number, py: number): void => {
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(px + lw, py + lw, post, post);
      g.fillStyle = BRIDGE.dark;
      g.fillRect(px, py, post, post);
      g.fillStyle = BRIDGE.rail;
      g.fillRect(px, py, post, lw);
    };
    const pl = R(l + rail / 2 - post / 2);
    const pr = R(r - rail / 2 - post / 2);
    const ptp = R(tp + rail / 2 - post / 2);
    const pbt = R(bt - rail / 2 - post / 2);
    if (N === 'land') {
      if (W === 'water') postAt(pl, y0);
      if (E === 'water') postAt(pr, y0);
    }
    if (S === 'land') {
      if (W === 'water') postAt(pl, y0 + T - post);
      if (E === 'water') postAt(pr, y0 + T - post);
    }
    if (W === 'land') {
      if (N === 'water') postAt(x0, ptp);
      if (S === 'water') postAt(x0, pbt);
    }
    if (E === 'land') {
      if (N === 'water') postAt(x0 + T - post, ptp);
      if (S === 'water') postAt(x0 + T - post, pbt);
    }
  }
}

/** Burned bridge remains: charred stumps at the bank ends and a broken beam per tile (embers are fx, layer 4). */
function paintCharred(c: Ctx, x: number, y: number, N: Side, S: Side, W: Side, E: Side, axis: Axis): void {
  const { g, T, lw } = c;
  const x0 = x * T;
  const y0 = y * T;
  const post = Math.max(2, R(T * 0.13));
  const stump = (px: number, py: number, h: number): void => {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(R(px) + lw, R(py) + lw, post, R(h));
    g.fillStyle = BRIDGE.charred;
    g.fillRect(R(px), R(py), post, R(h));
    g.fillStyle = 'rgba(255,122,46,0.25)';
    g.fillRect(R(px), R(py), post, lw);
  };
  // Stumps of the posts and a jagged plank stub on each bank side.
  const stub = (horizontal: boolean, at0: number, fromStart: boolean): void => {
    g.fillStyle = BRIDGE.charred;
    for (let k = 0; k < 4; k++) {
      const len = T * (0.08 + 0.12 * hash(x * 4 + k, y, 130));
      if (horizontal) {
        const px = x0 + T * 0.12 + k * T * 0.19;
        g.fillRect(R(px), R(fromStart ? at0 : at0 - len), R(T * 0.16), R(len));
      } else {
        const py = y0 + T * 0.12 + k * T * 0.19;
        g.fillRect(R(fromStart ? at0 : at0 - len), R(py), R(len), R(T * 0.16));
      }
    }
  };
  if (N === 'land') {
    stub(true, y0, true);
    stump(x0 + T * 0.08, y0, T * 0.3);
    stump(x0 + T * 0.92 - post, y0, T * 0.26);
  }
  if (S === 'land') {
    stub(true, y0 + T, false);
    stump(x0 + T * 0.08, y0 + T * 0.68, T * 0.32);
    stump(x0 + T * 0.92 - post, y0 + T * 0.72, T * 0.28);
  }
  if (W === 'land') {
    stub(false, x0, true);
    stump(x0, y0 + T * 0.08, T * 0.22);
  }
  if (E === 'land') {
    stub(false, x0 + T, false);
    stump(x0 + T - post, y0 + T * 0.7, T * 0.22);
  }
  // A broken, half-sunk beam fragment.
  g.save();
  g.translate(x0 + T * (0.35 + 0.3 * hash(x, y, 131)), y0 + T * (0.35 + 0.3 * hash(x, y, 132)));
  g.rotate((axis === 'ns' ? 0.3 : 1.3) + hash(x, y, 133) * 0.8);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(-T * 0.24 + lw, -T * 0.045 + lw * 2, T * 0.48, T * 0.09);
  g.fillStyle = BRIDGE.charred;
  g.fillRect(-T * 0.24, -T * 0.045, T * 0.48, T * 0.09);
  g.fillStyle = '#3b2614';
  g.fillRect(-T * 0.24, -T * 0.045, T * 0.48, lw);
  g.restore();
}

// --- doors -----------------------------------------------------------------------------------

/** Ordinary open doorway (barred doors: threshold only, objects.ts draws the rest). */
function paintDoorway(c: Ctx, x: number, y: number, axis: Axis, barred: boolean): void {
  const { g, T, lw } = c;
  g.save();
  // Local frame of an 'ns' passage (jambs left/right); 'ew' passages are a quarter turn.
  g.translate(x * T + T / 2, y * T + T / 2);
  if (axis === 'ew') g.rotate(Math.PI / 2);
  const h = T / 2;
  // Jambs that are walls in the local frame (left = -x, right = +x).
  const jambL = axis === 'ns' ? isWall(c, x - 1, y) : isWall(c, x, y + 1);
  const jambR = axis === 'ns' ? isWall(c, x + 1, y) : isWall(c, x, y - 1);
  const pw = R(T * 0.12);
  const pl = R(T * 0.4);
  const th = R(T * 0.16);
  // Threshold strip across the passage at the wall line (kept low-contrast: it must not read as a bar).
  g.globalAlpha = barred ? 0.8 : 0.5;
  g.fillStyle = DOOR.threshold;
  g.fillRect(-h, -R(th / 2), T, th);
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-h, -R(th / 2) + th - lw, T, lw);
  if (barred) {
    g.restore();
    return;
  }
  // Warm frame posts on the jambs, a lit inner edge facing the passage.
  const post = (sx: number): void => {
    const px = sx < 0 ? -h : h - pw;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(px + lw, -R(pl / 2) + lw * 2, pw, pl);
    g.fillStyle = DOOR.frame;
    g.fillRect(px, -R(pl / 2), pw, pl);
    g.fillStyle = DOOR.woodDark;
    g.fillRect(sx < 0 ? px : px + pw - lw, -R(pl / 2), lw, pl);
    g.fillStyle = LIGHT.flameBody;
    g.fillRect(sx < 0 ? px + pw - lw : px, -R(pl / 2), lw, pl);
    g.fillRect(px, -R(pl / 2), pw, lw);
  };
  if (jambL) post(-1);
  if (jambR) post(1);
  if (!jambL && !jambR) {
    g.restore();
    return;
  }
  // One leaf swung open 90 degrees, hinged at the top of a post and lying along the passage.
  const side = jambL && (!jambR || hash(x, y, 141) < 0.5) ? -1 : 1;
  if (side > 0) g.scale(-1, 1);
  const lt = Math.max(2, R(T * 0.1));
  const ll = R(T * 0.66);
  const lx = -h + pw;
  const ly = -R(pl / 2);
  // Faint swing arc from the leaf tip to the far side (the door-plan cue).
  g.strokeStyle = 'rgba(232,200,114,0.32)';
  g.lineWidth = lw;
  g.setLineDash([Math.max(2, R(T / 14)), Math.max(2, R(T / 14))]);
  g.beginPath();
  g.arc(lx, ly, ll * 0.92, Math.PI / 2, 0, true);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(lx + R(T * 0.06), ly + lw, lt, ll);
  g.fillStyle = DOOR.wood;
  g.fillRect(lx, ly, lt, ll);
  g.fillStyle = DOOR.woodDark;
  g.fillRect(lx + lt - lw, ly, lw, ll);
  g.fillRect(lx, ly + ll - lw, lt, lw);
  g.fillStyle = 'rgba(255,220,170,0.2)';
  g.fillRect(lx, ly, lw, ll);
  g.fillStyle = DOOR.iron;
  const ring = Math.max(1, R(T * 0.05));
  g.fillRect(lx + lt - lw, ly + R(ll * 0.55), ring, ring);
  g.restore();
}

// --- walls -------------------------------------------------------------------------------------

function paintWall(c: Ctx, x: number, y: number): void {
  const { g, s, T, lw } = c;
  const x0 = x * T;
  const y0 = y * T;
  const face = wallHasFace(s.base, x, y);
  const capH = face ? R(T * 0.56) : T;
  g.fillStyle = WALL.cap;
  g.fillRect(x0, y0, T, capH);
  // Faint staggered block joints so wall masses read as stone, not void.
  const half = R(T / 2);
  g.fillStyle = 'rgba(255,255,255,0.035)';
  g.fillRect(x0, y0 + half, T, lw);
  g.fillRect(x0 + (y % 2) * half, y0, lw, Math.min(half, capH));
  if (capH > half) g.fillRect(x0 + ((y + 1) % 2) * half, y0 + half, lw, capH - half);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x0, y0 + half + lw, T, lw);
  if (hash(x, y, 150) < 0.25) {
    g.fillStyle = 'rgba(255,255,255,0.02)';
    g.fillRect(x0 + R(T * 0.1), y0 + R(T * 0.08), R(T * 0.35), Math.min(R(T * 0.3), capH - R(T * 0.1)));
  }
  // Rim light where the cap meets open ground (N, W, E).
  const rim = Math.max(1, R(T / 22));
  g.fillStyle = WALL.capRim;
  if (y > 0 && !isWall(c, x, y - 1)) g.fillRect(x0, y0, T, rim);
  if (x > 0 && !isWall(c, x - 1, y)) g.fillRect(x0, y0, rim, capH);
  if (x < s.w - 1 && !isWall(c, x + 1, y)) g.fillRect(x0 + T - rim, y0, rim, capH);
  if (!face) return;
  const fh = T - capH;
  const grad = g.createLinearGradient(0, y0 + capH, 0, y0 + T);
  grad.addColorStop(0, WALL.faceTop);
  grad.addColorStop(1, WALL.face);
  g.fillStyle = grad;
  g.fillRect(x0, y0 + capH, T, fh);
  // Two brick courses.
  const bh = fh / 2;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let j = 0; j < 2; j++) {
    const yy = R(y0 + capH + j * bh);
    if (j > 0) g.fillRect(x0, yy, T, lw);
    const off = (j + x) % 2 === 0 ? 0 : T / 4;
    for (let bx = off; bx < T; bx += T / 2) g.fillRect(R(x0 + bx), yy, lw, R(bh));
  }
  g.fillStyle = WALL.faceHighlight;
  g.fillRect(x0, y0 + capH, T, lw);
  // Darker face ends where the wall turns a corner into open ground.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  if (x > 0 && !isWall(c, x - 1, y)) g.fillRect(x0, y0 + capH, lw, fh);
  if (x < s.w - 1 && !isWall(c, x + 1, y)) g.fillRect(x0 + T - lw, y0 + capH, lw, fh);
}

function paintThroneBack(c: Ctx, tb: { x0: number; x1: number; y: number }): void {
  const { g, T, lw } = c;
  const cols = tb.x1 - tb.x0 + 1;
  const w = R(T * 0.76 * cols);
  const cx = ((tb.x0 + tb.x1 + 1) / 2) * T;
  const l = R(cx - w / 2);
  const y0 = tb.y * T;
  const top = y0 + R(T * 0.22);
  const bot = y0 + T;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(l + lw * 2, top + lw * 2, w, bot - top);
  g.fillStyle = '#7a1f2c';
  g.beginPath();
  g.moveTo(l, bot);
  g.lineTo(l, top);
  g.lineTo(cx, y0 + R(T * 0.04));
  g.lineTo(l + w, top);
  g.lineTo(l + w, bot);
  g.closePath();
  g.fill();
  g.strokeStyle = '#c9a24a';
  g.lineWidth = Math.max(1, R(T / 23));
  g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(l + R(T * 0.12), top + R(T * 0.12), w - R(T * 0.24), bot - top - R(T * 0.12));
  g.fillStyle = '#c9a24a';
  g.beginPath();
  g.arc(cx, top + R(T * 0.2), T * 0.07, 0, TAU);
  g.fill();
}

function paintBanner(c: Ctx, x: number, y: number): void {
  const { g, T, lw } = c;
  const cx = x * T + T / 2;
  const w = T * 0.36;
  const top = y * T + T * 0.44;
  const h = T * 0.5;
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.beginPath();
  g.moveTo(cx - w / 2 + lw * 2, top + lw);
  g.lineTo(cx + w / 2 + lw * 2, top + lw);
  g.lineTo(cx + w / 2 + lw * 2, top + h + lw);
  g.lineTo(cx + lw * 2, top + h * 0.8 + lw);
  g.lineTo(cx - w / 2 + lw * 2, top + h + lw);
  g.closePath();
  g.fill();
  g.fillStyle = '#6a1f2a';
  g.beginPath();
  g.moveTo(cx - w / 2, top);
  g.lineTo(cx + w / 2, top);
  g.lineTo(cx + w / 2, top + h);
  g.lineTo(cx, top + h * 0.8);
  g.lineTo(cx - w / 2, top + h);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(R(cx - w / 2), R(top), lw, R(h));
  g.fillStyle = '#2a2018';
  g.fillRect(R(cx - w / 2 - T * 0.04), R(top - lw), R(w + T * 0.08), Math.max(1, R(T * 0.04)));
  g.fillStyle = '#c9a24a';
  g.beginPath();
  g.arc(cx, top + h * 0.38, T * 0.07, 0, TAU);
  g.fill();
}

function paintShelf(c: Ctx, x: number, y: number): void {
  const { g, T, lw } = c;
  const x0 = x * T;
  const y0 = y * T;
  const COLS = ['#5a2d3a', '#2d4a5a', '#5a4a2d', '#3a2d5a'];
  const bot = y0 + R(T * 0.95);
  g.fillStyle = '#1c140e';
  g.fillRect(x0 + R(T * 0.08), y0 + R(T * 0.6), T - R(T * 0.16), bot - y0 - R(T * 0.6) + lw);
  const sw = T * 0.1;
  const gap = (T * 0.72 - sw * 6) / 5;
  for (let i = 0; i < 6; i++) {
    const h = T * (0.24 + 0.06 * hash(x * 6 + i, y, 160));
    const sx = x0 + T * 0.14 + i * (sw + gap);
    g.fillStyle = COLS[Math.floor(hash(x * 6 + i, y, 161) * 4)]!;
    g.fillRect(R(sx), R(bot - h), Math.max(1, R(sw)), R(h));
    g.fillStyle = 'rgba(255,230,180,0.12)';
    g.fillRect(R(sx), R(bot - h * 0.7), Math.max(1, R(sw)), lw);
  }
  g.fillStyle = '#3a2a18';
  g.fillRect(x0 + R(T * 0.08), bot, T - R(T * 0.16), Math.max(1, R(T * 0.04)));
}

function paintLanternFixture(c: Ctx, l: LightSite): void {
  const { g, T } = c;
  const cx = l.x * T + T / 2;
  const cy = l.y * T + T * 0.67;
  const box = (w: number, h: number, col: string, dy = 0): void => {
    g.fillStyle = col;
    g.fillRect(R(cx - (T * w) / 2), R(cy - (T * h) / 2 + dy), Math.max(1, R(T * w)), Math.max(1, R(T * h)));
  };
  box(0.04, 0.1, '#2a2018', -T * 0.14);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(R(cx - T * 0.09) + 1, R(cy - T * 0.1) + R(T * 0.04), R(T * 0.18), R(T * 0.2));
  box(0.18, 0.2, '#3a2a18');
  box(0.12, 0.14, LIGHT.flameBody);
  box(0.06, 0.08, LIGHT.flameCore);
}

// --- map edges and exits -------------------------------------------------------------------------

function paintEdges(c: Ctx): void {
  const { g, s, T } = c;
  const L = T * 1.2;
  for (const e of s.edges) {
    const x0 = e.x * T;
    const y0 = e.y * T;
    let grad: CanvasGradient;
    let rx: number;
    let ry: number;
    let rw: number;
    let rh: number;
    if (e.dir.dx !== 0) {
      const outer = e.dir.dx < 0 ? x0 : x0 + T;
      const inner = outer - e.dir.dx * L;
      grad = g.createLinearGradient(inner, 0, outer, 0);
      rx = Math.min(inner, outer);
      ry = y0;
      rw = L;
      rh = T;
    } else {
      const outer = e.dir.dy < 0 ? y0 : y0 + T;
      const inner = outer - e.dir.dy * L;
      grad = g.createLinearGradient(0, inner, 0, outer);
      rx = x0;
      ry = Math.min(inner, outer);
      rw = T;
      rh = L;
    }
    grad.addColorStop(0, 'rgba(5,6,12,0)');
    grad.addColorStop(1, 'rgba(5,6,12,0.85)');
    g.fillStyle = grad;
    g.fillRect(R(rx), R(ry), R(rw), R(rh));
  }
  // Escape-exit thresholds: a teal glow on the tile (chevrons are layer 7).
  for (const ex of s.exits) {
    for (const t of ex.tiles) {
      g.fillStyle = STATUS.escapee;
      g.globalAlpha = 0.25;
      g.fillRect(t.x * T, t.y * T, T, T);
      g.globalAlpha = 1;
    }
  }
}

// --- layer 7: sources -----------------------------------------------------------------------------

function makeHalo(T: number): HTMLCanvasElement {
  const size = Math.max(8, R(T * 0.8));
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,214,150,0.55)');
    grad.addColorStop(0.4, 'rgba(255,176,90,0.2)');
    grad.addColorStop(1, 'rgba(255,176,90,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return cv;
}

const FLAME_COLS = ['#ff5a1f', '#ffb347', '#ffe2a0'] as const;

function drawSourcesImpl(f: GfxFrame, halo: HTMLCanvasElement): void {
  const { ctx, T, sites: s } = f;
  const reduced = f.motion.reduced;
  const t = f.now;
  const lamp = Math.max(0.35, f.env.lamp);

  // Lantern cores: small, bright, above the darkness.
  const hs = halo.width;
  for (const l of s.lanterns) {
    const cx = l.x * T + T / 2;
    const cy = l.y * T + T * 0.67;
    const a = reduced ? 0.95 : 0.8 + 0.2 * Math.sin(t / 90 + 50 * l.seed);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6 * a * lamp;
    ctx.drawImage(halo, R(cx - hs / 2), R(cy - hs / 2));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.fillStyle = LIGHT.flameCore;
    ctx.fillRect(R(cx - T * 0.03), R(cy - T * 0.04), Math.max(1, R(T * 0.06)), Math.max(1, R(T * 0.08)));
  }
  ctx.globalAlpha = 1;

  // Brazier fire: three layered flame tongues.
  for (const b of s.braziers) {
    const cx = b.x * T + T / 2;
    const base = b.y * T + T * 0.3;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7 * lamp;
    ctx.drawImage(halo, R(cx - hs * 0.75), R(base - hs * 0.9), R(hs * 1.5), R(hs * 1.5));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (let k = 0; k < 3; k++) {
      const wob = reduced ? 0 : Math.sin(t / (110 + k * 23) + b.seed * 40 + k * 1.7);
      const wob2 = reduced ? 0 : Math.sin(t / (70 + k * 11) + b.seed * 90 + k);
      const h = T * (0.45 - k * 0.075) * (0.9 + 0.1 * wob2);
      const w = T * (0.24 - k * 0.06);
      const sway = T * 0.035 * wob;
      ctx.fillStyle = FLAME_COLS[k]!;
      // Two tongues for the outer layer, one for the inner ones.
      const tongues = k === 0 ? 2 : 1;
      for (let i = 0; i < tongues; i++) {
        const ox = tongues === 2 ? (i === 0 ? -w * 0.35 : w * 0.35) : 0;
        const hh = tongues === 2 ? h * (i === 0 ? 0.85 : 1) : h;
        const bx = cx + ox;
        ctx.beginPath();
        ctx.moveTo(bx - w / 2, base);
        ctx.quadraticCurveTo(bx - w * 0.45, base - hh * 0.55, bx + sway, base - hh);
        ctx.quadraticCurveTo(bx + w * 0.45, base - hh * 0.55, bx + w / 2, base);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Table candle flames.
  for (const cdl of s.candles) {
    const cx = cdl.x * T + R(T * 0.5);
    const top = cdl.y * T + R(T * 0.45) - Math.max(2, R(T * 0.1));
    const a = reduced ? 0.95 : 0.8 + 0.2 * Math.sin(t / 80 + 30 * cdl.seed);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 * a * lamp;
    ctx.drawImage(halo, R(cx - hs * 0.3), R(top - hs * 0.3), R(hs * 0.6), R(hs * 0.6));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.fillStyle = LIGHT.flameCore;
    const fw = Math.max(1, R(T * 0.04));
    const fh = Math.max(2, R(T * 0.07));
    ctx.fillRect(cx - R(fw / 2), top - fh, fw, fh);
  }
  ctx.globalAlpha = 1;

  // Escape exits: three chevrons pointing off-map plus a small escapee badge at the inner edge.
  for (const ex of s.exits) {
    for (const p of ex.tiles) drawExitMarks(f, p.x, p.y, ex.dir);
  }
  ctx.globalAlpha = 1;
}

function drawExitMarks(f: GfxFrame, x: number, y: number, dir: Dir): void {
  const { ctx, T } = f;
  const cx = x * T + T / 2;
  const cy = y * T + T / 2;
  const s = T * 0.22;
  ctx.strokeStyle = STATUS.escapee;
  ctx.lineWidth = Math.max(2, R(T / 14));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    // Chevron i sits further toward the edge; animation runs outward.
    const along = (i - 1) * T * 0.22;
    const a = f.motion.reduced ? 0.7 : 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(((f.now - i * 150) / 1200) * TAU));
    const px = cx + dir.dx * along;
    const py = cy + dir.dy * along;
    ctx.globalAlpha = a;
    ctx.beginPath();
    // Perpendicular axis.
    const qx = -dir.dy;
    const qy = dir.dx;
    ctx.moveTo(px - dir.dx * s * 0.5 + qx * s, py - dir.dy * s * 0.5 + qy * s);
    ctx.lineTo(px + dir.dx * s * 0.5, py + dir.dy * s * 0.5);
    ctx.lineTo(px - dir.dx * s * 0.5 - qx * s, py - dir.dy * s * 0.5 - qy * s);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}
