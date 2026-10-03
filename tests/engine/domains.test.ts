import { describe, expect, it } from 'vitest';
import {
  activeDomainOf,
  applyAction,
  domainRoundsRemaining,
  domainTiles,
  domainUnavailableReason,
  effectiveStats,
  findObject,
  getLegalActions,
  IllegalActionError,
  previewDamage,
  reachableTiles,
  type GameState,
  type UnitPlacement,
} from '../../src/engine';
import { advanceTo, eventsOf, floor, game, loyal, mutate, nextRoll, nextRound, play, rebel, unit } from './helpers';

const MAP = floor(11, 11);
const tough = { stats: { hp: 50 } };

function hpOf(s: GameState, id: string): number {
  return unit(s, id).hp;
}

describe('Domain activation (Tempest)', () => {
  const units: UnitPlacement[] = [
    rebel('varek', 'ascendant', [5, 5], { character: 'varek' }),
    rebel('ally', 'soldier', [5, 6]),
    loyal('in3', 'soldier', [5, 2], tough), // distance 3: inside
    loyal('in2', 'soldier', [7, 5], tough),
    loyal('out4', 'soldier', [5, 1], tough), // distance 4: outside
    loyal('weak', 'soldier', [4, 5], { stats: { hp: 8 } }), // fixed 8: no +50% for Domain damage
  ];
  const s = game(MAP, units);

  it('is listed as a legal action for an Ascendant with a Domain', () => {
    expect(getLegalActions(s, 'varek')).toContainEqual({ kind: 'domain', unitId: 'varek' });
    expect(getLegalActions(s, 'ally').some((a) => a.kind === 'domain')).toBe(false);
  });

  it('deals 8 to every enemy inside the radius-3 diamond on activation', () => {
    const { state, events } = play(s, { kind: 'domain', unitId: 'varek' });
    expect(hpOf(state, 'in3')).toBe(42);
    expect(hpOf(state, 'in2')).toBe(42);
    expect(hpOf(state, 'out4')).toBe(50);
    expect(hpOf(state, 'ally')).toBe(10);
    expect(state.units.find((u) => u.id === 'weak')).toBeUndefined();
    const act = eventsOf(events, 'domainActivated')[0]!;
    expect(act).toMatchObject({ unitId: 'varek', domain: 'tempest', center: { x: 5, y: 5 }, radius: 3, expiresAtRound: 4 });
    expect(act.tiles).toHaveLength(25);
    expect(eventsOf(events, 'damaged').every((e) => e.cause === 'tempest' && e.roll === null)).toBe(true);
  });

  it('counts as the action, once per battle', () => {
    const { state } = play(s, { kind: 'domain', unitId: 'varek' });
    expect(unit(state, 'varek')).toMatchObject({ hasActed: true, domainUsed: true, hasMoved: false });
    expect(getLegalActions(state, 'varek').some((a) => a.kind === 'attack' || a.kind === 'domain')).toBe(false);
    expect(getLegalActions(state, 'varek').some((a) => a.kind === 'move')).toBe(true);
    const later = advanceTo(state, 6).state;
    expect(domainUnavailableReason(later, unit(later, 'varek'))).toMatch(/already used/);
    expect(() => applyAction(later, { kind: 'domain', unitId: 'varek' })).toThrow(IllegalActionError);
  });

  it('cannot be used after acting', () => {
    const acted = play(s, { kind: 'attack', unitId: 'varek', targetId: 'in2' }).state;
    expect(() => applyAction(acted, { kind: 'domain', unitId: 'varek' })).toThrow(/already acted/);
  });
});

describe('Domain duration, round-start ticks and Drained', () => {
  const s = game(MAP, [rebel('varek', 'ascendant', [5, 5], { character: 'varek' }), loyal('e', 'soldier', [5, 3], tough)]);
  const r1 = play(s, { kind: 'domain', unitId: 'varek' }).state; // round 1: 8 damage

  it('lasts rounds R, R+1, R+2 and ticks at the starts of R+1 and R+2 only', () => {
    expect(hpOf(r1, 'e')).toBe(42);
    expect(domainRoundsRemaining(r1, activeDomainOf(r1, 'varek')!)).toBe(3);
    const r2 = nextRound(r1);
    expect(r2.state.round).toBe(2);
    expect(hpOf(r2.state, 'e')).toBe(39);
    expect(eventsOf(r2.events, 'damaged')[0]).toMatchObject({ cause: 'tempest', amount: 3, sourceId: 'varek' });
    const r3 = nextRound(r2.state);
    expect(hpOf(r3.state, 'e')).toBe(36);
    expect(domainRoundsRemaining(r3.state, activeDomainOf(r3.state, 'varek')!)).toBe(1);
    const r4 = nextRound(r3.state);
    expect(hpOf(r4.state, 'e')).toBe(36); // expired before the tick
    expect(r4.state.domains).toEqual([]);
    expect(eventsOf(r4.events, 'domainEnded')[0]).toEqual({ type: 'domainEnded', unitId: 'varek', domain: 'tempest', reason: 'expired', drained: true });
  });

  it('leaves its owner Drained (-2 ATK, -1 move) for the rest of the battle', () => {
    const r4 = advanceTo(r1, 4).state;
    const v = unit(r4, 'varek');
    expect(v.statuses).toContain('drained');
    expect(effectiveStats(v)).toMatchObject({ atk: 8, move: 4 });
    expect(unit(advanceTo(r4, 8).state, 'varek').statuses).toContain('drained');
  });

  it('a Domain activated in the AI phase follows the same rule', () => {
    const t = game(MAP, [rebel('r', 'soldier', [5, 3], tough), loyal('storm', 'ascendant', [5, 5], { domain: 'tempest' })]);
    const a1 = play(t, { kind: 'endTurn' }, { kind: 'domain', unitId: 'storm' }).state;
    expect(activeDomainOf(a1, 'storm')).toMatchObject({ activatedRound: 1, expiresAtRound: 4 });
    expect(hpOf(a1, 'r')).toBe(42);
    expect(hpOf(advanceTo(a1, 3).state, 'r')).toBe(36);
    const r4 = advanceTo(a1, 4).state;
    expect(hpOf(r4, 'r')).toBe(36);
    expect(unit(r4, 'storm').statuses).toContain('drained');
  });

  it('moves with its owner', () => {
    const moved = play(r1, { kind: 'move', unitId: 'varek', to: { x: 5, y: 9 } }).state; // e now 6 away
    expect(domainTiles(moved, activeDomainOf(moved, 'varek')!)).toContainEqual({ x: 5, y: 9 });
    expect(hpOf(nextRound(moved).state, 'e')).toBe(42);
  });

  it('ends without Drain when its owner is removed', () => {
    const t = game(MAP, [rebel('varek', 'ascendant', [5, 5], { character: 'varek' }), loyal('orsa', 'ascendant', [5, 7], { character: 'orsa', stats: { hp: 1, maxHp: 40 } })]);
    const ai = play(t, { kind: 'endTurn' }, { kind: 'domain', unitId: 'orsa' }, { kind: 'endTurn' }).state;
    const { state, events } = play(ai, { kind: 'attack', unitId: 'varek', targetId: 'orsa' });
    expect(state.domains).toEqual([]);
    expect(eventsOf(events, 'domainEnded')[0]).toMatchObject({ unitId: 'orsa', reason: 'ownerRemoved', drained: false });
  });
});

describe('Pyre', () => {
  const map = ['...........', '...........', '.....=.....', '...........', '...........', '...........', '...........', '...........', '..........='];
  const s = game(map, [
    rebel('grimm', 'ascendant', [5, 5], { character: 'grimm' }),
    rebel('friend', 'soldier', [5, 6], tough),
    loyal('foe', 'soldier', [4, 4], tough),
    loyal('far', 'soldier', [0, 0], tough),
  ]);

  it('deals no damage on activation, then 4 to every other unit inside at each round start', () => {
    const a = play(s, { kind: 'domain', unitId: 'grimm' }).state;
    expect(hpOf(a, 'foe')).toBe(50);
    const r2 = nextRound(a).state;
    expect(hpOf(r2, 'foe')).toBe(46);
    expect(hpOf(r2, 'friend')).toBe(46);
    expect(hpOf(r2, 'grimm')).toBe(40);
    expect(hpOf(r2, 'far')).toBe(50);
    expect(hpOf(advanceTo(a, 4).state, 'foe')).toBe(42);
  });

  it('burns bridges inside it, including when its owner moves', () => {
    const { state, events } = play(s, { kind: 'domain', unitId: 'grimm' });
    expect(eventsOf(events, 'bridgeBurned')).toEqual([
      { type: 'bridgeBurned', bridgeId: 'bridge@5,2', tiles: [{ x: 5, y: 2 }], byUnitId: 'grimm', cause: 'pyre' },
    ]);
    expect(state.map.terrain[2]![5]).toBe('water');
    expect(findObject(state, 'bridge@10,8')).toMatchObject({ burned: false });
    const moved = play(state, { kind: 'move', unitId: 'grimm', to: { x: 8, y: 7 } });
    expect(eventsOf(moved.events, 'bridgeBurned')[0]).toMatchObject({ bridgeId: 'bridge@10,8', cause: 'pyre' });
    expect(moved.state.map.terrain[8]![10]).toBe('water');
  });
});

describe('Bulwark', () => {
  const units: UnitPlacement[] = [
    rebel('varek', 'ascendant', [5, 8], { character: 'varek' }),
    rebel('k', 'kindled', [5, 3]),
    loyal('orsa', 'ascendant', [5, 5], { character: 'orsa' }),
    loyal('guard', 'soldier', [5, 4], tough),
    loyal('outside', 'soldier', [9, 9], tough),
  ];
  // Orsa raises Bulwark in the AI phase of round 1; round 2 begins.
  const s = play(game(MAP, units), { kind: 'endTurn' }, { kind: 'domain', unitId: 'orsa' }, { kind: 'endTurn' }).state;

  it('allies inside take half damage (floored, min 1)', () => {
    const roll = nextRoll(s);
    const { events } = play(s, { kind: 'attack', unitId: 'k', targetId: 'guard' });
    expect(eventsOf(events, 'damaged')[0]!.amount).toBe(Math.max(1, Math.floor((5 + roll) / 2)));
    expect(previewDamage(s, 'k', 'guard')!.outcomes).toEqual([2, 3, 3]);
  });

  it('protects its owner too', () => {
    const t = game(MAP, [rebel('varek', 'ascendant', [5, 7], { character: 'varek' }), loyal('orsa', 'ascendant', [5, 5], { character: 'orsa' })]);
    const st = play(t, { kind: 'endTurn' }, { kind: 'domain', unitId: 'orsa' }, { kind: 'endTurn' }).state;
    expect(previewDamage(st, 'varek', 'orsa')!.outcomes).toEqual([3, 3, 4]); // (6..8) / 2
  });

  it('halves fixed Domain damage', () => {
    const t = game(MAP, [
      rebel('varek', 'ascendant', [5, 8], { character: 'varek' }),
      loyal('orsa', 'ascendant', [5, 5], { character: 'orsa' }),
      loyal('guard', 'soldier', [5, 6], tough),
    ]);
    const st = play(t, { kind: 'endTurn' }, { kind: 'domain', unitId: 'orsa' }, { kind: 'endTurn' }, { kind: 'domain', unitId: 'varek' }).state;
    expect(hpOf(st, 'guard')).toBe(46); // 8 halved
    expect(hpOf(st, 'orsa')).toBe(36); // 8 halved (Ascendant source: no cap)
  });

  it('enemies cannot move into it', () => {
    const tiles = domainTiles(s, activeDomainOf(s, 'orsa')!);
    const r = reachableTiles(s, 'varek');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((p) => tiles.some((t) => t.x === p.x && t.y === p.y))).toBe(false);
  });
});

describe('Sanctuary', () => {
  const units: UnitPlacement[] = [
    rebel('k', 'kindled', [5, 3]),
    rebel('k2', 'kindled', [0, 10]),
    loyal('elian', 'ascendant', [5, 5], { character: 'elian', stats: { hp: 30, maxHp: 40 } }),
    loyal('hurt', 'soldier', [5, 4], { stats: { hp: 3, maxHp: 10 } }),
    loyal('scratched', 'soldier', [6, 5], { stats: { hp: 8, maxHp: 10 } }),
    loyal('target', 'soldier', [0, 9], tough),
  ];
  const s = play(game(MAP, units), { kind: 'endTurn' }, { kind: 'domain', unitId: 'elian' }, { kind: 'endTurn' });

  it('heals allies inside (owner included) 5 at each round start, capped at max HP', () => {
    expect(hpOf(s.state, 'hurt')).toBe(8);
    expect(hpOf(s.state, 'scratched')).toBe(10);
    expect(hpOf(s.state, 'elian')).toBe(35);
    expect(eventsOf(s.events, 'healed')).toContainEqual({ type: 'healed', unitId: 'scratched', pos: { x: 6, y: 5 }, amount: 2, hpAfter: 10, sourceId: 'elian' });
    expect(hpOf(s.state, 'k')).toBe(16); // enemies are not healed
  });

  it('enemies inside deal 3 less damage (min 1)', () => {
    // k stands inside: (6 - 1 + roll) - 3
    expect(previewDamage(s.state, 'k', 'hurt')!.outcomes).toEqual([2, 3, 4]);
    // k2 stands outside, unless previewed from a tile inside
    expect(previewDamage(s.state, 'k2', 'target')!.outcomes).toEqual([5, 6, 7]);
    expect(previewDamage(s.state, 'k2', 'target', { x: 5, y: 7 })!.outcomes).toEqual([2, 3, 4]);
  });
});

describe('Domain availability', () => {
  it('Silence is reserved and cannot be activated', () => {
    const s = game(MAP, [rebel('sereth', 'ascendant', [5, 5], { character: 'sereth' })]);
    expect(unit(s, 'sereth').domain).toBe('silence');
    expect(getLegalActions(s, 'sereth').some((a) => a.kind === 'domain')).toBe(false);
    expect(() => applyAction(s, { kind: 'domain', unitId: 'sereth' })).toThrow(/reserved/);
  });

  it('an Ascendant without a Domain and non-Ascendants have none', () => {
    const s = game(MAP, [rebel('a', 'ascendant', [5, 5]), rebel('b', 'radiant', [1, 1])]);
    expect(domainUnavailableReason(s, unit(s, 'a'))).toMatch(/no Domain/);
    expect(domainUnavailableReason(s, unit(s, 'b'))).toMatch(/only Ascendants/);
  });

  it('domains stay listed in state as plain data', () => {
    const s = play(game(MAP, [rebel('varek', 'ascendant', [5, 5], { character: 'varek' })]), { kind: 'domain', unitId: 'varek' }).state;
    expect(s.domains).toEqual([{ ownerId: 'varek', kind: 'tempest', faction: 'rebel', activatedRound: 1, expiresAtRound: 4 }]);
    expect(mutate(s, () => {})).toEqual(s);
  });
});
