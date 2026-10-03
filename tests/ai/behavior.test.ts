// Behaviour of the Loyalist AI on small hand-built scenarios and the fixture.
import { describe, expect, it } from 'vitest';
import { createGame, manhattan, neighbors4, type Action, type GameState } from '../../src/engine';
import { assignRole, chooseAiAction, threatMapFor } from '../../src/ai';
import { prologueScenario } from '../../src/content/prologue';
import { miniPrologue } from '../engine/fixtures/miniPrologue';
import { eventsOf, floor, game, loyal, mutate, rebel, unit } from '../engine/helpers';
import { aiPhase, passiveRebels, playRounds } from './aiHelpers';

/** Hands the turn to the AI (ends the rebel phase of round 1). */
function aiTurn(s: GameState): GameState {
  return passiveRebels(s).state;
}

function actionsOf(actions: Action[], unitId: string): Action[] {
  return actions.filter((a) => a.kind !== 'endTurn' && a.unitId === unitId);
}

const mira = (pos: [number, number], extra = {}) =>
  loyal('mira', 'radiant', pos, { character: 'mira', tags: ['escapee'], ...extra });
const elian = (pos: [number, number], extra = {}) =>
  loyal('elian', 'ascendant', pos, { character: 'elian', tags: ['escapee'], ...extra });

describe('Mira', () => {
  it('flees to her exit and escapes when unopposed', () => {
    const s0 = game(['##########', '..........', '##########'], [mira([0, 1])], {
      exits: [{ id: 'miraExit', tiles: [[9, 1]], units: ['mira'] }],
    });
    const r = playRounds(s0, 3);
    const escaped = eventsOf(r.events, 'escaped');
    expect(escaped).toHaveLength(1);
    expect(escaped[0]!.unitId).toBe('mira');
    expect(r.state.outcome.miraOutcome).toBe('escaped');
    // Cost 9 at move 4: out on the third AI phase.
    expect(r.state.removedUnits.find((x) => x.unit.id === 'mira')?.round).toBe(3);
  });

  it('takes the unthreatened lane when both lanes are equally short', () => {
    // A Radiant (who cannot move) covers the north lane across the water.
    const map = ['~~~~.~~~~~', '..........', '.########.', '..........'];
    const s0 = aiTurn(
      game(map, [mira([0, 2]), rebel('archer', 'radiant', [4, 0], { stats: { move: 0 } })], {
        exits: [{ id: 'miraExit', tiles: [[9, 2]], units: ['mira'] }],
      }),
    );
    const a = chooseAiAction(s0);
    expect(a.kind).toBe('move');
    if (a.kind !== 'move') return;
    expect(a.to.y).toBe(3);
    const threat = threatMapFor(s0, 'loyalist');
    expect(threat.byTile[a.to.y * 10 + a.to.x]).toEqual([]);
    // The greedy alternative in the north lane is threatened.
    expect(threat.byTile[1 * 10 + 3]!.length).toBeGreaterThan(0);
  });
});

describe('Elian', () => {
  it('does nothing while sealed', () => {
    const s = aiTurn(createGame(miniPrologue()));
    expect(assignRole(s, unit(s, 'elian')).kind).toBe('inert');
    const r = aiPhase(s);
    expect(actionsOf(r.actions, 'elian')).toEqual([]);
  });

  it('escapes through the servants tunnel once unsealed', () => {
    const s0 = mutate(createGame(miniPrologue()), (m) => {
      m.sealBroken = true;
      for (const u of m.units) u.statuses = u.statuses.filter((x) => x !== 'sealed');
    });
    const r = playRounds(s0, 2);
    expect(eventsOf(r.events, 'escaped').map((e) => e.unitId)).toContain('elian');
    expect(r.state.outcome.elianOutcome).toBe('escaped');
  });

  it('escapes after the anchor breakers free him (fixture, passive rebels)', () => {
    const r = playRounds(createGame(miniPrologue()), 10);
    const seal = eventsOf(r.events, 'sealBroken');
    expect(seal).toHaveLength(1);
    expect(seal[0]!.reason).toBe('anchors');
    expect(r.state.outcome.elianOutcome).toBe('escaped');
  });

  it('runs instead of fighting when he has a way out', () => {
    const map = ['#########', '#........', '#........', '#########'];
    const s0 = aiTurn(
      game(map, [elian([1, 1]), rebel('wolf', 'soldier', [1, 2])], {
        exits: [{ id: 'elianExit', tiles: [[8, 1]], units: ['elian'] }],
      }),
    );
    const r = aiPhase(s0);
    const mine = actionsOf(r.actions, 'elian');
    expect(mine.some((a) => a.kind === 'attack')).toBe(false);
    expect(mine[0]!.kind).toBe('move');
  });

  it('attacks only when cornered, and never lands a killing blow', () => {
    const map = ['#######', '#......', '#######'];
    const s0 = aiTurn(
      game(map, [elian([1, 1]), rebel('wolf', 'soldier', [2, 1], { stats: { hp: 2, maxHp: 10 } })], {
        exits: [{ id: 'elianExit', tiles: [[6, 1]], units: ['elian'] }],
      }),
    );
    const r = aiPhase(s0);
    expect(actionsOf(r.actions, 'elian')).toContainEqual({ kind: 'attack', unitId: 'elian', targetId: 'wolf' });
    expect(unit(r.state, 'wolf').hp).toBe(1);
  });
});

describe('anchor breakers', () => {
  it('break every ward anchor on the fixture before the Second Bell', () => {
    const r = playRounds(createGame(miniPrologue()), 8);
    const destroyed = eventsOf(r.events, 'objectDestroyed').filter((e) => e.objectKind === 'anchor');
    expect(destroyed.map((e) => e.objectId).sort()).toEqual(['anchorA', 'anchorB', 'anchorC']);
    expect(eventsOf(r.events, 'sealBroken')[0]?.reason).toBe('anchors');
  });

  it('hit an adjacent anchor rather than an adjacent rebel', () => {
    const s0 = aiTurn(
      game(
        floor(8, 3),
        [
          loyal('elian', 'ascendant', [7, 2], { character: 'elian', statuses: ['sealed'] }),
          loyal('sapper', 'soldier', [1, 1], { tags: ['anchorBreaker'] }),
          rebel('wolf', 'soldier', [0, 1]),
        ],
        { objects: [{ id: 'anchorA', kind: 'anchor', pos: [2, 1] }] },
      ),
    );
    expect(assignRole(s0, unit(s0, 'sapper')).kind).toBe('breaker');
    const r = aiPhase(s0);
    expect(actionsOf(r.actions, 'sapper')).toContainEqual({ kind: 'attack', unitId: 'sapper', targetId: 'anchorA' });
  });
});

describe('guards', () => {
  const zones = { hall: { x: 1, y: 1, w: 5, h: 3 } };

  it('attack adjacent rebels and take the kill', () => {
    const s0 = aiTurn(
      game(
        floor(7, 5),
        [
          loyal('guard', 'kindled', [3, 2], { guardZone: 'hall' }),
          rebel('healthy', 'soldier', [3, 1]),
          rebel('wounded', 'soldier', [2, 2], { stats: { hp: 3, maxHp: 10 } }),
        ],
        { zones },
      ),
    );
    const a = chooseAiAction(s0);
    expect(a).toEqual({ kind: 'attack', unitId: 'guard', targetId: 'wounded' });
  });

  it('do not waste attacks on an Ascendant when another target is in reach', () => {
    const s0 = aiTurn(
      game(
        floor(7, 5),
        [
          loyal('guard', 'soldier', [3, 2], { guardZone: 'hall' }),
          rebel('varek', 'ascendant', [3, 1], { character: 'varek' }),
          rebel('wolf', 'kindled', [4, 2]),
        ],
        { zones },
      ),
    );
    const r = aiPhase(s0);
    const attacks = actionsOf(r.actions, 'guard').filter((a) => a.kind === 'attack');
    expect(attacks).toEqual([{ kind: 'attack', unitId: 'guard', targetId: 'wolf' }]);
  });

  it('hold their zone instead of chasing a distant rebel', () => {
    const s0 = aiTurn(
      game(floor(16, 3), [loyal('guard', 'kindled', [1, 1], { guardZone: 'post' }), rebel('wolf', 'soldier', [12, 1])], {
        zones: { post: { x: 0, y: 0, w: 4, h: 3 } },
      }),
    );
    const r = aiPhase(s0);
    expect(unit(r.state, 'guard').pos.x).toBeLessThanOrEqual(3 + 2);
    expect(actionsOf(r.actions, 'guard').some((a) => a.kind === 'attack')).toBe(false);
  });

  it('stand on the tiles next to the Emperor so Varek cannot Confront', () => {
    const map = ['#######', '#.....#', '#.....#', '#.....#', '#######'];
    const s0 = aiTurn(
      game(
        map,
        [
          loyal('halden', 'soldier', [3, 2], { character: 'halden', tags: ['noResist'] }),
          loyal('g1', 'soldier', [1, 1], { guardZone: 'hall' }),
          loyal('g2', 'soldier', [1, 2], { guardZone: 'hall' }),
          loyal('g3', 'soldier', [1, 3], { guardZone: 'hall' }),
          loyal('g4', 'soldier', [5, 3], { guardZone: 'hall' }),
          rebel('varek', 'ascendant', [5, 1], { character: 'varek', stats: { move: 0 } }),
        ],
        { zones: { hall: { x: 1, y: 1, w: 5, h: 3 } } },
      ),
    );
    const r = aiPhase(s0);
    const halden = unit(r.state, 'halden');
    for (const n of neighbors4(halden.pos)) {
      const occupant = r.state.units.find((u) => u.pos.x === n.x && u.pos.y === n.y);
      expect(occupant?.faction).toBe('loyalist');
    }
  });
});

describe('reinforcements', () => {
  // Emperor on the west, Mira on the east, a free soldier in the middle.
  const units = (varekAt: [number, number]) => [
    loyal('halden', 'soldier', [1, 1], { character: 'halden', tags: ['noResist'] }),
    // An escapee with no exit on this map: she stays put and is defended.
    loyal('mira', 'radiant', [23, 1], { character: 'mira', tags: ['escapee'] }),
    loyal('watch', 'soldier', [12, 1]),
    rebel('varek', 'ascendant', varekAt, { character: 'varek', stats: { move: 0 } }),
  ];

  it('head for the Emperor when he is threatened', () => {
    const s0 = aiTurn(game(floor(25, 3), units([3, 1])));
    const r = aiPhase(s0);
    expect(unit(r.state, 'watch').pos.x).toBeLessThan(12);
  });

  it('head for the most threatened ward, even if it ranks lower', () => {
    const s0 = aiTurn(game(floor(25, 3), units([21, 1])));
    const r = aiPhase(s0);
    expect(unit(r.state, 'watch').pos.x).toBeGreaterThan(12);
  });
});

describe('Orsa', () => {
  it('fights Grimm while dueling', () => {
    const s0 = aiTurn(createGame(miniPrologue()));
    expect(assignRole(s0, unit(s0, 'orsa')).kind).toBe('duelist');
    const r = aiPhase(s0);
    expect(actionsOf(r.actions, 'orsa')).toContainEqual({ kind: 'attack', unitId: 'orsa', targetId: 'grimm' });
    expect(r.state.domains).toEqual([]);
  });

  it('once free, raises Bulwark over the Emperor as Varek closes in', () => {
    const s0 = aiTurn(
      game(floor(14, 7), [
        loyal('halden', 'soldier', [2, 3], { character: 'halden', tags: ['noResist'] }),
        loyal('orsa', 'ascendant', [5, 3], { character: 'orsa' }),
        rebel('varek', 'ascendant', [12, 3], { character: 'varek' }),
      ]),
    );
    const r = aiPhase(s0);
    const d = r.state.domains.find((x) => x.ownerId === 'orsa');
    expect(d?.kind).toBe('bulwark');
    const orsa = unit(r.state, 'orsa');
    for (const n of neighbors4({ x: 2, y: 3 })) expect(manhattan(orsa.pos, n)).toBeLessThanOrEqual(3);
  });

  it('keeps Bulwark in reserve when nothing threatens the Emperor', () => {
    const s0 = aiTurn(
      game(floor(30, 7), [
        loyal('halden', 'soldier', [2, 3], { character: 'halden', tags: ['noResist'] }),
        loyal('orsa', 'ascendant', [5, 3], { character: 'orsa' }),
        rebel('varek', 'ascendant', [29, 3], { character: 'varek', stats: { move: 0 } }),
      ]),
    );
    const r = aiPhase(s0);
    expect(r.state.domains).toEqual([]);
  });
});

describe('ranged units', () => {
  it('a wounded Radiant shoots, then falls back out of reach', () => {
    const s0 = aiTurn(
      game(floor(14, 1), [
        loyal('archer', 'radiant', [5, 0], { stats: { hp: 5, maxHp: 18 } }),
        rebel('wolf', 'kindled', [2, 0]),
      ]),
    );
    const r = aiPhase(s0);
    const mine = actionsOf(r.actions, 'archer');
    expect(mine[0]).toEqual({ kind: 'attack', unitId: 'archer', targetId: 'wolf' });
    expect(mine[1]?.kind).toBe('move');
    expect(unit(r.state, 'archer').pos.x).toBeGreaterThanOrEqual(9);
  });
});

describe('full games', () => {
  it('the AI finishes a whole fixture battle against a passive rebel side', () => {
    const r = playRounds(createGame(miniPrologue()), 20);
    expect(r.state.gameOver).toBe(true);
    expect(r.state.result?.winner).toBe('loyalist');
  });

  it('sanity: on the real prologue against a passive rebel side, Mira and Elian get out and Dawn wins it', () => {
    const r = playRounds(createGame(prologueScenario), 14);
    expect(r.state.gameOver).toBe(true);
    expect(r.state.result?.winner).toBe('loyalist');
    expect(r.state.outcome.miraOutcome).toBe('escaped');
    expect(r.state.outcome.elianOutcome).toBe('escaped');
    expect(eventsOf(r.events, 'sealBroken')[0]?.reason).toBe('anchors');
  });
});
