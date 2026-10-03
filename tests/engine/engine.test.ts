// Cross-cutting properties: immutability, determinism, serializability,
// legal-action consistency and turn flow.
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  getLegalActions,
  IllegalActionError,
  isLegalAction,
  nextRandom,
  type Action,
  type GameEvent,
  type GameState,
} from '../../src/engine';
import { miniPrologue } from './fixtures/miniPrologue';
import { deepFreeze, eventsOf, play, unit } from './helpers';

/** Plays a whole battle choosing legal actions with its own seeded chooser. */
function autoplay(seed: number, gameSeed = 1234, maxSteps = 3000): { state: GameState; events: GameEvent[]; steps: number } {
  let state = createGame({ ...miniPrologue(), seed: gameSeed });
  let r = seed >>> 0;
  const pick = (n: number): number => {
    const [v, next] = nextRandom(r);
    r = next;
    return Math.floor(v * n);
  };
  const events: GameEvent[] = [];
  let steps = 0;
  while (!state.gameOver && steps < maxSteps) {
    const options: Action[] = [];
    for (const u of state.units) {
      if (u.faction !== state.activeFaction) continue;
      for (const a of getLegalActions(state, u.id)) if (a.kind !== 'endTurn') options.push(a);
    }
    const action: Action = options.length === 0 || pick(10) === 0 ? { kind: 'endTurn' } : options[pick(options.length)]!;
    const res = applyAction(state, action);
    state = res.state;
    events.push(...res.events);
    steps++;
  }
  return { state, events, steps };
}

describe('immutability', () => {
  it('applyAction never mutates its (deep-frozen) input', () => {
    let state = deepFreeze(createGame(miniPrologue()));
    const script: Action[] = [
      { kind: 'move', unitId: 'varek', to: { x: 4, y: 5 } },
      { kind: 'attack', unitId: 'varek', targetId: 'throneDoor' },
      { kind: 'domain', unitId: 'grimm' },
      { kind: 'move', unitId: 'wolf2', to: { x: 12, y: 7 } },
      { kind: 'interact', unitId: 'wolf2', interaction: 'burnBridge', targetId: 'eastBridge' },
      { kind: 'wait', unitId: 'kaela' },
      { kind: 'endTurn' },
      { kind: 'move', unitId: 'mira', to: { x: 0, y: 9 } },
      { kind: 'endTurn' },
    ];
    for (let round = 0; round < 6; round++) script.push({ kind: 'endTurn' }, { kind: 'endTurn' });
    for (const a of script) {
      const before = JSON.stringify(state);
      const res = applyAction(state, a);
      expect(JSON.stringify(state)).toBe(before);
      expect(res.state).not.toBe(state);
      state = deepFreeze(res.state);
    }
    expect(state.round).toBe(8);
    expect(state.bells[0]!.rung).toBe(true);
  });

  it('frozen states also work with every query', () => {
    const s = deepFreeze(createGame(miniPrologue()));
    for (const u of s.units) expect(() => getLegalActions(s, u.id)).not.toThrow();
  });
});

describe('determinism', () => {
  it('same seed + same actions = identical state and events', () => {
    const a = autoplay(7);
    const b = autoplay(7);
    expect(a.steps).toBe(b.steps);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('the game seed drives the dice', () => {
    const script: Action[] = [
      { kind: 'move', unitId: 'varek', to: { x: 4, y: 5 } },
      { kind: 'attack', unitId: 'varek', targetId: 'throneDoor' },
    ];
    const rolls = new Set<number | null>();
    for (let seed = 0; seed < 20; seed++) {
      const { events } = play(createGame({ ...miniPrologue(), seed }), ...script);
      rolls.add(eventsOf(events, 'damaged')[0]!.roll);
    }
    expect(rolls.size).toBe(3);
  });
});

describe('legal actions are the single source of truth', () => {
  it.each([1, 2, 3, 4, 5, 6])('random legal play (chooser seed %i) never throws and ends by Dawn', (seed) => {
    const { state, steps } = autoplay(seed, 1000 + seed);
    expect(state.gameOver).toBe(true);
    expect(steps).toBeLessThan(3000);
    expect(state.round).toBeLessThanOrEqual(15);
    // Invariants
    const tiles = new Set(state.units.map((u) => `${u.pos.x},${u.pos.y}`));
    expect(tiles.size).toBe(state.units.length);
    for (const u of state.units) {
      expect(u.hp).toBeGreaterThan(0);
      expect(u.hp).toBeLessThanOrEqual(u.maxHp);
    }
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('every listed action is legal and actions for the wrong side are not', () => {
    const s = createGame(miniPrologue());
    for (const u of s.units) {
      const list = getLegalActions(s, u.id);
      if (u.faction === 'rebel') {
        expect(list.at(-1)).toEqual({ kind: 'endTurn' });
        for (const a of list) expect(isLegalAction(s, a)).toBe(true);
      } else {
        expect(list).toEqual([]);
      }
    }
    expect(isLegalAction(s, { kind: 'wait', unitId: 'guard1' })).toBe(false);
  });

  it('illegal actions throw IllegalActionError with a code and the action', () => {
    const s = createGame(miniPrologue());
    const bad: Action = { kind: 'attack', unitId: 'wolf1', targetId: 'halden' };
    try {
      applyAction(s, bad);
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalActionError);
      expect((e as IllegalActionError).code).toBe('INVALID_TARGET');
      expect((e as IllegalActionError).action).toBe(bad);
    }
  });
});

describe('turn flow', () => {
  it('player phase -> AI phase -> next round, each announced', () => {
    const s = createGame(miniPrologue());
    const p = applyAction(s, { kind: 'endTurn' });
    expect(p.state).toMatchObject({ round: 1, phase: 'ai', activeFaction: 'loyalist' });
    expect(p.events).toEqual([{ type: 'phaseStarted', round: 1, phase: 'ai', faction: 'loyalist' }]);
    const a = applyAction(p.state, { kind: 'endTurn' });
    expect(a.state).toMatchObject({ round: 2, phase: 'player', activeFaction: 'rebel' });
    expect(a.events[0]).toEqual({ type: 'phaseStarted', round: 2, phase: 'player', faction: 'rebel' });
  });

  it('resets only the starting faction flags', () => {
    const moved = play(createGame(miniPrologue()), { kind: 'wait', unitId: 'wolf1' }, { kind: 'endTurn' }).state;
    expect(unit(moved, 'wolf1').hasActed).toBe(true); // still flagged during the AI phase
    const next = play(moved, { kind: 'endTurn' }).state;
    expect(unit(next, 'wolf1').hasActed).toBe(false);
  });

  it('round start runs ticks before bells and bells before evaluation', () => {
    let s = createGame(miniPrologue());
    s = play(s, { kind: 'domain', unitId: 'grimm' }).state; // Pyre in the duel
    while (s.round < 4) s = play(s, { kind: 'endTurn' }, { kind: 'endTurn' }).state;
    const { events } = play(s, { kind: 'endTurn' }, { kind: 'endTurn' }); // -> round 5
    const kinds = events.map((e) => e.type);
    // Pyre expired at the start of round 4, so round 5 has duel damage, then the bell.
    expect(kinds.slice(0, 2)).toEqual(['phaseStarted', 'phaseStarted']);
    expect(kinds.indexOf('damaged')).toBeLessThan(kinds.indexOf('bellRang'));
    expect(kinds.indexOf('bellRang')).toBeLessThan(kinds.indexOf('reinforcementsArrived'));
  });
});
