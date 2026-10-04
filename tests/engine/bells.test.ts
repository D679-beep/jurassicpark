import { describe, expect, it } from 'vitest';
import {
  applyAction,
  findSpawnTile,
  getLegalActions,
  getNextBell,
  getObjective,
  roundsUntilNextBell,
  upcomingWaves,
  waveArrivalRound,
  type GameState,
  type ScenarioDef,
  type WaveDef,
} from '../../src/engine';
import { advanceTo, eventsOf, floor, game, loyal, mutate, nextRound, play, rebel, scenario, unit } from './helpers';
import { createGame } from '../../src/engine';

const MAP = [
  '..........', // 0
  '~=~~~=~~=~', // 1  bridges (1,1) (5,1) route; (8,1) not
  '..........', // 2
  '..........', // 3
];

const WAVES: WaveDef[] = [
  { id: 'watch', bell: 'firstBell', spawnTiles: [[9, 0]], units: [{ id: 'w1', faction: 'loyalist', rank: 'soldier' }] },
  {
    id: 'lantern',
    bell: 'secondBell',
    spawnTiles: [[4, 3]],
    units: [
      { id: 'k1', faction: 'loyalist', rank: 'kindled' },
      { id: 'k2', faction: 'loyalist', rank: 'radiant' },
    ],
  },
  { id: 'legion', bell: 'dawn', spawnTiles: [[0, 2]], units: [{ id: 'g1', faction: 'loyalist', rank: 'soldier' }] },
];

function def(extra: Partial<ScenarioDef> = {}): ScenarioDef {
  return scenario(MAP, [rebel('r', 'soldier', [1, 0]), rebel('r2', 'soldier', [5, 2]), loyal('l', 'soldier', [0, 3])], {
    zones: { bellTower: { x: 7, y: 2, w: 3, h: 2 } },
    objects: [
      { id: 'west', kind: 'bridge', tiles: [[1, 1]], tags: ['barracksRoute'] },
      { id: 'mid', kind: 'bridge', tiles: [[5, 1]], tags: ['barracksRoute'] },
      { id: 'north', kind: 'bridge', tiles: [[8, 1]] },
    ],
    waves: WAVES,
    ...extra,
  });
}

const bellRounds = (s: GameState) => s.bells.map((b) => b.round);

describe('bell schedule', () => {
  const s = createGame(def());

  it('defaults to First Bell 5, Second Bell 9, Dawn 13', () => {
    expect(bellRounds(s)).toEqual([5, 9, 13]);
    expect(getNextBell(s)).toEqual({ id: 'firstBell', name: 'First Bell', round: 5, roundsRemaining: 4 });
    expect(roundsUntilNextBell(s)).toBe(4);
  });

  it('counts down as rounds pass', () => {
    expect(getNextBell(advanceTo(s, 3).state)!.roundsRemaining).toBe(2);
    const r5 = advanceTo(s, 5).state;
    expect(getNextBell(r5)).toMatchObject({ id: 'secondBell', round: 9, roundsRemaining: 4 });
  });

  it('rings each bell at the start of its round, then spawns its wave', () => {
    const r4 = advanceTo(s, 4).state;
    const { state, events } = nextRound(r4);
    expect(state.round).toBe(5);
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf('phaseStarted')).toBeLessThan(kinds.indexOf('bellRang'));
    expect(kinds.indexOf('bellRang')).toBeLessThan(kinds.indexOf('reinforcementsArrived'));
    expect(eventsOf(events, 'bellRang')).toEqual([{ type: 'bellRang', bell: 'firstBell', name: 'First Bell', round: 5 }]);
    expect(eventsOf(events, 'reinforcementsArrived')).toEqual([
      { type: 'reinforcementsArrived', waveId: 'watch', name: 'watch', bell: 'firstBell', units: [{ unitId: 'w1', pos: { x: 9, y: 0 } }], blocked: [] },
    ]);
    expect(unit(state, 'w1')).toMatchObject({ faction: 'loyalist', pos: { x: 9, y: 0 }, hasMoved: false, hasActed: false });
    expect(state.bells[0]!.rung).toBe(true);
    expect(state.waves[0]).toMatchObject({ spawned: true, arrivedRound: 5 });
    // The AI acts with the new units in its phase.
    const ai = play(state, { kind: 'endTurn' }).state;
    expect(getLegalActions(ai, 'w1').some((a) => a.kind === 'move')).toBe(true);
  });

  it('honours a per-wave delay', () => {
    const t = createGame(def({ waves: [{ ...WAVES[0]!, delay: 1 }] }));
    expect(advanceTo(t, 5).state.units.some((u) => u.id === 'w1')).toBe(false);
    expect(advanceTo(t, 6).state.units.some((u) => u.id === 'w1')).toBe(true);
  });

  it('lists upcoming waves', () => {
    expect(upcomingWaves(s).map((w) => [w.id, w.round, w.roundsRemaining, w.unitCount])).toEqual([
      ['watch', 5, 4, 1],
      ['lantern', 9, 8, 2],
      ['legion', 13, 12, 1],
    ]);
  });
});

describe('reinforcement spawning', () => {
  const base = (spawn: [number, number][], units: number, map = floor(8, 3)) =>
    game(map, [rebel('r', 'soldier', [4, 1]), loyal('l', 'soldier', [0, 0])], {
      bells: { firstBell: 2, secondBell: 3, dawn: 4 },
      waves: [{ id: 'w', bell: 'firstBell', spawnTiles: spawn, units: Array.from({ length: units }, (_, i) => ({ id: `s${i}`, faction: 'loyalist' as const, rank: 'soldier' as const })) }],
    });

  it('uses the nearest free tile when a spawn tile is occupied (BFS, N/E/S/W)', () => {
    const { state, events } = nextRound(base([[4, 1]], 3));
    expect(eventsOf(events, 'reinforcementsArrived')[0]!.units).toEqual([
      { unitId: 's0', pos: { x: 4, y: 0 } },
      { unitId: 's1', pos: { x: 5, y: 1 } },
      { unitId: 's2', pos: { x: 4, y: 2 } },
    ]);
    expect(state.units).toHaveLength(5);
  });

  it('cycles through the spawn tiles', () => {
    const { events } = nextRound(base([[7, 0], [7, 2]], 3));
    expect(eventsOf(events, 'reinforcementsArrived')[0]!.units.map((u) => u.pos)).toEqual([
      { x: 7, y: 0 },
      { x: 7, y: 2 },
      { x: 7, y: 1 },
    ]);
  });

  it('does not search through walls; reports units it cannot place', () => {
    const map = ['.#....', '##....', '......'];
    const s = game(map, [rebel('r', 'soldier', [0, 0]), loyal('l', 'soldier', [5, 2])], {
      bells: { firstBell: 2, secondBell: 3, dawn: 4 },
      waves: [{ id: 'w', bell: 'firstBell', spawnTiles: [[0, 0]], units: [{ id: 's0', faction: 'loyalist', rank: 'soldier' }] }],
    });
    expect(findSpawnTile(s, { x: 0, y: 0 })).toBeNull();
    const { state, events } = nextRound(s);
    expect(eventsOf(events, 'reinforcementsArrived')[0]).toMatchObject({ units: [], blocked: ['s0'] });
    expect(state.waves[0]!.spawned).toBe(true);
  });
});

describe('Seize the bell tower', () => {
  const inTower = mutate(createGame(def()), (s) => {
    unit(s, 'r2').pos = { x: 8, y: 2 };
  });

  it('delays every remaining bell by 2 when a rebel ends the player phase there unopposed', () => {
    const { state, events } = play(inTower, { kind: 'endTurn' });
    expect(bellRounds(state)).toEqual([7, 11, 15]);
    expect(state.bells.map((b) => b.baseRound)).toEqual([5, 9, 13]);
    expect(eventsOf(events, 'bellsDelayed')[0]).toEqual({
      type: 'bellsDelayed',
      reason: 'bellTower',
      amount: 2,
      bells: [
        { id: 'firstBell', round: 7 },
        { id: 'secondBell', round: 11 },
        { id: 'dawn', round: 15 },
      ],
      waves: [
        { id: 'watch', round: 7 },
        { id: 'lantern', round: 11 },
        { id: 'legion', round: 15 },
      ],
    });
    expect(eventsOf(events, 'objectiveCompleted')[0]).toMatchObject({ objectiveId: 'seizeBellTower' });
    expect(state.modifiers.bellTowerSeized).toBe(true);
    expect(advanceTo(state, 5).events.some((e) => e.type === 'bellRang')).toBe(false);
    const r7 = advanceTo(state, 7);
    expect(eventsOf(r7.events, 'bellRang').map((e) => [e.bell, e.round])).toEqual([['firstBell', 7]]);
    expect(r7.state.units.some((u) => u.id === 'w1')).toBe(true);
  });

  it('applies only once', () => {
    const later = advanceTo(play(inTower, { kind: 'endTurn' }).state, 3).state;
    expect(bellRounds(play(later, { kind: 'endTurn' }).state)).toEqual([7, 11, 15]);
  });

  it('only delays bells that have not rung', () => {
    const r6 = mutate(advanceTo(createGame(def()), 6).state, (s) => {
      unit(s, 'r2').pos = { x: 8, y: 2 };
    });
    expect(bellRounds(play(r6, { kind: 'endTurn' }).state)).toEqual([5, 11, 15]);
  });

  it('does nothing with a loyalist in the tower, or without a rebel there', () => {
    const contested = mutate(inTower, (s) => {
      unit(s, 'l').pos = { x: 9, y: 3 };
    });
    expect(bellRounds(play(contested, { kind: 'endTurn' }).state)).toEqual([5, 9, 13]);
    expect(bellRounds(play(createGame(def()), { kind: 'endTurn' }).state)).toEqual([5, 9, 13]);
  });

  it('is checked at the end of the rebel phase, not the loyalist phase', () => {
    const ai = play(createGame(def()), { kind: 'endTurn' }).state;
    const moved = mutate(ai, (s) => {
      unit(s, 'r2').pos = { x: 8, y: 2 };
    });
    expect(bellRounds(play(moved, { kind: 'endTurn' }).state)).toEqual([5, 9, 13]);
  });

  it('requires the objective to be in play', () => {
    const t = mutate(createGame(def({ objectives: ['burnBridges'] })), (s) => {
      unit(s, 'r2').pos = { x: 8, y: 2 };
    });
    expect(bellRounds(play(t, { kind: 'endTurn' }).state)).toEqual([5, 9, 13]);
  });
});

describe('Burn the canal bridges', () => {
  const s = createGame(def());
  const burnBoth = (st: GameState) =>
    play(
      st,
      { kind: 'interact', unitId: 'r', interaction: 'burnBridge', targetId: 'west' },
      { kind: 'interact', unitId: 'r2', interaction: 'burnBridge', targetId: 'mid' },
    );

  it('burning is an interaction available next to an unburned bridge', () => {
    expect(getLegalActions(s, 'r')).toContainEqual({ kind: 'interact', unitId: 'r', interaction: 'burnBridge', targetId: 'west' });
    expect(getLegalActions(s, 'r').some((a) => a.kind === 'interact' && a.targetId === 'mid')).toBe(false);
    const on = mutate(s, (x) => {
      unit(x, 'r').pos = { x: 1, y: 1 };
    });
    expect(getLegalActions(on, 'r').some((a) => a.kind === 'interact')).toBe(false);
  });

  it('turns the bridge into water and uses the action', () => {
    const { state, events } = play(s, { kind: 'interact', unitId: 'r', interaction: 'burnBridge', targetId: 'west' });
    expect(state.map.terrain[1]![1]).toBe('water');
    expect(unit(state, 'r').hasActed).toBe(true);
    expect(eventsOf(events, 'bridgeBurned')[0]).toEqual({ type: 'bridgeBurned', bridgeId: 'west', tiles: [{ x: 1, y: 1 }], byUnitId: 'r', cause: 'interact' });
    expect(() => applyAction(state, { kind: 'interact', unitId: 'r', interaction: 'burnBridge', targetId: 'west' })).toThrow(/cannot burnBridge/);
    expect(state.modifiers.bridgesBurned).toBe(false); // one route bridge left
  });

  it('delays the Second Bell wave (not the bell) by 2 once every barracksRoute bridge burns', () => {
    const { state, events } = burnBoth(s);
    expect(state.modifiers.bridgesBurned).toBe(true);
    expect(eventsOf(events, 'bellsDelayed')[0]).toEqual({ type: 'bellsDelayed', reason: 'bridges', amount: 2, bells: [], waves: [{ id: 'lantern', round: 11 }] });
    expect(getObjective(state, 'burnBridges')!.status).toBe('completed');
    expect(waveArrivalRound(state, state.waves[1]!)).toBe(11);
    expect(bellRounds(state)).toEqual([5, 9, 13]);
    const r9 = advanceTo(state, 9);
    expect(eventsOf(r9.events, 'bellRang').map((e) => e.bell)).toEqual(['firstBell', 'secondBell']);
    expect(r9.state.units.some((u) => u.id === 'k1')).toBe(false);
    const r11 = advanceTo(r9.state, 11);
    expect(eventsOf(r11.events, 'reinforcementsArrived').map((e) => e.waveId)).toEqual(['lantern']);
  });

  it('without every route bridge burned the wave comes on schedule', () => {
    const one = play(s, { kind: 'interact', unitId: 'r', interaction: 'burnBridge', targetId: 'west' }).state;
    expect(advanceTo(one, 9).state.units.some((u) => u.id === 'k1')).toBe(true);
  });

  it('stacks with the bell tower delay', () => {
    const both = mutate(burnBoth(s).state, (x) => {
      unit(x, 'r2').pos = { x: 8, y: 2 };
    });
    const st = play(both, { kind: 'endTurn' }).state;
    expect(bellRounds(st)).toEqual([7, 11, 15]);
    expect(waveArrivalRound(st, st.waves[1]!)).toBe(13);
  });

  it('has no effect after the Second Bell wave has arrived', () => {
    const late = advanceTo(s, 9).state;
    const st = burnBoth(late).state;
    expect(st.modifiers.bridgesBurned).toBe(true);
    expect(st.waves[1]).toMatchObject({ spawned: true, arrivedRound: 9 });
  });
});

describe('multi-tile bridges burn as one', () => {
  //        x: 0123456
  const map = [
    '.......', // 0
    '~~~=~~~', // 1  span (3,1)
    '~~===~~', // 2  landing deck (2,2) (3,2) (4,2)
    '.......', // 3
  ];
  const tiles: [number, number][] = [[3, 1], [2, 2], [3, 2], [4, 2]];
  const s = game(map, [rebel('r', 'soldier', [3, 3]), rebel('n', 'soldier', [3, 0]), rebel('on', 'soldier', [2, 2]), loyal('l', 'soldier', [6, 0])], {
    objects: [{ id: 'big', kind: 'bridge', tiles, tags: ['barracksRoute'] }],
  });

  it('is one object: no auto bridges for its tiles, and either bank can burn it', () => {
    expect(s.map.objects.filter((o) => o.kind === 'bridge').map((o) => o.id)).toEqual(['big']);
    const burn = { interaction: 'burnBridge', targetId: 'big' };
    expect(getLegalActions(s, 'r')).toContainEqual({ kind: 'interact', unitId: 'r', ...burn });
    expect(getLegalActions(s, 'n')).toContainEqual({ kind: 'interact', unitId: 'n', ...burn });
    // Standing on any of its tiles, you cannot burn it.
    expect(getLegalActions(s, 'on').some((a) => a.kind === 'interact')).toBe(false);
  });

  it('turns every tile to water in one action and completes the bonus', () => {
    const { state, events } = play(s, { kind: 'interact', unitId: 'n', interaction: 'burnBridge', targetId: 'big' });
    for (const [x, y] of tiles) expect(state.map.terrain[y]![x], `(${x},${y})`).toBe('water');
    expect(eventsOf(events, 'bridgeBurned')).toEqual([
      { type: 'bridgeBurned', bridgeId: 'big', tiles: [{ x: 3, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }], byUnitId: 'n', cause: 'interact' },
    ]);
    expect(state.modifiers.bridgesBurned).toBe(true);
    expect(getLegalActions(state, 'r').some((a) => a.kind === 'interact')).toBe(false);
  });

  it('burns whole when a Pyre touches only one of its tiles', () => {
    const p = game(map, [rebel('grimm', 'ascendant', [6, 3], { character: 'grimm' }), loyal('l', 'soldier', [0, 0])], {
      objects: [{ id: 'big', kind: 'bridge', tiles }],
    });
    // Only (4,2) is within 3 of (6,3).
    const { state, events } = play(p, { kind: 'domain', unitId: 'grimm' });
    expect(eventsOf(events, 'bridgeBurned')).toHaveLength(1);
    for (const [x, y] of tiles) expect(state.map.terrain[y]![x]).toBe('water');
  });
});
