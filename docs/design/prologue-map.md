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
| `grimm` | Grimm | Ascendant | `(4,4)` | feastHall | Status `dueling`. Domain: Pyre. |
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
| `elian` | Crown Prince Elian | Ascendant | `(15,10)` | wellspringHall | status `sealed`. On the rite dais. Domain: Sanctuary. |
| `orsa` | Lady Orsa | Ascendant | `(5,4)` | feastHall | status `dueling`. Domain: Bulwark. Adjacent to Grimm. |
| `mira` | Princess Mira | Radiant | `(30,1)` | princessTower | tag `escapee`. Flees to `miraExit`. |
| `g-throne-1` | Palace Guard | Kindled | `(14,3)` | throneHall | assigned zone `throneHall` |
| `g-throne-2` | Palace Guard | Kindled | `(17,3)` | throneHall | assigned zone `throneHall` |
| `g-throne-3` | Palace Guard | Soldier | `(15,4)` | throneHall | assigned zone `throneHall` |
| `g-ante-1` | Palace Guard | Soldier | `(16,7)` | antechamber | assigned zone `throneHall` (screens the main door) |
| `g-anchor-1` | Palace Guard | Kindled | `(12,7)` | antechamber | tag `anchorBreaker`. Just outside the Wellspring Hall's north wall. |
| `g-anchor-2` | Palace Guard | Soldier | `(13,7)` | antechamber | tag `anchorBreaker` |
| `g-tower-1` | Palace Guard | Kindled | `(28,4)` | princessTower | assigned zone `princessTower` |
| `g-tower-2` | Palace Guard | Soldier | `(25,6)` | princessTower | assigned zone `princessTower` |
| `g-bell-1` | Palace Guard | Soldier | `(3,18)` | bellTower | assigned zone `bellTower` |

Totals: 11 rebels (2 Ascendants, 1 Kindled hero, 8 Wolves), 13 loyalists at Midnight (3 Ascendants, 1 Radiant, 1 Emperor, 9 guards, of whom 2 are anchor-breakers).

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

Three objects with tag `wardAnchor`, 12 HP each, on floor tiles inside `wellspringHall`. They are deliberately spread: the pairwise Manhattan distances are 7, 6 and 5, so one attacker cannot hit two without walking.

| Id | Tile | HP | Distance to the other two |
|---|---|---|---|
| `anchorA` | `(12,9)` | 12 | 7 to `anchorB`, 6 to `anchorC` |
| `anchorB` | `(19,9)` | 12 | 7 to `anchorA`, 5 to `anchorC` |
| `anchorC` | `(16,11)` | 12 | 6 to `anchorA`, 5 to `anchorB` |

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

**Varek to the Emperor.** `(15,17)` to `(15,3)`, adjacent to Halden, is cost 24, which is 5 rounds for move 5. The route is center bridge, west along the quay to the corridor mouth `(10,13)`, north up the west corridor to the antechamber, east along it, then through `(15,6)` and into the hall. He passes the tunnel junction `(10,10)` at cost 12 (round 3) and the antechamber at cost 17 to 20 (round 4), exactly where the anchor-breakers, `g-ante-1` and the Throne Hall's three guards stand. Clearing them costs about 1 to 3 rounds (Varek one-shots Soldiers and two-shots Kindled thanks to his +50%, and Tempest hits the whole room), so a well-played run Confronts on **round 6 to 8**. That leaves 4 to 6 rounds for everything else, with First Bell at round 5 and Second Bell at round 9 landing in the middle of the throne fight. The shortcut through the Wellspring Hall (break `doorWellSouth` and `doorWellNorth`) is cost 16, 4 rounds, but costs 28 HP of door-breaking and leads straight into the anchors and Elian's Domain range.

**Orsa is the clock on Grimm.** If Grimm leaves the Feast Hall, Orsa is free and walks `(5,4)` to `(15,4)` at cost 16, which is 4 rounds. She would stand in the Throne Hall by round 4, before Varek's unopposed round 5. Bulwark is a radius-3 diamond and the four tiles from which Varek can Confront Halden are all within 3 of `(15,4)`, so a Bulwark there makes the Confront impossible for 3 rounds. Pinning her is not optional in practice; it protects the required objective.

**Mira and Kaela.** Mira (move 4) leaves `(30,1)`, walks down through the tower's zigzag (cost 17 to the door `(26,8)`, 5 rounds), crosses the east court, and exits at `(31,12)` at total cost 26, which is **7 rounds**; she can leave on the AI phase of round 7. She also stalls if Kaela's threat range covers her path. Kaela (move 5) from `(17,18)` reaches `(26,13)` on the north bank at cost 14 (3 rounds) and the tower door `(26,9)` at cost 18 (4 rounds), so by the end of round 4 she is outside the door while Mira is still one step inside it. Slack is about 3 rounds. It disappears if Kaela is diverted: if Mira clears the door in round 5, she still needs 9 more tiles. To soften Mira to 50% HP (9 of 18) takes 2 to 3 Kaela hits (4 to 6 damage each against DEF 2), then Capture. **Keep the Wolves off Mira**: a Wolf hit can kill her, which fails the objective, and only Kaela's hits are floored at 1 HP. The two tower guards (Kindled `(28,4)`, Soldier `(25,6)`) make the climb a real fight.

**Elian.** The seal breaks at Second Bell (round 9) at the latest. The two anchor-breakers start in the antechamber and need cost 7 to reach `(12,10)` inside the hall (2 rounds), so left alone they open `anchorA` around round 3, `anchorC` around round 4 and `anchorB` around round 5, freeing Elian before round 6. Rebels stopping them in the west corridor is the same fight as Varek's route. After the seal breaks Elian needs cost 15 to `(0,10)`, 3 rounds at move 5. Seal at round 9 means he can exit at round 11. The tunnel is 2 lanes wide, so blocking him takes two units standing in `(10,10)` and `(10,11)` or in the two door tiles. Killing him at all needs Varek, since only Ascendants hurt a sealed Elian, so it is a deliberate stretch goal; the canonical outcome (Elian escapes) is the default.

**Why the optional objectives are worth the detour**

- **Bell tower** (`bellTower`, one Soldier inside). `wolf-k1` `(14,17)` reaches `(4,19)` at cost 12 (3 rounds), `wolf-s2` `(14,19)` at cost 10 (3 rounds). A Kindled plus a Soldier clear and hold it by the end of round 4, in time to stop First Bell. Cost: two Wolves out of eight, who were not needed for the throne. Payoff: every bell comes 2 rounds later, so the window is effectively 14 rounds. Of the three optionals it has the best return.
- **Burn the canal bridges** (`bridgeCenter`, `bridgeEast`). Each interact is one action by a unit next to the bridge, which costs about a turn of one Wolf. It delays Second Bell by 2 rounds and lengthens the knights' walk from 26 to 42 cost, so they are about 3 rounds further away. It cuts the rebels' own retreat, so burn each bridge only after Varek (center) and Kaela (east) have crossed. The burner Wolves stranded on the south bank can then walk to the bell tower.
- **Keep Orsa pinned.** It costs nothing beyond leaving Grimm in the duel, and see above: it is what keeps the throne reachable.

## 7. Dialogue

1. **Intro card.** "Midnight. The lanterns of Calderon go dark one by one. The Ashen Wolves hold the inner gates, and the Wellspring Hall is sealed with the Crown Prince inside. The Emperor must fall before dawn."
2. **Confront (Varek, then Halden).** Varek: "Father. I asked you once for the Ember Line. I will not ask twice." Halden: "..."
3. **Mira captured (Kaela).** "That is far enough, Highness. You are coming with me, and you are coming breathing."
4. **Elian's seal breaks (Elian).** "The ward gives. Hear me, brother: I will not take your life, and I will not let you take the rest of Calderon."
5. **First Bell.** "First Bell. The City Watch is at the palace gates, and they are not here to parade."
6. **Second Bell.** "Second Bell. Dawn Lantern steel is through the outer gate, and the Radiants are with them."
