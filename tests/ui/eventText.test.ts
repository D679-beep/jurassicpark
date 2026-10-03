import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/engine';
import { ChronicleLog, describeEvent, outcomeLines, repositionText, type LogLine } from '../../src/ui/eventText';
import { exitName, humanize, makeNameLookup, objectName, zoneName } from '../../src/ui/names';
import { END, play, uiGame } from './fixture';

const name = makeNameLookup(uiGame());
const text = (e: GameEvent): string => describeEvent(e, name)?.text ?? '';
const P = { x: 1, y: 2 };

describe('describeEvent', () => {
  it('describes attacks with names, amount and HP change', () => {
    const { state, events } = play(uiGame(), { kind: 'attack', unitId: 'wolf', targetId: 'guard' });
    const lookup = makeNameLookup(state);
    const lines = events.map((e) => describeEvent(e, lookup));
    expect(lines[0]?.text).toMatch(/^Ashen Wolf hits Palace Guard for 3 \(3 → 0\)\.$/);
    expect(lines[0]?.tone).toBe('damage');
    expect(lines[1]?.text).toBe('Palace Guard is slain by Ashen Wolf.');
    expect(lines[1]?.tone).toBe('death');
  });

  it('describes the Confront, dialogue and game over', () => {
    const s0 = uiGame();
    const { state, events } = play(
      { ...s0, dialogue: { confront: [{ speaker: 'varek', text: 'Father.' }] } },
      { kind: 'move', unitId: 'varek', to: { x: 3, y: 2 } },
      { kind: 'interact', unitId: 'varek', interaction: 'confront', targetId: 'halden' },
    );
    const lookup = makeNameLookup(state);
    const all = events.map((e) => describeEvent(e, lookup)?.text);
    expect(all).toContain('Varek: “Father.”');
    expect(all).toContain('Emperor Halden: “...”');
    expect(all).toContain('Emperor Halden is dead. The throne is empty.');
    expect(all).toContain('Objective complete: Kill Emperor Halden.');
    expect(all.some((t) => t?.startsWith('Victory:'))).toBe(true);
  });

  it('describes phases, bells and reinforcements from a real turn cycle', () => {
    const { state, events } = play(uiGame(), END, END, END, END);
    const lookup = makeNameLookup(state);
    const all = events.map((e) => describeEvent(e, lookup)?.text);
    expect(all).toContain('Loyalist phase.');
    expect(all).toContain('Round 2: Rebel phase.');
    expect(all).toContain('The First Bell rings (round 2).');
    expect(all).toContain('City Watch arrives: 2 units.');
  });

  it('has a line for every event type', () => {
    const events: GameEvent[] = [
      { type: 'moved', unitId: 'wolf', from: P, to: { x: 4, y: 5 }, path: [{ x: 4, y: 5 }] },
      { type: 'damaged', targetId: 'guard', targetKind: 'unit', pos: P, amount: 3, hpBefore: 10, hpAfter: 7, sourceId: 'varek', cause: 'tempest', roll: null },
      { type: 'damaged', targetId: 'guard', targetKind: 'unit', pos: P, amount: 4, hpBefore: 10, hpAfter: 6, sourceId: 'x', cause: 'pyre', roll: null },
      { type: 'damaged', targetId: 'varek', targetKind: 'unit', pos: P, amount: 3, hpBefore: 40, hpAfter: 37, sourceId: null, cause: 'duel', roll: null },
      { type: 'healed', unitId: 'guard', pos: P, amount: 5, hpAfter: 9, sourceId: 'x' },
      { type: 'died', unitId: 'guard', name: 'Palace Guard', faction: 'loyalist', pos: P, killerId: null, cause: 'pyre' },
      { type: 'objectDestroyed', objectId: 'doorThroneMain', objectKind: 'door', pos: P, byUnitId: 'wolf' },
      { type: 'objectDestroyed', objectId: 'anchorA', objectKind: 'anchor', pos: P, byUnitId: 'wolf' },
      { type: 'domainActivated', unitId: 'varek', domain: 'tempest', center: P, radius: 3, tiles: [P], expiresAtRound: 4 },
      { type: 'domainEnded', unitId: 'varek', domain: 'tempest', reason: 'expired', drained: true },
      { type: 'domainEnded', unitId: 'varek', domain: 'pyre', reason: 'ownerRemoved', drained: false },
      { type: 'bellRang', bell: 'dawn', name: 'Dawn', round: 13 },
      { type: 'bellsDelayed', reason: 'bellTower', amount: 2, bells: [], waves: [] },
      { type: 'bellsDelayed', reason: 'bridges', amount: 2, bells: [], waves: [] },
      { type: 'reinforcementsArrived', waveId: 'w', name: 'Dawn Lantern', bell: 'secondBell', units: [{ unitId: 'a', pos: P }], blocked: ['b'] },
      { type: 'objectiveFailed', objectiveId: 'imprisonMira', name: 'Imprison Princess Mira', reason: 'Mira escaped' },
      { type: 'captured', unitId: 'mira', byUnitId: 'kaela', pos: P },
      { type: 'escaped', unitId: 'mira', exitId: 'miraExit', pos: P },
      { type: 'bridgeBurned', bridgeId: 'bridgeMid', tiles: [P], byUnitId: 'archer', cause: 'interact' },
      { type: 'bridgeBurned', bridgeId: 'bridgeMid', tiles: [P], byUnitId: null, cause: 'pyre' },
      { type: 'sealBroken', unitIds: ['elian'], reason: 'anchors' },
      { type: 'sealBroken', unitIds: ['elian'], reason: 'secondBell' },
      { type: 'duelEnded', unitIds: ['grimm', 'orsa'], reason: 'leftFeastHall' },
      { type: 'duelEnded', unitIds: ['grimm', 'orsa'], reason: 'duelistRemoved' },
      { type: 'gameOver', result: 'defeat', winner: 'loyalist', reason: 'Varek has fallen', outcome: { emperorKilled: false, elianOutcome: 'alive', miraOutcome: 'free' } },
    ];
    const lines = events.map(text);
    for (const l of lines) expect(l.length).toBeGreaterThan(5);
    expect(lines).toEqual([
      'Ashen Wolf moves to (4,5).',
      'Tempest lashes Palace Guard for 3 (10 → 7).',
      'Pyre scorches Palace Guard for 4 (10 → 6).',
      'Varek bleeds 3 in the duel (40 → 37).',
      'Sanctuary mends Palace Guard for 5 (now 9).',
      'Palace Guard falls.',
      'Door Throne Main is broken open.',
      'Anchor A shatters.',
      'Varek unleashes Tempest (until round 4).',
      "Varek's Tempest fades; Varek is Drained.",
      'Pyre collapses with its owner.',
      'Dawn breaks over Calderon (round 13).',
      'Bell tower seized: the remaining bells are delayed 2 rounds.',
      'Bridges burned: the Second Bell knights are delayed 2 rounds.',
      'Dawn Lantern arrives: 1 unit. 1 could not enter.',
      'Objective failed: Imprison Princess Mira (Mira escaped).',
      'Kaela takes Mira prisoner.',
      'Mira escapes the palace.',
      'Wolf Radiant burns the Mid bridge.',
      'Pyre burns the Mid bridge.',
      'The ward anchors are gone. The Wellspring seal breaks.',
      'The Second Bell shatters the Wellspring seal.',
      'The Feast Hall duel is broken: Grimm and Orsa are free.',
      'The Feast Hall duel is over.',
      'Defeat: Varek has fallen.',
    ]);
  });
});

describe('outcomeLines', () => {
  it('reports the canonical outcome in plain language', () => {
    expect(outcomeLines({ emperorKilled: true, elianOutcome: 'escaped', miraOutcome: 'captured' })).toEqual([
      'Emperor Halden is dead.',
      "Crown Prince Elian escaped through the servants' tunnel.",
      'Princess Mira is your prisoner, alive.',
    ]);
    expect(outcomeLines({ emperorKilled: false, elianOutcome: 'killed', miraOutcome: 'dead' })).toEqual([
      'Emperor Halden still lives.',
      'Crown Prince Elian was killed.',
      'Princess Mira is dead.',
    ]);
  });
});

describe('names', () => {
  it('humanizes ids, zones and objects', () => {
    expect(humanize('throneHall')).toBe('Throne Hall');
    expect(humanize('g-throne-1')).toBe('G Throne 1');
    expect(zoneName('servantsTunnel')).toBe("Servants' Tunnel");
    expect(zoneName('someNewZone')).toBe('Some New Zone');
    expect(objectName({ id: 'doorThroneMain', kind: 'door' })).toBe('Throne Hall main door');
    expect(objectName({ id: 'doorWellSouth', kind: 'door' })).toBe('Wellspring south door');
    expect(objectName({ id: 'anchorA', kind: 'anchor' })).toBe('Ward anchor (west)');
    expect(objectName({ id: 'anchorB', kind: 'anchor' })).toBe('Ward anchor (east)');
    expect(objectName({ id: 'anchorC', kind: 'anchor' })).toBe('Ward anchor (south)');
    expect(objectName({ id: 'bridgeCenter', kind: 'bridge' })).toBe('Center bridge');
    expect(objectName({ id: 'bridgeEast', kind: 'bridge' })).toBe('East bridge');
  });

  it('falls back to id-derived names for unknown objects and prefers an explicit name', () => {
    expect(objectName({ id: 'doorCellar', kind: 'door' })).toBe('Cellar door');
    expect(objectName({ id: 'anchorD', kind: 'anchor' })).toBe('Ward anchor D');
    expect(objectName({ id: 'bridgeNorth', kind: 'bridge' })).toBe('North bridge');
    expect(objectName({ id: 'gate', kind: 'door' })).toBe('Barred door Gate');
    expect(objectName({ id: 'doorThroneMain', kind: 'door', name: 'The Big Door' })).toBe('The Big Door');
    expect(exitName('miraExit')).toBe("Mira's escape route");
    expect(exitName('someExit')).toBe('Some Exit');
  });

  it('looks up removed units and falls back for unknown ids', () => {
    const { state } = play(uiGame(), { kind: 'attack', unitId: 'wolf', targetId: 'guard' });
    const n = makeNameLookup(state);
    expect(n('guard')).toBe('Palace Guard');
    expect(n('watch-1')).toBe('City Watch');
    expect(n('mysteryUnit')).toBe('Mystery Unit');
    expect(n(null)).toBe('Someone');
  });
});

describe('chronicle: AI moves', () => {
  const moved = (unitId: string, x: number): GameEvent => ({ type: 'moved', unitId, from: P, to: { x, y: 5 }, path: [{ x, y: 5 }] });

  it('marks plain AI moves for folding and keeps player moves as lines', () => {
    const lookup = makeNameLookup(uiGame());
    expect(lookup.aiFactionOf?.('guard')).toBe('loyalist');
    expect(lookup.aiFactionOf?.('wolf')).toBeUndefined();
    expect(lookup.aiFactionOf?.('watch-1')).toBe('loyalist');
    expect(describeEvent(moved('wolf', 4), lookup)).toEqual({ text: 'Ashen Wolf moves to (4,5).', tone: 'move' });
    const ai = describeEvent(moved('guard', 4), lookup);
    expect(ai?.reposition).toEqual({ faction: 'loyalist', unitId: 'guard' });
    expect(ai?.text).toBe('Loyalists reposition (1 unit).');
  });

  it('folds many AI moves in a phase into one summary and keeps other events', () => {
    const lookup = makeNameLookup(uiGame());
    const log = new ChronicleLog();
    const entries: LogLine[] = [];
    const feed = (e: GameEvent): void => {
      const line = describeEvent(e, lookup);
      if (!line) return;
      const r = log.push(line);
      if (r.isNew) entries.push(r.entry);
    };
    feed({ type: 'phaseStarted', round: 1, phase: 'ai', faction: 'loyalist' });
    feed(moved('guard', 4));
    feed(moved('watch-1', 5));
    feed({ type: 'damaged', targetId: 'wolf', targetKind: 'unit', pos: P, amount: 2, hpBefore: 9, hpAfter: 7, sourceId: 'guard', cause: 'attack', roll: null });
    feed(moved('watch-2', 6));
    feed(moved('guard', 7)); // same unit again does not inflate the count
    expect(entries.map((l) => l.text)).toEqual([
      'Loyalist phase.',
      'Loyalists reposition (3 units).',
      'Palace Guard hits Ashen Wolf for 2 (9 → 7).',
    ]);
    // A new phase starts a fresh summary.
    feed({ type: 'phaseStarted', round: 2, phase: 'player', faction: 'rebel' });
    feed({ type: 'phaseStarted', round: 2, phase: 'ai', faction: 'loyalist' });
    feed(moved('guard', 4));
    expect(entries.at(-1)?.text).toBe('Loyalists reposition (1 unit).');
    expect(repositionText('rebel', 2)).toBe('Rebels reposition (2 units).');
  });

  it('player moves stay individual', () => {
    const lookup = makeNameLookup(uiGame());
    const log = new ChronicleLog();
    const a = log.push(describeEvent(moved('wolf', 4), lookup) as LogLine);
    const b = log.push(describeEvent(moved('varek', 5), lookup) as LogLine);
    expect(a.isNew && b.isNew).toBe(true);
    expect(b.entry.text).toBe('Varek moves to (5,5).');
  });
});
