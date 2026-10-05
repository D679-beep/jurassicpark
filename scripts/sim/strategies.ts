// Scripted rebel strategies for the balance simulator. Each is a greedy
// policy built from kit.ts Orders and re-planned every unit turn.
//
// Since v0.5 the battle no longer ends with the Confront: the rebels must hold
// until Dawn (or rout the loyalists), and Varek and Kaela fall downed instead
// of dying. Every strategy that moves units therefore
//   - revives downed heroes (withRevive: the nearest free rebel is sent to the
//     hero and any rebel next to a downed hero revives it), and
//   - after the Confront follows a hold policy (RushOptions.after).
import {
  effectiveStats,
  findCharacter,
  findUnit,
  hasStatus,
  isDowned,
  isDueling,
  isInert,
  isInZone,
  manhattan,
  pathCost,
  type GameState,
  type Pos,
  type Unit,
} from '../../src/engine';
import { adjacentTiles, enemiesWithin, ring, type Order } from './kit';

/** Per-run scratch memory a strategy may use (plain object, reset per game). */
export type Memory = Record<string, unknown>;

export interface Strategy {
  name: string;
  description: string;
  /** Rebel unit ids in the order they act this phase. */
  sequence(s: GameState, mem: Memory): string[];
  /** The Order for one unit, built right before it acts. */
  order(s: GameState, unitId: string, mem: Memory): Order;
}

const P = (x: number, y: number): Pos => ({ x, y });

const THRONE_WOLVES = ['wolf-k1', 'wolf-k2', 'wolf-s1', 'wolf-s2', 'wolf-r1', 'wolf-r2'];
const ALL_WOLVES = ['wolf-s1', 'wolf-s2', 'wolf-s3', 'wolf-k1', 'wolf-k2', 'wolf-k3', 'wolf-r1', 'wolf-r2'];

// --- shared orders -----------------------------------------------------------

/** Tempest when it hits 3+ enemies, or 2+ while within 3 of the Emperor. */
function tempestPolicy(s: GameState, u: Unit, at: Pos): number {
  const n = enemiesWithin(s, u, at, 3).length;
  const halden = findCharacter(s, 'halden');
  if (n >= 3) return 400 + 60 * n;
  if (n >= 2 && halden && manhattan(at, halden.pos) <= 3) return 400 + 60 * n;
  return -1;
}

/** Varek: march on the Emperor, kill whoever blocks a Confront tile, Confront. */
function varekToThrone(s: GameState): Order {
  const halden = findCharacter(s, 'halden');
  if (!halden) return { goals: [], risk: 0.3 };
  const varek = findCharacter(s, 'varek');
  const north = s.map.objects.find((o) => o.id === 'doorWellNorth');
  if (varek && isInZone(s, varek.pos, 'wellspringHall') && north && north.kind === 'door' && !north.destroyed) {
    // Inside the Wellspring Hall: break out through its north door, straight onto the antechamber.
    return { goals: [P(15, 9), P(14, 9), P(16, 9)], goalWeight: 6, risk: 0.3, objects: { doorWellNorth: 20 }, domain: tempestPolicy };
  }
  const adj = adjacentTiles(halden.pos);
  const focus: Record<string, number> = {};
  for (const e of s.units) if (e.faction === 'loyalist' && adj.some((t) => t.x === e.pos.x && t.y === e.pos.y)) focus[e.id] = 40;
  return { goals: adj, goalWeight: 6, risk: 0.3, interactions: [{ kind: 'confront' }], domain: tempestPolicy, focus };
}

/** Varek after the Confront: hunt Elian (Tempest on him if it is still unused). */
function varekHuntElian(s: GameState): Order {
  const elian = findCharacter(s, 'elian');
  if (!elian) return { goals: [], risk: 0.3 };
  return {
    goals: ring(s, elian.pos, 1, 2),
    goalWeight: 6,
    risk: 0.3,
    focus: { elian: 300 },
    objects: { doorWellNorth: 3, doorWellSouth: 3 },
    domain: (_s, _u, at) => (manhattan(at, elian.pos) <= 3 ? 600 : -1),
  };
}

/** Varek, Elian first: break into the Wellspring Hall from the quay and kill the sealed prince. */
function varekElianFirst(s: GameState): Order {
  const elian = findCharacter(s, 'elian')!;
  const sealed = hasStatus(elian, 'sealed');
  return {
    goals: ring(s, elian.pos, 1, 2),
    goalWeight: 6,
    risk: 0.3,
    focus: { elian: 300 },
    objects: { doorWellSouth: 8 },
    domain: (st, u, at) =>
      sealed && isInZone(st, at, 'wellspringHall') && manhattan(at, elian.pos) <= 2 ? 600 + 60 * enemiesWithin(st, u, at, 3).length : -1,
  };
}

/** Kaela is at 40% HP or less: the Mira hunt is off. */
export function kaelaGaveUp(s: GameState): boolean {
  const k = findCharacter(s, 'kaela');
  return k !== undefined && k.hp * 5 <= k.maxHp * 2;
}

/** Kaela: reach Mira, soften her to half HP (her hits cannot kill), Capture. */
function kaelaToMira(s: GameState): Order {
  const mira = findCharacter(s, 'mira');
  const kaela = findCharacter(s, 'kaela');
  if (!mira || !kaela) return { goals: [], risk: 3 };
  // She must survive (defeat if she falls): the more hurt, the more careful.
  const hurt = kaela.hp / kaela.maxHp;
  const risk = hurt > 0.7 ? 1.5 : hurt > 0.4 ? 3 : 6;
  // Too hurt to keep at it: give Mira up and fall back on Varek (Capture still taken if offered).
  if (kaelaGaveUp(s)) {
    const varek = findCharacter(s, 'varek');
    return { goals: varek ? ring(s, varek.pos, 1, 2) : [], goalWeight: 1, risk: 6, avoidLethal: true, interactions: [{ kind: 'capture' }] };
  }
  return { goals: adjacentTiles(mira.pos), goalWeight: 5, risk, avoidLethal: true, interactions: [{ kind: 'capture' }], focus: { mira: 40 } };
}

/** Kaela with no interest in Mira: march with the main body (brain-dead play). */
function followGoals(goals: Pos[], risk: number): Order {
  return { goals, goalWeight: 4, risk, interactions: [{ kind: 'confront' }, { kind: 'capture' }] };
}

/**
 * A Wolf escorting toward a point: close on the nearest enemy (never Mira)
 * within `reach` of the point, else hug the point.
 */
function escort(s: GameState, center: Pos, min = 1, max = 3, risk = 0.8, reach = 7): Order {
  const foes = s.units
    .filter((e) => e.faction === 'loyalist' && e.character !== 'mira' && !e.tags.includes('noResist') && !hasStatus(e, 'sealed'))
    .filter((e) => !hasStatus(e, 'dueling') && manhattan(e.pos, center) <= reach);
  const goals = foes.length > 0 ? foes.flatMap((e) => adjacentTiles(e.pos)) : ring(s, center, min, max);
  return { goals, goalWeight: 3, risk };
}

/** A Wolf holding one tile. */
function holdTile(tile: Pos, risk = 0.4): Order {
  return { goals: [tile], goalWeight: 6, risk };
}

// --- after the Confront: hold until Dawn ---------------------------------------

/**
 * What the rebels do once the Emperor is dead:
 *   throne  regroup on Varek in the Throne Hall (Kaela and her escorts walk back);
 *   split   Varek holds the Throne Hall, Kaela and her escorts hold where they are;
 *   hunt    go after the nearest loyalists (a try for an early rout).
 */
export type AfterConfront = 'throne' | 'split' | 'hunt';

/** The Throne Hall rally point: in front of the dais, one step from the main door's line. */
const THRONE_HOLD: Pos = P(15, 3);

function nonInertFoes(s: GameState): Unit[] {
  return s.units.filter((e) => e.faction === 'loyalist' && !isInert(e) && e.character !== 'mira');
}

/** Varek after the Confront: hold the Throne Hall and kill what comes in reach, or hunt. */
function varekHold(s: GameState, after: AfterConfront): Order {
  const varek = findCharacter(s, 'varek');
  if (!varek) return { goals: [], risk: 0.3 };
  if (after === 'hunt') {
    const foes = nonInertFoes(s).filter((e) => !isDueling(s, e));
    const near = foes.sort((a, b) => manhattan(a.pos, varek.pos) - manhattan(b.pos, varek.pos)).slice(0, 3);
    return { goals: near.flatMap((e) => adjacentTiles(e.pos)), goalWeight: 4, risk: 0.3, domain: tempestPolicy };
  }
  return { ...escort(s, THRONE_HOLD, 0, 2, 0.3, 4), domain: tempestPolicy };
}

/** Kaela after Mira is resolved: stay alive. */
function kaelaHold(s: GameState, after: AfterConfront): Order {
  const varek = findCharacter(s, 'varek');
  if (after === 'split' || !varek) return { goals: [], risk: 4, avoidLethal: true };
  return { goals: ring(s, varek.pos, 1, 2), goalWeight: 3, risk: 4, avoidLethal: true };
}

/** A Wolf after the Confront: guard Varek (or Kaela, for her escorts in a split hold), or hunt. */
function wolfHold(s: GameState, after: AfterConfront, guarding: 'varek' | 'kaela'): Order {
  const varek = findCharacter(s, 'varek');
  const kaela = findCharacter(s, 'kaela');
  const ward = after === 'split' && guarding === 'kaela' && kaela ? kaela : varek ?? kaela;
  if (!ward) return { goals: [], risk: 0.8 };
  if (after === 'hunt') return escort(s, ward.pos, 1, 3, 0.6, 8);
  return escort(s, ward.pos, 1, 3, 0.8, 4);
}

// --- reviving downed heroes ------------------------------------------------------

const REVIVE_VALUE = 80000;

/** Cheapest move cost for `u` to a free tile next to `p` (0 when already adjacent), or Infinity. */
function costToAdjacent(s: GameState, u: Unit, p: Pos): number {
  if (manhattan(u.pos, p) === 1) return 0;
  let best = Infinity;
  for (const t of adjacentTiles(p)) {
    const c = pathCost(s, u.id, t, { ignoreMoveLimit: true });
    if (c !== null && c < best) best = c;
  }
  return best;
}

/**
 * For each downed rebel hero, the free rebel who goes to revive it: the one
 * that gets next to it cheapest (the other hero only if nobody else can,
 * Varek not at all while the Emperor lives). Grimm in the duel cannot help.
 */
export function reviveAssignments(s: GameState): Record<string, string> {
  const out: Record<string, string> = {};
  const downed = s.units.filter((u) => u.faction === 'rebel' && isDowned(u));
  const taken = new Set<string>();
  const haldenAlive = findCharacter(s, 'halden') !== undefined;
  for (const hero of downed) {
    let best: { id: string; cost: number } | null = null;
    for (const u of s.units) {
      if (u.faction !== 'rebel' || u.id === hero.id || isInert(u) || u.hasActed || isDueling(s, u) || taken.has(u.id)) continue;
      if (u.character === 'varek' && haldenAlive) continue;
      const cost = costToAdjacent(s, u, hero.pos) + (u.tags.includes('hero') ? 8 : 0);
      if (cost === Infinity) continue;
      if (!best || cost < best.cost) best = { id: u.id, cost };
    }
    if (best) {
      out[best.id] = hero.id;
      taken.add(best.id);
    }
  }
  return out;
}

function reviveOrder(s: GameState, u: Unit, heroId: string): Order {
  const hero = findUnit(s, heroId);
  if (!hero) return { goals: [] };
  const reachable = costToAdjacent(s, u, hero.pos) <= effectiveStats(u).move;
  return {
    goals: adjacentTiles(hero.pos),
    goalWeight: 20,
    // Getting there is worth some danger: the alternative is losing the battle.
    risk: reachable ? 0.1 : 0.5,
    interactions: [{ kind: 'revive', targetId: heroId, value: REVIVE_VALUE * 2 }],
  };
}

/**
 * Adds reviving to a strategy: revivers act first in the phase and head for
 * their hero; every other unit may revive a downed hero it is standing next to.
 */
export function withRevive(strat: Strategy): Strategy {
  return {
    ...strat,
    sequence: (s, mem) => {
      const base = strat.sequence(s, mem);
      const revivers = Object.keys(reviveAssignments(s));
      mem.revivers = reviveAssignments(s);
      return [...revivers, ...base.filter((id) => !revivers.includes(id))];
    },
    order: (s, id, mem) => {
      const assigned = (mem.revivers as Record<string, string> | undefined)?.[id];
      const u = findUnit(s, id);
      if (assigned && u) {
        const hero = findUnit(s, assigned);
        if (hero && isDowned(hero)) return reviveOrder(s, u, assigned);
      }
      const o = strat.order(s, id, mem);
      return { ...o, interactions: [...(o.interactions ?? []), { kind: 'revive', value: REVIVE_VALUE }] };
    },
  };
}

export type GrimmMode = 'passive' | 'fight' | 'leave';

/** Grimm in the duel. */
function grimmOrder(s: GameState, mode: GrimmMode): Order {
  const g = findCharacter(s, 'grimm');
  const orsa = findCharacter(s, 'orsa');
  const dueling = g !== undefined && hasStatus(g, 'dueling');
  if (mode === 'passive' && dueling) return { goals: [], idle: true };
  if (mode === 'leave' || !dueling) {
    const halden = findCharacter(s, 'halden');
    const goal = orsa ? ring(s, orsa.pos, 1, 2) : halden ? adjacentTiles(halden.pos) : [];
    return { goals: goal, goalWeight: 4, risk: 0.3, focus: orsa ? { orsa: 100 } : {} };
  }
  // fight: stay in the hall, prefer pillar cover, hit Orsa every turn.
  return { goals: orsa ? ring(s, orsa.pos, 1, 2) : [], goalWeight: 1, risk: 1, confine: 'feastHall', onlyTargets: ['orsa'] };
}

// --- strategies ---------------------------------------------------------------

export const endTurnOnly: Strategy = {
  name: 'endTurn',
  description: 'End the turn every round, never touch a unit.',
  sequence: () => [],
  order: () => ({ goals: [], idle: true }),
};

/** Everyone, Grimm included, runs straight at the Emperor and hits whatever is in reach. */
const chargeRaw: Strategy = {
  name: 'charge',
  description: 'All-in forward charge: every unit (Grimm too) runs at the throne, attacks anything in reach; no plan after the Confront.',
  sequence: (s) => s.units.filter((u) => u.faction === 'rebel').map((u) => u.id),
  order: (s, id) => {
    const halden = findCharacter(s, 'halden');
    const goals = halden ? adjacentTiles(halden.pos) : [];
    const u = findUnit(s, id)!;
    if (u.character === 'varek') return { ...followGoals(goals, 0), domain: tempestPolicy };
    return followGoals(goals, 0);
  },
};
export const charge = withRevive(chargeRaw);

/** Like charge, but Grimm stays in the duel and trades blows (the "obvious" naive line). */
export const chargePinned = withRevive({
  name: 'chargePinned',
  description: 'Forward charge, Grimm keeps fighting the duel.',
  sequence: chargeRaw.sequence,
  order: (s, id, mem) => (id === 'grimm' ? grimmOrder(s, 'fight') : chargeRaw.order(s, id, mem)),
});

interface RushOptions {
  name: string;
  description: string;
  grimm: GrimmMode;
  throne: string[];
  mira: string[];
  /** Wolves that plug the tower door from the court tile (26,9) while Mira is inside. */
  plug?: string[];
  /** Wolves that take and hold the bell tower. */
  bellTower?: string[];
  /** Wolf id -> [bridge id, stand tile (south bank, beside the bridge), units that must be north of the canal first]. */
  burners?: Record<string, [string, Pos, string[]]>;
  /** After the Confront (or with elianFirst, before it) Varek goes after Elian. */
  huntElian?: boolean;
  /** Wolves that join Grimm in the Feast Hall and chip at Orsa (she may only strike Grimm). */
  duelHelpers?: string[];
  /** Wolves that enter the Wellspring Hall to kill the anchor-breakers, then bar its west door. */
  wardens?: string[];
  /** Varek goes through the Wellspring Hall (breaking its barred doors) and kills the sealed Elian first. */
  elianFirst?: boolean;
  /** What to do once the Emperor is dead (default: regroup in the Throne Hall). */
  after?: AfterConfront;
}

function rush(o: RushOptions): Strategy {
  return withRevive(rushRaw(o));
}

function rushRaw(o: RushOptions): Strategy {
  const assigned = new Set<string>([
    ...o.throne,
    ...o.mira,
    ...(o.plug ?? []),
    ...(o.bellTower ?? []),
    ...Object.keys(o.burners ?? {}),
    ...(o.duelHelpers ?? []),
    ...(o.wardens ?? []),
  ]);
  return {
    name: o.name,
    description: o.description,
    sequence: (s) => {
      // Near the throne the escorts strike first, so Varek can step onto a freed tile and Confront.
      const halden = findCharacter(s, 'halden');
      const varek = findCharacter(s, 'varek');
      const close = halden && varek && manhattan(halden.pos, varek.pos) <= 5;
      const ids = close ? ['grimm', ...o.throne, 'varek'] : ['grimm', 'varek', ...o.throne];
      // Kaela moves after her escorts, so she plans around where they actually ended up.
      ids.push(...o.mira, ...(o.plug ?? []), 'kaela', ...(o.wardens ?? []));
      ids.push(...(o.bellTower ?? []), ...Object.keys(o.burners ?? {}), ...(o.duelHelpers ?? []));
      for (const w of ALL_WOLVES) if (!assigned.has(w)) ids.push(w);
      return ids.filter((id) => findUnit(s, id));
    },
    order: (s, id) => {
      const halden = findCharacter(s, 'halden');
      const mira = findCharacter(s, 'mira');
      const elian = findCharacter(s, 'elian');
      const varek = findCharacter(s, 'varek');
      const after = o.after ?? 'throne';
      if (id === 'grimm') return grimmOrder(s, o.grimm);
      if (id === 'varek') {
        if (o.elianFirst && elian && halden) return varekElianFirst(s);
        if (halden) return varekToThrone(s);
        if (o.huntElian && elian) return varekHuntElian(s);
        return varekHold(s, after);
      }
      if (id === 'kaela') return mira ? kaelaToMira(s) : kaelaHold(s, halden ? 'split' : after);
      if (o.mira.includes(id)) return mira ? escort(s, mira.pos, 1, 3, 0.8) : halden ? escort(s, halden.pos) : wolfHold(s, after, 'kaela');
      if (o.plug?.includes(id) && kaelaGaveUp(s)) return varek ? escort(s, varek.pos, 1, 2, 0.8) : { goals: [] };
      if (o.plug?.includes(id)) {
        if (mira) return isInZone(s, mira.pos, 'princessTower') ? holdTile(P(26, 9), 0.5) : escort(s, mira.pos, 1, 2, 0.6);
        return halden ? { goals: [] } : wolfHold(s, after, 'kaela');
      }
      if (o.bellTower?.includes(id)) {
        // The bell tower's floor tiles; the great bell stands on (2,18).
        const tiles: Pos[] = [P(3, 18), P(4, 18), P(2, 19), P(3, 19), P(4, 19)];
        return { goals: tiles, goalWeight: 5, risk: 0.6 };
      }
      const burn = o.burners?.[id];
      if (burn) {
        const [bridgeId, stand, waitFor] = burn;
        const bridge = s.map.objects.find((b) => b.id === bridgeId);
        if (bridge && bridge.kind === 'bridge' && !bridge.burned) {
          const crossed = waitFor.every((w) => {
            const u = findUnit(s, w);
            return !u || u.pos.y < 15;
          });
          return { goals: [stand], goalWeight: 5, risk: 0.5, interactions: crossed ? [{ kind: 'burnBridge', targetId: bridgeId, value: 500 }] : [] };
        }
        return o.bellTower ? { goals: [P(4, 19), P(3, 19)], goalWeight: 3, risk: 0.6 } : { goals: [], risk: 0.6 };
      }
      if (o.wardens?.includes(id)) {
        const breakers = s.units.filter((e) => e.tags.includes('anchorBreaker') && e.faction === 'loyalist');
        if (elian && hasStatus(elian, 'sealed') && breakers.length > 0) {
          const focus: Record<string, number> = {};
          for (const b of breakers) focus[b.id] = 60;
          return { goals: breakers.flatMap((b) => adjacentTiles(b.pos)), goalWeight: 4, risk: 0.5, focus };
        }
        if (elian) {
          // Bar the Wellspring west door pair, then chip at Elian once he is loose.
          const i = o.wardens.indexOf(id);
          const doorTiles = [P(11, 10), P(11, 11), P(10, 10), P(10, 11)];
          const t = doorTiles[i % doorTiles.length]!;
          return { goals: [t], goalWeight: 5, risk: 0.3, focus: { elian: 30 } };
        }
        return halden ? escort(s, halden.pos) : mira ? escort(s, mira.pos) : wolfHold(s, after, 'varek');
      }
      if (o.duelHelpers?.includes(id)) {
        const orsa = findCharacter(s, 'orsa');
        if (orsa && hasStatus(orsa, 'dueling')) return { goals: adjacentTiles(orsa.pos), goalWeight: 4, risk: 0.5, focus: { orsa: 50 } };
        if (orsa) return { goals: ring(s, orsa.pos, 1, 1), goalWeight: 4, risk: 0.8, focus: { orsa: 50 } };
        return halden ? escort(s, halden.pos) : { goals: [] };
      }
      // Throne escorts and anyone unassigned.
      if (o.elianFirst && elian && halden && varek) return { ...escort(s, varek.pos, 1, 2, 0.8, 4), objects: { doorWellSouth: 5 } };
      if (halden) {
        const pressing = varek !== undefined && manhattan(varek.pos, halden.pos) <= 5;
        const order = escort(s, halden.pos, 1, 3, pressing ? 0.4 : 0.8);
        // Clear a Confront tile for Varek.
        const focus: Record<string, number> = {};
        for (const e of s.units) if (e.faction === 'loyalist' && manhattan(e.pos, halden.pos) === 1) focus[e.id] = 40;
        return { ...order, focus };
      }
      if (o.huntElian && elian) return { goals: ring(s, elian.pos, 1, 1), goalWeight: 4, risk: 0.3, focus: { elian: 30 } };
      return wolfHold(s, after, 'varek');
    },
  };
}

export const varekRush = rush({
  name: 'varekRush',
  description: 'Varek + 6 Wolves to the throne, Grimm fights the duel, Kaela + 2 Wolves to Mira (one plugs the tower door).',
  grimm: 'fight',
  throne: THRONE_WOLVES,
  mira: ['wolf-k3'],
  plug: ['wolf-s3'],
});

export const varekRushPassiveGrimm = rush({
  name: 'rushGrimmIdle',
  description: 'varekRush, but Grimm is left to auto-duel (never acts).',
  grimm: 'passive',
  throne: THRONE_WOLVES,
  mira: ['wolf-k3'],
  plug: ['wolf-s3'],
});

export const grimmHelped = rush({
  name: 'grimmHelped',
  description: 'varekRush with 2 Soldier Wolves sent to the Feast Hall to chip at Orsa.',
  grimm: 'fight',
  throne: ['wolf-k1', 'wolf-k2', 'wolf-r1', 'wolf-r2'],
  mira: ['wolf-k3'],
  plug: ['wolf-s3'],
  duelHelpers: ['wolf-s1', 'wolf-s2'],
});

export const sweepThroneFirst = rush({
  name: 'sweepThroneFirst',
  description: 'Throne first, then Elian: Varek + 3 to the throne, then on to Elian; 3 Wolves kill the anchor-breakers and bar the Wellspring west door; Kaela + 2 to Mira.',
  grimm: 'fight',
  throne: ['wolf-k2', 'wolf-r1', 'wolf-r2'],
  mira: ['wolf-k3'],
  plug: ['wolf-s3'],
  wardens: ['wolf-k1', 'wolf-s1', 'wolf-s2'],
  huntElian: true,
});

const SWEEP: RushOptions = {
  name: 'fullSweep',
  description: 'All three: Varek + 4 break into the Wellspring Hall from the quay and kill the sealed Elian, then the throne; 2 Wolves hunt the anchor-breakers; Kaela + 2 to Mira; Grimm fights.',
  grimm: 'fight',
  throne: ['wolf-k1', 'wolf-k2', 'wolf-r1', 'wolf-r2'],
  mira: ['wolf-k3'],
  plug: ['wolf-s3'],
  wardens: ['wolf-s1', 'wolf-s2'],
  elianFirst: true,
  huntElian: true,
};

export const fullSweep = rush(SWEEP);

export const sweepBell = rush({
  ...SWEEP,
  name: 'sweepBell',
  description: 'fullSweep, but the two warden Wolves seize the bell tower instead (all bells +2).',
  wardens: [],
  bellTower: ['wolf-s1', 'wolf-s2'],
});

export const sweepAllBonuses = rush({
  ...SWEEP,
  name: 'sweepBonuses',
  description: 'sweepBell plus both barracks bridges burned (r2 and k1 peel off from the Wellspring group).',
  throne: ['wolf-k2', 'wolf-r1'],
  wardens: [],
  bellTower: ['wolf-s1', 'wolf-s2'],
  burners: {
    'wolf-k1': ['bridgeCenter', P(15, 17), ['varek', 'wolf-k2', 'wolf-r1']],
    'wolf-r2': ['bridgeEast', P(26, 17), ['kaela', 'wolf-k3', 'wolf-s3']],
  },
});

export const sweepGrimmIdle = rush({
  ...SWEEP,
  name: 'sweepGrimmIdle',
  description: 'fullSweep, but Grimm is left to auto-duel.',
  grimm: 'passive',
});

export const bonusRush = rush({
  name: 'bonusRush',
  description: 'Bell tower (k1 + s2) and both barracks bridges (s1, r2) first, then the Varek rush with the rest.',
  grimm: 'fight',
  throne: ['wolf-k2', 'wolf-r1'],
  mira: ['wolf-k3'],
  plug: ['wolf-s3'],
  bellTower: ['wolf-k1', 'wolf-s2'],
  burners: {
    'wolf-s1': ['bridgeCenter', P(15, 17), ['varek', 'wolf-k2', 'wolf-r1']],
    'wolf-r2': ['bridgeEast', P(26, 17), ['kaela', 'wolf-k3', 'wolf-s3']],
  },
});

/** Probe: Varek alone at the throne (the other Wolves idle at the gate). */
export const varekSolo: Strategy = withRevive({
  ...rushRaw({ name: 'varekSolo', description: 'Varek alone to the throne; Kaela + 2 to Mira; the rest stay home.', grimm: 'fight', throne: [], mira: ['wolf-k3'], plug: ['wolf-s3'] }),
  sequence: (s) => ['grimm', 'varek', 'kaela', 'wolf-k3', 'wolf-s3'].filter((id) => findUnit(s, id)),
});

/** varekRush, but after the Confront Kaela's group holds where it is (the tower) instead of walking back. */
export const rushSplitHold = rush({
  name: 'rushSplitHold',
  description: 'varekRush; after the Confront Varek holds the Throne Hall while Kaela and her two Wolves hold where they are.',
  grimm: 'fight',
  throne: THRONE_WOLVES,
  mira: ['wolf-k3'],
  plug: ['wolf-s3'],
  after: 'split',
});

/** varekRush, but after the Confront everyone goes hunting (a try for a rout before Dawn). */
export const rushHunt = rush({
  name: 'rushHunt',
  description: 'varekRush; after the Confront Varek and the Wolves hunt the nearest loyalists (a try for a rout), Kaela stays behind Varek.',
  grimm: 'fight',
  throne: THRONE_WOLVES,
  mira: ['wolf-k3'],
  plug: ['wolf-s3'],
  after: 'hunt',
});

/** Probe: only Grimm plays (he fights the duel from the pillars); everyone else stays home. Measures the duel on its own. */
export const duelOnly: Strategy = {
  name: 'duelOnly',
  description: 'Probe: Grimm fights the duel from the pillars, every other rebel ends its turn.',
  sequence: (s) => (findUnit(s, 'grimm') ? ['grimm'] : []),
  order: (s) => grimmOrder(s, 'fight'),
};

export const STRATEGIES: Strategy[] = [
  endTurnOnly,
  duelOnly,
  charge,
  chargePinned,
  varekRush,
  rushSplitHold,
  rushHunt,
  varekRushPassiveGrimm,
  grimmHelped,
  varekSolo,
  bonusRush,
  fullSweep,
  sweepBell,
  sweepAllBonuses,
  sweepGrimmIdle,
  sweepThroneFirst,
];
