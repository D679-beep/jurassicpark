import { describe, expect, it } from 'vitest';
import {
  applyAction,
  attackableTargets,
  findObject,
  IllegalActionError,
  previewDamage,
  reachableTiles,
  rollInt,
  type GameState,
  type Rank,
  type UnitPlacement,
} from '../../src/engine';
import { eventsOf, floor, game, loyal, mutate, nextRoll, play, rebel, unit } from './helpers';

/** Attacker 'a' at (0,0) hits 'd' at (1,0) standing on `tile`. Returns [damage dealt, roll]. */
function hit(attacker: UnitPlacement, defender: UnitPlacement, tile = '.'): [number, number, GameState] {
  const s = game(['.' + tile + '.'], [{ ...attacker, pos: [0, 0] }, { ...defender, pos: [1, 0] }]);
  const roll = nextRoll(s);
  const { state, events } = play(s, { kind: 'attack', unitId: attacker.id, targetId: defender.id });
  const [dmg] = eventsOf(events, 'damaged');
  return [dmg!.amount, roll, state];
}

const big = (id: string, rank: Rank, extra: Partial<UnitPlacement> = {}): UnitPlacement =>
  loyal(id, rank, [1, 0], { stats: { hp: 99 }, ...extra });

describe('damage formula', () => {
  it('is max(1, atk - def - terrain) + roll(0..2)', () => {
    const [d, roll] = hit(rebel('a', 'soldier', [0, 0]), big('d', 'soldier'));
    expect(d).toBe(3 + roll);
    expect(roll).toBeGreaterThanOrEqual(0);
    expect(roll).toBeLessThanOrEqual(2);
  });

  it('applies the defender tile defense bonus', () => {
    const [pil, r0] = hit(rebel('a', 'soldier', [0, 0]), big('d', 'soldier'), 'O');
    expect(pil).toBe(1 + r0); // pillar +2
    const [rub, r1] = hit(rebel('a', 'soldier', [0, 0]), big('d', 'soldier'), '%');
    expect(rub).toBe(2 + r1); // rubble +1
    const [thr, r2] = hit(rebel('a', 'soldier', [0, 0]), big('d', 'soldier'), 'T');
    expect(thr).toBe(2 + r2); // throne +1
    const [dais, r3] = hit(rebel('a', 'soldier', [0, 0]), big('d', 'soldier'), '^');
    expect(dais).toBe(2 + r3);
    const [door, r4] = hit(rebel('a', 'soldier', [0, 0]), big('d', 'soldier'), '+');
    expect(door).toBe(3 + r4);
  });

  it('never goes below 1 before the roll', () => {
    const [d, roll] = hit(rebel('a', 'soldier', [0, 0], { stats: { atk: 1 } }), big('d', 'soldier', { stats: { hp: 99, def: 5 } }), 'O');
    expect(d).toBe(1 + roll);
  });

  it('consumes exactly one RNG roll per attack', () => {
    const s = game(floor(2, 1), [rebel('a', 'soldier', [0, 0]), big('d', 'soldier')]);
    const after = play(s, { kind: 'attack', unitId: 'a', targetId: 'd' }).state;
    expect(after.rng).toBe(rollInt(s.rng, 0, 2)[1]);
  });

  it('emits a damaged event with roll, hp and source', () => {
    const s = game(floor(2, 1), [rebel('a', 'soldier', [0, 0]), big('d', 'soldier')]);
    const roll = nextRoll(s);
    const { events } = play(s, { kind: 'attack', unitId: 'a', targetId: 'd' });
    expect(eventsOf(events, 'damaged')[0]).toEqual({
      type: 'damaged',
      targetId: 'd',
      targetKind: 'unit',
      pos: { x: 1, y: 0 },
      amount: 3 + roll,
      hpBefore: 99,
      hpAfter: 96 - roll,
      sourceId: 'a',
      cause: 'attack',
      roll,
    });
  });

  it('uses effective ATK after Drained (-2)', () => {
    const s = mutate(game(floor(2, 1), [rebel('a', 'kindled', [0, 0]), big('d', 'soldier')]), (x) => unit(x, 'a').statuses.push('drained'));
    const roll = nextRoll(s);
    const { events } = play(s, { kind: 'attack', unitId: 'a', targetId: 'd' });
    expect(eventsOf(events, 'damaged')[0]!.amount).toBe(6 - 2 - 1 + roll);
  });
});

describe('Ascendant rules', () => {
  it('Ascendants deal +50% (floored) to non-Ascendants', () => {
    const [d, roll] = hit(rebel('a', 'ascendant', [0, 0]), big('d', 'soldier'));
    expect(d).toBe(Math.floor((9 + roll) * 1.5));
    const [p, r2] = hit(rebel('a', 'ascendant', [0, 0]), big('d', 'kindled'), 'O');
    expect(p).toBe(Math.floor((10 - 2 - 2 + r2) * 1.5));
  });

  it('non-Ascendants deal at most 1 per hit to an Ascendant', () => {
    for (const rank of ['soldier', 'kindled', 'radiant'] as const) {
      const [d] = hit(rebel('a', rank, [0, 0], { stats: { atk: 30 } }), loyal('d', 'ascendant', [1, 0]));
      expect(d).toBe(1);
    }
  });

  it('Ascendant vs Ascendant uses the plain formula', () => {
    const [d, roll] = hit(rebel('a', 'ascendant', [0, 0]), loyal('d', 'ascendant', [1, 0]));
    expect(d).toBe(6 + roll);
  });
});

describe('previewDamage', () => {
  const s = game(floor(3, 1), [rebel('a', 'ascendant', [0, 0]), loyal('d', 'soldier', [1, 0], { stats: { hp: 14, maxHp: 30 } })]);

  it('lists the damage for each roll and kill chances', () => {
    const p = previewDamage(s, 'a', 'd')!;
    expect(p.outcomes).toEqual([13, 15, 16]);
    expect(p).toMatchObject({ min: 13, max: 16, targetHp: 14, canKill: true, willKill: false, targetKind: 'unit' });
  });

  it('matches the resolved attack', () => {
    const roll = nextRoll(s);
    const { events } = play(s, { kind: 'attack', unitId: 'a', targetId: 'd' });
    const dmg = eventsOf(events, 'damaged')[0]!;
    expect(dmg.hpBefore - dmg.hpAfter).toBe(Math.min(14, previewDamage(s, 'a', 'd')!.outcomes[roll]!));
  });

  it('previews objects and returns null for unknown ids', () => {
    const o = game(['.+'], [rebel('a', 'soldier', [0, 0])], { objects: [{ id: 'door', kind: 'door', pos: [1, 0], hp: 5 }] });
    expect(previewDamage(o, 'a', 'door')).toMatchObject({ outcomes: [4, 5, 6], canKill: true, willKill: false, targetKind: 'object' });
    expect(previewDamage(o, 'a', 'nope')).toBeNull();
    expect(previewDamage(o, 'nope', 'door')).toBeNull();
  });
});

describe('death', () => {
  it('removes a unit at 0 HP and emits died', () => {
    const s = game(floor(2, 1), [rebel('a', 'ascendant', [0, 0]), loyal('d', 'soldier', [1, 0])]);
    const { state, events } = play(s, { kind: 'attack', unitId: 'a', targetId: 'd' });
    expect(state.units.map((u) => u.id)).toEqual(['a']);
    expect(eventsOf(events, 'died')[0]).toMatchObject({ unitId: 'd', killerId: 'a', cause: 'attack', pos: { x: 1, y: 0 } });
    expect(state.removedUnits[0]).toMatchObject({ reason: 'died', round: 1, unit: { id: 'd', hp: 0 } });
    expect(eventsOf(events, 'damaged')[0]!.hpAfter).toBe(0);
  });
});

describe('targeting', () => {
  it('respects min/max range (Manhattan)', () => {
    const s = game(floor(6, 1), [rebel('r', 'radiant', [0, 0]), loyal('t3', 'soldier', [3, 0]), loyal('t4', 'soldier', [4, 0])]);
    expect(attackableTargets(s, 'r').map((t) => t.id)).toEqual(['t3']);
    const a = game(floor(4, 1), [rebel('v', 'ascendant', [0, 0]), loyal('t2', 'soldier', [2, 0]), loyal('t3', 'soldier', [3, 0])]);
    expect(attackableTargets(a, 'v').map((t) => t.id)).toEqual(['t2']);
    const m = game(floor(3, 1), [rebel('k', 'kindled', [0, 0], { stats: { rangeMin: 2, rangeMax: 2 } }), loyal('t1', 'soldier', [1, 0]), loyal('t2', 'soldier', [2, 0])]);
    expect(attackableTargets(m, 'k').map((t) => t.id)).toEqual(['t2']);
  });

  it('previews targets from another tile', () => {
    const s = game(floor(6, 1), [rebel('a', 'soldier', [0, 0]), loyal('t', 'soldier', [4, 0])]);
    expect(attackableTargets(s, 'a')).toEqual([]);
    expect(attackableTargets(s, 'a', { x: 3, y: 0 }).map((t) => t.id)).toEqual(['t']);
  });

  it('cannot attack allies, itself, or twice per turn', () => {
    const s = game(floor(3, 1), [rebel('a', 'soldier', [0, 0]), rebel('b', 'soldier', [1, 0]), loyal('e', 'soldier', [2, 0], { stats: { hp: 50 } })]);
    expect(() => applyAction(s, { kind: 'attack', unitId: 'a', targetId: 'b' })).toThrow(IllegalActionError);
    expect(() => applyAction(s, { kind: 'attack', unitId: 'a', targetId: 'a' })).toThrow(/cannot attack itself/);
    const once = play(s, { kind: 'attack', unitId: 'b', targetId: 'e' }).state;
    expect(attackableTargets(once, 'b')).toEqual([]);
    try {
      applyAction(once, { kind: 'attack', unitId: 'b', targetId: 'e' });
      throw new Error('should throw');
    } catch (e) {
      expect((e as IllegalActionError).code).toBe('ALREADY_ACTED');
    }
  });
});

describe('objects', () => {
  it('a barred door takes max(1, atk - def) + roll and opens when destroyed', () => {
    const s = game(['.+.'], [rebel('a', 'soldier', [0, 0])], { objects: [{ id: 'door', kind: 'door', pos: [1, 0], hp: 6 }] });
    expect(attackableTargets(s, 'a')).toEqual([{ id: 'door', kind: 'object', pos: { x: 1, y: 0 } }]);
    const roll = nextRoll(s);
    const r1 = play(s, { kind: 'attack', unitId: 'a', targetId: 'door' });
    expect(eventsOf(r1.events, 'damaged')[0]).toMatchObject({ targetKind: 'object', amount: Math.min(6, 4 + roll) });
    // Finish it off next round.
    const r2 = play(r1.state, { kind: 'endTurn' }, { kind: 'endTurn' }, { kind: 'attack', unitId: 'a', targetId: 'door' });
    expect(eventsOf(r2.events, 'objectDestroyed')[0]).toMatchObject({ objectId: 'door', objectKind: 'door', byUnitId: 'a' });
    expect(findObject(r2.state, 'door')).toMatchObject({ hp: 0, destroyed: true });
    expect(attackableTargets(r2.state, 'a')).toEqual([]);
    const next = play(r2.state, { kind: 'endTurn' }, { kind: 'endTurn' }).state;
    expect(reachableTiles(next, 'a')).toContainEqual({ x: 2, y: 0 });
  });

  it('object defense and no rank bonus', () => {
    const s = game(['..'], [rebel('a', 'ascendant', [0, 0])], { objects: [{ id: 'w', kind: 'anchor', pos: [1, 0], def: 3 }] });
    expect(previewDamage(s, 'a', 'w')!.outcomes).toEqual([7, 8, 9]);
  });

  it('bridges are not attack targets', () => {
    const s = game(['.='], [rebel('a', 'soldier', [0, 0])]);
    expect(attackableTargets(s, 'a')).toEqual([]);
  });
});
