import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/engine';
import { describeEvent, outcomeLines } from '../../src/ui/eventText';
import { humanize, makeNameLookup, objectName, zoneName } from '../../src/ui/names';
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
    expect(objectName({ id: 'doorThroneMain', kind: 'door' })).toBe('Throne Main door');
    expect(objectName({ id: 'anchorB', kind: 'anchor' })).toBe('Ward anchor B');
    expect(objectName({ id: 'bridgeEast', kind: 'bridge' })).toBe('East bridge');
    expect(objectName({ id: 'gate', kind: 'door' })).toBe('Barred door Gate');
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
