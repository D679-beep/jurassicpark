// Test-only miniature of the prologue: every set piece on a 22x12 map.
// Not the real prologue map (that lives in src/content).
import type { ScenarioDef } from '../../../src/engine';

//            x: 0123456789012345678901
export const MINI_MAP = [
  '######################', // 0
  '#..T..#......#......##', // 1  throneHall | feastHall | wellspringHall
  '#.....#..O...#...^..+.', // 2  servants tunnel door (20,2), exit (21,2)
  '#.....#......#......##', // 3
  '###+######+######+####', // 4  doors (3,4) barred, (10,4), (17,4)
  '#....................#', // 5  courtyard
  '~~~~~~=~~~~~=~~~~~~~~~', // 6  canal, bridges (6,6) and (12,6)
  '#....................#', // 7
  '#...#.......%..#.....#', // 8
  '....+..........+.....#', // 9  tower exit (0,9); doors (4,9), (15,9)
  '#...#..........#.....#', // 10
  '######################', // 11
];

export function miniPrologue(): ScenarioDef {
  return {
    id: 'miniPrologue',
    name: 'Mini Prologue (test fixture)',
    playerFaction: 'rebel',
    seed: 1234,
    map: MINI_MAP,
    zones: {
      throneHall: { x: 1, y: 1, w: 5, h: 3 },
      feastHall: { x: 7, y: 1, w: 6, h: 3 },
      wellspringHall: { x: 14, y: 1, w: 6, h: 3 },
      servantsTunnel: { tiles: [[20, 2], [21, 2]] },
      princessTower: { x: 1, y: 8, w: 3, h: 3 },
      bellTower: { x: 16, y: 8, w: 5, h: 3 },
      innerGate: { rects: [{ x: 18, y: 5, w: 3, h: 1 }], tiles: [[20, 7]] },
    },
    objects: [
      { id: 'throneDoor', kind: 'door', pos: [3, 4], hp: 8 },
      { id: 'anchorA', kind: 'anchor', pos: [14, 1] },
      { id: 'anchorB', kind: 'anchor', pos: [19, 3] },
      { id: 'anchorC', kind: 'anchor', pos: [9, 5] },
      { id: 'westBridge', kind: 'bridge', tiles: [[6, 6]], tags: ['barracksRoute'] },
      { id: 'eastBridge', kind: 'bridge', tiles: [[12, 6]], tags: ['barracksRoute'] },
    ],
    exits: [
      { id: 'towerExit', zone: 'princessTower', tiles: [[0, 9]], units: ['mira'] },
      { id: 'tunnelExit', zone: 'servantsTunnel', tiles: [[21, 2]], units: ['elian'] },
    ],
    units: [
      // Rebels (Varek and Kaela are heroes: downed at 0 HP, revivable once)
      { id: 'varek', name: 'Varek', faction: 'rebel', rank: 'ascendant', character: 'varek', pos: [6, 5], tags: ['hero'] },
      { id: 'grimm', name: 'Grimm', faction: 'rebel', rank: 'ascendant', character: 'grimm', pos: [8, 2], statuses: ['dueling'] },
      { id: 'kaela', name: 'Kaela', faction: 'rebel', rank: 'kindled', character: 'kaela', pos: [6, 9], tags: ['hero'] },
      { id: 'wolf1', name: 'Ashen Wolf', faction: 'rebel', rank: 'soldier', pos: [8, 5] },
      { id: 'wolf2', name: 'Ashen Wolf', faction: 'rebel', rank: 'soldier', pos: [10, 7] },
      { id: 'wolf3', name: 'Ashen Wolf', faction: 'rebel', rank: 'soldier', pos: [7, 9] },
      { id: 'archer', name: 'Wolf Radiant', faction: 'rebel', rank: 'radiant', pos: [11, 9] },
      // Loyalists
      { id: 'halden', name: 'Emperor Halden', faction: 'loyalist', rank: 'soldier', character: 'halden', pos: [3, 1], tags: ['noResist'] },
      { id: 'guard1', name: 'Palace Guard', faction: 'loyalist', rank: 'soldier', pos: [2, 3], guardZone: 'throneHall' },
      { id: 'guard2', name: 'Palace Guard', faction: 'loyalist', rank: 'soldier', pos: [4, 2], guardZone: 'throneHall' },
      { id: 'orsa', name: 'Lady Orsa', faction: 'loyalist', rank: 'ascendant', character: 'orsa', pos: [11, 2], statuses: ['dueling'] },
      { id: 'elian', name: 'Prince Elian', faction: 'loyalist', rank: 'ascendant', character: 'elian', pos: [18, 2], statuses: ['sealed'], tags: ['escapee'] },
      { id: 'mira', name: 'Princess Mira', faction: 'loyalist', rank: 'radiant', character: 'mira', pos: [2, 9], tags: ['escapee'] },
      { id: 'breaker', name: 'Lantern Sapper', faction: 'loyalist', rank: 'soldier', pos: [16, 5], tags: ['anchorBreaker'] },
      { id: 'towerGuard', name: 'Bell Warden', faction: 'loyalist', rank: 'soldier', pos: [18, 9], guardZone: 'bellTower' },
    ],
    waves: [
      {
        id: 'cityWatch',
        name: 'City Watch',
        bell: 'firstBell',
        spawnTiles: [[20, 5], [20, 7]],
        units: [
          { id: 'watch1', faction: 'loyalist', rank: 'soldier' },
          { id: 'watch2', faction: 'loyalist', rank: 'soldier' },
          { id: 'watch3', faction: 'loyalist', rank: 'soldier' },
        ],
      },
      {
        id: 'dawnLantern',
        name: 'Dawn Lantern Knights',
        bell: 'secondBell',
        spawnTiles: [[20, 5], [20, 7]],
        units: [
          { id: 'knight1', faction: 'loyalist', rank: 'kindled' },
          { id: 'knight2', faction: 'loyalist', rank: 'radiant' },
        ],
      },
      {
        id: 'southernLegion',
        name: 'Southern Legion',
        bell: 'thirdBell',
        spawnTiles: [[20, 5]],
        units: [{ id: 'legion1', faction: 'loyalist', rank: 'soldier' }],
      },
    ],
    dialogue: {
      confront: [{ speaker: 'varek', text: 'Father.' }],
      sealBroken: [{ speaker: 'elian', text: 'The ward is gone.' }],
    },
  };
}
