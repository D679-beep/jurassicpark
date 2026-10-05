import { describe, expect, it } from 'vitest';
import { applyAction, findUnit, type GameState } from '../../src/engine';
import {
  NO_SELECTION,
  actorForTarget,
  attackForecast,
  clickTile,
  cycleSelection,
  forecastText,
  intentAt,
  isReady,
  readyUnitIds,
  refreshSelection,
  selectNextReadyAfter,
  selectUnit,
} from '../../src/ui/selection';
import { END, addKaelaAndMira, placeUnit, play, uiGame, uiGameWith } from './fixture';

describe('selection state machine', () => {
  it('selects a ready player unit with its moves, targets and commands', () => {
    const s = uiGame();
    const r = clickTile(s, NO_SELECTION, { x: 6, y: 2 });
    expect(r.action).toBeNull();
    expect(r.selection.mode).toBe('unit');
    if (r.selection.mode !== 'unit') return;
    expect(r.selection.unitId).toBe('wolf');
    expect(r.selection.moves.length).toBeGreaterThan(0);
    expect(r.selection.targets.map((t) => t.id)).toEqual(['guard']);
    expect(r.selection.commands.map((c) => c.key)).toContain('wait');
  });

  it('does not select enemies', () => {
    const s = uiGame();
    expect(clickTile(s, NO_SELECTION, { x: 7, y: 2 }).selection).toEqual(NO_SELECTION);
  });

  it('clicking the Emperor with nothing selected selects Varek and says what to do next', () => {
    const s = uiGame();
    const r = clickTile(s, NO_SELECTION, { x: 3, y: 1 });
    expect(r.action).toBeNull();
    expect(r.selection.mode === 'unit' && r.selection.unitId).toBe('varek');
    expect(r.notice).toBe('Varek is selected and can walk up to Emperor Halden. Click Emperor Halden again to Confront.');
  });

  it('turns a click on a reachable tile into a move, and keeps the unit selected afterwards', () => {
    const s = uiGame();
    const sel = selectUnit(s, 'wolf');
    const r = clickTile(s, sel, { x: 6, y: 3 });
    expect(r.action).toEqual({ kind: 'move', unitId: 'wolf', to: { x: 6, y: 3 } });
    const next = applyAction(s, r.action!).state;
    const after = refreshSelection(next, sel);
    expect(after.mode).toBe('unit');
    if (after.mode === 'unit') expect(after.moves).toEqual([]);
  });

  it('turns a click on a target into an attack', () => {
    const s = uiGame();
    const r = clickTile(s, selectUnit(s, 'wolf'), { x: 7, y: 2 });
    expect(r.action).toEqual({ kind: 'attack', unitId: 'wolf', targetId: 'guard' });
  });

  it('switches to another ready unit, and deselects on the same unit or empty ground', () => {
    const s = uiGame();
    const sel = selectUnit(s, 'wolf');
    const other = clickTile(s, sel, { x: 3, y: 3 });
    expect(other.selection.mode === 'unit' && other.selection.unitId).toBe('varek');
    expect(clickTile(s, sel, { x: 6, y: 2 }).selection).toEqual(NO_SELECTION);
    // Wall tile: neither a move nor a unit.
    expect(clickTile(s, sel, { x: 0, y: 0 })).toEqual({ selection: NO_SELECTION, action: null });
  });

  it('offers Domain and Confront from getLegalActions', () => {
    let s = uiGame();
    s = applyAction(s, { kind: 'move', unitId: 'varek', to: { x: 3, y: 2 } }).state;
    const sel = selectUnit(s, 'varek');
    expect(sel.mode).toBe('unit');
    if (sel.mode !== 'unit') return;
    const keys = sel.commands.map((c) => c.key);
    expect(keys).toContain('domain');
    expect(keys).toContain('interact:confront:halden');
    const confront = sel.commands.find((c) => c.key === 'interact:confront:halden')!;
    expect(confront.label).toBe('Confront Emperor Halden');
    expect(sel.commands.find((c) => c.key === 'domain')!.label).toBe('Domain: Tempest');
  });

  it('offers Burn Bridge next to a bridge', () => {
    const s = uiGame();
    const sel = selectUnit(s, 'archer');
    expect(sel.mode === 'unit' && sel.commands.some((c) => c.key === 'interact:burnBridge:bridgeMid')).toBe(true);
  });

  it('does nothing outside the player phase', () => {
    const s = play(uiGame(), END).state;
    expect(s.phase).toBe('ai');
    expect(isReady(s, 'wolf')).toBe(false);
    expect(readyUnitIds(s)).toEqual([]);
    expect(clickTile(s, NO_SELECTION, { x: 6, y: 2 })).toEqual({ selection: NO_SELECTION, action: null });
  });

  it('drops units with nothing left to do from the ready list', () => {
    const s = applyAction(uiGame(), { kind: 'wait', unitId: 'wolf' }).state;
    expect(readyUnitIds(s)).toEqual(['varek', 'archer']);
    expect(refreshSelection(s, selectUnit(uiGame(), 'wolf'))).toEqual(NO_SELECTION);
  });

  it('cycles through ready units with wrap-around', () => {
    const s = uiGame();
    const ids = readyUnitIds(s);
    expect(ids).toEqual(['varek', 'wolf', 'archer']);
    let sel = cycleSelection(s, NO_SELECTION);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      if (sel.mode === 'unit') seen.push(sel.unitId);
      sel = cycleSelection(s, sel);
    }
    expect(seen).toEqual(['varek', 'wolf', 'archer', 'varek']);
    const back = cycleSelection(s, selectUnit(s, 'varek'), -1);
    expect(back.mode === 'unit' && back.unitId).toBe('archer');
  });
});

describe('click targets: interactions on the map', () => {
  const beside = (): GameState => applyAction(uiGame(), { kind: 'move', unitId: 'varek', to: { x: 3, y: 2 } }).state;

  it('clicking the Emperor beside Varek performs Confront', () => {
    const s = beside();
    const sel = selectUnit(s, 'varek');
    const r = clickTile(s, sel, { x: 3, y: 1 });
    expect(r.action).toEqual({ kind: 'interact', unitId: 'varek', interaction: 'confront', targetId: 'halden' });
    expect(r.followUp).toBeUndefined();
    expect(intentAt(sel, { x: 3, y: 1 })).toMatchObject({ kind: 'interact' });
  });

  it('clicking the Emperor from afar walks Varek to the best tile first, then asks for Confront', () => {
    const s = uiGame();
    const r = clickTile(s, selectUnit(s, 'varek'), { x: 3, y: 1 });
    expect(r.action).toEqual({ kind: 'move', unitId: 'varek', to: { x: 3, y: 2 } });
    expect(r.followUp).toEqual({ unitId: 'varek', interaction: 'confront', targetId: 'halden' });
    // A plain stand tile is just a move, with no follow-up.
    const stand = clickTile(s, selectUnit(s, 'varek'), { x: 4, y: 1 });
    expect(stand.action).toEqual({ kind: 'move', unitId: 'varek', to: { x: 4, y: 1 } });
    expect(stand.followUp).toBeUndefined();
    expect(intentAt(selectUnit(s, 'varek'), { x: 4, y: 1 })).toMatchObject({ kind: 'stand' });
    expect(intentAt(selectUnit(s, 'varek'), { x: 6, y: 3 })).toEqual({ kind: 'move' });
  });

  it('clicking the Emperor with another unit selected hands the selection to Varek', () => {
    const s = uiGame();
    const r = clickTile(s, selectUnit(s, 'wolf'), { x: 3, y: 1 });
    expect(r.action).toBeNull();
    expect(r.selection.mode === 'unit' && r.selection.unitId).toBe('varek');
    expect(r.notice).toContain('Varek is selected');
  });

  it('with nobody able to Confront, clicking the Emperor says why and keeps the selection', () => {
    // Varek has acted: nobody can do it this turn.
    const s = play(uiGame(), { kind: 'wait', unitId: 'varek' }).state;
    const sel = selectUnit(s, 'wolf');
    const r = clickTile(s, sel, { x: 3, y: 1 });
    expect(r.action).toBeNull();
    expect(r.selection).toBe(sel);
    expect(r.notice).toBe('The Emperor cannot be attacked. Varek is 2 tiles from the Emperor (~1 turn).');
  });

  it('a bridge tile stays a move while the unit can walk onto it, and becomes the burn target when it cannot', () => {
    const s = uiGame();
    // Archer beside the bridge, not yet moved: (3,4) is a legal move.
    expect(intentAt(selectUnit(s, 'archer'), { x: 3, y: 4 })).toEqual({ kind: 'move' });
    const start = uiGameWith((d) => placeUnit(d, 'archer', [4, 5]));
    const moved = applyAction(start, { kind: 'move', unitId: 'archer', to: { x: 3, y: 5 } }).state;
    const sel = selectUnit(moved, 'archer');
    expect(intentAt(sel, { x: 3, y: 4 })).toMatchObject({ kind: 'interact' });
    expect(clickTile(moved, sel, { x: 3, y: 4 }).action).toEqual({ kind: 'interact', unitId: 'archer', interaction: 'burnBridge', targetId: 'bridgeMid' });
  });

  it('when a tile offers both Capture and an attack, the interaction wins and Shift attacks instead', () => {
    const s = uiGameWith((d) => addKaelaAndMira(d, [6, 5], [7, 5]));
    const sel = selectUnit(s, 'kaela');
    expect(sel.mode === 'unit' && sel.targets.map((t) => t.id)).toContain('mira');
    expect(clickTile(s, sel, { x: 7, y: 5 }).action).toMatchObject({ kind: 'interact', interaction: 'capture' });
    expect(clickTile(s, sel, { x: 7, y: 5 }, { preferAttack: true }).action).toEqual({ kind: 'attack', unitId: 'kaela', targetId: 'mira' });
    expect(intentAt(sel, { x: 7, y: 5 })).toMatchObject({ kind: 'interact', alsoAttack: { id: 'mira' } });
    expect(intentAt(sel, { x: 7, y: 5 }, true)).toMatchObject({ kind: 'attack', alsoInteract: { id: 'mira' } });
  });

  it('explains a click on an enemy the selected unit cannot hit, and keeps the unit selected', () => {
    const s = uiGameWith((d) => placeUnit(d, 'guard', [8, 5]));
    const sel = selectUnit(s, 'wolf');
    const r = clickTile(s, sel, { x: 8, y: 5 });
    expect(r.action).toBeNull();
    expect(r.selection).toBe(sel);
    expect(r.notice).toBe('Palace Guard is out of range. Move Ashen Wolf closer first, then attack.');
  });

  it('says why a unit with nothing left to do cannot be selected', () => {
    const s = play(uiGame(), { kind: 'wait', unitId: 'wolf' }).state;
    const r = clickTile(s, selectUnit(s, 'varek'), { x: 6, y: 2 });
    expect(r.selection).toEqual(NO_SELECTION);
    expect(r.notice).toBe('Ashen Wolf has nothing left to do this turn.');
  });
});

describe('selectNextReadyAfter', () => {
  it('hands the selection to the next ready unit in state order, wrapping, or to nobody', () => {
    const s = uiGame(); // state order: varek, wolf, archer, ...
    const afterWolf = play(s, { kind: 'wait', unitId: 'wolf' }).state;
    const next = selectNextReadyAfter(afterWolf, 'wolf');
    expect(next.mode === 'unit' && next.unitId).toBe('archer');
    const afterArcher = play(afterWolf, { kind: 'wait', unitId: 'archer' }).state;
    const wrapped = selectNextReadyAfter(afterArcher, 'archer');
    expect(wrapped.mode === 'unit' && wrapped.unitId).toBe('varek');
    const allDone = play(afterArcher, { kind: 'wait', unitId: 'varek' }).state;
    expect(selectNextReadyAfter(allDone, 'varek')).toEqual(NO_SELECTION);
  });
});

describe('actorForTarget', () => {
  it('prefers a unit that can act on the target right now over one that must walk', () => {
    const s = uiGameWith((d) => addKaelaAndMira(d, [6, 5], [7, 5]));
    expect(actorForTarget(s, 'mira')).toMatchObject({ unitId: 'kaela' });
    expect(actorForTarget(s, 'guard')).toBeNull();
  });
});

describe('attackForecast', () => {
  it('gives min-max and a kill chance over the three rolls', () => {
    const s = uiGame();
    const f = attackForecast(s, 'wolf', 'guard')!;
    // Soldier vs soldier: max(1, 4 - 1) + 0..2 = 3..5, the guard has 3 HP.
    expect(f.min).toBe(3);
    expect(f.max).toBe(5);
    expect(f.targetHp).toBe(3);
    expect(f.killChance).toBe(1);
    expect(forecastText(f)).toBe('3–5 dmg · 100% kill');
  });

  it('reports partial kill chances', () => {
    let s = uiGame();
    s = structuredClone(s);
    findUnit(s, 'guard')!.hp = 4;
    const f = attackForecast(s, 'wolf', 'guard')!;
    expect(f.killChance).toBeCloseTo(2 / 3);
    expect(forecastText(f)).toBe('3–5 dmg · 67% kill');
  });

  it('returns null for unknown ids', () => {
    expect(attackForecast(uiGame(), 'nobody', 'guard')).toBeNull();
  });
});
