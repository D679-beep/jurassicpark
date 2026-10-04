import { describe, expect, it } from 'vitest';
import { applyAction, findUnit } from '../../src/engine';
import {
  NO_SELECTION,
  attackForecast,
  clickTile,
  cycleSelection,
  forecastText,
  isReady,
  readyUnitIds,
  refreshSelection,
  selectUnit,
} from '../../src/ui/selection';
import { END, play, uiGame } from './fixture';

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

  it('does not select enemies or the Emperor', () => {
    const s = uiGame();
    expect(clickTile(s, NO_SELECTION, { x: 7, y: 2 }).selection).toEqual(NO_SELECTION);
    expect(clickTile(s, NO_SELECTION, { x: 3, y: 1 }).selection).toEqual(NO_SELECTION);
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
