# Prologue Level Design: Night of Ashen Lanterns

Status: v0.1, companion to `docs/design/prologue-slice.md` (the binding rules) and `docs/story.md` (prologue section). Played as the **Rebels**. All coordinates are `(x, y)` with x = column from 0 on the left and y = row from 0 at the top. Rectangles are inclusive on both ends. The map is **32 columns x 22 rows**.

## 1. Map

Legend: `#` wall, `.` floor, `+` door, `=` barred door, `~` water (canal), `b` bridge, `o` pillar, `r` rubble, `T` throne/dais. Nothing else is drawn in the grid. Units, objects and zones are listed by coordinate in the sections below.

```grid
################################
#........#.#..TTTT..#.#........#
#........#.#.o.TT.o.#.#........#
#..o..o..#.=........=.#######..#
#........+.#.o....o.#.#........#
#..o..o..#.#..o..o..#.#.########
#........#.####+=####.#........#
#........#............#........#
##########.####=#####.####+#####
##########.#.o......#..........#
.........+.+...TT..o#...o...o..#
.........+.+......o.#........r.#
##########.#####=####......r....
..............r................#
.......r..........r.....r......#
#~~~~b~~~~~~~~~b~~~~~~~~~~b~~~~#
#.......r...o......o...........#
######....r..........r.........#
##...#...r.....................#
##...+................r........#
######......o......o...........#
######################....######
```

Column ruler (not part of the grid, for reading only):

```ruler
00000000001111111111222222222233
01234567890123456789012345678901
```

Reading the map (north is up):

- **South city (y 16..20):** the rebels' side. The **inner gate** plaza sits in the middle (x 12..19), flanked by four pillar piers. The **bell tower** is the small walled room in the south-west corner. The outer gate (gap in the south wall at x 22..25) is where the Dawn Lantern knights and the Southern Legion break in.
- **Canal (y 15):** one tile wide, wall to wall, crossed by three one-tile bridges at x = 5 (west), x = 15 (center), x = 26 (east). Radiants can still shoot across it.
- **Quay (y 13..14):** the palace's front terrace on the north bank. The **City Watch gate** is the two edge tiles `(0,13)` and `(0,14)`.
- **West block:** the **Feast Hall** (x 1..8, y 1..7, one door at `(9,4)`) and, below it, the 2-wide **servants' tunnel** (y 10..11) running to the west edge.
- **Spine:** corridor x = 10 on the west, corridor x = 21 on the east, joined by the **antechamber** (y = 7). Both corridors open onto the quay.
- **Center:** the **Throne Hall** (x 12..19, y 1..5) at the far north, then the antechamber, then the **Wellspring Hall** (x 12..19, y 9..11) directly south of it. The Wellspring Hall's only unbarred door is the servants' door pair on the west wall at `(11,10)` and `(11,11)`.
- **East block:** the **Princess's Tower** (x 23..30, y 1..7), a zigzag of two partition walls, whose only door is `(26,8)`. Below it is the open **east court** (x 22..30, y 9..12), with Mira's escape tile `(31,12)` on the east edge.

Design intent in one line: the straight line from the rebels to the throne is blocked by the Wellspring Hall, so Varek must go around by the west corridor and the antechamber, past the anchor-breakers and the throne guard.

## 2. Zones

All rectangles are inclusive. A tile belongs to a zone if it lies inside the rectangle.

| Zone id | Rectangle | Notes |
|---|---|---|
| `throneHall` | x 12..19, y 1..5 | Interior only. Dais `T` at `(14,1) (15,1) (16,1) (17,1) (15,2) (16,2)`. |
| `wellspringHall` | x 12..19, y 9..11 | Interior only. Rite dais `T` at `(15,10) (16,10)`. |
| `feastHall` | x 1..8, y 1..7 | Interior only. Door `(9,4)`. |
| `princessTower` | x 23..30, y 1..7 | Interior only. Door `(26,8)`. Escape exit tile `(31,12)` (see below). |
| `bellTower` | x 2..4, y 18..19 | Interior only. Door `(5,19)`. |
| `innerGate` | x 12..19, y 16..20 | Rebel start area. Pillar piers at `(12,16) (19,16) (12,20) (19,20)`. |
| `servantsTunnel` | x 0..9, y 10..11 | Two parallel lanes. Doors at `(9,10)` and `(9,11)`. **Exit tiles:** `(0,10)` and `(0,11)` on the west edge. A unit that ends a move on either leaves the map. |
| `antechamber` | x 10..21, y 7..7 | Helper zone: the corridor-to-corridor strip south of the Throne Hall. |
| `eastCourt` | x 22..30, y 9..12 | Helper zone: the open ground between the tower door and Mira's exit. |
| `quay` | x 0..30, y 13..14 | Helper zone: north-bank terrace. |

Escape and exit tiles (both on the map edge):

| Id | Tile | Who uses it |
|---|---|---|
| `miraExit` | `(31,12)` | Mira. Leaving the map by this tile is her escape. It is on the north bank, so burning bridges does not block it. |
| `elianExit` | `(0,10)`, `(0,11)` | Elian, via `servantsTunnel`. |

Spawn areas (tile lists are in section 5):

| Id | Tiles | Used by |
|---|---|---|
| `rebelSpawn` | the `innerGate` rectangle | Start positions of the rebel force |
| `watchSpawn` | `(0,13) (0,14) (1,13) (1,14) (2,13) (2,14) (3,13) (3,14)` | First Bell (City Watch) |
| `barracksSpawn` | `(22,21) (23,21) (24,21) (25,21) (23,20) (24,20)` | Second Bell (Dawn Lantern) |
| `legionSpawn` | `(21,20) (22,20) (25,20) (26,20)` | Dawn (Southern Legion) |

## 3. Units at Midnight (round 1)

Rank stats are the baseline from the slice spec. `Placed in` names the zone whose rectangle contains the tile. Tiles are all passable terrain, and no two units share a tile.

### Rebels (player)

| Id | Name | Rank | Pos | Placed in | Notes |
|---|---|---|---|---|---|
| `varek` | Varek | Ascendant | `(15,17)` | innerGate | Domain: Tempest. Only unit that can Confront. Defeat if he dies. |
| `kaela` | Kaela | Kindled | `(17,18)` | innerGate | Can Capture Mira. Defeat if she dies. |
| `grimm` | Grimm | Ascendant | `(4,4)` | feastHall | Status `dueling`. Domain: Pyre. **DEF 5** (balance log). |
| `wolf-s1` | Ashen Wolf | Soldier | `(13,17)` | innerGate | |
| `wolf-s2` | Ashen Wolf | Soldier | `(14,19)` | innerGate | |
| `wolf-s3` | Ashen Wolf | Soldier | `(18,19)` | innerGate | |
| `wolf-k1` | Ashen Wolf | Kindled | `(14,17)` | innerGate | |
| `wolf-k2` | Ashen Wolf | Kindled | `(16,17)` | innerGate | |
| `wolf-k3` | Ashen Wolf | Kindled | `(18,18)` | innerGate | |
| `wolf-r1` | Ashen Wolf | Radiant | `(15,19)` | innerGate | |
| `wolf-r2` | Ashen Wolf | Radiant | `(16,19)` | innerGate | |

### Loyalists (AI)

| Id | Name | Rank | Pos | Placed in | Tags / status / assignment |
|---|---|---|---|---|---|
| `halden` | Emperor Halden | (special) | `(15,2)` | throneHall | tag `noResist`. On the dais. Confront from `(15,3)`, `(14,2)`, `(16,2)` or `(15,1)`. |
| `elian` | Crown Prince Elian | Ascendant | `(15,10)` | wellspringHall | status `sealed`. On the rite dais. Domain: Sanctuary. **Starts at 34 of 40 HP**: the seal draws on the one it holds (balance log). |
| `orsa` | Lady Orsa | Ascendant | `(5,4)` | feastHall | status `dueling`. Domain: Bulwark. Adjacent to Grimm. **44 HP, ATK 8, DEF 5**: the shield, not the sword (balance log). |
| `mira` | Princess Mira | Radiant | `(30,1)` | princessTower | tag `escapee`. Flees to `miraExit`. |
| `g-throne-1` | Palace Guard | Kindled | `(14,3)` | throneHall | assigned zone `throneHall` |
| `g-throne-2` | Palace Guard | Kindled | `(17,3)` | throneHall | assigned zone `throneHall` |
| `g-throne-3` | Palace Guard | Kindled | `(15,4)` | throneHall | assigned zone `throneHall` |
| `g-throne-4` | Palace Guard | Radiant | `(18,2)` | throneHall | assigned zone `throneHall`. On the east pillar, range 1-3 over the hall. |
| `g-ante-1` | Palace Guard | Kindled | `(16,7)` | antechamber | assigned zone `throneHall` (screens the main door) |
| `g-anchor-1` | Palace Guard | Kindled | `(12,7)` | antechamber | tag `anchorBreaker`. Just outside the Wellspring Hall's north wall. |
| `g-anchor-2` | Palace Guard | Soldier | `(13,7)` | antechamber | tag `anchorBreaker` |
| `g-tower-1` | Palace Guard | Kindled | `(28,4)` | princessTower | assigned zone `princessTower` |
| `g-tower-2` | Palace Guard | Soldier | `(25,6)` | princessTower | assigned zone `princessTower` |
| `g-bell-1` | Palace Guard | Soldier | `(3,18)` | bellTower | assigned zone `bellTower` |

Totals: 11 rebels (2 Ascendants, 1 Kindled hero, 8 Wolves), 14 loyalists at Midnight (3 Ascendants, Mira, 1 Emperor, 10 guards, of whom 2 are anchor-breakers and 5 hold the Throne Hall).

Per-unit stat overrides (everything else is the rank baseline from the slice spec): Grimm DEF 5; Orsa 44 HP, ATK 8, DEF 5; Elian 34/40 HP at Midnight. See section 8 for why.

## 4. Objects

The engine spec leaves open how objects take damage. This design assumes an object has DEF 0 and takes an ordinary attack's damage (about 4-6 from a Soldier or Kindled, so 12 HP is two to three hits). If the engine rules differently, tune the HP numbers, not the layout.

### Barred doors

A barred door sits on its own `=` tile. It is impassable and blocks line of sight until its HP reaches 0, then it becomes an open door.

| Id | Tile | HP | What it guards |
|---|---|---|---|
| `doorThroneMain` | `(16,6)` | 18 | East leaf of the Throne Hall's main double door. Its twin at `(15,6)` is an ordinary door. |
| `doorThroneWest` | `(11,3)` | 12 | Side door from the west corridor into the Throne Hall. |
| `doorThroneEast` | `(20,3)` | 12 | Side door from the east corridor into the Throne Hall. |
| `doorWellNorth` | `(15,8)` | 14 | Wellspring Hall, from the antechamber. |
| `doorWellSouth` | `(16,12)` | 14 | Wellspring Hall, from the quay. |

Ordinary (unbarred) doors, for reference: `(9,4)` Feast Hall, `(15,6)` Throne Hall, `(11,10)` and `(11,11)` Wellspring Hall west, `(9,10)` and `(9,11)` tunnel mouth, `(26,8)` Princess's Tower, `(5,19)` bell tower.

### Ward anchors

Three objects with tag `wardAnchor`, 12 HP each, on floor tiles inside `wellspringHall`. They are deliberately spread: the pairwise Manhattan distances are 7, 6 and 5, so one attacker cannot hit two without walking. No anchor stands on the tile just inside a Wellspring door (`(12,10)`, `(12,11)`, `(15,9)`, `(16,11)`), so breaking a barred door always opens a route into the hall.

| Id | Tile | HP | Distance to the other two |
|---|---|---|---|
| `anchorA` | `(12,9)` | 12 | 7 to `anchorB`, 5 to `anchorC` |
| `anchorB` | `(19,9)` | 12 | 7 to `anchorA`, 6 to `anchorC` |
| `anchorC` | `(15,11)` | 12 | 5 to `anchorA`, 6 to `anchorB` |

`anchorC` was first drawn at `(16,11)`, the tile directly inside `doorWellSouth` `(16,12)`, which silently blocked the quay door route even after the door was broken. It moved one tile west to `(15,11)`, directly south of Elian, keeping the 7/6/5 spread (balance log).

### Bridges

One tile each. Interacting with the tile burns it (it becomes water).

| Id | Tile | Tags | Notes |
|---|---|---|---|
| `bridgeWest` | `(5,15)` | (none) | Far from the barracks, so it is not on their route. |
| `bridgeCenter` | `(15,15)` | `barracksRoute` | Directly north of the rebel start. |
| `bridgeEast` | `(26,15)` | `barracksRoute` | On Kaela's route to the tower. |

Burning `bridgeCenter` and `bridgeEast` together triggers the "Second Bell is 2 rounds later" modifier. The loyalist walk is also longer: from `(24,20)` to the antechamber `(15,7)` it is 26 move cost with both bridges and 42 without them (the west bridge detour).

The "Seize the bell tower" bonus has no tile object; it uses the `bellTower` zone rectangle.

## 5. Reinforcement waves

If a listed tile is occupied, the engine uses the nearest free tile, as the spec says. Units are assigned to tiles in the order listed (first unit to first tile).

| Bell | Round | Wave | Composition | Spawn tiles (in order) |
|---|---|---|---|---|
| First Bell | 5 | City Watch | `watch-1`..`watch-6` Soldier, `watch-7` Kindled | `watch-1`..`watch-6` on `(0,13) (0,14) (1,13) (1,14) (2,13) (2,14)`, `watch-7` (Kindled) on `(3,13)`, `(3,14)` spare |
| Second Bell | 9 | Dawn Lantern | `lantern-1`..`lantern-4` Kindled, `lantern-5`..`lantern-6` Radiant | `lantern-1`..`lantern-4` on `(24,20) (23,20) (22,21) (25,21)`, `lantern-5` and `lantern-6` (Radiant) on `(23,21) (24,21)` |
| Dawn | 13 | Southern Legion (token) | `legion-1`..`legion-4` Soldier | `(21,20) (22,20) (25,20) (26,20)` |

Notes:

- The City Watch enters at the west gate, behind the rebels' advance and next to the servants' tunnel and the west corridor. From `(3,13)` to the tunnel junction `(10,10)` is cost 10, about 3 rounds, so Watch units can be hitting a rebel blocker at the tunnel by round 7 or 8, and from `(1,13)` to the antechamber `(15,7)` is cost 20, so they join the Throne Hall defence around round 9.
- The Dawn Lantern knights break in far to the south-east and need to cross the canal. Without burned bridges they reach the antechamber `(15,7)` in cost 26 (6 rounds for a Kindled, move 5), so about round 14 if they spawn at 9.
- If the bell tower is seized, the three bells move to rounds 7, 11 and 15.

## 6. Pacing notes

Move values from the spec: Soldier 4, Kindled 5, Radiant 4, Ascendant 5. Costs below are real Dijkstra costs on this grid with floor, door, bridge and dais at 1, and rubble and pillar at 2, ignoring units. Rounds are `ceil(cost / move)`. The window is rounds 1 to 12 (Dawn arrives at 13).

**Varek to the Emperor.** `(15,17)` to `(15,3)`, adjacent to Halden, is cost 24, which is 5 rounds for move 5. The cheapest route is center bridge, west along the quay to the corridor mouth `(10,13)`, north up the west corridor to the antechamber, east along it, then through `(15,6)` and into the hall. He passes the tunnel junction `(10,10)` at cost 12 (round 3) and the antechamber at cost 20 (round 4), exactly where the anchor-breakers stand. The east corridor (x = 21) is 2 longer but empty, and it is the line the simulated rushes take. Either way he reaches the Throne Hall door on round 4 and the hall on round 5. Its garrison is five guards (three Kindled and a Radiant inside, a Kindled on the antechamber) and they stand on all four Confront tiles from round 2. Varek is nearly untouchable for them (non-Ascendants deal 1), so the fight is about tempo, not survival: Tempest softens the whole room, then he needs one action to kill a blocker and one more to Confront. If escorts free a tile first, he steps in and Confronts on the same turn. Simulated competent rushes Confront on **round 7** (Varek alone: round 8), with First Bell at round 5 behind him and Second Bell at round 9 ahead. The shortcut through the Wellspring Hall (break `doorWellSouth` and `doorWellNorth`) is cost 16, 4 rounds, but costs 28 HP of door-breaking and leads straight into the anchors, the breakers and the sealed Elian; it is the Elian-first line below.

**Orsa is the clock on Grimm.** If Grimm leaves the Feast Hall, Orsa is free and walks `(5,4)` to `(15,4)` at cost 16, which is 4 rounds. Bulwark is a radius-3 diamond and the four tiles from which Varek can Confront Halden are all within 3 of `(15,4)`, so a Bulwark there makes the Confront impossible for 3 rounds, and a free Orsa (ATK 8, +50% against non-Ascendants) kills Kaela in two hits. So the duel has to hold, and it now can. Both duelists take 3 a round; Orsa (DEF 5) hits Grimm (DEF 5) for 3 to 5, 1 to 3 when he stands on a pillar (`(3,3)`, `(6,3)`, `(3,5)`, `(6,5)`, +2 DEF); Grimm hits her for 5 to 7, 3 to 5 on a pillar. The options:

- *Leave him to auto-duel* (Grimm never acts): he lasts to about **round 6 to 7**, so Orsa walks free around round 7 and reaches the throne around round 10. A quick rush is already done by then; a slow plan is not (sims: the Elian-first sweep drops from 60% to 10% wins).
- *Fight back from cover*: Grimm on a pillar trading blows outlasts her; Orsa falls around **round 7** with Grimm on about 10 of 40 HP, and Grimm is then free (Pyre unspent) to help.
- *Help him*: Wolves may walk into the Feast Hall and hit Orsa (1 damage each; she may only strike Grimm while the duel holds), which shortens it a little. Pyre (4 a round to her, twice) is a finisher; using it early Drains Grimm (-2 ATK) for the rest of the duel.
- *Pull him out*: ends the duel at once and frees Orsa with most of her HP. Only worth it once the Confront is done.

**Mira and Kaela.** Mira (move 4) leaves `(30,1)`, walks down through the tower's zigzag (cost 17 to the door `(26,8)`, 5 rounds), crosses the east court, and exits at `(31,12)` at total cost 26, which is **7 rounds**; she can leave on the AI phase of round 7. She also stalls if Kaela's threat range covers her path. Kaela (move 5) from `(17,18)` reaches `(26,13)` on the north bank at cost 14 (3 rounds) and the tower door `(26,9)` at cost 18 (4 rounds), so by the end of round 4 she is outside the door while Mira is still one step inside it. Slack is about 3 rounds. It disappears if Kaela is diverted: if Mira clears the door in round 5, she still needs 9 more tiles. To soften Mira to 50% HP (9 of 18) takes 2 to 3 Kaela hits (4 to 6 damage each against DEF 2), then Capture. **Keep the Wolves off Mira**: a Wolf hit can kill her, which fails the objective, and only Kaela's hits are floored at 1 HP (a Wolf can safely land one hit while she is above half and no roll can kill her). The two tower guards (Kindled `(28,4)`, Soldier `(25,6)`) make the climb a real fight, and Kaela dying is a defeat, so she cannot simply dive in. A Wolf standing on `(26,9)` plugs the tower's only door and keeps Mira inside, but a plugged Mira also keeps the battle going past the Confront (it only ends when her fate is sealed or at Dawn), and the Dawn Lantern knights then come for Kaela. Sims: Kaela plus two Wolves captures Mira in about half of runs; otherwise she gets out around round 9.

**Elian.** The seal breaks at Second Bell (round 9, or 11 with the bell tower) at the latest. The two anchor-breakers start in the antechamber and need cost 7 to reach `(12,10)` inside the hall (2 rounds), so left alone they open `anchorA` around round 3, `anchorC` around round 4 and `anchorB` around round 5, freeing Elian around round 5 or 6; he is out of the tunnel by **round 7**. After the seal breaks Elian needs cost 15 to `(0,10)`, 3 rounds at move 5. The tunnel is 2 lanes wide, so blocking him takes two units standing in `(10,10)` and `(10,11)` or in the two door tiles. Killing him needs an Ascendant: while sealed only Varek or Grimm can hurt him, and once free he heals 5 a round in his Sanctuary while every rebel inside it deals 3 less. He starts the battle at 34 of 40 HP. The working line is **Elian first**: Varek and two Wolves break `doorWellSouth` from the quay on rounds 1 and 2 (it now opens straight into the hall), Varek walks in on round 2 or 3, Tempests the room (Elian and the breakers), and hits the sealed prince until he falls around round 6 or 7. Then he breaks out through `doorWellNorth` onto the antechamber and takes the throne Drained (-2 ATK, -1 move), Confronting around **round 11 or 12**, which is very close to Dawn. Throne-first and then Elian does not work: by the time Varek is back, the seal has broken and Elian is healing and running.

**Why the optional objectives are worth the detour**

- **Bell tower** (`bellTower`, one Soldier inside). `wolf-k1` `(14,17)` reaches `(4,19)` at cost 12 (3 rounds), `wolf-s2` `(14,19)` at cost 10 (3 rounds). A Kindled plus a Soldier clear and hold it by the end of round 4, in time to stop First Bell. Cost: two Wolves out of eight for the first four rounds, and they are out of the fight after that. Payoff: every bell comes 2 rounds later, so the window is effectively 14 rounds, and the Second Bell seal break slips to round 11. A quick rush does not need it; the Elian-first sweep does (sims: 60% wins without it, 85% with it; Dawn defeats drop from 6 to 2 in 20).
- **Burn the canal bridges** (`bridgeCenter`, `bridgeEast`). Each interact is one action by a unit next to the bridge, which costs about a turn of one Wolf. It delays the Second Bell *wave* by 2 rounds (the bell itself, and so the seal break, still ring on time) and lengthens the knights' walk from 26 to 42 cost, so they are about 3 rounds further away. It cuts the rebels' own retreat, so burn each bridge only after Varek (center) and Kaela (east) have crossed. The burner Wolves stranded on the south bank can then walk to the bell tower. It only pays in a long battle: the knights matter when the fight runs past round 10 or Mira is kept bottled up, and the two burners are two fewer blades in the Wellspring Hall (sims: on top of the bell tower it is roughly even, 85% vs 80%).
- **Keep Orsa pinned.** It costs nothing beyond leaving Grimm in the duel, but Grimm has to be played (see above): fighting back from a pillar wins the duel; doing nothing only holds her to about round 7.

## 7. Dialogue

1. **Intro card.** "Midnight. The lanterns of Calderon go dark one by one. The Ashen Wolves hold the inner gates, and the Wellspring Hall is sealed with the Crown Prince inside. The Emperor must fall before dawn."
2. **Confront (Varek, then Halden).** Varek: "Father. I asked you once for the Ember Line. I will not ask twice." Halden: "..."
3. **Mira captured (Kaela).** "That is far enough, Highness. You are coming with me, and you are coming breathing."
4. **Elian's seal breaks (Elian).** "The ward gives. Hear me, brother: I will not take your life, and I will not let you take the rest of Calderon."
5. **First Bell.** "First Bell. The City Watch is at the palace gates, and they are not here to parade."
6. **Second Bell.** "Second Bell. Dawn Lantern steel is through the outer gate, and the Radiants are with them."

## 8. Balance log

Tuning is done with the balance simulator in `scripts/sim/`: scripted rebel strategies (greedy one-turn policies that only ever play actions from `getLegalActions`) against the real Loyalist AI (`runAiPhase`), over seeded combat rolls. `npm run sim` prints the table below for the current content (20 seeds per strategy by default, `--seeds N`, `--strategy a,b`, `--runs`, `--trace`). `npm run sim -- --variant v0.1` replays the untuned v0.1 content; `--variant no-anchor`, `no-throne`, `ante-soldier`, `no-duel` and `no-elian` undo one change each (`scripts/sim/variants.ts`). `tests/content/balance.test.ts` pins the headline properties on a few seeds.

Only content changed: unit stats, the Throne Hall garrison and one anchor tile. The engine rules, the AI and the bell schedule (5 / 9 / 13) are untouched.

### Strategies

| Strategy | Plan |
|---|---|
| `endTurn` | End the turn every round. |
| `charge` | Every unit, Grimm included (which ends the duel), runs at the throne and hits whatever is in reach. |
| `chargePinned` | The same, but Grimm stays and fights the duel. |
| `varekRush` | Varek + 6 Wolves to the throne; Grimm fights from the pillars; Kaela + `wolf-k3` to Mira, `wolf-s3` plugs the tower door. |
| `rushGrimmIdle` | `varekRush`, Grimm left to auto-duel (never acts). |
| `grimmHelped` | `varekRush` with 2 Soldier Wolves sent into the Feast Hall to chip at Orsa. |
| `varekSolo` | Probe: Varek alone at the throne. |
| `bonusRush` | Bell tower (2 Wolves) and both barracks bridges (2 Wolves) first, then the rush with the rest. |
| `fullSweep` | All three objectives: Varek + 4 break in through `doorWellSouth` and kill the sealed Elian, then the throne; 2 Wolves hunt the anchor-breakers; Kaela + 2 to Mira. |
| `sweepBell` | `fullSweep`, the 2 breaker-hunters take the bell tower instead. |
| `sweepBonuses` | `sweepBell` plus both bridges (2 more Wolves peel off). |
| `sweepGrimmIdle` | `fullSweep` with Grimm left to auto-duel. |
| `sweepThroneFirst` | Throne first, then Varek goes for Elian; 3 Wolves kill the breakers and bar the west door. |

### Before (v0.1) and after, 20 seeds each

Confront = mean round of the Confront in the runs that got one. Elian K/E = killed/escaped; Mira C/E = captured/escaped (no run killed her). Both = runs that killed Elian and captured Mira. Grimm = runs in which Grimm died (mean round).

| Strategy | Win v0.1 | Win now | Confront v0.1 | Confront now | Elian K/E v0.1 | Elian K/E now | Mira C/E v0.1 | Mira C/E now | Both v0.1 | Both now | Grimm v0.1 | Grimm now |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `endTurn` | 0% | 0% | - | - | 0/20 | 0/20 | 0/20 | 0/20 | 0 | 0 | 20 (r4.9) | 20 (r6.7) |
| `charge` | 85% | **0%** | 6.0 | 6.0 | 0/17 | 0/0 | 0/18 | 0/0 | 0 | 0 | 6 (r5.8) | 0 |
| `chargePinned` | 100% | 50% | 6.0 | 6.0 | 0/20 | 0/10 | 0/20 | 0/15 | 0 | 0 | 13 (r5.8) | 0 |
| `varekRush` | 100% | 100% | 6.0 | 7.0 | 0/20 | 0/20 | 9/11 | 8/12 | 0 | 0 | 10 (r5.9) | 0 |
| `rushGrimmIdle` | 100% | 100% | 6.0 | 7.0 | 0/20 | 0/20 | 10/10 | 10/10 | 0 | 0 | 20 (r4.9) | 17 (r6.5) |
| `grimmHelped` | 100% | 95% | 6.0 | 7.0 | 0/20 | 0/19 | 9/11 | 8/11 | 0 | 0 | 9 (r5.9) | 0 |
| `varekSolo` | 95% | 95% | 6.0 | 8.0 | 0/20 | 0/20 | 7/12 | 7/12 | 0 | 0 | 8 (r5.9) | 0 |
| `bonusRush` | 95% | 100% | 6.0 | 7.0 | 0/20 | 0/20 | 11/8 | 11/9 | 0 | 0 | 5 (r5.8) | 0 |
| `fullSweep` | 20% | **60%** | 12.0 | 11.8 | 17/1 | 20/0 | 8/11 | 10/9 | 8 | 10 | 6 (r6.7) | 0 |
| `sweepBell` | 70% | **85%** | 13.6 | 12.8 | 17/3 | 20/0 | 9/11 | 11/8 | 8 | 11 | 6 (r6.8) | 0 |
| `sweepBonuses` | 25% | 80% | 13.8 | 12.2 | 12/8 | 20/0 | 9/11 | 6/14 | 7 | 6 | 6 (r6.8) | 0 |
| `sweepGrimmIdle` | 0% | 10% | - | 11.5 | 12/8 | 20/0 | 11/9 | 9/11 | 8 | 9 | 20 (r5.0) | 20 (r6.5) |
| `sweepThroneFirst` | 95% | 100% | 6.0 | 7.0 | 0/19 | 0/20 | 9/10 | 8/12 | 0 | 0 | 10 (r6.2) | 0 |

Every loss of `charge` and half of `chargePinned` is "Kaela has fallen"; the sweeps lose to Dawn or to Kaela falling late. Doing nothing about Elian and Mira lets both out on round 7 (`endTurn`: Elian 7.2, Mira 7.0).

### Changes

1. **`anchorC` `(16,11)` to `(15,11)`.** It stood on the tile directly inside `doorWellSouth`, so breaking that door led nowhere until the anchor was destroyed too (which frees Elian). Now the quay door is a real (28 HP of doors) shortcut and the way in for an Elian-first plan; the 7/6/5 anchor spread is kept. Undoing it (`no-anchor`): `fullSweep` 60% to 30% wins.
2. **Throne Hall garrison: `g-throne-3` Soldier to Kindled, new `g-throne-4` Radiant on the pillar `(18,2)`, `g-ante-1` Soldier to Kindled.** In v0.1 every plan Confronted on round 6, the all-in charge won 85% and Kaela could walk with the pack. The hall is now lethal for Kaela and slower for Varek: competent rushes Confront on round 7 (alone: round 8) and the charge loses. Undoing it (`no-throne`): `charge` 0% to 85%, `chargePinned` 50% to 100%, every Confront back to round 6. The antechamber Kindled alone (`ante-soldier`): `chargePinned` 60% to 50%, `fullSweep` 75% to 60%; kept for the pressure it puts on half-careful play.
3. **Duel: Orsa 44 HP, ATK 8, DEF 5; Grimm DEF 5.** In v0.1 a Grimm left alone died on round 4.9 on average, and fighting back was a coin flip that often ended in a double kill on round 6. Now auto-duel holds Orsa to round 6.5 to 7, Grimm fighting from the pillars wins on round 7 with about 10 HP left (he died in none of the 180 runs where he fights), and a freed Orsa is still the main threat: she lands the killing blow on Kaela in 4 of the first 5 `charge` seeds. Undoing it (`no-duel`): auto-duel death back to round 4.9, `varekRush` loses Grimm in 9 of 20 runs, `charge` wins 25%.
4. **Elian starts at 34 of 40 HP.** At 40, killing him needs so many Varek turns that the Elian-first sweep ran into Dawn (v0.1: 20%; `no-elian`: 10%). At 34 the sweep is a real gamble: 60% wins, and the bell tower makes it 85%.

### Remaining concerns

- The Throne Hall is a Varek-only problem: non-Ascendants deal him 1, so the garrison can only cost him tempo, and escorts save about one round (`varekSolo` round 8 against `varekRush` round 7). A quick rush has 5 to 6 rounds of slack before Dawn, so the bell tower and the bridges only matter in the long sweeps.
- Fighting the duel from the pillars always wins it. If it should need help, Orsa 48 HP is the next knob.
- Mira is the noisiest objective (captured in roughly half of runs). The scripted Kaela is cautious; a plugged tower door keeps Mira in but also keeps the battle going until Dawn, which is when the knights catch Kaela.
- The sims only cover scripted greedy players. Numbers are for comparing variants, not promises about human play.
