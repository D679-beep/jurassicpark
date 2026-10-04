// gfx/sites.ts: per-map analysis. The prologue checks are written as
// properties (no hard-coded coordinates or counts) so they keep holding while
// the geometry pass reshapes the map; the synthetic map covers the new
// terrain kinds, the pool, a 2-wide canal, a multi-tile bridge and a gate.
import { describe, expect, it } from 'vitest';
import { TERRAIN, createGame, type MapState, type Pos, type Terrain } from '../../src/engine';
import { prologueScenario } from '../../src/content';
import { LANTERN_GROUND, MATERIAL_BY_ZONE, OUTDOOR_ZONES, baseTerrain, buildSites, offMapDir, sitesKey } from '../../src/ui/gfx/sites';
import type { Material } from '../../src/ui/gfx/types';

const state = createGame(prologueScenario);
const map = state.map;
const sites = buildSites(map, state.scenarioId);
const zoneOf = (id: string): Pos[] => map.zones[id] ?? [];
const t = (x: number, y: number): Terrain | undefined => sites.base[y]?.[x];
const interiorZoned = (x: number, y: number): boolean =>
  Object.entries(map.zones).some(([id, ts]) => !OUTDOOR_ZONES.has(id) && ts.some((p) => p.x === x && p.y === y));
const inAnyZone = (x: number, y: number): boolean => Object.values(map.zones).some((ts) => ts.some((p) => p.x === x && p.y === y));

describe('sites on the prologue map', () => {
  it('has grids matching the map', () => {
    for (const g of [sites.base, sites.material, sites.outdoor, sites.passable, sites.zone, sites.corridor]) {
      expect(g.length).toBe(map.height);
      for (const row of g) expect(row.length).toBe(map.width);
    }
  });

  it('puts lanterns only on wall tiles facing floor-like ground', () => {
    expect(sites.lanterns.length).toBeGreaterThan(5);
    for (const l of sites.lanterns) {
      expect(t(l.x, l.y)).toBe('wall');
      const below = t(l.x, l.y + 1)!;
      expect(LANTERN_GROUND.has(below)).toBe(true);
      expect(['door', 'water', 'bridge', 'stairs', 'brazier', 'bell']).not.toContain(below);
      expect(sites.staticLights[l.light]!.kind).toBe('lantern');
    }
  });

  it('derives braziers, candles and bells from terrain only', () => {
    const count = (k: Terrain): number => sites.base.flat().filter((x) => x === k).length;
    expect(sites.braziers.length).toBe(count('brazier'));
    expect(sites.bells.length).toBe(count('bell'));
    for (const c of sites.candles) expect(t(c.x, c.y)).toBe('table');
    for (const b of sites.braziers) expect(t(b.x, b.y)).toBe('brazier');
  });

  it('lists every static light once, in site order', () => {
    const n = sites.lanterns.length + sites.braziers.length + sites.candles.length + sites.bells.length + sites.overheads.length;
    expect(sites.staticLights.length).toBe(n);
    expect(Object.isFrozen(sites.staticLights[0])).toBe(true);
    // One or more overheads per interior zone, none outdoors.
    for (const id of Object.keys(map.zones)) {
      const k = sites.overheads.filter((o) => o.zone === id).length;
      if (OUTDOOR_ZONES.has(id)) expect(k).toBe(0);
      else expect(k).toBeGreaterThanOrEqual(1);
    }
    for (const o of sites.overheads) {
      expect(o.radius).toBeGreaterThanOrEqual(2.2);
      expect(o.radius).toBeLessThanOrEqual(3.4);
      const b = sites.zoneBoxes[o.zone]!;
      expect(o.x).toBeGreaterThanOrEqual(b.x);
      expect(o.x).toBeLessThanOrEqual(b.x + b.w);
    }
  });

  it('marks the outdoor zones, the canal and the south streets as outdoor, and never interiors or walls', () => {
    for (const id of OUTDOOR_ZONES) for (const p of zoneOf(id)) if (t(p.x, p.y) !== 'wall') expect(sites.outdoor[p.y]![p.x], `${id} ${p.x},${p.y}`).toBe(true);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (t(x, y) === 'wall') expect(sites.outdoor[y]![x]).toBe(false);
        if (interiorZoned(x, y)) expect(sites.outdoor[y]![x], `${x},${y}`).toBe(false);
        if (sites.corridor[y]![x]) expect(sites.outdoor[y]![x], `corridor ${x},${y}`).toBe(false);
      }
    }
    for (const w of sites.water) if (!w.pool) expect(sites.outdoor[w.y]![w.x]).toBe(true);
    // South of the canal: every non-zone open tile (not a door) is a moonlit street.
    const canalBottom = Math.max(...sites.water.filter((w) => !w.pool).map((w) => w.y));
    for (let y = canalBottom + 1; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const k = t(x, y);
        if (k === 'wall' || k === 'door' || inAnyZone(x, y) || sites.corridor[y]![x]) continue;
        expect(sites.outdoor[y]![x], `street ${x},${y}`).toBe(true);
      }
    }
    // Exit tiles outside interior zones (Mira's east exit) are open ground reached from outside.
    for (const e of map.exits) for (const p of e.tiles) if (!interiorZoned(p.x, p.y)) expect(sites.outdoor[p.y]![p.x], e.id).toBe(true);
  });

  it('assigns materials by zone, water and walls (4.1)', () => {
    const hist = new Map<Material, number>();
    for (const row of sites.material) for (const m of row) hist.set(m, (hist.get(m) ?? 0) + 1);
    let total = 0;
    for (const v of hist.values()) total += v;
    expect(total).toBe(map.width * map.height);
    expect(hist.get('wall')).toBe(sites.base.flat().filter((x) => x === 'wall').length);
    expect((hist.get('canal') ?? 0) + (hist.get('pool') ?? 0)).toBe(sites.water.length);
    for (const [id, mat] of MATERIAL_BY_ZONE) {
      if (!map.zones[id]) continue;
      // The zone's open floor uses its material (first match wins, so check tiles whose first zone is this one).
      const own = zoneOf(id).filter((p) => sites.zone[p.y]![p.x] === id && t(p.x, p.y) === 'floor');
      for (const p of own) expect(sites.material[p.y]![p.x], `${id} ${p.x},${p.y}`).toBe(mat);
      if (own.length > 0) expect(hist.get(mat) ?? 0).toBeGreaterThan(0);
    }
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (inAnyZone(x, y) || !['floor', 'rubble', 'pillar'].includes(t(x, y)!)) continue;
        expect(sites.material[y]![x]).toBe(sites.outdoor[y]![x] ? 'cobble' : 'slab');
      }
    }
  });

  it('finds 1-wide corridors and keeps them indoors', () => {
    const corridors = sites.corridor.flat().filter((c) => c !== null).length;
    expect(corridors).toBeGreaterThan(3);
  });

  it('describes bridges as spans across the canal', () => {
    const objs = map.objects.filter((o) => o.kind === 'bridge');
    expect(sites.bridges.length).toBe(objs.length);
    for (const b of sites.bridges) {
      const o = objs.find((x) => x.id === b.id)!;
      expect(b.tiles.length).toBe(o.tiles.length);
      expect(b.axis).toBe('ns'); // the canal runs east-west
      for (const p of b.tiles) expect(sites.water.some((w) => w.x === p.x && w.y === p.y && w.bridge === b.id)).toBe(true);
    }
  });

  it('pairs lanterns and braziers with water tiles in their column', () => {
    for (const r of sites.reflections) {
      const l = sites.staticLights[r.light]!;
      expect(['lantern', 'brazier']).toContain(l.kind);
      expect(Math.floor(l.x)).toBe(r.x);
      expect(r.dy).toBeLessThanOrEqual(3.2);
      expect(sites.water.some((w) => w.x === r.x && w.y === r.y)).toBe(true);
    }
  });

  it('lists doors, exits and edge openings', () => {
    expect(sites.doors.length).toBe(sites.base.flat().filter((x) => x === 'door').length);
    for (const d of sites.doors) {
      // The passage is open along its axis.
      if (d.axis === 'ns') expect(t(d.x, d.y - 1) !== 'wall' || t(d.x, d.y + 1) !== 'wall', `${d.x},${d.y}`).toBe(true);
      else expect(t(d.x - 1, d.y) !== 'wall' || t(d.x + 1, d.y) !== 'wall', `${d.x},${d.y}`).toBe(true);
    }
    const barred = map.objects.filter((o) => o.kind === 'door');
    for (const o of barred) expect(sites.doors.find((d) => d.x === o.pos.x && d.y === o.pos.y)?.objectId).toBe(o.id);
    // The tunnel doors pass east-west.
    for (const d of sites.doors) if (sites.zone[d.y]![d.x - 1] === 'servantsTunnel') expect(d.axis).toBe('ew');
    expect(sites.exits.map((e) => e.id).sort()).toEqual(map.exits.map((e) => e.id).sort());
    for (const e of sites.edges) {
      expect(t(e.x, e.y)).not.toBe('wall');
      expect(e.x === 0 || e.y === 0 || e.x === map.width - 1 || e.y === map.height - 1).toBe(true);
    }
    for (const ex of map.exits) for (const p of ex.tiles) expect(sites.edges.find((e) => e.x === p.x && e.y === p.y)?.exit).toBe(ex.id);
  });

  it('is stable for a whole battle (bridges burning do not change the key)', () => {
    const burned: MapState = structuredClone(map);
    for (const o of burned.objects) {
      if (o.kind !== 'bridge') continue;
      o.burned = true;
      for (const p of o.tiles) burned.terrain[p.y]![p.x] = 'water';
    }
    expect(sitesKey(burned, state.scenarioId)).toBe(sites.key);
    expect(baseTerrain(burned)).toEqual(sites.base);
  });
});

// --- synthetic map with every new kind ---------------------------------------------

function mapFrom(rows: string[], zones: Record<string, [number, number, number, number]>, extra: Partial<MapState> = {}): MapState {
  const legend: Record<string, Terrain> = {
    '#': 'wall',
    '.': 'floor',
    '+': 'door',
    '~': 'water',
    b: 'bridge',
    t: 'table',
    c: 'crates',
    s: 'stairs',
    f: 'brazier',
    B: 'bell',
    o: 'pillar',
    r: 'rubble',
  };
  const terrain = rows.map((r) => [...r].map((ch) => legend[ch]!));
  const z: Record<string, Pos[]> = {};
  for (const [id, [x0, y0, w, h]] of Object.entries(zones)) {
    z[id] = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) z[id]!.push({ x, y });
  }
  return { width: rows[0]!.length, height: rows.length, terrain, zones: z, objects: [], exits: [], ...extra };
}

//            x: 0123456789012
const ROWS = [
  '#############', // 0
  '#.tt.#......#', // 1  feastHall x1..4, wellspring x6..11
  '#.tt.#..~~..#', // 2  pool
  '#....+..~~..#', // 3
  '###.####+####', // 4  corridor (3,4)
  '#...c..s....#', // 5  quay, crates, stairs
  '#~~~~~~b~~~~#', // 6  canal row 1
  '#~~~~~~b~~~~#', // 7  canal row 2
  '#.f...B.....#', // 8  south street, brazier, bell (outdoors here)
  '#####....####', // 9  gate gap x5..8 on the border row
];

describe('sites on a synthetic map with the new terrain', () => {
  const m = mapFrom(ROWS, { feastHall: [1, 1, 4, 3], wellspringHall: [6, 1, 6, 3], quay: [1, 5, 11, 1] }, {
    objects: [
      { id: 'bridgeA', kind: 'bridge', tiles: [{ x: 7, y: 6 }, { x: 7, y: 7 }], tags: [], burned: false },
      { id: 'gateS', kind: 'gate', tiles: [5, 6, 7, 8].map((x) => ({ x, y: 9 })), wave: 'w', open: false },
    ],
  });
  const s = buildSites(m, 'synthetic');

  it('treats pool water inside an interior zone as pool, not canal and not outdoor', () => {
    expect(s.material[2]![8]).toBe('pool');
    expect(s.water.find((w) => w.x === 8 && w.y === 2)?.pool).toBe(true);
    expect(s.outdoor[2]![8]).toBe(false);
    expect(s.material[6]![2]).toBe('canal');
    expect(s.outdoor[6]![2]).toBe(true);
  });

  it('handles a 2-wide canal with a 2-tile bridge', () => {
    expect(s.bridges).toEqual([{ id: 'bridgeA', tiles: [{ x: 7, y: 6 }, { x: 7, y: 7 }], axis: 'ns' }]);
    expect(s.water.filter((w) => w.bridge === 'bridgeA').length).toBe(2);
    expect(s.passable[6]![7]).toBe(true);
    expect(s.passable[6]![6]).toBe(false);
  });

  it('places furniture sites and materials', () => {
    expect(s.braziers.map((b) => [b.x, b.y])).toEqual([[2, 8]]);
    expect(s.bells.map((b) => [b.x, b.y])).toEqual([[6, 8]]);
    for (const c of s.candles) expect(m.terrain[c.y]![c.x]).toBe('table');
    expect(s.material[1]![2]).toBe('plank'); // table tile: material of the room under it
    expect(s.material[5]![7]).toBe('flag'); // stairs
    expect(s.material[5]![4]).toBe('flag'); // crates on the quay
    expect(s.passable[8]![2]).toBe(false); // brazier blocks
    expect(s.passable[1]![2]).toBe(true); // table is low cover
    expect(TERRAIN.table.moveCost).toBe(2);
  });

  it('points stairs down toward the water', () => {
    expect(s.stairs).toEqual([{ x: 7, y: 5, dir: { dx: 0, dy: 1 } }]);
  });

  it('keeps the corridor and doors indoors, the street and the gate gap outdoors', () => {
    expect(s.corridor[4]![3]).toBe('ns');
    expect(s.outdoor[4]![3]).toBe(false);
    expect(s.outdoor[8]![9]).toBe(true);
    expect(s.outdoor[9]![6]).toBe(true);
    expect(s.material[8]![9]).toBe('cobble');
    expect(s.material[3]![2]).toBe('plank');
    expect(s.doors.find((d) => d.x === 8 && d.y === 4)?.axis).toBe('ns');
    expect(s.doors.find((d) => d.x === 5 && d.y === 3)?.axis).toBe('ew');
  });

  it('describes the gate and the edge openings', () => {
    expect(s.gates).toEqual([{ id: 'gateS', tiles: [5, 6, 7, 8].map((x) => ({ x, y: 9 })), wave: 'w', axis: 'ew', outward: { dx: 0, dy: 1 } }]);
    expect(s.edges.filter((e) => e.y === 9).length).toBe(4);
    for (const e of s.edges) if (e.y === 9) expect(e.dir).toEqual({ dx: 0, dy: 1 });
  });

  it('puts lanterns only on walls above floor-like ground', () => {
    for (const l of s.lanterns) {
      expect(m.terrain[l.y]![l.x]).toBe('wall');
      expect(LANTERN_GROUND.has(m.terrain[l.y + 1]![l.x]!)).toBe(true);
    }
  });

  it('off-map directions', () => {
    expect(offMapDir({ x: 0, y: 5 }, 10, 10)).toEqual({ dx: -1, dy: 0 });
    expect(offMapDir({ x: 9, y: 5 }, 10, 10)).toEqual({ dx: 1, dy: 0 });
    expect(offMapDir({ x: 5, y: 9 }, 10, 10)).toEqual({ dx: 0, dy: 1 });
  });
});
