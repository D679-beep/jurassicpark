import { describe, expect, it } from 'vitest';
import {
  createGame,
  findObject,
  isInZone,
  RANK_STATS,
  ScenarioValidationError,
  zoneTiles,
  zonesAt,
  type ScenarioDef,
} from '../../src/engine';
import { miniPrologue } from './fixtures/miniPrologue';
import { floor, loyal, rebel, scenario, unit } from './helpers';

function issuesOf(def: ScenarioDef): string[] {
  try {
    createGame(def);
  } catch (e) {
    expect(e).toBeInstanceOf(ScenarioValidationError);
    return (e as ScenarioValidationError).issues;
  }
  throw new Error('expected createGame to throw');
}

describe('createGame: fixture', () => {
  const s = createGame(miniPrologue());

  it('builds the map, zones, objects and exits', () => {
    expect(s.map.width).toBe(22);
    expect(s.map.height).toBe(12);
    expect(s.map.terrain[1]?.[3]).toBe('throne');
    expect(s.map.terrain[6]?.[6]).toBe('bridge');
    expect(s.map.terrain[2]?.[17]).toBe('dais');
    expect(zoneTiles(s, 'throneHall')).toHaveLength(15);
    expect(zoneTiles(s, 'innerGate')).toEqual([
      { x: 18, y: 5 },
      { x: 19, y: 5 },
      { x: 20, y: 5 },
      { x: 20, y: 7 },
    ]);
    expect(isInZone(s, { x: 21, y: 2 }, 'servantsTunnel')).toBe(true);
    expect(zonesAt(s, { x: 3, y: 1 })).toEqual(['throneHall']);
    expect(findObject(s, 'throneDoor')).toMatchObject({ kind: 'door', hp: 8, maxHp: 8, destroyed: false });
    expect(findObject(s, 'anchorA')).toMatchObject({ kind: 'anchor', hp: 12 });
    expect(findObject(s, 'westBridge')).toMatchObject({ kind: 'bridge', tags: ['barracksRoute'], burned: false });
    expect(s.map.exits.map((e) => e.id)).toEqual(['towerExit', 'tunnelExit']);
  });

  it('applies rank baselines, character domains and statuses', () => {
    expect(unit(s, 'wolf1')).toMatchObject({ hp: 10, maxHp: 10, atk: 4, def: 1, move: 4, range: { min: 1, max: 1 } });
    expect(unit(s, 'kaela')).toMatchObject({ hp: 16, atk: 6, def: 2, move: 5 });
    expect(unit(s, 'archer').range).toEqual({ min: 1, max: 3 });
    expect(unit(s, 'varek')).toMatchObject({ hp: 40, atk: 10, def: 4, move: 5, range: { min: 1, max: 2 }, domain: 'tempest' });
    expect(unit(s, 'grimm').domain).toBe('pyre');
    expect(unit(s, 'orsa').domain).toBe('bulwark');
    expect(unit(s, 'elian').domain).toBe('sanctuary');
    expect(unit(s, 'elian').statuses).toEqual(['sealed']);
    expect(unit(s, 'kaela').domain).toBeNull();
    expect(s.duel).toEqual({ unitIds: ['grimm', 'orsa'], active: true });
  });

  it('starts at round 1, player phase, with the default bells and every objective', () => {
    expect(s.round).toBe(1);
    expect(s.phase).toBe('player');
    expect(s.activeFaction).toBe('rebel');
    expect(s.aiFaction).toBe('loyalist');
    expect(s.bells.map((b) => [b.id, b.round, b.rung])).toEqual([
      ['firstBell', 5, false],
      ['secondBell', 9, false],
      ['dawn', 13, false],
    ]);
    expect(s.objectives.map((o) => [o.id, o.type, o.status])).toEqual([
      ['killEmperor', 'required', 'pending'],
      ['killElian', 'optional', 'pending'],
      ['imprisonMira', 'optional', 'pending'],
      ['seizeBellTower', 'bonus', 'pending'],
      ['burnBridges', 'bonus', 'pending'],
    ]);
    expect(s.outcome).toEqual({ emperorKilled: false, elianOutcome: 'alive', miraOutcome: 'free' });
    expect(s.gameOver).toBe(false);
    expect(s.result).toBeNull();
  });

  it('resolves wave units to their spawn tiles', () => {
    const w = s.waves[0]!;
    expect(w.units.map((u) => u.pos)).toEqual([
      { x: 20, y: 5 },
      { x: 20, y: 7 },
      { x: 20, y: 5 },
    ]);
    expect(w.units[0]).toMatchObject({ faction: 'loyalist', rank: 'soldier', hp: 10 });
  });

  it('is plain JSON-serializable data', () => {
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('stores the seed and RNG state', () => {
    expect(s.seed).toBe(1234);
    expect(s.rng).toBe(1234);
  });
});

describe('createGame: authoring formats', () => {
  it('accepts stat overrides per unit', () => {
    const s = createGame(
      scenario(floor(3, 1), [rebel('a', 'soldier', [0, 0], { stats: { atk: 9, maxHp: 30, move: 2, rangeMax: 2 } })]),
    );
    expect(unit(s, 'a')).toMatchObject({ atk: 9, hp: 30, maxHp: 30, move: 2, def: RANK_STATS.soldier.def, range: { min: 1, max: 2 } });
  });

  it('treats stats.hp alone as the unit\'s HP (current and max); hp + maxHp starts it wounded', () => {
    const s = createGame(
      scenario(floor(3, 1), [rebel('a', 'kindled', [0, 0], { stats: { hp: 30 } }), rebel('b', 'kindled', [1, 0], { stats: { hp: 5, maxHp: 16 } })]),
    );
    expect(unit(s, 'a')).toMatchObject({ hp: 30, maxHp: 30 });
    expect(unit(s, 'b')).toMatchObject({ hp: 5, maxHp: 16 });
  });

  it('merges a custom legend over the default one', () => {
    const s = createGame(scenario(['.R#'], [rebel('a', 'soldier', [0, 0])], { legend: { R: 'rubble' } }));
    expect(s.map.terrain[0]).toEqual(['floor', 'rubble', 'wall']);
  });

  it('accepts zones as rect, rects + tiles, with tuple or object positions', () => {
    const s = createGame(
      scenario(floor(5, 5), [rebel('a', 'soldier', { x: 0, y: 0 })], {
        zones: {
          a: { x: 0, y: 0, w: 2, h: 2 },
          b: { rects: [{ x: 3, y: 3, w: 1, h: 1 }], tiles: [[4, 4], { x: 3, y: 3 }] },
        },
      }),
    );
    expect(zoneTiles(s, 'a')).toHaveLength(4);
    expect(zoneTiles(s, 'b')).toEqual([
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);
  });

  it('auto-creates burnable single-tile bridges for undeclared bridge terrain', () => {
    const s = createGame(scenario(['.=.'], [rebel('a', 'soldier', [0, 0])]));
    expect(findObject(s, 'bridge@1,0')).toMatchObject({ kind: 'bridge', tiles: [{ x: 1, y: 0 }] });
  });

  it('overrides bell rounds', () => {
    const s = createGame(scenario(floor(2, 1), [rebel('a', 'soldier', [0, 0])], { bells: { firstBell: 2, secondBell: 3, dawn: 4 } }));
    expect(s.bells.map((b) => b.round)).toEqual([2, 3, 4]);
  });

  it('includes only objectives whose prerequisites exist by default', () => {
    const s = createGame(scenario(floor(2, 1), [rebel('a', 'soldier', [0, 0])]));
    expect(s.objectives).toEqual([]);
  });

  it('accepts an explicit objective list', () => {
    const s = createGame({ ...miniPrologue(), objectives: ['killEmperor', 'burnBridges'] });
    expect(s.objectives.map((o) => o.id)).toEqual(['killEmperor', 'burnBridges']);
  });

  it('allows the loyalists to be the player faction', () => {
    const s = createGame({ ...miniPrologue(), playerFaction: 'loyalist' });
    expect(s.activeFaction).toBe('loyalist');
    expect(s.aiFaction).toBe('rebel');
  });
});

describe('createGame: validation', () => {
  const ok = (): ScenarioDef => scenario(floor(4, 3), [rebel('a', 'soldier', [0, 0]), loyal('b', 'soldier', [3, 2])]);

  it('throws ScenarioValidationError with a readable message', () => {
    expect(() => createGame({ ...ok(), map: ['....', '..'] })).toThrow(ScenarioValidationError);
    expect(() => createGame({ ...ok(), map: ['....', '..'] })).toThrow(/map row 1 has length 2, expected 4/);
  });

  it('reports ragged rows, unknown chars and empty maps', () => {
    expect(issuesOf({ ...ok(), map: ['....', '...', '....'] })).toContain('map row 1 has length 3, expected 4');
    expect(issuesOf({ ...ok(), map: ['..?.', '....', '....'] })).toContain('map char "?" at (2,0) is not in the legend');
    expect(issuesOf({ ...ok(), map: [] })[0]).toMatch(/at least one row/);
  });

  it('reports bad legend entries', () => {
    expect(issuesOf({ ...ok(), legend: { X: 'lava' as never } }).join()).toMatch(/unknown terrain "lava"/);
  });

  it('reports bad unit placement', () => {
    const map = ['.#..', '....', '....'];
    expect(issuesOf(scenario(map, [rebel('a', 'soldier', [9, 0])])).join()).toMatch(/outside the map/);
    expect(issuesOf(scenario(map, [rebel('a', 'soldier', [1, 0])])).join()).toMatch(/impassable terrain \(wall\)/);
    expect(issuesOf(scenario(map, [rebel('a', 'soldier', [0, 0]), rebel('b', 'soldier', [0, 0])])).join()).toMatch(/already occupied/);
    expect(issuesOf(scenario(map, [{ id: 'a', faction: 'rebel', rank: 'soldier' }])).join()).toMatch(/pos is required/);
  });

  it('reports duplicate ids across units and objects', () => {
    const def = scenario(['.+.'], [rebel('x', 'soldier', [0, 0])], { objects: [{ id: 'x', kind: 'door', pos: [1, 0] }] });
    expect(issuesOf(def).join()).toMatch(/duplicate id "x"/);
  });

  it('reports bad rank, faction, character, status and stats', () => {
    expect(issuesOf(scenario(floor(3, 1), [{ id: 'a', faction: 'rebel', rank: 'king' as never, pos: [0, 0] }])).join()).toMatch(/rank must be one of/);
    expect(issuesOf(scenario(floor(3, 1), [{ id: 'a', faction: 'pirate' as never, rank: 'soldier', pos: [0, 0] }])).join()).toMatch(/faction must be one of/);
    expect(
      issuesOf(scenario(floor(3, 1), [rebel('a', 'soldier', [0, 0], { character: 'kaela' }), rebel('b', 'soldier', [1, 0], { character: 'kaela' })])).join(),
    ).toMatch(/placed more than once/);
    expect(issuesOf(scenario(floor(3, 1), [rebel('a', 'soldier', [0, 0], { statuses: ['asleep' as never] })])).join()).toMatch(/unknown status/);
    expect(issuesOf(scenario(floor(3, 1), [rebel('a', 'soldier', [0, 0], { stats: { hp: 0 } })])).join()).toMatch(/hp must be/);
    expect(issuesOf(scenario(floor(3, 1), [rebel('a', 'soldier', [0, 0], { stats: { rangeMin: 3, rangeMax: 2 } })])).join()).toMatch(/rangeMax/);
  });

  it('rejects a Domain on a non-Ascendant', () => {
    expect(issuesOf(scenario(floor(3, 1), [rebel('a', 'kindled', [0, 0], { domain: 'pyre' })])).join()).toMatch(/only Ascendants/);
  });

  it('rejects misplaced objects', () => {
    const map = ['.+=.'];
    const u = [rebel('a', 'soldier', [0, 0])];
    expect(issuesOf(scenario(map, u, { objects: [{ id: 'd', kind: 'door', pos: [0, 0] }] })).join()).toMatch(/must be on door terrain/);
    expect(issuesOf(scenario(map, u, { objects: [{ id: 'b', kind: 'bridge', tiles: [[3, 0]] }] })).join()).toMatch(/must be bridge terrain/);
    expect(issuesOf(scenario(['.#'], u, { objects: [{ id: 'w', kind: 'anchor', pos: [1, 0] }] })).join()).toMatch(/passable terrain/);
    expect(issuesOf(scenario(map, [rebel('a', 'soldier', [1, 0])], { objects: [{ id: 'd', kind: 'door', pos: [1, 0] }] })).join()).toMatch(
      /holds a barred door/,
    );
  });

  it('rejects a bad bell schedule', () => {
    expect(issuesOf({ ...ok(), bells: { secondBell: 4 } }).join()).toMatch(/strictly increasing/);
    expect(issuesOf({ ...ok(), bells: { firstBell: 1 } }).join()).toMatch(/>= 2/);
  });

  it('rejects bad waves', () => {
    const w = (extra: object) => ({ ...ok(), waves: [{ id: 'w', bell: 'firstBell', spawnTiles: [[1, 1]], units: [{ id: 'r', faction: 'loyalist', rank: 'soldier' }], ...extra }] }) as ScenarioDef;
    expect(issuesOf(w({ bell: 'noon' })).join()).toMatch(/unknown bell "noon"/);
    expect(issuesOf(w({ spawnTiles: [] })).join()).toMatch(/at least one spawn tile/);
    expect(issuesOf(w({ units: [] })).join()).toMatch(/at least one unit/);
    expect(issuesOf(w({ delay: -1 })).join()).toMatch(/delay/);
  });

  it('rejects bad exits and guard zones', () => {
    expect(issuesOf({ ...ok(), exits: [{ id: 'e', tiles: [[9, 9]] }] }).join()).toMatch(/outside/);
    expect(issuesOf({ ...ok(), exits: [{ id: 'e', tiles: [[1, 1]], zone: 'nowhere' }] }).join()).toMatch(/zone "nowhere"/);
    expect(issuesOf(scenario(floor(3, 1), [rebel('a', 'soldier', [0, 0], { guardZone: 'nowhere' })])).join()).toMatch(/guardZone/);
  });

  it('validates the Feast Hall duel setup', () => {
    const one = scenario(floor(4, 1), [rebel('a', 'ascendant', [0, 0], { statuses: ['dueling'] })], { zones: { feastHall: { x: 0, y: 0, w: 4, h: 1 } } });
    expect(issuesOf(one).join()).toMatch(/exactly two units may start dueling/);
    const noHall = scenario(floor(4, 1), [
      rebel('a', 'ascendant', [0, 0], { statuses: ['dueling'] }),
      loyal('b', 'ascendant', [1, 0], { statuses: ['dueling'] }),
    ]);
    expect(issuesOf(noHall).join()).toMatch(/feastHall/);
  });

  it('requires Halden to have noResist', () => {
    expect(issuesOf(scenario(floor(3, 1), [loyal('h', 'soldier', [0, 0], { character: 'halden' })])).join()).toMatch(/noResist/);
  });

  it('rejects objectives without prerequisites, and unknown ones', () => {
    expect(issuesOf({ ...ok(), objectives: ['killElian'] }).join()).toMatch(/requires character "elian"/);
    expect(issuesOf({ ...ok(), objectives: ['burnBridges'] }).join()).toMatch(/barracksRoute/);
    expect(issuesOf({ ...ok(), objectives: ['win' as never] }).join()).toMatch(/unknown objective/);
  });

  it('rejects unknown dialogue triggers and malformed seeds', () => {
    expect(issuesOf({ ...ok(), dialogue: { lunch: [] } as never }).join()).toMatch(/unknown trigger "lunch"/);
    expect(issuesOf({ ...ok(), seed: 1.5 }).join()).toMatch(/seed must be an integer/);
  });

  it('collects every issue instead of stopping at the first', () => {
    const issues = issuesOf({ ...ok(), seed: Number.NaN, playerFaction: 'x' as never, bells: { dawn: 3 } });
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});
