import { describe, expect, it } from 'vitest';
import {
  applyAction,
  getLegalActions,
  IllegalActionError,
  manhattan,
  pathCost,
  pathTo,
  reachableTiles,
  TERRAIN,
  type GameState,
  type Pos,
} from '../../src/engine';
import { eventsOf, floor, game, loyal, mutate, play, rebel, unit } from './helpers';

const has = (tiles: Pos[], x: number, y: number): boolean => tiles.some((t) => t.x === x && t.y === y);

function expectIllegal(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(IllegalActionError);
    expect((e as IllegalActionError).code).toBe(code);
    return;
  }
  throw new Error(`expected IllegalActionError ${code}`);
}

describe('movement costs and terrain', () => {
  const s = game(['.....', '.%O#.', '.....'], [rebel('a', 'soldier', [0, 0])]);

  it('uses terrain move costs (rubble 2, pillar 2, floor 1)', () => {
    expect(pathCost(s, 'a', { x: 1, y: 1 })).toBe(3);
    expect(pathCost(s, 'a', { x: 2, y: 1 })).toBe(4);
    expect(pathCost(s, 'a', { x: 4, y: 0 })).toBe(4);
    const r = reachableTiles(s, 'a');
    expect(has(r, 2, 1)).toBe(true);
    expect(has(r, 4, 1)).toBe(false); // cost 5
  });

  it('never enters walls or water', () => {
    expect(has(reachableTiles(s, 'a'), 3, 1)).toBe(false);
    const w = game(['.~.', '.~.'], [rebel('a', 'soldier', [0, 0], { stats: { move: 9 } })]);
    expect(reachableTiles(w, 'a')).toEqual([{ x: 0, y: 1 }]);
    expect(TERRAIN.water.moveCost).toBeNull();
  });

  it('excludes the current tile and sorts row-major', () => {
    const r = reachableTiles(s, 'a');
    expect(has(r, 0, 0)).toBe(false);
    const sorted = [...r].sort((p, q) => p.y - q.y || p.x - q.x);
    expect(r).toEqual(sorted);
  });

  it('pathTo returns a contiguous cheapest path ending at the target', () => {
    const p = pathTo(s, 'a', { x: 2, y: 1 })!;
    expect(p.at(-1)).toEqual({ x: 2, y: 1 });
    let prev: Pos = { x: 0, y: 0 };
    let cost = 0;
    for (const step of p) {
      expect(manhattan(prev, step)).toBe(1);
      cost += TERRAIN[s.map.terrain[step.y]![step.x]!].moveCost!;
      prev = step;
    }
    expect(cost).toBe(4);
    expect(pathTo(s, 'a', { x: 2, y: 1 })).toEqual(p); // deterministic
    expect(pathTo(s, 'a', { x: 0, y: 0 })).toEqual([]);
    expect(pathTo(s, 'a', { x: 3, y: 1 })).toBeNull();
  });

  it('pathTo can plan beyond the move budget', () => {
    const big = game([floor(12, 1)[0]!], [rebel('a', 'soldier', [0, 0])]);
    expect(pathTo(big, 'a', { x: 11, y: 0 })).toBeNull();
    expect(pathTo(big, 'a', { x: 11, y: 0 }, { ignoreMoveLimit: true })).toHaveLength(11);
  });

  it('Drained units move one tile less', () => {
    const d = mutate(s, (x) => unit(x, 'a').statuses.push('drained'));
    expect(has(reachableTiles(d, 'a'), 4, 0)).toBe(false);
    expect(has(reachableTiles(d, 'a'), 3, 0)).toBe(true);
  });
});

describe('movement blocking', () => {
  it('cannot pass through enemies', () => {
    const s = game(['.....'], [rebel('a', 'soldier', [0, 0]), loyal('e', 'soldier', [2, 0])]);
    expect(reachableTiles(s, 'a')).toEqual([{ x: 1, y: 0 }]);
    expect(pathTo(s, 'a', { x: 4, y: 0 }, { ignoreMoveLimit: true })).toBeNull();
    expect(pathTo(s, 'a', { x: 4, y: 0 }, { ignoreUnits: true })).toHaveLength(4);
  });

  it('passes through allies but cannot end on them', () => {
    const s = game(['.....'], [rebel('a', 'soldier', [0, 0]), rebel('b', 'soldier', [2, 0])]);
    expect(reachableTiles(s, 'a')).toEqual([
      { x: 1, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
    expectIllegal(() => applyAction(s, { kind: 'move', unitId: 'a', to: { x: 2, y: 0 } }), 'UNREACHABLE');
  });

  it('cannot pass a barred door until it is broken', () => {
    const s = game(['.+.'], [rebel('a', 'soldier', [0, 0])], { objects: [{ id: 'door', kind: 'door', pos: [1, 0], hp: 3 }] });
    expect(reachableTiles(s, 'a')).toEqual([]);
    const broken = mutate(s, (x) => {
      const d = x.map.objects[0]!;
      if (d.kind === 'door') d.destroyed = true;
    });
    expect(reachableTiles(broken, 'a')).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('an unbarred door is passable', () => {
    const s = game(['.+.'], [rebel('a', 'soldier', [0, 0])]);
    expect(has(reachableTiles(s, 'a'), 2, 0)).toBe(true);
  });

  it('ward anchors block movement while intact', () => {
    const s = game(['...'], [rebel('a', 'soldier', [0, 0])], { objects: [{ id: 'w', kind: 'anchor', pos: [1, 0] }] });
    expect(reachableTiles(s, 'a')).toEqual([]);
  });

  it('enemies cannot enter a Bulwark zone, but can leave it', () => {
    const base = game(floor(10, 5), [
      rebel('a', 'soldier', [0, 2]),
      rebel('c', 'soldier', [3, 2]),
      loyal('orsa', 'ascendant', [6, 2], { character: 'orsa' }),
      loyal('ally', 'soldier', [9, 4]),
    ]);
    const { state } = play(base, { kind: 'endTurn' }, { kind: 'domain', unitId: 'orsa' }, { kind: 'endTurn' });
    expect(state.round).toBe(2);
    const inZone = (p: Pos) => manhattan(p, { x: 6, y: 2 }) <= 3;
    const ra = reachableTiles(state, 'a');
    expect(ra.length).toBeGreaterThan(0);
    expect(ra.some(inZone)).toBe(false);
    const rc = reachableTiles(state, 'c'); // starts on the zone's edge
    expect(has(rc, 2, 2)).toBe(true);
    expect(rc.some(inZone)).toBe(false);
    // Orsa's allies are not blocked.
    const ai = play(state, { kind: 'endTurn' }).state;
    expect(reachableTiles(ai, 'ally').some(inZone)).toBe(true);
  });
});

describe('move action and turn flags', () => {
  const s = game(floor(6, 2), [rebel('a', 'soldier', [0, 0]), loyal('e', 'soldier', [5, 1])]);

  it('moves the unit and emits a moved event with its path', () => {
    const { state, events } = play(s, { kind: 'move', unitId: 'a', to: { x: 2, y: 1 } });
    expect(unit(state, 'a').pos).toEqual({ x: 2, y: 1 });
    expect(unit(state, 'a').hasMoved).toBe(true);
    const [m] = eventsOf(events, 'moved');
    expect(m).toMatchObject({ unitId: 'a', from: { x: 0, y: 0 }, to: { x: 2, y: 1 } });
    expect(m!.path).toHaveLength(3);
    expect(m!.path.at(-1)).toEqual({ x: 2, y: 1 });
  });

  it('allows one move per turn', () => {
    const moved = play(s, { kind: 'move', unitId: 'a', to: { x: 1, y: 0 } }).state;
    expect(reachableTiles(moved, 'a')).toEqual([]);
    expect(getLegalActions(moved, 'a').some((a) => a.kind === 'move')).toBe(false);
    expectIllegal(() => applyAction(moved, { kind: 'move', unitId: 'a', to: { x: 2, y: 0 } }), 'ALREADY_MOVED');
  });

  it('allows move then act, and act then move', () => {
    const t = game(floor(6, 1), [rebel('a', 'soldier', [0, 0]), loyal('e', 'soldier', [1, 0], { stats: { hp: 30 } })]);
    const actFirst = play(t, { kind: 'attack', unitId: 'a', targetId: 'e' }).state;
    expect(getLegalActions(actFirst, 'a').some((a) => a.kind === 'move')).toBe(false); // boxed in by the enemy
    const t2 = game(floor(6, 2), [rebel('a', 'soldier', [0, 0]), loyal('e', 'soldier', [1, 0], { stats: { hp: 30 } })]);
    const af = play(t2, { kind: 'attack', unitId: 'a', targetId: 'e' }).state;
    expect(getLegalActions(af, 'a').some((a) => a.kind === 'move')).toBe(true);
    const mf = play(t2, { kind: 'move', unitId: 'a', to: { x: 1, y: 1 } }).state;
    expect(getLegalActions(mf, 'a').some((a) => a.kind === 'attack')).toBe(true);
  });

  it('wait ends the unit turn', () => {
    const w = play(s, { kind: 'wait', unitId: 'a' }).state;
    expect(unit(w, 'a')).toMatchObject({ hasMoved: true, hasActed: true });
    expect(getLegalActions(w, 'a')).toEqual([{ kind: 'endTurn' }]);
    expectIllegal(() => applyAction(w, { kind: 'wait', unitId: 'a' }), 'UNIT_CANNOT_ACT');
  });

  it('units of the inactive faction cannot move', () => {
    expect(reachableTiles(s, 'e')).toEqual([]);
    expect(getLegalActions(s, 'e')).toEqual([]);
    expectIllegal(() => applyAction(s, { kind: 'move', unitId: 'e', to: { x: 4, y: 1 } }), 'NOT_ACTIVE_FACTION');
  });

  it('rejects malformed and unknown actions', () => {
    expectIllegal(() => applyAction(s, { kind: 'move', unitId: 'a', to: { x: 0.5, y: 0 } }), 'INVALID_ACTION');
    expectIllegal(() => applyAction(s, { kind: 'fly', unitId: 'a' } as never), 'INVALID_ACTION');
    expectIllegal(() => applyAction(s, { kind: 'move', unitId: 'ghost', to: { x: 1, y: 0 } }), 'UNKNOWN_UNIT');
    expectIllegal(() => applyAction(s, { kind: 'move', unitId: 'a', to: { x: 5, y: 0 } }), 'UNREACHABLE');
  });

  it('flags reset when the faction phase starts again', () => {
    const moved = play(s, { kind: 'move', unitId: 'a', to: { x: 1, y: 0 } }).state;
    const next: GameState = play(moved, { kind: 'endTurn' }, { kind: 'endTurn' }).state;
    expect(unit(next, 'a')).toMatchObject({ hasMoved: false, hasActed: false });
  });
});
