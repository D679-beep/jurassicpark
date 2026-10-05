import { describe, expect, it } from 'vitest';
import { applyAction, findUnit, getLegalActions, type Action, type GameState } from '../../src/engine';
import { approachOptions, interactionHint, interactionLabel, interactionTargets, resolveFollowUp } from '../../src/ui/interactions';
import { makeNameLookup } from '../../src/ui/names';
import { selectUnit } from '../../src/ui/selection';
import { addKaelaAndMira, placeUnit, uiGame, uiGameWith } from './fixture';

const unitSel = (s: GameState, id: string) => {
  const sel = selectUnit(s, id);
  if (sel.mode !== 'unit') throw new Error(`${id} is not selectable`);
  return sel;
};

const move = (s: GameState, unitId: string, to: [number, number]): GameState =>
  applyAction(s, { kind: 'move', unitId, to: { x: to[0], y: to[1] } }).state;

describe('interaction targets', () => {
  it('turns Confront into a target on the Emperor, with a label and what it does', () => {
    const s = move(uiGame(), 'varek', [3, 2]);
    const sel = unitSel(s, 'varek');
    const t = sel.interactions.find((x) => x.interaction === 'confront')!;
    expect(t).toMatchObject({ key: 'interact:confront:halden', id: 'halden', kind: 'unit', label: 'Confront Emperor Halden' });
    expect(t.tiles).toEqual([{ x: 3, y: 1 }]);
    expect(t.action).toEqual({ kind: 'interact', unitId: 'varek', interaction: 'confront', targetId: 'halden' });
    expect(t.hint).toBe('Kills Emperor Halden. Completes the required objective: Kill Emperor Halden.');
    // The HUD command for the same interaction carries the same key.
    expect(sel.commands.some((c) => c.key === t.key)).toBe(true);
  });

  it('turns Burn Bridge into a target on every tile of the bridge', () => {
    const s = uiGame();
    const t = unitSel(s, 'archer').interactions.find((x) => x.interaction === 'burnBridge')!;
    expect(t.kind).toBe('object');
    expect(t.tiles).toEqual([{ x: 3, y: 4 }]);
    expect(t.hint).toContain('turns to water');
  });

  it('turns Capture into a target on Mira once she is weak enough and Kaela is beside her', () => {
    const s = uiGameWith((d) => addKaelaAndMira(d, [6, 5], [7, 5]));
    const t = unitSel(s, 'kaela').interactions.find((x) => x.interaction === 'capture')!;
    expect(t).toMatchObject({ id: 'mira', kind: 'unit', label: 'Capture Princess Mira' });
    expect(t.hint).toBe('Takes Princess Mira prisoner. Completes the optional objective: Imprison Princess Mira.');
  });

  it('offers no target for an interaction that is not legal', () => {
    // Varek is two tiles from Halden.
    expect(unitSel(uiGame(), 'varek').interactions.filter((x) => x.interaction === 'confront')).toEqual([]);
  });

  it('labels and describes interactions generically', () => {
    const s = uiGame();
    const name = makeNameLookup(s);
    expect(interactionLabel('confront', 'Emperor Halden')).toBe('Confront Emperor Halden');
    expect(interactionLabel('escape', 'Mira')).toBe('Escape');
    expect(interactionHint(s, 'escape', 'x', name)).toBe('Leave the battlefield here.');
    // A kind the UI has never heard of still gets a sentence.
    expect(interactionHint(s, 'revive' as never, 'wolf', name)).toBe('Revive Ashen Wolf.');
  });
});

describe('approach (move, then interact)', () => {
  it('finds the tiles beside the Emperor Varek can reach and picks the nearest as best', () => {
    const s = uiGame();
    const sel = unitSel(s, 'varek');
    expect(sel.approaches).toHaveLength(1);
    const a = sel.approaches[0]!;
    expect(a).toMatchObject({ key: 'approach:confront:halden', id: 'halden', interaction: 'confront', label: 'Confront Emperor Halden' });
    expect(a.pos).toEqual({ x: 3, y: 1 });
    expect(a.stand).toEqual(expect.arrayContaining([{ x: 3, y: 2 }, { x: 2, y: 1 }, { x: 4, y: 1 }]));
    expect(a.stand).toHaveLength(3);
    // (3,2) is one step away; the others are two or three.
    expect(a.best).toEqual({ x: 3, y: 2 });
    // Every stand tile is a real legal move.
    for (const p of a.stand) expect(sel.moves).toContainEqual(p);
  });

  it('is not offered when the interaction is possible from here, or once the unit has moved or acted', () => {
    const beside = move(uiGame(), 'varek', [3, 2]);
    expect(unitSel(beside, 'varek').approaches).toEqual([]);
    const acted = applyAction(uiGame(), { kind: 'wait', unitId: 'varek' }).state;
    expect(selectUnit(acted, 'varek').mode).toBe('none');
    // Moved but not beside him: no moves left, so no approach.
    const far = move(uiGame(), 'varek', [6, 3]);
    expect(unitSel(far, 'varek').approaches).toEqual([]);
  });

  it('is not offered to units that cannot do the interaction', () => {
    expect(unitSel(uiGame(), 'wolf').approaches).toEqual([]);
    expect(unitSel(uiGame(), 'archer').approaches).toEqual([]);
  });

  it('lets Kaela walk up to a weakened Mira', () => {
    const s = uiGameWith((d) => addKaelaAndMira(d, [5, 5], [8, 5]));
    const a = unitSel(s, 'kaela').approaches.find((x) => x.interaction === 'capture')!;
    expect(a).toBeDefined();
    expect(a.id).toBe('mira');
    expect(a.stand).toContainEqual(a.best);
    // From the best tile the capture really is legal.
    const moved = move(s, 'kaela', [a.best.x, a.best.y]);
    expect(resolveFollowUp(moved, { unitId: 'kaela', interaction: 'capture', targetId: 'mira' })).toEqual({
      kind: 'interact',
      unitId: 'kaela',
      interaction: 'capture',
      targetId: 'mira',
    });
  });

  it('breaks a tie in walking cost by cover, then by row and column', () => {
    // From (4,2), (3,2) and (4,1) are both one step. Make (3,2) a throne dais (+1 defense).
    const s = uiGameWith((d) => {
      d.map = d.map.map((row, y) => (y === 2 ? '#..T.....#' : row));
      placeUnit(d, 'varek', [4, 2]);
    });
    const a = unitSel(s, 'varek').approaches[0]!;
    expect(a.stand).toEqual(expect.arrayContaining([{ x: 3, y: 2 }, { x: 4, y: 1 }]));
    expect(a.best).toEqual({ x: 3, y: 2 });
    // Without the cover, row-major order decides: (4,1) before (3,2).
    const flat = uiGameWith((d) => placeUnit(d, 'varek', [4, 2]));
    expect(unitSel(flat, 'varek').approaches[0]!.best).toEqual({ x: 4, y: 1 });
  });
});

describe('resolveFollowUp', () => {
  const f = { unitId: 'varek', interaction: 'confront' as const, targetId: 'halden' };

  it('is null until the unit stands beside the target, then the engine action', () => {
    const s = uiGame();
    expect(resolveFollowUp(s, f)).toBeNull();
    const moved = move(s, 'varek', [3, 2]);
    const a = resolveFollowUp(moved, f)!;
    expect(a).toEqual({ kind: 'interact', unitId: 'varek', interaction: 'confront', targetId: 'halden' });
    // It is exactly an action getLegalActions offers.
    expect(getLegalActions(moved, 'varek')).toContainEqual(a);
  });

  it('is null when the state moved on (the unit already acted, or it is not the player turn)', () => {
    const moved = move(uiGame(), 'varek', [3, 2]);
    const done = applyAction(moved, { kind: 'wait', unitId: 'varek' }).state;
    expect(resolveFollowUp(done, f)).toBeNull();
    const ai = applyAction(moved, { kind: 'endTurn' }).state;
    expect(resolveFollowUp(ai, f)).toBeNull();
  });

  it('completes the Confront walk-up through two ordinary actions', () => {
    let s = uiGame();
    const sel = unitSel(s, 'varek');
    const a = sel.approaches[0]!;
    const walk: Action = { kind: 'move', unitId: 'varek', to: a.best };
    s = applyAction(s, walk).state;
    expect(findUnit(s, 'varek')!.pos).toEqual({ x: 3, y: 2 });
    const confront = resolveFollowUp(s, { unitId: 'varek', interaction: a.interaction, targetId: a.id })!;
    const r = applyAction(s, confront);
    expect(r.state.outcome.emperorKilled).toBe(true);
    expect(r.events.some((e) => e.type === 'died' && e.unitId === 'halden' && e.cause === 'confront')).toBe(true);
    expect(approachOptions(r.state, findUnit(r.state, 'varek')!, [], [])).toEqual([]);
  });
});

describe('interaction targets on a unit that has already moved', () => {
  it('makes a bridge a click target once the unit is beside it and has no moves left', () => {
    const start = uiGameWith((d) => placeUnit(d, 'archer', [4, 5]));
    const s = move(start, 'archer', [3, 5]); // (3,5) touches the bridge tile (3,4)
    const sel = unitSel(s, 'archer');
    expect(sel.moves).toEqual([]);
    expect(interactionTargets(s, findUnit(s, 'archer')!, getLegalActions(s, 'archer')).map((t) => t.interaction)).toContain('burnBridge');
    expect(sel.interactions.some((t) => t.interaction === 'burnBridge')).toBe(true);
  });
});
