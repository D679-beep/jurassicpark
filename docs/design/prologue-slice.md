# Vertical Slice: Night of Ashen Lanterns (Prologue Battle)

Status: v0.1, the first build target. Story source: `docs/story.md`.

## Decisions
- **Genre:** turn-based grid tactics.
- **Stack:** TypeScript, Vite, Vitest, HTML5 Canvas 2D. No game engine, no runtime dependencies.
- **Target platform:** laptop/desktop browsers, roughly 1280×720 up to 1920×1080, played with mouse and keyboard. Phones and touch are out of scope.
- **Slice scope:** the prologue coup battle, played as the **Rebels (Kaela)** against an AI-controlled Loyalist side. The engine is side-agnostic: the scenario declares which faction the player controls, so the Loyalist side (Aren) can be added later without engine changes.

## Architecture

```
src/
  engine/    Pure game rules. No DOM, no randomness outside the seeded RNG. Fully unit-tested.
  content/   Scenario data: map, units, reinforcement waves, objectives, dialogue lines.
  ai/        Computer opponent. Reads GameState, returns Actions. No DOM.
  ui/        Canvas renderer, input handling, HUD, event log. The only layer that touches the DOM.
  main.ts    Wires content -> engine -> ui.
tests/       Vitest specs, mirroring src/.
```

Rules for every layer:
- `GameState` is plain, JSON-serializable data. No classes with hidden state, no `Map`/`Set` in state.
- All state changes go through one entry point: `applyAction(state, action) => { state, events }`. It returns a new state and does not mutate its input.
- `events` is an ordered list of `GameEvent`s (moved, damaged, died, domainActivated, bellRang, reinforcementsArrived, objectiveCompleted, objectiveFailed, captured, gameOver, dialogue). The UI animates and logs from events; it never diffs states.
- Randomness: a seeded RNG whose seed lives in state. Same seed + same actions = same game.
- `getLegalActions(state, unitId)` is the single source of truth for what a unit may do. The UI and AI both use it.

## Core Rules

### Map
- Rectangular grid. Each tile has a terrain type:

| Terrain | Move cost | Defense bonus | Notes |
|---|---|---|---|
| floor | 1 | 0 | streets, halls |
| wall | impassable | - | blocks movement and line of sight |
| door | 1 | 0 | can be **barred** (impassable until broken; has HP) |
| rubble | 2 | +1 | |
| water | impassable | - | canals |
| bridge | 1 | 0 | can be **burned** -> becomes water |
| pillar | 2 | +2 | cover inside halls |
| throne / dais | 1 | +1 | decorative/cover |

- Named **zones** are rectangles or tile sets with an id (e.g. `throneHall`, `wellspringHall`, `feastHall`, `princessTower`, `bellTower`, `innerGate`, `servantsTunnel`). Objectives and AI refer to zones.
- Movement: 4-directional. Units may pass through allies, not enemies. Pathfinding is Dijkstra/A* over move cost.
- Line of sight for ranged attacks: Bresenham line, blocked by walls and closed/barred doors.

### Units
Fields: `id, name, faction ('rebel' | 'loyalist'), rank, hp, maxHp, atk, def, move, range (min,max), pos, hasMoved, hasActed, statuses[], tags[]`.

Ranks and baseline stats (content may override per unit):

| Rank | HP | ATK | DEF | Move | Range | Notes |
|---|---|---|---|---|---|---|
| Soldier | 10 | 4 | 1 | 4 | 1 | ordinary troops |
| Kindled | 16 | 6 | 2 | 5 | 1 | mana-sheathed blade |
| Radiant | 18 | 6 | 2 | 4 | 1-3 | ranged strike; one affinity skill |
| Ascendant | 40 | 10 | 4 | 5 | 1-2 | Domain, special damage rules |

- One move and one action per unit per turn, in either order. Actions: attack, skill, interact, wait.
- **Damage:** `max(1, atk - def - terrainDefense) + rng(0..2)`. Deterministic via the seeded RNG.
- **Only an Ascendant can stop an Ascendant:** damage dealt by a non-Ascendant to an Ascendant is capped at **1** per hit. Ascendants deal **+50%** damage to non-Ascendants.
- Units at 0 HP die and are removed, except where a unit's tag says otherwise (see Mira, Emperor).

### Domains (Ascendant ultimate)
- Each Ascendant has one Domain, usable **once per battle**. It counts as the unit's action.
- A Domain is a **radius-3 diamond** (Manhattan distance) centered on the Ascendant. It lasts **3 rounds** and moves with its owner.
- After its Domain ends, the Ascendant is **Drained** for the rest of the battle: -2 ATK, -1 move.

| Domain | Owner | Effect inside the zone |
|---|---|---|
| Tempest | Varek | On activation: 8 damage to every enemy inside. Each later round start: 3 damage to every enemy inside. |
| Pyre | Grimm | Each round start: 4 damage to **every other unit** inside, both sides. Bridges inside burn. |
| Bulwark | Orsa | Allies inside take half damage. Enemies cannot enter the zone's tiles by movement. |
| Sanctuary | Elian | Each round start: allies inside heal 5. Enemies inside deal -3 damage. |
| Silence | Sereth | Hidden. Not in the slice except as story. Reserved id. |

### Time: the Bells
- A **round** = player phase then AI phase.
- The battle starts at **Midnight**, round 1. Default bell schedule:

| Bell | Round | Loyalist reinforcements |
|---|---|---|
| First Bell | 5 | City Watch arrives at the palace gates (soldiers) |
| Second Bell | 9 | Dawn Lantern knights break through the outer gate (Kindled and Radiant) |
| Dawn | 13 | Southern Legion. **Rebel defeat** if the Emperor is still alive. |

- Reinforcements spawn on the scenario's listed spawn tiles. If a spawn tile is occupied, use the nearest free tile.
- **Bell modifiers** (optional objectives):
  - *Seize the bell tower* (rebel): end a player phase with a rebel unit in `bellTower` and no loyalist in it. **All remaining bells are delayed by 2 rounds.** One time only.
  - *Burn the canal bridges* (rebel): interact with a bridge tile to burn it. If every bridge tagged `barracksRoute` is burned, the **Second Bell** wave arrives 2 rounds later than scheduled.
  - *Keep Orsa pinned* (rebel): see the Feast Hall duel below.

### Set-piece rules
- **The Wellspring seal.** Elian starts in `wellspringHall` with status `sealed`: he cannot move or act and cannot be damaged by non-Ascendants. Three **ward anchor** objects (destructible, 12 HP, on the map) hold the seal. The seal breaks when all anchors are destroyed **or** at Second Bell, whichever comes first. Loyalist AI tries to destroy anchors. While sealed, Elian can be attacked by Ascendants at full damage. When the seal breaks, Elian acts normally and the AI tries to get him out through `servantsTunnel` (escape = he leaves the map).
- **The Feast Hall duel.** Orsa and Grimm start in `feastHall` with status `dueling`. While both are alive and both inside `feastHall`, neither may leave it or affect units outside it, and their attacks may only target each other. Each round start, both take 3 damage. If the player moves Grimm out, the duel ends and Orsa is free; the AI then sends her toward the most threatened objective.
- **The Emperor.** Halden starts in `throneHall`, has tag `noResist`: he never moves or attacks. He cannot be damaged by attacks. Only **Varek**, adjacent to him, can perform the interact action **Confront**, which kills him and fires a dialogue event. His last words are withheld (`"..."`).
- **Princess Mira.** Starts in `princessTower`. Radiant. The AI moves her toward the tower's escape exit. If she leaves the map, she **escapes**. **Kaela's** attacks against Mira cannot reduce her below 1 HP. If Mira is at or below 50% HP and Kaela is adjacent, Kaela can interact: **Capture**. Mira is then removed from play as captured. If any unit's attack reduces Mira to 0 HP, she **dies**.

### Objectives and Outcome (Rebel player)
| Objective | Type | Completed when | Failed when |
|---|---|---|---|
| Kill Emperor Halden | required | Varek performs Confront | Dawn arrives first |
| Kill Crown Prince Elian | optional, tracked | Elian reaches 0 HP | Elian escapes |
| Imprison Princess Mira | optional, tracked | Mira captured | Mira escapes or dies |
| Seize the bell tower | bonus | as above | - |
| Burn the canal bridges | bonus | as above | - |

- **Defeat** if Varek dies, Kaela dies, or Dawn arrives with the Emperor alive.
- **Victory** when the Emperor is dead **and** each of the Elian and Mira objectives is resolved (completed or failed), **or** when Dawn arrives with the Emperor dead.
- The result screen reports the outcome flags `{ emperorKilled, elianOutcome: 'killed'|'escaped'|'alive', miraOutcome: 'captured'|'escaped'|'dead'|'free' }`. These feed Act I later.

## AI (Loyalist, slice)
Goal-driven per unit, evaluated every AI phase:
- **Guards** defend their assigned zone: attack the best reachable target inside or near it, else hold position.
- **Reinforcements** move toward the nearest rebel unit threatening an objective (Throne Hall first, then Princess Tower, then Wellspring Hall).
- **Anchor breakers:** units tagged `anchorBreaker` path to ward anchors and attack them.
- **Mira** flees toward the escape exit, avoiding tiles that rebels threaten.
- **Elian** once unsealed flees to `servantsTunnel`; he attacks only if cornered, and never deals a killing blow (his Vow): his attacks cannot reduce a unit below 1 HP.
- Target scoring: prefer kills, then high-value targets (Ascendants are mostly immune, so the AI should avoid wasting attacks on them unless the attacker is an Ascendant), then lowest HP.
- The AI must only issue actions returned by `getLegalActions`.

## UI (slice)
- Canvas rendering of the grid with distinct colors/glyphs per terrain. Units drawn as colored tokens with a letter glyph and an HP bar; Ascendants get a ring. No external art assets required for the slice.
- Click a player unit to select it: show reachable tiles, then attack targets. Click to move/attack. Buttons for Domain, Interact, Wait, End Turn.
- Layout: the whole map is visible without page scroll at 1280×720 and up. The board sits on the left at the largest integer tile size that fits; the HUD column is on the right and its text scales with the viewport. Hovering a reachable tile shows the path preview, and hovering an enemy shows the damage forecast.
- Keyboard shortcuts: Tab / Shift+Tab select the next / previous ready unit, Esc clears the selection, E ends the turn, W waits with the selected unit.
- HUD: current round, next bell and how many rounds until it, objective list with status, selected unit panel, event log.
- Active Domains drawn as tinted overlays.
- Short animation for movement and damage numbers, driven by events.
- Intro text card before the battle and a result card after.

## Out of scope for the slice
Loyalist-side play, war map, campaign acts, save/load UI, audio, sprite art, Sereth's Silence, phone/touch layouts.
