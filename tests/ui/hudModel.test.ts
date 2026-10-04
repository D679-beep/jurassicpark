import { describe, expect, it } from 'vitest';
import { applyAction, findUnit, type Action, type GameState } from '../../src/engine';
import { aiActionCap, decideAiAction } from '../../src/ui/aiDriver';
import { bellEra, nextBellText, objectiveRows, statusIcon, tileInfo, unitGlyph, unitSummary } from '../../src/ui/hudModel';
import { END, play, uiGame } from './fixture';

describe('bell era and next bell', () => {
  it('starts at Midnight and advances as bells ring', () => {
    const s = uiGame();
    expect(bellEra(s)).toBe('Midnight');
    expect(nextBellText(s)).toBe('First Bell in 1 round (round 2)');
    const r2 = play(s, END, END).state;
    expect(r2.round).toBe(2);
    expect(bellEra(r2)).toBe('First Bell');
    expect(nextBellText(r2)).toBe('Second Bell in 2 rounds (round 4)');
    const r4 = play(r2, END, END, END, END).state;
    expect(bellEra(r4)).toBe('Second Bell');
  });

  it('reports when no bells remain', () => {
    const s = structuredClone(uiGame());
    for (const b of s.bells) b.rung = true;
    expect(bellEra(s)).toBe('Dawn');
    expect(nextBellText(s)).toBe('No bells remain.');
  });
});

describe('objectives and units', () => {
  it('lists objectives with status icons', () => {
    const rows = objectiveRows(uiGame());
    expect(rows.map((r) => r.id)).toContain('killEmperor');
    expect(rows[0]!.icon).toBe('○');
    expect(statusIcon('completed')).toBe('✓');
    expect(statusIcon('failed')).toBe('✗');
  });

  it('picks glyphs: initials for characters, rank letters for troops', () => {
    const s = uiGame();
    expect(unitGlyph(findUnit(s, 'varek')!)).toBe('V');
    expect(unitGlyph(findUnit(s, 'halden')!)).toBe('H');
    expect(unitGlyph(findUnit(s, 'wolf')!)).toBe('s');
    expect(unitGlyph(findUnit(s, 'archer')!)).toBe('r');
    expect(unitGlyph({ character: 'orsa', name: 'Lady Orsa', rank: 'ascendant' })).toBe('O');
    expect(unitGlyph({ character: 'elian', name: 'Crown Prince Elian', rank: 'ascendant' })).toBe('E');
  });

  it('summarizes a unit with turn state', () => {
    const s = applyAction(uiGame(), { kind: 'move', unitId: 'varek', to: { x: 4, y: 3 } }).state;
    const sum = unitSummary(s, findUnit(s, 'varek')!);
    expect(sum).toMatchObject({ name: 'Varek', rank: 'Ascendant', hp: 40, atk: 10, move: 5, range: '1–2', turn: 'Moved, can still act' });
    expect(sum.notes).toContain('Domain: Tempest');
  });

  it('describes a tile: terrain, zone, features and occupant', () => {
    const s = uiGame();
    const t = tileInfo(s, { x: 3, y: 1 })!;
    expect(t.terrain).toBe('Throne dais');
    expect(t.defense).toBe(1);
    expect(t.zones).toEqual(['Throne Hall']);
    expect(t.unit?.name).toBe('Emperor Halden');
    const bridge = tileInfo(s, { x: 3, y: 4 })!;
    expect(bridge.features).toContain('Mid bridge');
    expect(tileInfo(s, { x: 0, y: 0 })!.moveCost).toBe('impassable');
    expect(tileInfo(s, { x: 99, y: 0 })).toBeNull();
  });
});

describe('AI driver guard', () => {
  const aiPhase = (): GameState => play(uiGame(), END).state;

  it('passes legal AI actions through', () => {
    const s = aiPhase();
    const a: Action = { kind: 'move', unitId: 'guard', to: { x: 8, y: 2 } };
    expect(decideAiAction(s, () => a, 0)).toEqual({ action: a, forced: null });
  });

  it('forces endTurn on illegal actions, exceptions and the cap', () => {
    const s = aiPhase();
    const illegal = decideAiAction(s, () => ({ kind: 'attack', unitId: 'guard', targetId: 'varek-nope' }), 0);
    expect(illegal.action).toEqual({ kind: 'endTurn' });
    expect(illegal.forced?.reason).toBe('illegal');
    const thrown = decideAiAction(s, () => {
      throw new Error('boom');
    }, 0);
    expect(thrown.forced).toEqual({ reason: 'error', detail: 'boom' });
    const capped = decideAiAction(s, () => ({ kind: 'endTurn' }), aiActionCap(s));
    expect(capped.forced?.reason).toBe('cap');
    expect(capped.action).toEqual({ kind: 'endTurn' });
  });

  it('scales the cap with the AI army but never below 40', () => {
    expect(aiActionCap(aiPhase())).toBe(40);
  });
});
