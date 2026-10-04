// Gates (portcullis objects): closed, their tiles block movement, standing and
// spawning; they open for good when their wave arrives, right before its units
// are placed, so the wave may spawn on the gate tiles.
import { describe, expect, it } from 'vitest';
import {
  attackableTargets,
  closedGateAt,
  createGame,
  findObject,
  findSpawnTile,
  getLegalActions,
  isStandable,
  lineOfSight,
  pathCost,
  reachableTiles,
  type GameState,
  type ScenarioDef,
  type UnitPlacement,
  type WaveDef,
} from '../../src/engine';
import { buildGrid, idx } from '../../src/ai/grid';
import { runAiPhase } from '../../src/ai';
import { advanceTo, eventsOf, loyal, mutate, play, rebel, unit } from './helpers';

//            x: 0123456
const MAP = [
  '.......', // 0
  '.......', // 1
  '#.....#', // 2
  '##...##', // 3  gate over (2,3) (3,3) (4,3)
  '.......', // 4
];

const WAVES: WaveDef[] = [
  {
    id: 'knights',
    bell: 'secondBell',
    spawnTiles: [[2, 3], [3, 3], [4, 3]],
    units: [
      { id: 'k1', faction: 'loyalist', rank: 'kindled' },
      { id: 'k2', faction: 'loyalist', rank: 'kindled' },
      { id: 'k3', faction: 'loyalist', rank: 'radiant' },
    ],
  },
  // An earlier wave that would like to stand on the gate: it must go elsewhere.
  { id: 'watch', bell: 'firstBell', spawnTiles: [[3, 3]], units: [{ id: 'w1', faction: 'loyalist', rank: 'soldier' }] },
];

function def(extra: Partial<ScenarioDef> = {}): ScenarioDef {
  return {
    id: 'gates',
    name: 'Gates',
    playerFaction: 'rebel',
    seed: 7,
    map: MAP,
    units: [rebel('r', 'kindled', [3, 4], { stats: { move: 6 } }), loyal('l', 'soldier', [0, 0])],
    objects: [{ id: 'portcullis', kind: 'gate', tiles: [[2, 3], [3, 3], [4, 3]], wave: 'knights' }],
    waves: WAVES,
    ...extra,
  };
}

const make = (extra: Partial<ScenarioDef> = {}, units?: UnitPlacement[]): GameState =>
  createGame({ ...def(extra), ...(units ? { units } : {}) });

const gateOpen = (s: GameState): boolean => {
  const g = findObject(s, 'portcullis');
  if (!g || g.kind !== 'gate') throw new Error('portcullis');
  return g.open;
};

describe('a closed gate', () => {
  const s = make();

  it('is built closed, with its tiles sorted', () => {
    expect(findObject(s, 'portcullis')).toEqual({
      id: 'portcullis',
      kind: 'gate',
      tiles: [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }],
      wave: 'knights',
      open: false,
    });
    expect(closedGateAt(s, { x: 3, y: 3 })?.id).toBe('portcullis');
    expect(closedGateAt(s, { x: 3, y: 2 })).toBeUndefined();
  });

  it('blocks movement: nothing reaches or crosses its tiles', () => {
    // The gate is the only way between rows 0..2 and row 4.
    expect(reachableTiles(s, 'r').some((t) => t.y < 4)).toBe(false);
    expect(pathCost(s, 'r', { x: 3, y: 3 }, { ignoreMoveLimit: true })).toBeNull();
    expect(pathCost(s, 'r', { x: 3, y: 1 }, { ignoreMoveLimit: true, ignoreUnits: true })).toBeNull();
    expect(getLegalActions(s, 'r').some((a) => a.kind === 'move' && a.to.y < 4)).toBe(false);
  });

  it('is not standable, so spawning skips it', () => {
    expect(isStandable(s, { x: 3, y: 3 })).toBe(false);
    expect(isStandable(s, { x: 3, y: 2 })).toBe(true);
    // BFS from a gate tile lands on the nearest open tile (N first: (3,2)).
    expect(findSpawnTile(s, { x: 3, y: 3 })).toEqual({ x: 3, y: 2 });
  });

  it('is a wall for the AI grid too', () => {
    const g = buildGrid(s);
    expect(g.cost[idx(g, { x: 3, y: 3 })]).toBe(-1);
    expect(g.cost[idx(g, { x: 3, y: 2 })]).toBe(1);
  });

  it('does not block line of sight and cannot be attacked', () => {
    expect(lineOfSight(s, { x: 3, y: 4 }, { x: 3, y: 1 })).toBe(true);
    const archer = make({}, [rebel('a', 'radiant', [3, 4]), loyal('l', 'soldier', [3, 1])]);
    expect(attackableTargets(archer, 'a').map((t) => t.id)).toEqual(['l']);
  });

  it('keeps the AI side out too while closed', () => {
    // A guard right behind the portcullis, a rebel right in front of it: no way through.
    const t = make({}, [rebel('r', 'kindled', [3, 4]), loyal('l', 'kindled', [3, 2])]);
    const ai = play(t, { kind: 'endTurn' }).state;
    expect(getLegalActions(ai, 'l').some((a) => a.kind === 'move' && a.to.y >= 3)).toBe(false);
    const r = runAiPhase(ai);
    expect(unit(r.state, 'l').pos.y).toBeLessThan(3);
    expect(unit(r.state, 'r').hp).toBe(unit(t, 'r').hp);
  });
});

describe('opening on wave arrival', () => {
  const s = make();

  it('stays closed until its wave arrives, other waves do not open it', () => {
    const r5 = advanceTo(s, 5);
    expect(eventsOf(r5.events, 'reinforcementsArrived').map((e) => e.waveId)).toEqual(['watch']);
    expect(gateOpen(r5.state)).toBe(false);
    // The First Bell watchman wanted (3,3) but the closed gate sent him to (3,2).
    expect(unit(r5.state, 'w1').pos).toEqual({ x: 3, y: 2 });
    expect(gateOpen(advanceTo(s, 8).state)).toBe(false);
  });

  it('opens at the Second Bell and the wave spawns on the gate tiles', () => {
    const r9 = advanceTo(s, 9);
    expect(gateOpen(r9.state)).toBe(true);
    const arrived = eventsOf(r9.events, 'reinforcementsArrived').find((e) => e.waveId === 'knights')!;
    expect(arrived.units).toEqual([
      { unitId: 'k1', pos: { x: 2, y: 3 } },
      { unitId: 'k2', pos: { x: 3, y: 3 } },
      { unitId: 'k3', pos: { x: 4, y: 3 } },
    ]);
    expect(arrived.blocked).toEqual([]);
    // No dedicated event: the UI keys the portcullis off this wave's reinforcementsArrived.
    expect(r9.events.some((e) => (e.type as string).includes('gate'))).toBe(false);
    expect(closedGateAt(r9.state, { x: 3, y: 3 })).toBeUndefined();
  });

  it('once open, its tiles are ordinary ground', () => {
    const r9 = advanceTo(s, 9).state;
    const cleared = mutate(r9, (x) => {
      x.units = x.units.filter((u) => !u.id.startsWith('k'));
    });
    expect(isStandable(cleared, { x: 3, y: 3 })).toBe(true);
    expect(pathCost(cleared, 'r', { x: 3, y: 1 }, { ignoreMoveLimit: true, ignoreUnits: true })).toBe(3);
    expect(buildGrid(cleared).cost[idx(buildGrid(cleared), { x: 3, y: 3 })]).toBe(1);
  });

  it('follows the wave when the bridges delay it', () => {
    const late = mutate(s, (x) => {
      x.modifiers.bridgesBurned = true;
    });
    expect(gateOpen(advanceTo(late, 10).state)).toBe(false);
    expect(gateOpen(advanceTo(late, 11).state)).toBe(true);
  });
});
