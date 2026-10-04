import { describe, expect, it } from 'vitest';
import {
  activeDomainOf,
  applyAction,
  attackableTargets,
  availableInteractions,
  createGame,
  domainTiles,
  getLegalActions,
  getObjective,
  IllegalActionError,
  isDuelActive,
  isInZone,
  previewDamage,
  reachableTiles,
  type GameState,
} from '../../src/engine';
import { miniPrologue } from './fixtures/miniPrologue';
import { advanceTo, eventsOf, mutate, nextRoll, nextRound, play, unit } from './helpers';

const fx = (): GameState => createGame(miniPrologue());
const toAi = (s: GameState): GameState => play(s, { kind: 'endTurn' }).state;
const place = (s: GameState, moves: Record<string, [number, number]>): GameState =>
  mutate(s, (x) => {
    for (const [id, [px, py]] of Object.entries(moves)) unit(x, id).pos = { x: px, y: py };
  });
const setHp = (s: GameState, hps: Record<string, number>): GameState =>
  mutate(s, (x) => {
    for (const [id, hp] of Object.entries(hps)) unit(x, id).hp = hp;
  });

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof IllegalActionError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

describe('The Wellspring seal', () => {
  it('a sealed unit cannot move or act', () => {
    const ai = toAi(fx());
    expect(getLegalActions(ai, 'elian')).toEqual([{ kind: 'endTurn' }]);
    expect(reachableTiles(ai, 'elian')).toEqual([]);
    expect(codeOf(() => applyAction(ai, { kind: 'wait', unitId: 'elian' }))).toBe('UNIT_CANNOT_ACT');
    expect(codeOf(() => applyAction(ai, { kind: 'move', unitId: 'elian', to: { x: 18, y: 3 } }))).toBe('UNIT_CANNOT_ACT');
  });

  it('cannot be harmed by non-Ascendants', () => {
    const s = place(fx(), { wolf1: [18, 3] });
    expect(attackableTargets(s, 'wolf1').map((t) => t.id)).not.toContain('elian');
    expect(() => applyAction(s, { kind: 'attack', unitId: 'wolf1', targetId: 'elian' })).toThrow(/only be harmed by an Ascendant/);
    expect(previewDamage(s, 'wolf1', 'elian')!.outcomes).toEqual([0, 0, 0]);
  });

  it('Ascendants attack a sealed unit at full damage', () => {
    const s = place(fx(), { varek: [18, 3] });
    expect(attackableTargets(s, 'varek').map((t) => t.id)).toContain('elian');
    const roll = nextRoll(s);
    const { state } = play(s, { kind: 'attack', unitId: 'varek', targetId: 'elian' });
    expect(unit(state, 'elian').hp).toBe(40 - (6 + roll));
  });

  it('Tempest damages a sealed unit', () => {
    const s = place(fx(), { varek: [18, 4 + 1] }); // (18,5): 3 from Elian at (18,2)
    const { state } = play(s, { kind: 'domain', unitId: 'varek' });
    expect(unit(state, 'elian').hp).toBe(32);
  });

  it('breaks when every ward anchor is destroyed', () => {
    const s = mutate(fx(), (x) => {
      for (const o of x.map.objects) {
        if (o.kind === 'anchor' && o.id !== 'anchorC') o.destroyed = true;
        if (o.kind === 'anchor' && o.id === 'anchorC') o.hp = 1;
      }
    });
    expect(attackableTargets(s, 'wolf1').map((t) => t.id)).toContain('anchorC');
    const { state, events } = play(s, { kind: 'attack', unitId: 'wolf1', targetId: 'anchorC' });
    expect(eventsOf(events, 'sealBroken')).toEqual([{ type: 'sealBroken', unitIds: ['elian'], reason: 'anchors' }]);
    expect(eventsOf(events, 'dialogue')[0]).toMatchObject({ trigger: 'sealBroken', speakerId: 'elian', speaker: 'Prince Elian', text: 'The ward is gone.' });
    expect(unit(state, 'elian').statuses).toEqual([]);
    expect(state.sealBroken).toBe(true);
    const ai = toAi(state);
    expect(getLegalActions(ai, 'elian').some((a) => a.kind === 'move')).toBe(true);
  });

  it('two of three anchors are not enough', () => {
    const s = mutate(fx(), (x) => {
      const a = x.map.objects.find((o) => o.id === 'anchorA');
      if (a && a.kind === 'anchor') a.destroyed = true;
    });
    const { state } = play(s, { kind: 'wait', unitId: 'wolf1' });
    expect(state.sealBroken).toBe(false);
  });

  it('breaks at the Second Bell', () => {
    const r8 = advanceTo(fx(), 8).state;
    expect(unit(r8, 'elian').statuses).toContain('sealed');
    const { state, events } = nextRound(r8);
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf('bellRang')).toBeLessThan(kinds.indexOf('sealBroken'));
    expect(eventsOf(events, 'sealBroken')[0]).toMatchObject({ reason: 'secondBell' });
    expect(unit(state, 'elian').statuses).toEqual([]);
  });
});

describe('The Feast Hall duel', () => {
  // Orsa two tiles from Grimm, a palace guard beside Grimm, an anchor in reach.
  const setup = (): GameState =>
    mutate(place(fx(), { orsa: [10, 2], guard1: [8, 1] }), (x) => {
      const a = x.map.objects.find((o) => o.id === 'anchorC');
      if (a && a.kind === 'anchor') a.pos = { x: 8, y: 3 };
    });

  it('starts active', () => {
    expect(isDuelActive(fx())).toBe(true);
  });

  it('duelists may only attack each other', () => {
    const s = setup();
    expect(attackableTargets(s, 'grimm').map((t) => t.id)).toEqual(['orsa']);
    expect(() => applyAction(s, { kind: 'attack', unitId: 'grimm', targetId: 'guard1' })).toThrow(/only attack the other duelist/);
    expect(() => applyAction(s, { kind: 'attack', unitId: 'grimm', targetId: 'anchorC' })).toThrow(/only attack the other duelist/);
  });

  it('other units may still attack a duelist', () => {
    const s = place(fx(), { wolf1: [11, 3] });
    expect(attackableTargets(s, 'wolf1').map((t) => t.id)).toContain('orsa');
  });

  it("the AI faction's duelist cannot leave feastHall", () => {
    const ai = toAi(fx());
    const r = reachableTiles(ai, 'orsa');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((p) => isInZone(ai, p, 'feastHall'))).toBe(true);
  });

  it("the player's duelist may walk out, which ends the duel", () => {
    const s = fx();
    expect(reachableTiles(s, 'grimm').some((p) => !isInZone(s, p, 'feastHall'))).toBe(true);
    const { state, events } = play(s, { kind: 'move', unitId: 'grimm', to: { x: 10, y: 5 } });
    expect(eventsOf(events, 'duelEnded')).toEqual([{ type: 'duelEnded', unitIds: ['grimm', 'orsa'], reason: 'leftFeastHall' }]);
    expect(isDuelActive(state)).toBe(false);
    expect(state.duel).toEqual({ unitIds: ['grimm', 'orsa'], active: false });
    expect(unit(state, 'grimm').statuses).toEqual([]);
    expect(unit(state, 'orsa').statuses).toEqual([]);
    // Orsa is free.
    const ai = toAi(state);
    expect(reachableTiles(ai, 'orsa').some((p) => !isInZone(ai, p, 'feastHall'))).toBe(true);
    // Returning does not restart the duel.
    const back = play(ai, { kind: 'endTurn' }, { kind: 'move', unitId: 'grimm', to: { x: 10, y: 3 } }).state;
    expect(isDuelActive(back)).toBe(false);
  });

  it('with the loyalists as player, Orsa may leave and Grimm is pinned', () => {
    const s = createGame({ ...miniPrologue(), playerFaction: 'loyalist' });
    expect(reachableTiles(s, 'orsa').some((p) => !isInZone(s, p, 'feastHall'))).toBe(true);
    const ai = toAi(s);
    expect(reachableTiles(ai, 'grimm').every((p) => isInZone(ai, p, 'feastHall'))).toBe(true);
  });

  it('both duelists take 3 at each round start', () => {
    const { state, events } = nextRound(fx());
    expect(unit(state, 'grimm').hp).toBe(37);
    expect(unit(state, 'orsa').hp).toBe(37);
    expect(eventsOf(events, 'damaged').map((e) => [e.targetId, e.amount, e.cause, e.sourceId])).toEqual([
      ['grimm', 3, 'duel', 'orsa'],
      ['orsa', 3, 'duel', 'grimm'],
    ]);
    expect(unit(advanceTo(state, 4).state, 'orsa').hp).toBe(31);
  });

  it('no duel damage once the duel has ended', () => {
    const out = play(fx(), { kind: 'move', unitId: 'grimm', to: { x: 10, y: 5 } }).state;
    expect(unit(nextRound(out).state, 'orsa').hp).toBe(40);
  });

  it('ends when a duelist dies', () => {
    const s = setHp(fx(), { orsa: 3 });
    const { state, events } = nextRound(s);
    expect(state.units.some((u) => u.id === 'orsa')).toBe(false);
    expect(unit(state, 'grimm').hp).toBe(37);
    expect(eventsOf(events, 'duelEnded')[0]).toMatchObject({ reason: 'duelistRemoved' });
    expect(unit(state, 'grimm').statuses).toEqual([]);
  });

  it('a duelist cannot interact', () => {
    const s = place(fx(), { grimm: [12, 3] });
    expect(availableInteractions(s, unit(s, 'grimm'))).toEqual([]);
  });

  it("a duelist's Domain cannot reach outside feastHall", () => {
    const s = place(setHp(fx(), { wolf1: 10 }), { wolf1: [8, 5] }); // 3 below Grimm, outside the hall
    const a = play(s, { kind: 'domain', unitId: 'grimm' }).state;
    const tiles = domainTiles(a, activeDomainOf(a, 'grimm')!);
    expect(tiles.every((p) => isInZone(a, p, 'feastHall'))).toBe(true);
    const r2 = nextRound(a).state;
    expect(unit(r2, 'wolf1').hp).toBe(10);
    expect(unit(r2, 'orsa').hp).toBe(40 - 4 - 3); // Pyre + duel
  });
});

describe('The Emperor', () => {
  it('never moves or acts', () => {
    expect(getLegalActions(toAi(fx()), 'halden')).toEqual([{ kind: 'endTurn' }]);
  });

  it('cannot be targeted by attacks', () => {
    const s = place(fx(), { wolf1: [2, 1], varek: [4, 1] });
    expect(attackableTargets(s, 'wolf1').map((t) => t.id)).not.toContain('halden');
    expect(attackableTargets(s, 'varek').map((t) => t.id)).not.toContain('halden');
    expect(() => applyAction(s, { kind: 'attack', unitId: 'varek', targetId: 'halden' })).toThrow(/cannot be damaged/);
  });

  it('is immune to Domain damage', () => {
    const s = place(fx(), { varek: [3, 2] });
    const { state } = play(s, { kind: 'domain', unitId: 'varek' });
    expect(unit(state, 'halden').hp).toBe(10);
    expect(unit(state, 'guard2').hp).toBe(2);
  });

  it('only Varek, adjacent, can Confront', () => {
    const s = place(fx(), { varek: [4, 1], kaela: [2, 1] });
    expect(availableInteractions(s, unit(s, 'varek'))).toContainEqual({ interaction: 'confront', targetId: 'halden' });
    expect(availableInteractions(s, unit(s, 'kaela')).some((i) => i.interaction === 'confront')).toBe(false);
    const far = place(fx(), { varek: [5, 1] });
    expect(availableInteractions(far, unit(far, 'varek'))).toEqual([]);
    expect(codeOf(() => applyAction(far, { kind: 'interact', unitId: 'varek', interaction: 'confront', targetId: 'halden' }))).toBe('INTERACTION_UNAVAILABLE');
  });

  it('Confront kills him with withheld last words', () => {
    const s = place(fx(), { varek: [4, 1] });
    const { state, events } = play(s, { kind: 'interact', unitId: 'varek', interaction: 'confront', targetId: 'halden' });
    expect(events.slice(0, 3)).toEqual([
      { type: 'dialogue', trigger: 'confront', speakerId: 'varek', speaker: 'Varek', text: 'Father.' },
      { type: 'dialogue', trigger: 'confront', speakerId: 'halden', speaker: 'Emperor Halden', text: '...' },
      { type: 'died', unitId: 'halden', name: 'Emperor Halden', faction: 'loyalist', pos: { x: 3, y: 1 }, killerId: 'varek', cause: 'confront' },
    ]);
    expect(eventsOf(events, 'objectiveCompleted').map((e) => e.objectiveId)).toEqual(['killEmperor']);
    expect(state.outcome.emperorKilled).toBe(true);
    expect(unit(state, 'varek').hasActed).toBe(true);
    expect(state.gameOver).toBe(false); // Elian and Mira unresolved
  });
});

describe('Princess Mira', () => {
  it("Kaela's attacks cannot reduce her below 1 HP", () => {
    const s = place(setHp(fx(), { mira: 2 }), { kaela: [3, 9] });
    const { state } = play(s, { kind: 'attack', unitId: 'kaela', targetId: 'mira' });
    expect(unit(state, 'mira').hp).toBe(1);
    const again = place(setHp(fx(), { mira: 1 }), { kaela: [3, 9] });
    const r = play(again, { kind: 'attack', unitId: 'kaela', targetId: 'mira' });
    expect(unit(r.state, 'mira').hp).toBe(1);
    expect(eventsOf(r.events, 'damaged')[0]!.amount).toBe(0);
  });

  it('Kaela can Capture her when adjacent and at or below 50% HP', () => {
    const healthy = place(setHp(fx(), { mira: 10 }), { kaela: [3, 9] });
    expect(availableInteractions(healthy, unit(healthy, 'kaela')).some((i) => i.interaction === 'capture')).toBe(false);
    const s = place(setHp(fx(), { mira: 9 }), { kaela: [3, 9] });
    expect(getLegalActions(s, 'kaela')).toContainEqual({ kind: 'interact', unitId: 'kaela', interaction: 'capture', targetId: 'mira' });
    const notAdjacent = place(setHp(fx(), { mira: 9 }), { kaela: [3, 10] });
    expect(availableInteractions(notAdjacent, unit(notAdjacent, 'kaela')).some((i) => i.interaction === 'capture')).toBe(false);
    const other = place(setHp(fx(), { mira: 9 }), { wolf3: [3, 9] });
    expect(availableInteractions(other, unit(other, 'wolf3')).some((i) => i.interaction === 'capture')).toBe(false);

    const { state, events } = play(s, { kind: 'interact', unitId: 'kaela', interaction: 'capture', targetId: 'mira' });
    expect(eventsOf(events, 'captured')).toEqual([{ type: 'captured', unitId: 'mira', byUnitId: 'kaela', pos: { x: 2, y: 9 } }]);
    expect(state.units.some((u) => u.id === 'mira')).toBe(false);
    expect(state.removedUnits.at(-1)).toMatchObject({ reason: 'captured', unit: { id: 'mira' } });
    expect(state.outcome.miraOutcome).toBe('captured');
    expect(getObjective(state, 'imprisonMira')!.status).toBe('completed');
  });

  it('dies if any other attack reduces her to 0', () => {
    const s = place(setHp(fx(), { mira: 1 }), { wolf3: [2, 10] });
    const { state, events } = play(s, { kind: 'attack', unitId: 'wolf3', targetId: 'mira' });
    expect(state.outcome.miraOutcome).toBe('dead');
    expect(eventsOf(events, 'objectiveFailed')).toEqual([{ type: 'objectiveFailed', objectiveId: 'imprisonMira', name: 'Imprison Princess Mira', reason: 'Mira died' }]);
  });

  it('dies to Domain damage too', () => {
    const s = place(setHp(fx(), { mira: 5 }), { varek: [3, 8 + 2] });
    const { state } = play(s, { kind: 'domain', unitId: 'varek' });
    expect(state.outcome.miraOutcome).toBe('dead');
  });

  it('escapes by leaving the map through her exit', () => {
    const ai = toAi(fx());
    const moved = play(ai, { kind: 'move', unitId: 'mira', to: { x: 0, y: 9 } });
    expect(eventsOf(moved.events, 'moved')[0]!.path).toEqual([
      { x: 1, y: 9 },
      { x: 0, y: 9 },
    ]);
    expect(getLegalActions(moved.state, 'mira')).toContainEqual({ kind: 'interact', unitId: 'mira', interaction: 'escape', targetId: 'towerExit' });
    const { state, events } = play(moved.state, { kind: 'interact', unitId: 'mira', interaction: 'escape', targetId: 'towerExit' });
    expect(eventsOf(events, 'escaped')).toEqual([{ type: 'escaped', unitId: 'mira', exitId: 'towerExit', pos: { x: 0, y: 9 } }]);
    expect(state.outcome.miraOutcome).toBe('escaped');
    expect(getObjective(state, 'imprisonMira')).toMatchObject({ status: 'failed' });
    expect(eventsOf(events, 'objectiveFailed')[0]!.reason).toBe('Mira escaped');
  });

  it('exits are limited to escapees they allow', () => {
    const s = toAi(place(mutate(fx(), (x) => (unit(x, 'elian').statuses = [])), { guard1: [0, 9], elian: [21, 2] }));
    expect(availableInteractions(s, unit(s, 'guard1'))).toEqual([]);
    const wrongExit = toAi(place(mutate(fx(), (x) => (unit(x, 'elian').statuses = [])), { elian: [0, 9], mira: [2, 10] }));
    expect(availableInteractions(wrongExit, unit(wrongExit, 'elian'))).toEqual([]);
  });
});

describe('Crown Prince Elian', () => {
  const unsealed = (): GameState => mutate(fx(), (x) => {
    unit(x, 'elian').statuses = [];
    x.sealBroken = true;
  });

  it("Elian's Vow: his attacks never reduce a unit below 1 HP", () => {
    const s = toAi(place(setHp(unsealed(), { wolf1: 2 }), { wolf1: [18, 3] }));
    expect(previewDamage(s, 'elian', 'wolf1')!.outcomes).toEqual([1, 1, 1]);
    const { state } = play(s, { kind: 'attack', unitId: 'elian', targetId: 'wolf1' });
    expect(unit(state, 'wolf1').hp).toBe(1);
  });

  it('escapes through the servants tunnel', () => {
    const s = toAi(place(unsealed(), { elian: [20, 2] }));
    const { state, events } = play(
      s,
      { kind: 'move', unitId: 'elian', to: { x: 21, y: 2 } },
      { kind: 'interact', unitId: 'elian', interaction: 'escape', targetId: 'tunnelExit' },
    );
    expect(eventsOf(events, 'escaped')[0]).toMatchObject({ unitId: 'elian', exitId: 'tunnelExit' });
    expect(state.outcome.elianOutcome).toBe('escaped');
    expect(getObjective(state, 'killElian')!.status).toBe('failed');
  });

  it('killing him completes the objective', () => {
    const s = place(setHp(fx(), { elian: 3 }), { varek: [18, 3] });
    const { state, events } = play(s, { kind: 'attack', unitId: 'varek', targetId: 'elian' });
    expect(state.outcome.elianOutcome).toBe('killed');
    expect(eventsOf(events, 'objectiveCompleted').map((e) => e.objectiveId)).toEqual(['killElian']);
  });
});
