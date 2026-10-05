// Heroes (tag `hero`) are downed at 0 HP instead of dying, can be revived once
// by an adjacent ally, and bleed out after their side's next two phases.
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  attackableTargets,
  bleedOutRoundFor,
  createGame,
  getLegalActions,
  IllegalActionError,
  previewDamage,
  reachableTiles,
  RULES,
  ScenarioValidationError,
  type GameState,
  type ScenarioDef,
} from '../../src/engine';
import { miniPrologue } from './fixtures/miniPrologue';
import { advanceTo, eventsOf, floor, game, loyal, mutate, nextRound, play, rebel, unit } from './helpers';

const fx = (def: ScenarioDef = miniPrologue()): GameState => createGame(def);
const place = (s: GameState, moves: Record<string, [number, number]>, hps: Record<string, number> = {}): GameState =>
  mutate(s, (x) => {
    for (const [id, [px, py]] of Object.entries(moves)) unit(x, id).pos = { x: px, y: py };
    for (const [id, hp] of Object.entries(hps)) unit(x, id).hp = hp;
  });

/** Round 1, AI phase: guard2 (4,2) has just knocked a 1-HP Varek on (5,2) down. */
function varekDownedInAiPhase(def?: ScenarioDef): { state: GameState; events: ReturnType<typeof play>['events'] } {
  const s = play(place(fx(def), { varek: [5, 2] }, { varek: 1 }), { kind: 'endTurn' }).state;
  return play(s, { kind: 'attack', unitId: 'guard2', targetId: 'varek' });
}

describe('a hero at 0 HP is downed, not killed', () => {
  it('stays on its tile at 0 HP with status downed and a bleed-out round; the battle goes on', () => {
    const { state, events } = varekDownedInAiPhase();
    expect(state.gameOver).toBe(false);
    const v = unit(state, 'varek');
    expect(v).toMatchObject({ hp: 0, pos: { x: 5, y: 2 }, bleedOutRound: 4, revives: 0 });
    expect(v.statuses).toContain('downed');
    expect(eventsOf(events, 'died')).toEqual([]);
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf('damaged')).toBeLessThan(kinds.indexOf('downed'));
    expect(eventsOf(events, 'downed')).toEqual([
      { type: 'downed', unitId: 'varek', name: 'Varek', faction: 'rebel', pos: { x: 5, y: 2 }, sourceId: 'guard2', cause: 'attack', bleedOutRound: 4 },
    ]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('cannot be targeted or damaged', () => {
    const { state } = varekDownedInAiPhase();
    const s = place(state, { guard1: [5, 3] });
    expect(attackableTargets(s, 'guard1').map((t) => t.id)).not.toContain('varek');
    expect(previewDamage(s, 'guard1', 'varek')!.outcomes).toEqual([0, 0, 0]);
    try {
      applyAction(s, { kind: 'attack', unitId: 'guard1', targetId: 'varek' });
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalActionError);
      expect((e as IllegalActionError).code).toBe('INVALID_TARGET');
    }
  });

  it('is inert: no move, attack, Domain, interaction or wait', () => {
    const r2 = nextRound(varekDownedInAiPhase().state).state;
    expect(r2.phase).toBe('player');
    expect(getLegalActions(r2, 'varek')).toEqual([{ kind: 'endTurn' }]);
    expect(reachableTiles(r2, 'varek')).toEqual([]);
  });

  it('a downed Varek cannot Confront', () => {
    const beside = place(fx(), { varek: [4, 1] });
    const confront = { kind: 'interact', unitId: 'varek', interaction: 'confront', targetId: 'halden' };
    expect(getLegalActions(beside, 'varek')).toContainEqual(confront);
    const down = mutate(beside, (x) => {
      Object.assign(unit(x, 'varek'), { hp: 0, statuses: ['downed'], bleedOutRound: 3 });
    });
    expect(getLegalActions(down, 'varek')).not.toContainEqual(confront);
  });

  it('still occupies its tile: enemies cannot pass through or end on it', () => {
    const s = game(floor(5, 1), [rebel('hero', 'kindled', [2, 0], { tags: ['hero'] }), rebel('r', 'soldier', [4, 0]), loyal('l', 'soldier', [0, 0])]);
    const down = mutate(play(s, { kind: 'endTurn' }).state, (x) => {
      Object.assign(unit(x, 'hero'), { hp: 0, statuses: ['downed'], bleedOutRound: 4 });
    });
    expect(reachableTiles(down, 'l')).toEqual([{ x: 1, y: 0 }]);
  });

  it('Domains skip downed units: no Tempest damage on activation or at round start', () => {
    const s = game(floor(7, 3), [
      rebel('varek', 'ascendant', [3, 1], { character: 'varek' }),
      loyal('champ', 'kindled', [4, 1], { tags: ['hero'] }),
      loyal('l', 'soldier', [2, 1]),
    ]);
    const down = mutate(s, (x) => {
      Object.assign(unit(x, 'champ'), { hp: 0, statuses: ['downed'], bleedOutRound: 9 });
    });
    const { state, events } = play(down, { kind: 'domain', unitId: 'varek' });
    expect(eventsOf(events, 'damaged').map((e) => e.targetId)).toEqual(['l']);
    const tick = nextRound(state).events;
    expect(eventsOf(tick, 'damaged').some((e) => e.targetId === 'champ')).toBe(false);
  });

  it('a non-hero at 0 HP still dies', () => {
    const s = play(place(fx(), { wolf1: [5, 2] }, { wolf1: 1 }), { kind: 'endTurn' }).state;
    const { state, events } = play(s, { kind: 'attack', unitId: 'guard2', targetId: 'wolf1' });
    expect(state.units.some((u) => u.id === 'wolf1')).toBe(false);
    expect(eventsOf(events, 'died').map((e) => e.unitId)).toEqual(['wolf1']);
    expect(eventsOf(events, 'downed')).toEqual([]);
  });
});

describe('Revive', () => {
  const r2 = (): GameState => place(nextRound(varekDownedInAiPhase().state).state, { wolf1: [5, 3] });
  const revive = { kind: 'interact', unitId: 'wolf1', interaction: 'revive', targetId: 'varek' } as const;

  it('is offered to an ally orthogonally adjacent to the downed hero that has not acted', () => {
    const s = r2();
    expect(getLegalActions(s, 'wolf1')).toContainEqual(revive);
    const offers = (st: GameState): boolean => getLegalActions(st, 'wolf1').some((a) => a.kind === 'interact' && a.interaction === 'revive');
    expect(offers(place(s, { wolf1: [5, 1] }))).toBe(true); // the other orthogonal side
    expect(offers(place(s, { wolf1: [4, 3] }))).toBe(false); // diagonal
    expect(offers(place(s, { wolf1: [5, 5] }))).toBe(false); // too far
    // Not after acting.
    const acted = mutate(s, (x) => {
      unit(x, 'wolf1').hasActed = true;
    });
    expect(getLegalActions(acted, 'wolf1')).not.toContainEqual(revive);
  });

  it('can follow a move in the same turn', () => {
    // Two steps along the Throne Hall's south row, (3,3) -> (5,3), then revive.
    const far = place(nextRound(varekDownedInAiPhase().state).state, { wolf1: [3, 3] });
    expect(getLegalActions(far, 'wolf1')).not.toContainEqual(revive);
    const moved = play(far, { kind: 'move', unitId: 'wolf1', to: { x: 5, y: 3 } }).state;
    expect(getLegalActions(moved, 'wolf1')).toContainEqual(revive);
  });

  it('restores ceil(50%) HP, clears downed and the bleed-out, and the hero is done for the phase', () => {
    const { state, events } = play(r2(), revive);
    const v = unit(state, 'varek');
    expect(v).toMatchObject({ hp: Math.ceil(40 * RULES.reviveHpFraction), bleedOutRound: null, revives: 1, hasMoved: true, hasActed: true });
    expect(v.hp).toBe(20);
    expect(v.statuses).not.toContain('downed');
    expect(unit(state, 'wolf1').hasActed).toBe(true);
    expect(eventsOf(events, 'revived')).toEqual([{ type: 'revived', unitId: 'varek', byUnitId: 'wolf1', pos: { x: 5, y: 2 }, hpAfter: 20 }]);
    expect(getLegalActions(state, 'varek')).toEqual([{ kind: 'endTurn' }]);
    // Next round he acts normally.
    const r3 = nextRound(state).state;
    expect(getLegalActions(r3, 'varek').some((a) => a.kind === 'move')).toBe(true);
  });

  it('rounds the restored HP up for odd max HP', () => {
    const s = game(floor(3, 1), [rebel('h', 'kindled', [0, 0], { tags: ['hero'], stats: { hp: 15 } }), rebel('r', 'soldier', [1, 0]), loyal('l', 'soldier', [2, 0])]);
    const down = mutate(s, (x) => {
      Object.assign(unit(x, 'h'), { hp: 0, statuses: ['downed'], bleedOutRound: 3 });
    });
    const st = play(down, { kind: 'interact', unitId: 'r', interaction: 'revive', targetId: 'h' }).state;
    expect(unit(st, 'h').hp).toBe(8);
  });

  it('a hero who falls again after a revive dies outright', () => {
    const revived = play(r2(), revive).state;
    const ai = place(play(revived, { kind: 'endTurn' }).state, {}, { varek: 1 });
    const { state, events } = play(ai, { kind: 'attack', unitId: 'guard2', targetId: 'varek' });
    expect(eventsOf(events, 'downed')).toEqual([]);
    expect(eventsOf(events, 'died')).toMatchObject([{ unitId: 'varek', cause: 'attack', killerId: 'guard2' }]);
    expect(state.result).toMatchObject({ result: 'defeat', winner: 'loyalist', reason: 'Varek has fallen' });
  });

  it('plays the hero dialogue lines (by unit id or character id)', () => {
    const def: ScenarioDef = {
      ...miniPrologue(),
      dialogue: {
        ...miniPrologue().dialogue,
        'downed:varek': [{ speaker: 'varek', text: 'Get me up.' }],
        'revived:varek': [{ speaker: 'varek', text: 'Again.' }],
      },
    };
    const down = varekDownedInAiPhase(def);
    expect(eventsOf(down.events, 'dialogue').map((e) => [e.trigger, e.speaker, e.text])).toEqual([['downed:varek', 'Varek', 'Get me up.']]);
    const s = place(nextRound(down.state).state, { wolf1: [5, 3] });
    const up = play(s, revive);
    expect(eventsOf(up.events, 'dialogue').map((e) => e.trigger)).toEqual(['revived:varek']);
    expect(() => createGame({ ...def, dialogue: { 'downed:nobody': [{ speaker: 'x', text: 'y' }] } })).toThrow(ScenarioValidationError);
  });
});

describe('bleeding out', () => {
  it('a hero downed in the loyalist phase of round R dies at the start of the rebel phase of R + 3', () => {
    const { state } = varekDownedInAiPhase();
    // Two full rebel phases (rounds 2 and 3) to reach him.
    const r2 = nextRound(state);
    expect(unit(r2.state, 'varek').statuses).toContain('downed');
    const r3 = advanceTo(r2.state, 3);
    expect(r3.state.gameOver).toBe(false);
    expect(eventsOf(r3.events, 'died')).toEqual([]);
    const r4 = advanceTo(r3.state, 4);
    expect(eventsOf(r4.events, 'died')).toEqual([
      { type: 'died', unitId: 'varek', name: 'Varek', faction: 'rebel', pos: { x: 5, y: 2 }, killerId: null, cause: 'bledOut' },
    ]);
    // It happens right as the rebel phase opens, before any other round-start step.
    const kinds = r4.events.map((e) => e.type);
    expect(kinds.slice(kinds.lastIndexOf('phaseStarted'), kinds.lastIndexOf('phaseStarted') + 2)).toEqual(['phaseStarted', 'died']);
    expect(r4.state.result).toMatchObject({ result: 'defeat', winner: 'loyalist', reason: 'Varek has fallen' });
  });

  it('a hero downed by round-start damage (a Pyre tick) gets that phase and the next: dies at R + 2', () => {
    const s = game(floor(6, 3), [
      rebel('grimm', 'ascendant', [1, 1], { character: 'grimm' }),
      rebel('kaela', 'kindled', [2, 1], { character: 'kaela', tags: ['hero'], stats: { hp: 3, maxHp: 16 } }),
      loyal('l', 'soldier', [5, 2]),
    ]);
    const lit = play(s, { kind: 'domain', unitId: 'grimm' }).state;
    const r2 = nextRound(lit);
    expect(eventsOf(r2.events, 'downed')).toMatchObject([{ unitId: 'kaela', cause: 'pyre', sourceId: 'grimm', bleedOutRound: 4 }]);
    // The Pyre's second tick skips her.
    const r3 = nextRound(r2.state);
    expect(eventsOf(r3.events, 'damaged').some((e) => e.targetId === 'kaela')).toBe(false);
    expect(r3.state.gameOver).toBe(false);
    const r4 = nextRound(r3.state);
    expect(eventsOf(r4.events, 'died')).toMatchObject([{ unitId: 'kaela', cause: 'bledOut' }]);
    expect(r4.state.result).toMatchObject({ result: 'defeat', reason: 'Kaela has fallen' });
  });

  it('bleedOutRoundFor: two full phases of the hero\'s own side', () => {
    const s = fx();
    const v = unit(s, 'varek');
    const g = unit(s, 'guard1');
    // Rebel hero: player phase -> R + 2, AI phase -> R + 3.
    expect(bleedOutRoundFor(s, v)).toBe(3);
    const ai = play(s, { kind: 'endTurn' }).state;
    expect(bleedOutRoundFor(ai, v)).toBe(4);
    // A loyalist (second-moving) hero: R + 2 either way.
    expect(bleedOutRoundFor(s, g)).toBe(3);
    expect(bleedOutRoundFor(ai, g)).toBe(3);
  });

  it('a revive in time stops the bleed-out', () => {
    const s = place(nextRound(varekDownedInAiPhase().state).state, { wolf1: [5, 3] });
    const revived = play(s, { kind: 'interact', unitId: 'wolf1', interaction: 'revive', targetId: 'varek' }).state;
    const later = advanceTo(revived, 5);
    expect(later.state.units.some((u) => u.id === 'varek')).toBe(true);
    expect(eventsOf(later.events, 'died').some((e) => e.unitId === 'varek')).toBe(false);
  });
});

describe('downed units and the rest of the rules', () => {
  it('a downed rebel does not hold the bell tower', () => {
    const base = mutate(fx(), (x) => {
      x.units = x.units.filter((u) => u.id !== 'towerGuard');
    });
    const downInTower = mutate(base, (x) => {
      Object.assign(unit(x, 'kaela'), { pos: { x: 18, y: 9 }, hp: 0, statuses: ['downed'], bleedOutRound: 3 });
    });
    expect(play(downInTower, { kind: 'endTurn' }).state.modifiers.bellTowerSeized).toBe(false);
    const standing = place(base, { kaela: [18, 9] });
    expect(play(standing, { kind: 'endTurn' }).state.modifiers.bellTowerSeized).toBe(true);
  });

  it('units cannot start downed', () => {
    expect(() => game(floor(2, 1), [rebel('a', 'soldier', [0, 0], { statuses: ['downed'] }), loyal('b', 'soldier', [1, 0])])).toThrow(/cannot start downed/);
  });
});
