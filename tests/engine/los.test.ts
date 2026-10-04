import { describe, expect, it } from 'vitest';
import { attackableTargets, bresenhamLine, lineOfSight } from '../../src/engine';
import { game, loyal, mutate, rebel } from './helpers';

describe('bresenhamLine', () => {
  it('includes both endpoints and steps one tile at a time', () => {
    const l = bresenhamLine({ x: 0, y: 0 }, { x: 4, y: 2 });
    expect(l[0]).toEqual({ x: 0, y: 0 });
    expect(l.at(-1)).toEqual({ x: 4, y: 2 });
    expect(l).toHaveLength(5);
    expect(bresenhamLine({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('lineOfSight', () => {
  const s = game(['......', '..#...', '......'], [rebel('a', 'soldier', [0, 0])]);

  it('is blocked by walls between the endpoints', () => {
    expect(lineOfSight(s, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
    expect(lineOfSight(s, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
    expect(lineOfSight(s, { x: 0, y: 2 }, { x: 5, y: 2 })).toBe(true);
  });

  it('is symmetric', () => {
    for (const [a, b] of [
      [{ x: 0, y: 0 }, { x: 4, y: 2 }],
      [{ x: 1, y: 2 }, { x: 3, y: 0 }],
      [{ x: 0, y: 1 }, { x: 5, y: 2 }],
    ] as const) {
      expect(lineOfSight(s, a, b)).toBe(lineOfSight(s, b, a));
    }
  });

  it('endpoints never block, units never block', () => {
    expect(lineOfSight(s, { x: 2, y: 1 }, { x: 4, y: 1 })).toBe(true);
    const u = game(['.....'], [rebel('a', 'radiant', [0, 0]), loyal('m', 'soldier', [1, 0]), loyal('t', 'soldier', [3, 0])]);
    expect(attackableTargets(u, 'a').map((t) => t.id)).toContain('t');
  });

  it('is blocked by a barred door, not by a plain or broken one', () => {
    const d = game(['..+..'], [rebel('a', 'soldier', [0, 0])], { objects: [{ id: 'door', kind: 'door', pos: [2, 0] }] });
    expect(lineOfSight(d, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    const broken = mutate(d, (x) => {
      const o = x.map.objects[0]!;
      if (o.kind === 'door') o.destroyed = true;
    });
    expect(lineOfSight(broken, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    const plain = game(['..+..'], [rebel('a', 'soldier', [0, 0])]);
    expect(lineOfSight(plain, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it('gates ranged attacks', () => {
    const r = game(['....', '.#..', '....'], [rebel('a', 'radiant', [0, 1]), loyal('t', 'soldier', [3, 1]), loyal('u', 'soldier', [2, 2])]);
    const ids = attackableTargets(r, 'a').map((t) => t.id);
    expect(ids).not.toContain('t'); // wall at (1,1) in the way
    expect(ids).toContain('u');
  });
});
