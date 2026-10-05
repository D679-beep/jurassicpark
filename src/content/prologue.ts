// The prologue scenario, "Night of Ashen Lanterns". Encodes docs/design/prologue-map.md.
// Coordinates are (x, y) with x = column from the left and y = row from the top.
import type { DialogueLine, ObjectDef, ScenarioDef, UnitPlacement, WaveDef } from '../engine';

/** Intro card text, shown before the battle (the engine has no hook for it). */
export const prologueIntro =
  'Midnight. The lanterns of Calderon go dark one by one. The Ashen Wolves hold the inner gates, ' +
  'and the Wellspring Hall is sealed with the Crown Prince inside. The Emperor must fall, ' +
  'and the palace must be held until dawn.';

// Legend: # wall, . floor, + door, = barred door (an object sits on it), ~ water (canal and
// the Wellspring pool), b bridge, o pillar, r rubble, T throne/dais, t banquet table,
// c crates, s quay steps, * brazier, B great bell. The outer-gate portcullis is an
// object over the floor tiles (22..25, 21). The doc's characters are pasted verbatim.
//            x: 00000000001111111111222222222233
//               01234567890123456789012345678901
const MAP: string[] = [
  '################################', //  0
  '#.tttttt.#.#..TTTT..#.#........#', //  1
  '#........#.#.o.TT.o.#.#........#', //  2
  '#..o..o..#.=........=.#######..#', //  3
  '#........+.#.o....o.#.#........#', //  4
  '#..o..o..#.#..o..o..#.#.########', //  5
  '#........#.####+=####.#........#', //  6
  '#.tttttt.#............#........#', //  7
  '##########.####=#####.####+#####', //  8
  '##########.#.o......#..........#', //  9
  '.........+.+...TT~~o#...o...o..#', // 10
  '.........+.+......o.#........r.#', // 11
  '##########.#####=####......r....', // 12
  '..............c................#', // 13
  '.....s.c......s.s.c.....cs.s...#', // 14
  '#~~~~~b~~~~~~~~b~~~~~~~~~~b~~~~#', // 15
  '#~~~~~b~~~~~~~bbb~~~~~~~~~b~~~~#', // 16
  '######....r.*......*.r.........#', // 17
  '##B..#...r.....................#', // 18
  '##...+................r........#', // 19
  '######......*......*...........#', // 20
  '######################....######', // 21
];

const rebel = (
  id: string,
  rank: UnitPlacement['rank'],
  pos: [number, number],
  extra: Partial<UnitPlacement> = {},
): UnitPlacement => ({ id, name: 'Ashen Wolf', faction: 'rebel', rank, pos, ...extra });

const guard = (
  id: string,
  rank: UnitPlacement['rank'],
  pos: [number, number],
  extra: Partial<UnitPlacement> = {},
): UnitPlacement => ({ id, name: 'Palace Guard', faction: 'loyalist', rank, pos, ...extra });

const objects: ObjectDef[] = [
  // Barred doors (on the `=` tiles).
  { id: 'doorThroneMain', kind: 'door', pos: [16, 6], hp: 18 },
  { id: 'doorThroneWest', kind: 'door', pos: [11, 3], hp: 12 },
  { id: 'doorThroneEast', kind: 'door', pos: [20, 3], hp: 12 },
  { id: 'doorWellNorth', kind: 'door', pos: [15, 8], hp: 14 },
  { id: 'doorWellSouth', kind: 'door', pos: [16, 12], hp: 11 },
  // Ward anchors holding the Wellspring seal.
  { id: 'anchorA', kind: 'anchor', pos: [12, 9], hp: 12 },
  { id: 'anchorB', kind: 'anchor', pos: [19, 9], hp: 12 },
  { id: 'anchorC', kind: 'anchor', pos: [15, 11], hp: 12 },
  // Canal bridges across the 2-wide canal (each burns as one bridge). The centre one lands
  // on a 3-wide deck on the inner-gate side, which keeps the old crossing's flow (balance log).
  // The centre and east ones are on the Dawn Lantern knights' route.
  { id: 'bridgeWest', kind: 'bridge', tiles: [[6, 15], [6, 16]] },
  { id: 'bridgeCenter', kind: 'bridge', tiles: [[15, 15], [14, 16], [15, 16], [16, 16]], tags: ['barracksRoute'] },
  { id: 'bridgeEast', kind: 'bridge', tiles: [[26, 15], [26, 16]], tags: ['barracksRoute'] },
  // The outer-gate portcullis: closed until the Dawn Lantern Knights arrive at Second Bell
  // (they spawn on its tiles).
  { id: 'outerGate', kind: 'gate', tiles: [[22, 21], [23, 21], [24, 21], [25, 21]], wave: 'dawnLantern' },
];

const units: UnitPlacement[] = [
  // Rebels (player). Varek and Kaela are heroes: downed at 0 HP (revivable once), and losing either loses the battle.
  { id: 'varek', name: 'Varek', faction: 'rebel', rank: 'ascendant', character: 'varek', pos: [15, 17], tags: ['hero'] },
  { id: 'kaela', name: 'Kaela', faction: 'rebel', rank: 'kindled', character: 'kaela', pos: [17, 18], tags: ['hero'] },
  { id: 'grimm', name: 'Grimm', faction: 'rebel', rank: 'ascendant', character: 'grimm', pos: [4, 4], statuses: ['dueling'], stats: { def: 5 } },
  rebel('wolf-s1', 'soldier', [13, 17]),
  rebel('wolf-s2', 'soldier', [14, 19]),
  rebel('wolf-s3', 'soldier', [18, 19]),
  rebel('wolf-k1', 'kindled', [14, 17]),
  rebel('wolf-k2', 'kindled', [16, 17]),
  rebel('wolf-k3', 'kindled', [18, 18]),
  rebel('wolf-r1', 'radiant', [15, 19]),
  rebel('wolf-r2', 'radiant', [16, 19]),
  // Loyalists (AI)
  { id: 'halden', name: 'Emperor Halden', faction: 'loyalist', rank: 'soldier', character: 'halden', pos: [15, 2], tags: ['noResist'] },
  // Elian also needs the escapee tag: the engine only offers the escape interaction to escapees.
  { id: 'elian', name: 'Crown Prince Elian', faction: 'loyalist', rank: 'ascendant', character: 'elian', pos: [15, 10], statuses: ['sealed'], tags: ['escapee'], stats: { hp: 34, maxHp: 40 } },
  { id: 'orsa', name: 'Lady Orsa', faction: 'loyalist', rank: 'ascendant', character: 'orsa', pos: [5, 4], statuses: ['dueling'], stats: { hp: 48, atk: 9, def: 5 } },
  { id: 'mira', name: 'Princess Mira', faction: 'loyalist', rank: 'radiant', character: 'mira', pos: [30, 1], tags: ['escapee'], stats: { atk: 4 } },
  guard('g-throne-1', 'kindled', [14, 3], { guardZone: 'throneHall' }),
  guard('g-throne-2', 'kindled', [17, 3], { guardZone: 'throneHall' }),
  guard('g-throne-3', 'kindled', [15, 4], { guardZone: 'throneHall' }),
  guard('g-ante-1', 'soldier', [16, 7], { guardZone: 'throneHall' }),
  guard('g-anchor-1', 'kindled', [12, 7], { tags: ['anchorBreaker'] }),
  guard('g-anchor-2', 'soldier', [13, 7], { tags: ['anchorBreaker'] }),
  guard('g-tower-1', 'soldier', [28, 4], { guardZone: 'princessTower' }),
  guard('g-tower-2', 'soldier', [25, 6], { guardZone: 'princessTower' }),
  guard('g-bell-1', 'soldier', [3, 18], { guardZone: 'bellTower' }),
];

const waves: WaveDef[] = [
  {
    id: 'cityWatch',
    name: 'City Watch',
    bell: 'firstBell',
    spawnTiles: [[0, 13], [0, 14], [1, 13], [1, 14], [2, 13], [2, 14], [3, 13], [3, 14]],
    units: [
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `watch-${n}`, name: 'City Watch', faction: 'loyalist' as const, rank: 'soldier' as const })),
      { id: 'watch-7', name: 'City Watch', faction: 'loyalist', rank: 'kindled' },
    ],
  },
  {
    id: 'dawnLantern',
    name: 'Dawn Lantern Knights',
    bell: 'secondBell',
    spawnTiles: [[24, 20], [23, 20], [22, 21], [25, 21], [23, 21], [24, 21]],
    units: [
      ...[1, 2, 3, 4].map((n) => ({ id: `lantern-${n}`, name: 'Dawn Lantern Knight', faction: 'loyalist' as const, rank: 'kindled' as const })),
      ...[5, 6].map((n) => ({ id: `lantern-${n}`, name: 'Dawn Lantern Knight', faction: 'loyalist' as const, rank: 'radiant' as const })),
    ],
  },
  {
    // Third Bell: the Southern Legion comes in through the outer gate (open since the knights broke it at Second Bell).
    id: 'southernLegion',
    name: 'Southern Legion',
    bell: 'thirdBell',
    spawnTiles: [[22, 20], [25, 20], [21, 20], [26, 20], [23, 21], [24, 21], [22, 21], [25, 21]],
    units: [
      ...[1, 2, 3].map((n) => legionnaire(n, 'kindled')),
      ...[4, 5].map((n) => legionnaire(n, 'radiant')),
      ...[6, 7, 8].map((n) => legionnaire(n, 'soldier')),
    ],
  },
];

function legionnaire(n: number, rank: UnitPlacement['rank']): UnitPlacement {
  return { id: `legion-${n}`, name: 'Southern Legionnaire', faction: 'loyalist', rank };
}

const line = (speaker: string, text: string): DialogueLine => ({ speaker, text });

export const prologueScenario: ScenarioDef = {
  id: 'prologue',
  name: 'Night of Ashen Lanterns',
  playerFaction: 'rebel',
  seed: 20240613,
  map: MAP,
  legend: {
    '=': 'door',
    b: 'bridge',
    o: 'pillar',
    r: 'rubble',
    T: 'throne',
    t: 'table',
    c: 'crates',
    s: 'stairs',
    '*': 'brazier',
    B: 'bell',
  },
  zones: {
    throneHall: { x: 12, y: 1, w: 8, h: 5 },
    wellspringHall: { x: 12, y: 9, w: 8, h: 3 },
    feastHall: { x: 1, y: 1, w: 8, h: 7 },
    princessTower: { x: 23, y: 1, w: 8, h: 7 },
    bellTower: { x: 2, y: 18, w: 3, h: 2 },
    innerGate: { x: 12, y: 17, w: 8, h: 4 },
    servantsTunnel: { x: 0, y: 10, w: 10, h: 2 },
    antechamber: { x: 10, y: 7, w: 12, h: 1 },
    eastCourt: { x: 22, y: 9, w: 9, h: 4 },
    quay: { x: 0, y: 13, w: 31, h: 2 },
  },
  objects,
  exits: [
    { id: 'miraExit', zone: 'princessTower', tiles: [[31, 12]], units: ['mira'] },
    { id: 'elianExit', zone: 'servantsTunnel', tiles: [[0, 10], [0, 11]], units: ['elian'] },
  ],
  units,
  waves,
  dialogue: {
    confront: [line('varek', 'Father. I asked you once for the Ember Line. I will not ask twice.')],
    miraCaptured: [line('kaela', 'That is far enough, Highness. You are coming with me, and you are coming breathing.')],
    sealBroken: [
      line('elian', 'The ward gives. Hear me, brother: I will not take your life, and I will not let you take the rest of Calderon.'),
    ],
    firstBell: [line('Narrator', 'First Bell. The City Watch is at the palace gates, and they are not here to parade.')],
    secondBell: [line('Narrator', 'Second Bell. Dawn Lantern steel is through the outer gate, and the Radiants are with them.')],
    thirdBell: [line('Narrator', 'Third Bell. The Southern Legion marches in through the outer gate. Hold until dawn.')],
    'downed:varek': [line('varek', 'Not here. Not yet. Get me on my feet.')],
    'downed:kaela': [line('kaela', 'I am down. Reach me, quickly.')],
    'revived:varek': [line('varek', 'Again, then. Hold the line.')],
    'revived:kaela': [line('kaela', 'Still breathing. Let us finish this.')],
  },
};
