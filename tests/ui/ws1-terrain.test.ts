// WS1 terrain, water and object helpers (pure parts of gfx/terrain.ts,
// gfx/water.ts and gfx/objects.ts). Canvas drawing itself is checked with
// screenshots; these pin the decisions the drawing depends on.
import { describe, expect, it } from 'vitest';
import { createGame, type MapObject, type ScenarioDef, type Terrain } from '../../src/engine';
import { prologueScenario } from '../../src/content';
import { buildSites } from '../../src/ui/gfx/sites';
import { bakedDesat, burnedBridgeIds, burnedBridgeMask, decorPlan, tableTiles, wallHasFace } from '../../src/ui/gfx/terrain';
import { rippleAlpha, rippleOffset, waterVisible } from '../../src/ui/gfx/water';
import { crackCount, doorStage, gateRise } from '../../src/ui/gfx/objects';
import { hasFloorPainter } from '../../src/ui/gfx/materials';

//   x: 0123456789
const MAP = [
  '##########', // 0
  '#.TT..ttt#', // 1  throne hall: dais, a 3-tile table
  '#........#', // 2
  '###+######', // 3  open door
  '#.t..~~..#', // 4  wellspring: a lone table, pool
  '#..TT....#', // 5
  '##########', // 6
];

function scenario(): ScenarioDef {
  return {
    id: 'ws1Test',
    name: 'WS1 Test',
    playerFaction: 'rebel',
    seed: 1,
    map: MAP,
    legend: { t: 'table', T: 'throne' },
    zones: {
      throneHall: { x: 1, y: 1, w: 8, h: 2 },
      wellspringHall: { x: 1, y: 4, w: 8, h: 2 },
      antechamber: { x: 1, y: 2, w: 8, h: 1 },
    },
    objects: [],
    units: [
      { id: 'varek', name: 'Varek', faction: 'rebel', rank: 'ascendant', character: 'varek', pos: [1, 2] },
      { id: 'halden', name: 'Emperor Halden', faction: 'loyalist', rank: 'soldier', character: 'halden', pos: [2, 1], tags: ['noResist'] },
    ],
    waves: [],
  };
}

const bridge = (id: string, burned: boolean): MapObject => ({ id, kind: 'bridge', tiles: [{ x: 0, y: 0 }], tags: [], burned });

describe('bridge burn key', () => {
  const objs: MapObject[] = [bridge('a', true), bridge('b', false), bridge('c', true)];
  it('marks burned bridges that are not pending', () => {
    expect(burnedBridgeMask(objs, { unburnedBridges: {} })).toBe(0b101);
    expect(burnedBridgeMask(objs, { unburnedBridges: { c: [] } })).toBe(0b001);
    expect([...burnedBridgeIds(objs, 0b101)].sort()).toEqual(['a', 'c']);
  });
  it('is stable while nothing burns', () => {
    expect(burnedBridgeMask([bridge('a', false)], { unburnedBridges: {} })).toBe(0);
  });
});

describe('era desaturation bake', () => {
  it('bakes only once the transition settled', () => {
    expect(bakedDesat(0.5, 0.3)).toBe(0);
    expect(bakedDesat(1, 0.45)).toBe(0.45);
    expect(bakedDesat(1, 0)).toBe(0);
  });
});

describe('walls and tables', () => {
  const g = (rows: string[]): Terrain[][] => rows.map((r) => [...r].map((c) => (c === '#' ? 'wall' : c === 't' ? 'table' : 'floor')));
  it('shows a face only above open ground inside the map', () => {
    const b = g(['###', '#.#', '###']);
    expect(wallHasFace(b, 1, 0)).toBe(true);
    expect(wallHasFace(b, 0, 0)).toBe(false);
    expect(wallHasFace(b, 1, 2)).toBe(false); // bottom row: south is off-map
    expect(wallHasFace(b, 1, 1)).toBe(false); // not a wall
  });
  it('merges adjacent tables into runs along their long axis', () => {
    const b = g(['.ttt.', '.....', '.t...', '.t...', '...t.']);
    const tt = tableTiles(b);
    const at = (x: number, y: number) => tt.find((t) => t.x === x && t.y === y)!;
    expect(at(1, 0)).toMatchObject({ axis: 'ew', start: true, end: false });
    expect(at(2, 0)).toMatchObject({ axis: 'ew', start: false, end: false });
    expect(at(3, 0)).toMatchObject({ axis: 'ew', start: false, end: true });
    expect(at(1, 2)).toMatchObject({ axis: 'ns', start: true, end: false });
    expect(at(1, 3)).toMatchObject({ axis: 'ns', start: false, end: true });
    expect(at(3, 4)).toMatchObject({ axis: 'ew', start: true, end: true });
  });
});

describe('decor plan (derived from terrain and zones)', () => {
  const s = buildSites(createGame(scenario()).map, 'ws1Test');
  const plan = decorPlan(s);
  it('runs the throne carpet below the dais centre columns to the hall edge', () => {
    expect(plan.carpet).toEqual({ x0: 2, x1: 3, y0: 2, y1: 2 });
    expect(plan.throneBack).toEqual({ x0: 2, x1: 3, y: 0 });
  });
  it('centres the Wellspring rune ring on its rite dais', () => {
    expect(plan.runeRing).toEqual({ cx: 4, cy: 5.5, zone: 'wellspringHall' });
  });
  it('treats in-hall water as pool and every floor material as paintable', () => {
    expect(s.material[4]![5]).toBe('pool');
    for (const row of s.material) for (const m of row) expect(hasFloorPainter(m)).toBe(m !== 'wall' && m !== 'canal' && m !== 'pool');
  });

  it('holds on the prologue map without coordinates', () => {
    const ps = buildSites(createGame(prologueScenario).map, 'prologue');
    const pp = decorPlan(ps);
    expect(pp.carpet).not.toBeNull();
    for (let y = pp.carpet!.y0; y <= pp.carpet!.y1; y++) expect(ps.zone[y]![pp.carpet!.x0]).toBe('throneHall');
    expect(pp.banners.length).toBeGreaterThan(0);
    expect(pp.banners.length).toBeLessThanOrEqual(4);
    for (const b of [...pp.banners, ...pp.shelves]) expect(wallHasFace(ps.base, b.x, b.y)).toBe(true);
    const lanterns = new Set(ps.lanterns.map((l) => `${l.x},${l.y}`));
    for (const b of [...pp.banners, ...pp.shelves]) expect(lanterns.has(`${b.x},${b.y}`)).toBe(false);
    for (const r of pp.ropes) expect(ps.passable[r.coil.y]![r.coil.x]).toBe(true);
  });
});

describe('water helpers', () => {
  it('keeps ripple alpha in the spec band', () => {
    for (let t = 0; t < 5000; t += 137) {
      const a = rippleAlpha(t, 1.3);
      expect(a).toBeGreaterThanOrEqual(0.45 - 1e-9);
      expect(a).toBeLessThanOrEqual(0.95 + 1e-9);
    }
  });
  it('wraps the drift offset into the strip', () => {
    expect(rippleOffset(0, 46, 460)).toBe(0);
    expect(rippleOffset(2600, 46, 460)).toBeCloseTo(46);
    const o = rippleOffset(123456, 46, 460);
    expect(o).toBeGreaterThanOrEqual(0);
    expect(o).toBeLessThan(460);
  });
  it('hides water under intact or pending-burn bridges', () => {
    const objs: MapObject[] = [bridge('a', true), bridge('b', false)];
    expect(waterVisible(null, objs, {})).toBe(true);
    expect(waterVisible('a', objs, {})).toBe(true);
    expect(waterVisible('a', objs, { a: [] })).toBe(false);
    expect(waterVisible('b', objs, {})).toBe(false);
  });
});

describe('object states', () => {
  it('stages barred doors by displayed HP', () => {
    expect(doorStage(18, 18, false, false)).toBe('intact');
    expect(doorStage(12, 18, false, false)).toBe('cracked');
    expect(doorStage(8, 18, false, false)).toBe('damaged');
    expect(doorStage(0, 18, true, false)).toBe('broken');
    expect(doorStage(3, 18, true, true)).toBe('damaged'); // pending destruction still shows the door
    expect([crackCount(10, 10), crackCount(7, 10), crackCount(4, 10), crackCount(1, 10)]).toEqual([0, 1, 2, 3]);
  });
  it('raises a portcullis during its wave arrival only', () => {
    const gate = { id: 'g', wave: 'w', open: true };
    const arrive = (waveId: string, progress: number) => ({ step: { kind: 'arrive', event: { type: 'reinforcementsArrived', waveId } }, progress });
    expect(gateRise({ ...gate, open: false }, {}, null)).toBe(0);
    expect(gateRise(gate, { g: 'w' }, null)).toBe(0);
    expect(gateRise(gate, {}, null)).toBe(1);
    expect(gateRise(gate, {}, arrive('w', 0))).toBe(0);
    const mid = gateRise(gate, {}, arrive('w', 0.25));
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
    expect(gateRise(gate, {}, arrive('w', 0.6))).toBe(1);
    expect(gateRise(gate, {}, arrive('other', 0.1))).toBe(1);
  });
});
