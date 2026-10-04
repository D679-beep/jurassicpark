import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  findObject,
  getLegalActions,
  pathCost,
  waveArrivalRound,
  type Action,
  type GameState,
  type Pos,
  type Rank,
  type Unit,
} from '../../src/engine';
import { prologueScenario } from '../../src/content';

const MAX_ROUNDS = 13;

function initial(): GameState {
  return createGame(prologueScenario);
}

function get(state: GameState, id: string): Unit {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`unit ${id} not in play`);
  return u;
}

/** Full-path cost for a unit, ignoring other units and the per-turn move limit. */
function cost(state: GameState, unitId: string, to: [number, number]): number {
  const c = pathCost(state, unitId, { x: to[0], y: to[1] }, { ignoreUnits: true, ignoreMoveLimit: true });
  if (c === null) throw new Error(`${unitId} cannot reach ${to}`);
  return c;
}

const rounds = (c: number, move: number): number => Math.ceil(c / move);

/** Copy of the state with the first unit of a wave dropped onto `at`, for route-cost checks. */
function withWaveScout(state: GameState, waveId: string, at: [number, number]): GameState {
  const s = structuredClone(state);
  const scout = structuredClone(s.waves.find((w) => w.id === waveId)!.units[0]!);
  scout.pos = { x: at[0], y: at[1] };
  s.units.push(scout);
  return s;
}

describe('prologue scenario: structure', () => {
  it('builds a valid 32x22 game in round 1, rebel phase', () => {
    const s = initial();
    expect(s.map.width).toBe(32);
    expect(s.map.height).toBe(22);
    expect(s.round).toBe(1);
    expect(s.phase).toBe('player');
    expect(s.playerFaction).toBe('rebel');
    expect(s.gameOver).toBe(false);
  });

  it('has 11 rebels and 13 loyalists with unique ids on distinct passable tiles', () => {
    const s = initial();
    expect(s.units.filter((u) => u.faction === 'rebel')).toHaveLength(11);
    expect(s.units.filter((u) => u.faction === 'loyalist')).toHaveLength(13);
    expect(new Set(s.units.map((u) => u.id)).size).toBe(24);
    expect(new Set(s.units.map((u) => `${u.pos.x},${u.pos.y}`)).size).toBe(24);
  });

  it('places every named character with the right faction, rank, statuses and tags', () => {
    const s = initial();
    const expected: Record<string, { id: string; faction: string; rank: Rank; statuses: string[]; tags: string[]; at: Pos }> = {
      varek: { id: 'varek', faction: 'rebel', rank: 'ascendant', statuses: [], tags: [], at: { x: 15, y: 17 } },
      grimm: { id: 'grimm', faction: 'rebel', rank: 'ascendant', statuses: ['dueling'], tags: [], at: { x: 4, y: 4 } },
      kaela: { id: 'kaela', faction: 'rebel', rank: 'kindled', statuses: [], tags: [], at: { x: 17, y: 18 } },
      orsa: { id: 'orsa', faction: 'loyalist', rank: 'ascendant', statuses: ['dueling'], tags: [], at: { x: 5, y: 4 } },
      elian: { id: 'elian', faction: 'loyalist', rank: 'ascendant', statuses: ['sealed'], tags: ['escapee'], at: { x: 15, y: 10 } },
      mira: { id: 'mira', faction: 'loyalist', rank: 'radiant', statuses: [], tags: ['escapee'], at: { x: 30, y: 1 } },
      halden: { id: 'halden', faction: 'loyalist', rank: 'soldier', statuses: [], tags: ['noResist'], at: { x: 15, y: 2 } },
    };
    for (const [character, e] of Object.entries(expected)) {
      const u = s.units.find((x) => x.character === character);
      expect(u, character).toBeDefined();
      expect(u!.id).toBe(e.id);
      expect(u!.faction).toBe(e.faction);
      expect(u!.rank).toBe(e.rank);
      expect(u!.statuses).toEqual(e.statuses);
      expect(u!.tags).toEqual(e.tags);
      expect(u!.pos).toEqual(e.at);
    }
    expect(s.units.filter((u) => u.character !== null)).toHaveLength(7);
    // Domains follow the characters.
    expect(get(s, 'varek').domain).toBe('tempest');
    expect(get(s, 'grimm').domain).toBe('pyre');
    expect(get(s, 'orsa').domain).toBe('bulwark');
    expect(get(s, 'elian').domain).toBe('sanctuary');
    expect(s.duel).toEqual({ unitIds: ['grimm', 'orsa'], active: true });
  });

  it('fields the Ashen Wolves, guards and anchor-breakers as designed', () => {
    const s = initial();
    const wolves = s.units.filter((u) => u.id.startsWith('wolf-'));
    expect(wolves.map((u) => u.rank).sort()).toEqual(
      ['kindled', 'kindled', 'kindled', 'radiant', 'radiant', 'soldier', 'soldier', 'soldier'],
    );
    expect(wolves.every((u) => u.name === 'Ashen Wolf' && u.faction === 'rebel')).toBe(true);
    const guards = s.units.filter((u) => u.id.startsWith('g-'));
    expect(guards).toHaveLength(9);
    expect(guards.every((u) => u.name === 'Palace Guard' && u.faction === 'loyalist')).toBe(true);
    expect(guards.filter((u) => u.tags.includes('anchorBreaker')).map((u) => u.id).sort()).toEqual(['g-anchor-1', 'g-anchor-2']);
    expect(get(s, 'g-ante-1').guardZone).toBe('throneHall');
    expect(get(s, 'g-tower-1').guardZone).toBe('princessTower');
    expect(get(s, 'g-bell-1').guardZone).toBe('bellTower');
    // Throne Hall garrison (balance log v0.3): 3 Kindled inside, a Soldier on the antechamber, no Radiant.
    const throne = ['g-throne-1', 'g-throne-2', 'g-throne-3', 'g-ante-1'];
    expect(throne.map((id) => get(s, id).rank)).toEqual(['kindled', 'kindled', 'kindled', 'soldier']);
    expect(throne.every((id) => get(s, id).guardZone === 'throneHall')).toBe(true);
    expect(s.units.some((u) => u.id === 'g-throne-4')).toBe(false);
    // Princess's Tower: two Soldiers.
    expect(['g-tower-1', 'g-tower-2'].map((id) => get(s, id).rank)).toEqual(['soldier', 'soldier']);
  });

  it('applies the balance-log stat overrides to the duelists, Elian and Mira', () => {
    const s = initial();
    const stats = (id: string) => {
      const u = get(s, id);
      return { hp: u.hp, maxHp: u.maxHp, atk: u.atk, def: u.def, move: u.move };
    };
    // Grimm: baseline Ascendant with DEF 5. Orsa, the shield: 48 HP, ATK 9, DEF 5.
    expect(stats('grimm')).toEqual({ hp: 40, maxHp: 40, atk: 10, def: 5, move: 5 });
    expect(stats('orsa')).toEqual({ hp: 48, maxHp: 48, atk: 9, def: 5, move: 5 });
    // Mira is a Radiant who barely fights back: ATK 4.
    expect(stats('mira')).toEqual({ hp: 18, maxHp: 18, atk: 4, def: 2, move: 4 });
    // The seal draws on the one it holds: Elian starts at 34 of 40.
    expect(stats('elian')).toEqual({ hp: 34, maxHp: 40, atk: 10, def: 4, move: 5 });
    expect(stats('varek')).toEqual({ hp: 40, maxHp: 40, atk: 10, def: 4, move: 5 });
  });

  it('puts every starting unit in the zone the design names', () => {
    const s = initial();
    const inZone = (id: string, zone: string): boolean => {
      const u = get(s, id);
      return s.map.zones[zone]!.some((t) => t.x === u.pos.x && t.y === u.pos.y);
    };
    for (const id of ['varek', 'kaela', 'wolf-s1', 'wolf-s2', 'wolf-s3', 'wolf-k1', 'wolf-k2', 'wolf-k3', 'wolf-r1', 'wolf-r2']) {
      expect(inZone(id, 'innerGate'), id).toBe(true);
    }
    expect(inZone('grimm', 'feastHall')).toBe(true);
    expect(inZone('orsa', 'feastHall')).toBe(true);
    expect(inZone('halden', 'throneHall')).toBe(true);
    expect(inZone('g-throne-3', 'throneHall')).toBe(true);
    expect(inZone('elian', 'wellspringHall')).toBe(true);
    expect(inZone('mira', 'princessTower')).toBe(true);
    expect(inZone('g-tower-1', 'princessTower')).toBe(true);
    expect(inZone('g-bell-1', 'bellTower')).toBe(true);
    expect(inZone('g-anchor-1', 'antechamber')).toBe(true);
    expect(inZone('g-ante-1', 'antechamber')).toBe(true);
  });

  it('defines the barred doors, anchors, bridges and exits', () => {
    const s = initial();
    const doors = s.map.objects.filter((o) => o.kind === 'door');
    expect(doors.map((d) => [d.id, d.kind === 'door' ? d.maxHp : 0])).toEqual([
      ['doorThroneMain', 18],
      ['doorThroneWest', 12],
      ['doorThroneEast', 12],
      ['doorWellNorth', 14],
      ['doorWellSouth', 11],
    ]);
    const anchors = s.map.objects.filter((o) => o.kind === 'anchor');
    expect(anchors.map((a) => a.id)).toEqual(['anchorA', 'anchorB', 'anchorC']);
    expect(anchors.every((a) => a.kind === 'anchor' && a.maxHp === 12)).toBe(true);
    const bridges = s.map.objects.filter((o) => o.kind === 'bridge');
    expect(bridges.map((b) => b.id)).toEqual(['bridgeWest', 'bridgeCenter', 'bridgeEast']);
    expect(bridges.map((b) => (b.kind === 'bridge' ? b.tags : null))).toEqual([[], ['barracksRoute'], ['barracksRoute']]);
    expect(s.map.exits.map((e) => e.id).sort()).toEqual(['elianExit', 'miraExit']);
    expect(s.map.exits.find((e) => e.id === 'miraExit')!.tiles).toEqual([{ x: 31, y: 12 }]);
    expect(s.map.exits.find((e) => e.id === 'elianExit')!.tiles).toEqual([{ x: 0, y: 10 }, { x: 0, y: 11 }]);
    // Barred doors sit on door terrain, bridges on bridge terrain.
    expect(s.map.terrain[6]![16]).toBe('door');
    expect(s.map.terrain[15]![15]).toBe('bridge');
  });

  it('schedules the three waves on the default bells, with the designed spawn tiles', () => {
    const s = initial();
    expect(s.bells.map((b) => [b.id, b.round])).toEqual([['firstBell', 5], ['secondBell', 9], ['dawn', 13]]);
    const wave = (id: string) => s.waves.find((w) => w.id === id)!;
    expect(wave('cityWatch').units.map((u) => u.rank)).toEqual([...Array<Rank>(6).fill('soldier'), 'kindled']);
    expect(wave('cityWatch').units[6]!.pos).toEqual({ x: 3, y: 13 });
    expect(wave('dawnLantern').units.map((u) => u.rank)).toEqual(['kindled', 'kindled', 'kindled', 'kindled', 'radiant', 'radiant']);
    expect(wave('dawnLantern').units.map((u) => [u.pos.x, u.pos.y])).toEqual([[24, 20], [23, 20], [22, 21], [25, 21], [23, 21], [24, 21]]);
    expect(wave('southernLegion').units).toHaveLength(4);
    expect(wave('southernLegion').units.map((u) => [u.pos.x, u.pos.y])).toEqual([[21, 20], [22, 20], [25, 20], [26, 20]]);
    expect(wave('southernLegion').bell).toBe('dawn');
  });

  it('tracks all five objectives', () => {
    expect(initial().objectives.map((o) => o.id)).toEqual(['killEmperor', 'killElian', 'imprisonMira', 'seizeBellTower', 'burnBridges']);
  });
});

describe('prologue scenario: the Wellspring south door opens a real route (anchorC off the doorway)', () => {
  const anchorsIntact = (s: GameState): boolean =>
    s.map.objects.filter((o) => o.kind === 'anchor').every((o) => o.kind === 'anchor' && !o.destroyed && o.hp === o.maxHp);
  const moveTargets = (s: GameState, unitId: string): string[] =>
    getLegalActions(s, unitId)
      .filter((a): a is Extract<Action, { kind: 'move' }> => a.kind === 'move')
      .map((a) => `${a.to.x},${a.to.y}`);

  it('a rebel on the quay breaks doorWellSouth (16,12) and walks through it into the hall with every anchor intact', () => {
    // Varek stands on the quay right below the door; the door is down to its last hit point.
    const s = structuredClone(initial());
    get(s, 'varek').pos = { x: 16, y: 13 };
    const door = s.map.objects.find((o) => o.id === 'doorWellSouth');
    if (!door || door.kind !== 'door') throw new Error('doorWellSouth');
    door.hp = 1;
    // While the door stands, (16,12) and everything behind it is out of reach.
    const before = moveTargets(s, 'varek');
    expect(before).not.toContain('16,12');
    expect(before).not.toContain('16,11');

    // Break it with a real attack, then move in the same turn.
    const r = applyAction(s, { kind: 'attack', unitId: 'varek', targetId: 'doorWellSouth' });
    const broken = r.state.map.objects.find((o) => o.id === 'doorWellSouth');
    expect(broken?.kind === 'door' && broken.destroyed).toBe(true);
    expect(anchorsIntact(r.state)).toBe(true);
    const after = moveTargets(r.state, 'varek');
    // Through the doorway (16,12), onto the tile inside it (16,11), and on into the hall.
    for (const t of ['16,12', '16,11', '17,11', '17,10', '18,10']) expect(after, t).toContain(t);
    // The anchors themselves stay solid: (15,11) is anchorC, not a floor tile to stand on.
    expect(after).not.toContain('15,11');
    const m = applyAction(r.state, { kind: 'move', unitId: 'varek', to: { x: 17, y: 10 } });
    expect(get(m.state, 'varek').pos).toEqual({ x: 17, y: 10 });
    expect(m.state.map.zones.wellspringHall!.some((t) => t.x === 17 && t.y === 10)).toBe(true);
    expect(anchorsIntact(m.state)).toBe(true);
  });

  it('with only doorWellSouth broken, a Wolf from the inner gate reaches the tile inside it, anchors intact (path costs)', () => {
    const s = structuredClone(initial());
    for (const o of s.map.objects) if (o.id === 'doorWellSouth' && o.kind === 'door') o.destroyed = true;
    expect(anchorsIntact(s)).toBe(true);
    // (16,17) -> centre bridge -> quay -> (16,12) -> (16,11): one tile further than the door itself.
    expect(cost(s, 'wolf-k2', [16, 11])).toBe(cost(s, 'wolf-k2', [16, 12]) + 1);
    // ...and from there the whole hall interior is walkable (beside Elian on the dais at (16,10)).
    expect(cost(s, 'wolf-k2', [16, 10])).toBe(cost(s, 'wolf-k2', [16, 11]) + 1);
  });
});

describe('prologue scenario: pacing (map doc section 6)', () => {
  it('Varek reaches a tile beside Halden at cost 24 (5 rounds)', () => {
    const s = initial();
    const adjacent: [number, number][] = [[15, 3], [14, 2], [16, 2], [15, 1]];
    expect(cost(s, 'varek', [15, 3])).toBe(24);
    expect(rounds(24, 5)).toBe(5);
    const best = Math.min(...adjacent.map((t) => cost(s, 'varek', t)));
    expect(best).toBeGreaterThanOrEqual(23);
    expect(best).toBeLessThanOrEqual(25);
    // He passes the tunnel junction (10,10) at cost 12 (round 3) and the antechamber at 17..20 (round 4).
    expect(cost(s, 'varek', [10, 10])).toBe(12);
    expect(cost(s, 'varek', [15, 7])).toBeGreaterThanOrEqual(17);
    expect(cost(s, 'varek', [15, 7])).toBeLessThanOrEqual(20);
  });

  it('the Wellspring Hall shortcut costs 16 once its two barred doors are broken', () => {
    const s = initial();
    // Barred doors are solid until destroyed, so the straight line is blocked: the walk is the long way round.
    expect(cost(s, 'varek', [15, 3])).toBeGreaterThan(16);
    const open = structuredClone(s);
    const shortcut = new Set(['doorWellNorth', 'doorWellSouth']);
    for (const o of open.map.objects) if (o.kind === 'door' && shortcut.has(o.id)) o.destroyed = true;
    // anchorC sits at (15,11), beside the tile inside doorWellSouth (16,12), not on it: the route is open.
    expect(cost(open, 'varek', [15, 3])).toBe(16);
    expect(rounds(16, 5)).toBe(4);
    // Breaking only the south door puts Varek beside the sealed Elian in 2 rounds.
    const south = structuredClone(s);
    for (const o of south.map.objects) if (o.id === 'doorWellSouth' && o.kind === 'door') o.destroyed = true;
    expect(cost(south, 'varek', [16, 10])).toBe(8);
  });

  it('keeps the ward anchors spread (pairwise distances 7, 6, 5) and off every door tile', () => {
    const s = initial();
    const at = (id: string): Pos => {
      const o = findObject(s, id);
      if (!o || o.kind !== 'anchor') throw new Error(id);
      return o.pos;
    };
    const d = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    expect(at('anchorC')).toEqual({ x: 15, y: 11 });
    expect([d(at('anchorA'), at('anchorB')), d(at('anchorA'), at('anchorC')), d(at('anchorB'), at('anchorC'))]).toEqual([7, 5, 6]);
    // No anchor is orthogonally inside a Wellspring door: (11,10), (11,11), (15,8), (16,12).
    const insideDoors: Pos[] = [{ x: 12, y: 10 }, { x: 12, y: 11 }, { x: 15, y: 9 }, { x: 16, y: 11 }];
    for (const id of ['anchorA', 'anchorB', 'anchorC']) {
      expect(insideDoors.some((t) => t.x === at(id).x && t.y === at(id).y), id).toBe(false);
    }
  });

  it('Mira walks (30,1) to (31,12) at cost 26 (7 rounds), door (26,8) at cost 17', () => {
    const s = initial();
    expect(cost(s, 'mira', [26, 8])).toBe(17);
    expect(cost(s, 'mira', [31, 12])).toBe(26);
    expect(rounds(26, get(s, 'mira').move)).toBe(7);
  });

  it('Kaela reaches (26,13) at cost 14 and the tower door (26,9) at cost 18, ahead of Mira', () => {
    const s = initial();
    expect(cost(s, 'kaela', [26, 13])).toBe(14);
    expect(rounds(14, 5)).toBe(3);
    expect(cost(s, 'kaela', [26, 9])).toBe(18);
    expect(rounds(18, 5)).toBe(4);
    // Mira needs 5 rounds just to reach the door, so Kaela is there first with slack.
    expect(rounds(cost(s, 'mira', [26, 8]), 4) - rounds(18, 5)).toBeGreaterThanOrEqual(1);
  });

  it('Elian reaches the tunnel exit (0,10) at cost 15 once unsealed (3 rounds)', () => {
    const s = initial();
    expect(cost(s, 'elian', [0, 10])).toBe(15);
    expect(rounds(15, get(s, 'elian').move)).toBe(3);
  });

  it('Orsa walks (5,4) to (15,4) at cost 16 (4 rounds)', () => {
    // While she is dueling she is confined to the Feast Hall, so free her first.
    const s = structuredClone(initial());
    s.duel!.active = false;
    expect(cost(s, 'orsa', [15, 4])).toBe(16);
    expect(rounds(16, 5)).toBe(4);
  });

  it('anchor-breakers reach (12,10) inside the Wellspring Hall in 2 rounds', () => {
    const s = initial();
    expect(cost(s, 'g-anchor-1', [12, 10])).toBe(7);
    expect(rounds(7, get(s, 'g-anchor-1').move)).toBe(2);
  });

  it('bell tower wolves arrive in 3 rounds', () => {
    const s = initial();
    expect(cost(s, 'wolf-k1', [4, 19])).toBe(12);
    expect(cost(s, 'wolf-s2', [4, 19])).toBe(10);
    expect(rounds(12, 5)).toBe(3);
    expect(rounds(10, 4)).toBe(3);
  });

  it('the City Watch has short walks to the tunnel junction (10) and antechamber (20)', () => {
    const s = initial();
    const at = withWaveScout(s, 'cityWatch', [3, 13]);
    expect(cost(at, 'watch-1', [10, 10])).toBe(10);
    const gate = withWaveScout(s, 'cityWatch', [1, 13]);
    expect(cost(gate, 'watch-1', [15, 7])).toBe(20);
  });

  it('the Second Bell route is 26 cost with both bridges and 42 without', () => {
    const s = withWaveScout(initial(), 'dawnLantern', [24, 20]);
    expect(cost(s, 'lantern-1', [15, 7])).toBe(26);
    expect(rounds(26, 5)).toBe(6);

    // Burn the two barracksRoute bridges the way a player would.
    let burned = s;
    const burn = (wolf: string, bridgeId: string, standAt: Pos): void => {
      burned = structuredClone(burned);
      get(burned, wolf).pos = standAt;
      burned = applyAction(burned, { kind: 'interact', unitId: wolf, interaction: 'burnBridge', targetId: bridgeId }).state;
    };
    burn('wolf-k1', 'bridgeCenter', { x: 15, y: 16 });
    expect(burned.modifiers.bridgesBurned).toBe(false);
    expect(cost(burned, 'lantern-1', [15, 7])).toBeLessThan(42);
    burn('wolf-k2', 'bridgeEast', { x: 26, y: 16 });
    expect(burned.modifiers.bridgesBurned).toBe(true);
    expect(cost(burned, 'lantern-1', [15, 7])).toBe(42);
    expect(rounds(42, 5)).toBe(9);

    // The Second Bell wave is delayed two rounds (9 -> 11); the other waves are not.
    expect(waveArrivalRound(s, s.waves.find((w) => w.id === 'dawnLantern')!)).toBe(9);
    expect(waveArrivalRound(burned, burned.waves.find((w) => w.id === 'dawnLantern')!)).toBe(11);
    expect(findObject(burned, 'bridgeWest')).toMatchObject({ burned: false });
  });

  it('burning all three bridges cuts the south bank off from the quay', () => {
    const s = structuredClone(initial());
    expect(cost(s, 'varek', [15, 13])).toBe(4);
    for (const o of s.map.objects) {
      if (o.kind !== 'bridge') continue;
      o.burned = true;
      for (const t of o.tiles) s.map.terrain[t.y]![t.x] = 'water';
    }
    expect(pathCost(s, 'varek', { x: 15, y: 13 }, { ignoreUnits: true, ignoreMoveLimit: true })).toBeNull();
    // Mira's exit is on the north bank, so it is unaffected.
    expect(cost(s, 'mira', [31, 12])).toBe(26);
  });
});

/** Picks one action per unit: the last legal action that is not endTurn. */
function lastActionPolicy(state: GameState): Action[] {
  const out: Action[] = [];
  for (const u of state.units.filter((x) => x.faction === state.activeFaction)) {
    const acts = getLegalActions(state, u.id).filter((a) => a.kind !== 'endTurn');
    const last = acts[acts.length - 1];
    if (last) out.push(last);
  }
  return out;
}

describe('prologue scenario: smoke run', () => {
  it('doing the last legal thing every turn ends in a Dawn defeat with the Emperor alive', () => {
    let state = initial();
    let phases = 0;
    while (!state.gameOver) {
      expect(phases++).toBeLessThan(MAX_ROUNDS * 2 + 2);
      for (const first of lastActionPolicy(state)) {
        if (state.gameOver) break;
        // Re-validate against the live state: earlier actions may have changed things.
        const live = getLegalActions(state, 'unitId' in first ? first.unitId : '');
        if (live.some((a) => JSON.stringify(a) === JSON.stringify(first))) state = applyAction(state, first).state;
      }
      if (!state.gameOver) state = applyAction(state, { kind: 'endTurn' }).state;
    }
    expect(state.round).toBe(MAX_ROUNDS);
    expect(state.result).not.toBeNull();
    expect(state.result!.result).toBe('defeat');
    expect(state.result!.winner).toBe('loyalist');
    expect(state.outcome.emperorKilled).toBe(false);
    expect(state.units.some((u) => u.character === 'halden')).toBe(true);
    // Every bell rang and every wave arrived on schedule.
    expect(state.bells.every((b) => b.rung)).toBe(true);
    expect(state.waves.filter((w) => w.id !== 'southernLegion').every((w) => w.arrivedRound !== null)).toBe(true);
    expect(state.waves.find((w) => w.id === 'cityWatch')!.arrivedRound).toBe(5);
    expect(state.waves.find((w) => w.id === 'dawnLantern')!.arrivedRound).toBe(9);
    // Elian's seal broke at Second Bell with the anchors intact, and he stayed in play.
    expect(state.sealBroken).toBe(true);
    // Mira (who waits like everyone else) is still free; the duel is still on.
    expect(state.outcome.miraOutcome).toBe('free');
    expect(state.duel?.active).toBe(true);
  });

  it('a cycling policy that tries every action kind never throws and always ends by Dawn', () => {
    for (const offset of [0, 1, 2, 3, 5, 8]) {
      let state = initial();
      let step = offset;
      let guard = 0;
      while (!state.gameOver) {
        expect(guard++).toBeLessThan(5000);
        const unit = state.units.find((u) => u.faction === state.activeFaction && getLegalActions(state, u.id).some((a) => a.kind !== 'endTurn' && a.kind !== 'wait'));
        if (!unit || step % 7 === 0) {
          state = applyAction(state, { kind: 'endTurn' }).state;
          step++;
          continue;
        }
        const acts = getLegalActions(state, unit.id).filter((a) => a.kind !== 'endTurn');
        state = applyAction(state, acts[step % acts.length]!).state;
        step++;
      }
      expect(state.round).toBeLessThanOrEqual(MAX_ROUNDS);
      expect(state.result).not.toBeNull();
    }
  });
});
