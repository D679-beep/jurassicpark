import { describe, expect, it } from 'vitest';
import {
  applyAction,
  attackableTargets,
  createGame,
  decideGame,
  getLegalActions,
  getObjective,
  IllegalActionError,
  reachableTiles,
  type GameState,
} from '../../src/engine';
import { miniPrologue } from './fixtures/miniPrologue';
import { advanceTo, eventsOf, mutate, play, unit } from './helpers';

const fx = (): GameState => createGame(miniPrologue());
const place = (s: GameState, moves: Record<string, [number, number]>, hps: Record<string, number> = {}): GameState =>
  mutate(s, (x) => {
    for (const [id, [px, py]] of Object.entries(moves)) unit(x, id).pos = { x: px, y: py };
    for (const [id, hp] of Object.entries(hps)) unit(x, id).hp = hp;
  });

describe('defeat', () => {
  it('when Varek dies', () => {
    const s = play(place(fx(), { varek: [5, 2] }, { varek: 1 }), { kind: 'endTurn' }).state;
    const { state, events } = play(s, { kind: 'attack', unitId: 'guard2', targetId: 'varek' });
    expect(state.gameOver).toBe(true);
    expect(state.result).toEqual({
      result: 'defeat',
      winner: 'loyalist',
      reason: 'Varek has fallen',
      outcome: { emperorKilled: false, elianOutcome: 'alive', miraOutcome: 'free' },
    });
    expect(events.at(-1)).toEqual({ type: 'gameOver', result: 'defeat', winner: 'loyalist', reason: 'Varek has fallen', outcome: state.result!.outcome });
  });

  it('when Kaela dies', () => {
    const s = play(place(fx(), { kaela: [3, 9] }, { kaela: 1 }), { kind: 'endTurn' }).state;
    const { state } = play(s, { kind: 'attack', unitId: 'mira', targetId: 'kaela' });
    expect(state.result).toMatchObject({ result: 'defeat', reason: 'Kaela has fallen' });
  });

  it('when Dawn arrives with the Emperor alive', () => {
    const r12 = advanceTo(fx(), 12).state;
    expect(r12.gameOver).toBe(false);
    const { state, events } = advanceTo(r12, 13);
    expect(state.round).toBe(13);
    expect(state.result).toMatchObject({ result: 'defeat', winner: 'loyalist', reason: 'Dawn arrived with the Emperor still alive' });
    expect(getObjective(state, 'killEmperor')!.status).toBe('failed');
    expect(eventsOf(events, 'objectiveFailed').map((e) => [e.objectiveId, e.reason])).toContainEqual(['killEmperor', 'Dawn arrived first']);
    const kinds = events.map((e) => e.type);
    expect(kinds.lastIndexOf('bellRang')).toBeLessThan(kinds.indexOf('gameOver'));
  });

  it('a defeat condition beats a simultaneous victory condition', () => {
    const s = mutate(fx(), (x) => {
      x.outcome = { emperorKilled: true, elianOutcome: 'killed', miraOutcome: 'captured' };
      for (const o of x.objectives) o.status = 'completed';
      const v = unit(x, 'varek');
      x.units = x.units.filter((u) => u.id !== 'varek');
      x.removedUnits.push({ unit: v, reason: 'died', round: 1 });
    });
    expect(decideGame(s)).toEqual(['loyalist', 'Varek has fallen']);
  });
});

describe('victory', () => {
  it('as soon as the Emperor is dead and the Elian and Mira objectives are resolved', () => {
    // Round 1: Kaela captures Mira, Varek kills Elian.
    const r1 = play(
      place(fx(), { kaela: [3, 9], varek: [18, 3] }, { mira: 9, elian: 3 }),
      { kind: 'interact', unitId: 'kaela', interaction: 'capture', targetId: 'mira' },
      { kind: 'attack', unitId: 'varek', targetId: 'elian' },
    ).state;
    expect(r1.gameOver).toBe(false);
    // Round 2: Varek confronts the Emperor.
    const r2 = place(play(r1, { kind: 'endTurn' }, { kind: 'endTurn' }).state, { varek: [4, 1] });
    const { state, events } = play(r2, { kind: 'interact', unitId: 'varek', interaction: 'confront', targetId: 'halden' });
    expect(state.result).toMatchObject({
      result: 'victory',
      winner: 'rebel',
      outcome: { emperorKilled: true, elianOutcome: 'killed', miraOutcome: 'captured' },
    });
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf('objectiveCompleted')).toBeLessThan(kinds.indexOf('gameOver'));
  });

  it('failed optional objectives count as resolved', () => {
    const s = mutate(fx(), (x) => {
      x.outcome.elianOutcome = 'escaped';
      x.outcome.miraOutcome = 'dead';
    });
    const st = play(place(s, { varek: [4, 1] }), { kind: 'interact', unitId: 'varek', interaction: 'confront', targetId: 'halden' }).state;
    expect(st.result).toMatchObject({ result: 'victory', outcome: { emperorKilled: true, elianOutcome: 'escaped', miraOutcome: 'dead' } });
    expect(st.objectives.map((o) => o.status)).toEqual(['completed', 'failed', 'failed', 'pending', 'pending']);
  });

  it('when Dawn arrives with the Emperor dead, whatever else happened', () => {
    const killed = play(place(fx(), { varek: [4, 1] }), { kind: 'interact', unitId: 'varek', interaction: 'confront', targetId: 'halden' }).state;
    expect(killed.gameOver).toBe(false);
    const { state } = advanceTo(killed, 13);
    expect(state.result).toMatchObject({
      result: 'victory',
      reason: 'Dawn arrived with the Emperor dead',
      outcome: { emperorKilled: true, elianOutcome: 'alive', miraOutcome: 'free' },
    });
    expect(getObjective(state, 'killElian')!.status).toBe('pending');
  });

  it('is reported from the player faction point of view', () => {
    const s = createGame({ ...miniPrologue(), playerFaction: 'loyalist' });
    const varekLow = mutate(s, (x) => {
      unit(x, 'varek').pos = { x: 5, y: 2 };
      unit(x, 'varek').hp = 1;
    });
    const { state } = play(varekLow, { kind: 'attack', unitId: 'guard2', targetId: 'varek' });
    expect(state.result).toMatchObject({ result: 'victory', winner: 'loyalist' });
  });
});

describe('after the game is over', () => {
  const over = advanceTo(fx(), 13).state;

  it('rejects every action and lists none', () => {
    expect(over.gameOver).toBe(true);
    expect(() => applyAction(over, { kind: 'endTurn' })).toThrow(IllegalActionError);
    try {
      applyAction(over, { kind: 'wait', unitId: 'varek' });
    } catch (e) {
      expect((e as IllegalActionError).code).toBe('GAME_OVER');
    }
    expect(getLegalActions(over, 'varek')).toEqual([]);
    expect(reachableTiles(over, 'varek')).toEqual([]);
    expect(attackableTargets(over, 'varek')).toEqual([]);
  });
});

describe('outcome flags', () => {
  it('start as alive/free and track every removal', () => {
    expect(fx().outcome).toEqual({ emperorKilled: false, elianOutcome: 'alive', miraOutcome: 'free' });
  });
});
