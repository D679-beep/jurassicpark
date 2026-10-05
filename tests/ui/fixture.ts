// Small scenario for UI logic tests (not a test file).
import { applyAction, createGame, type Action, type GameEvent, type GameState, type ScenarioDef } from '../../src/engine';

//   x: 0123456789
export const UI_MAP = [
  '##########', // 0
  '#..T.....#', // 1  Halden on the throne (3,1)
  '#........#', // 2
  '#........#', // 3
  '#~~=~~~~~#', // 4  canal, bridge (3,4)
  '#........#', // 5
  '##########', // 6
];

export function uiScenario(): ScenarioDef {
  return {
    id: 'uiTest',
    name: 'UI Test',
    playerFaction: 'rebel',
    seed: 7,
    map: UI_MAP,
    zones: { throneHall: { x: 1, y: 1, w: 8, h: 2 } },
    objects: [{ id: 'bridgeMid', kind: 'bridge', tiles: [[3, 4]] }],
    units: [
      { id: 'varek', name: 'Varek', faction: 'rebel', rank: 'ascendant', character: 'varek', pos: [3, 3] },
      { id: 'wolf', name: 'Ashen Wolf', faction: 'rebel', rank: 'soldier', pos: [6, 2] },
      { id: 'archer', name: 'Wolf Radiant', faction: 'rebel', rank: 'radiant', pos: [3, 5] },
      { id: 'halden', name: 'Emperor Halden', faction: 'loyalist', rank: 'soldier', character: 'halden', pos: [3, 1], tags: ['noResist'] },
      { id: 'guard', name: 'Palace Guard', faction: 'loyalist', rank: 'soldier', pos: [7, 2], stats: { hp: 3 } },
    ],
    waves: [
      {
        id: 'watch',
        name: 'City Watch',
        bell: 'firstBell',
        spawnTiles: [[8, 5], [7, 5]],
        units: [
          { id: 'watch-1', name: 'City Watch', faction: 'loyalist', rank: 'soldier' },
          { id: 'watch-2', name: 'City Watch', faction: 'loyalist', rank: 'soldier' },
        ],
      },
    ],
    bells: { firstBell: 2, secondBell: 4, dawn: 6 },
  };
}

export function uiGame(): GameState {
  return createGame(uiScenario());
}

/** The UI scenario after `edit` has changed its definition (move a unit, add one, swap a legend char). */
export function uiGameWith(edit: (def: ScenarioDef) => void): GameState {
  const def = uiScenario();
  edit(def);
  return createGame(def);
}

/** Moves a unit of a scenario definition. */
export function placeUnit(def: ScenarioDef, id: string, pos: [number, number]): void {
  const u = def.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  u.pos = pos;
}

/** Adds Kaela (rebel, kindled) at `kaela` and a weakened Mira (loyalist radiant, 5/18 HP) at `mira`. */
export function addKaelaAndMira(def: ScenarioDef, kaela: [number, number], mira: [number, number]): void {
  def.units.push(
    { id: 'kaela', name: 'Kaela', faction: 'rebel', rank: 'kindled', character: 'kaela', pos: kaela },
    { id: 'mira', name: 'Princess Mira', faction: 'loyalist', rank: 'radiant', character: 'mira', pos: mira, stats: { hp: 5, maxHp: 18 } },
  );
}

export function play(state: GameState, ...actions: Action[]): { state: GameState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = applyAction(s, a);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

export const END: Action = { kind: 'endTurn' };
