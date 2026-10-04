# Visual Style: Night of Ashen Lanterns

Status: v1.1 art direction for the prologue map, graphics and animation overhaul (v1.1: approved map additions, section 10, and the mock review fixes). Binding for implementers. Companion to `docs/design/prologue-map.md` (geometry, zones) and `docs/design/prologue-slice.md` (rules).

Reference mock: the `art-direction` branch, commit "WIP mock prototype" (`src/ui/proto.ts`, screenshots `mock-1920.png`, `mock-1280.png`, `mock-closeup.png`, `mock-1920-dawn.png`). The prototype proves the look; **this document, not the prototype code, is the contract** (see section 11 for its shortcuts).

## 0. Non-negotiables

1. **Gameplay is untouched by the visual work.** The approved map additions (section 10) are made by a separate geometry pass in `src/engine` / `src/content`; the visual workstreams never edit `src/engine`, `src/ai`, `src/content` or existing tests. The UI reads `GameState` and `GameEvent`s only and draws whatever geometry is there **by terrain type and zone, never by hard-coded coordinates** (all sites come from `gfx/sites.ts`, 3.2).
2. **Readability beats mood.** Highlights, units, HP, status, labels and the damage tooltip are always drawn *above* the darkness layer (section 2).
3. **Decor never invents geometry.** Anything on a passable tile is flat, low-contrast and casts no shadow. Anything that looks raised (cap, face, shadow) is either impassable (wall, closed barred door, closed portcullis, brazier, bell) or low cover (pillar, rubble, table, crates), drawn by the rules in sections 4 and 10. Low cover is visibly lower than a wall: no cap and no brick face, a front edge of at most `0.12T` and a cast shadow of at most `0.10T`. Blocking furniture (brazier, bell) is raised *and* lit so it never reads as floor.
4. **Everything is code-drawn** with canvas 2D. No image/SVG/audio files, no downloads, no web fonts. Fonts: titles `Georgia, 'Times New Roman', serif`; UI `system-ui, -apple-system, 'Segoe UI', sans-serif`.
5. **Performance:** 60 fps at 1920x1080 (46 px tiles, dpr 1) on an integrated GPU. Static layers cached offscreen; particles capped; no per-frame work while the tab is hidden.
6. **Motion settings:** honour `prefers-reduced-motion`; add an animation-speed setting `1x | 2x | instant` (section 6.4).

Units used below: `T` = tile edge in device pixels (`Renderer.tile`, already includes dpr). Fractions like `0.14T` are relative to the tile. "css px" means `Renderer.px(n)` (`n * dpr`, rounded). All coordinates in a tile are from its top-left. Map is 32x22.

## 1. Palette

Tokens replace the current `COLORS` in `src/ui/palette.ts`, grouped into exported `const` objects. Keep the existing `COLORS` keys that other files use (`reach`, `reachEdge`, `target`, `targetEdge`, `hover`, `path`, `hp*`, `gold`, `text`, `zoneLabel`) as aliases so `hud.ts` and `controller.ts` keep compiling.

### 1.1 Night and light

| Token | Value | Use |
|---|---|---|
| `NIGHT.void` | `#05060c` | canvas clear, beyond-map |
| `NIGHT.tint` | `rgb(6,8,16)` | darkness colour at Midnight (near neutral: no coloured haze, 3.4) |
| `NIGHT.moon` | `rgb(120,150,215)` | moon sheen (screen blend) |
| `LIGHT.lantern` | `rgb(255,176,90)` | wall lanterns |
| `LIGHT.brazier` | `rgb(255,150,70)` | braziers, fire |
| `LIGHT.overhead` | `rgb(255,200,140)` | chandeliers (light only) |
| `LIGHT.ward` | `rgb(120,170,255)` | ward anchors |
| `LIGHT.seal` | `rgb(150,220,255)` | sealed Elian |
| `LIGHT.flameCore` | `#ffe6a8` | lantern core pixel, flame tips |
| `LIGHT.flameBody` | `#f2b04e` | lantern glass |

### 1.2 Materials (floors are mid-dark, L 16-22 %; walls darker; never brighter than units)

| Token | A / B (checker or variation) | Detail |
|---|---|---|
| `MAT.marble` | `#36343f` / `#2f2d39` | vein `rgba(225,220,255,0.07)`, joint `rgba(0,0,0,0.30)` |
| `MAT.carpet` | `#5a1824`, dark `#3c0e17` | trim `#c9a24a` |
| `MAT.plank` | `#3d2b1e` / `#35261b` | seam `rgba(0,0,0,0.38)`, sheen `rgba(255,220,170,0.03)` |
| `MAT.slab` | `#2c2b34` / `#292830` | antechamber, corridors; joint `rgba(0,0,0,0.32)` |
| `MAT.runner` | `rgba(32,40,70,0.55)` | corridor runner, trim `rgba(201,162,74,0.22)` |
| `MAT.flag` | `#2d3443` / `#283040` | quay flagstones, moon edge `rgba(180,200,255,0.035)` |
| `MAT.cobble` | `#2b303b` / `#333946`, gap `#181b22` | courts, streets, inner-gate plaza |
| `MAT.well` | `#1c2b33` / `#22343d` | Wellspring floor tiles, rune `rgba(120,225,255,0.26)` (the pool itself: `POOL`, 1.3) |
| `MAT.tunnel` | `#232027` / `#1e1c22` | damp `rgba(40,70,80,0.22)` |
| `MAT.parquet` | `#30283a` / `#2a2333` | Princess's Tower, rug `rgba(60,44,100,0.30)` |
| `MAT.boards` | `#33281f` / `#2d231b` | Bell Tower |

### 1.3 Structure and water

| Token | Value |
|---|---|
| `WALL.cap` | `#1c1a26` |
| `WALL.capRim` | `#4f4a66` (light edge where the cap meets open ground) |
| `WALL.faceTop` / `WALL.face` | `#2b2738` -> `#121019` (vertical gradient) |
| `WALL.faceHighlight` | `rgba(200,190,255,0.16)` (1 px at cap/face seam) |
| `WALL.contact` | `rgba(0,0,0,0.60)` -> 0 (floor under a wall), sides `rgba(0,0,0,0.38)` |
| `PILLAR.top` / `body` / `plinth` | `#5a5468` / `#3c3748` / `#2e2a38`, shadow `rgba(0,0,0,0.5)` |
| `DOOR.wood` / `woodDark` / `iron` / `bar` | `#5e3d22` / `#3a2312` / `#8f96a3` / `#2b1a0c` |
| `DOOR.frame` / `threshold` | `#b08850` / `#8a6a3e` (open doors, 4.7) |
| `WATER.deep` / `mid` / `surface` | `#0a2034` / `#134466` / `#1f7192` (blue-teal surface band: water is always clearly brighter and bluer than walls and floors, 4.6) |
| `WATER.ripple` / `bank` | `rgba(170,225,245,0.55)` / `rgba(185,215,240,0.55)` (1 px bank edge line) |
| `WATER.kerb` / `kerbFace` | `#2a2f3b` / `#171a22` |
| `BRIDGE.wood` / `dark` / `rail` | `#6d4a2b` / `#3b2614` / `#8a6238` |
| `BRIDGE.charred` | `#1a110a`, ember `#ff7a2e` |
| `POOL.water` / `deep` / `rim` / `rimTop` / `rune` | `#15485a` / `#0c2c3a` / `#3a4950` / `#71878f` / `rgba(120,225,255,0.50)` |
| `TABLE.top` / `topEdge` / `front` / `runner` | `#4c3322` / `#7a5634` / `#24170e` / `rgba(140,36,48,0.85)`; plates `#d8cfbd`, goblets `#c9a24a`, candle `LIGHT.flameCore` |
| `CRATE.wood` / `dark` / `band` | `#6a4b2c` / `#2e2014` / `#8a6a40` |
| `STAIR.tread` / `riser` / `nosing` | `#3a4354` / `#1b2029` / `rgba(200,215,245,0.22)` |
| `BRAZIER.iron` / `rim` / `coal` / `legs` | `#2a1f18` / `#7a6650` / `#ff7a2e` / `#16110c` |
| `BELL.bronze` / `hi` / `dark` / `rope` | `#9c7a3c` / `#e0bd72` / `#4e3a1a` / `#bfa071` |
| `GATE.iron` / `ironHi` / `shadow` | `#4c525e` / `#a3abb8` / `rgba(0,0,0,0.45)` |
| `ANCHOR.hi` / `lo` / `edge` / `dead` | `#e6f8ff` / `#6a7cff` / `rgba(60,70,200,0.9)` / `#3b3946` |

### 1.4 Factions

| Token | Rebels (Ashen Wolves: storm, ash, steel) | Loyalists (Dawn Lantern: gold, ivory) |
|---|---|---|
| `cloak` | `#3f6690` | `#e0b955` |
| `cloakDark` (hood/shade) | `#22364f` | `#9d7426` |
| `steel` (pauldrons, helm) | `#a9b9c9` | `#efe6cf` |
| `accent` (base rim, glints, blade glow) | `#6fd3ff` | `#fff1b8` (crest `#c0392b`) |
| `trim` | `#d6e2ee` | `#fff8e4` |
| `base` (ground plate fill) | `#111a26` | `#2a200c` |
| `skin` | `#c9a88a` | `#d8b896` |
| `outline` | `rgba(4,5,10,0.9)` both | |
| HUD aliases | `--storm #7fb4e6`, phase pill `#23384f` | `--loyal #e3bd5f`, phase pill `#4d3d17` |

Named marks: Varek `#7fe3ff` (bolt), Kaela `#e0483a` (scarf), Grimm `#ff8a2e` (flame), Halden `#ffd24a` (crown), Elian `#fff6c8` (halo), Orsa `#8f8068`/`#e0c47a` (tower shield), Mira `#2f6f6a` cowl + `#7fe0d0` (book glow).

### 1.5 Overlays, status, domains

| Token | Value |
|---|---|
| `OVERLAY.reach` / `reachEdge` | `rgba(70,140,255,0.30)` / `rgba(150,200,255,0.85)` + 1 px outer `rgba(0,0,0,0.55)` |
| `OVERLAY.target` / `targetEdge` | `rgba(255,72,60,0.36)` / `#ff7864` + outer `rgba(0,0,0,0.55)` |
| `OVERLAY.path` / `pathCasing` | `rgba(200,228,255,0.95)` / `rgba(4,8,20,0.8)` |
| `OVERLAY.hover` | `rgba(255,255,255,0.85)` |
| `OVERLAY.plate` / `plateEdge` | `rgba(8,8,14,0.74)` / `rgba(232,200,114,0.32)` (zone label plaques) |
| `STATUS.dueling` / `sealed` / `drained` / `escapee` | `#ff7a5c` / `#8cdcff` / `#b5a8d6` / `#7fe0d0`, badge fill `rgba(8,8,14,0.88)` |
| `HP.good` / `mid` / `low` / `back` / `ghost` | `#6fcf6f` / `#e8c040` / `#e05040` / `rgba(0,0,0,0.7)` / `rgba(255,255,255,0.85)` |

Domain styles (replace `DOMAIN_STYLE`; ground fill alpha is deliberately low so move/attack highlights stay distinct, see checklist 8):

| Domain | ground | edge | label | light rgb | particles |
|---|---|---|---|---|---|
| tempest | `rgba(110,130,230,0.10)` | `rgba(170,200,255,0.9)` | `#bcd4ff` | 120,160,255 | `#dbe8ff`, bolt `#ffffff`/`#8fd8ff` |
| pyre | `rgba(255,100,40,0.12)` | `rgba(255,140,60,0.95)` | `#ffb27a` | 255,120,50 | `#ff5a1f` `#ffb347` `#ffe2a0` |
| bulwark | `rgba(205,180,130,0.10)` | `rgba(240,215,160,0.95)` | `#ecd9a8` | 230,205,150 | hex lattice `rgba(236,217,168,0.22)` |
| sanctuary | `rgba(255,245,180,0.10)` | `rgba(255,250,210,0.9)` | `#fff5c8` | 255,240,190 | motes `#fff6c8` |
| silence | `rgba(120,90,160,0.12)` | `rgba(170,140,210,0.8)` | `#d0c0f0` | 150,120,200 (dims, see 6.3) | `#b9a6e0` |

## 2. Layer order (decided)

Every frame, in this order. "C" = cached offscreen canvas, "F" = drawn per frame. Screen shake (6.2) translates layers 1-14 only.

| # | Layer | Kind | Contents |
|---|---|---|---|
| 0 | Clear | F | `NIGHT.void` |
| 1 | Terrain | C | floors per material, flat decor, contact shadows, pillars, rubble, tables, crates, quay steps, brazier stands and bowls (unlit), the great bell, open doors, bridge decks, burned-bridge remains, canal base and banks, reflecting-pool rim and basin, 2.5D walls, wall decor (banners, shelves, throne back), lantern fixtures, map-edge openings, escape-exit thresholds. Key: `T`, terrain, unburned-bridge overrides, era-desaturation flag (3.4). |
| 2 | Water | F | canal ripples, lantern and moon reflections; reflecting-pool shimmer and rune glow (water tiles only) |
| 3 | Objects | F | barred doors, ward anchors (intact/damaged/broken), portcullis gates (closed/rising/open) |
| 4 | Ground FX | F | ash decals, Domain ground fill + ground patterns, scorch on burned bridges |
| 5 | Darkness | F | low-res darkness canvas upscaled, `source-over` |
| 6 | Light glow | F | low-res glow canvas upscaled, `screen` |
| 7 | Light sources | F | lantern flame pixels, brazier fire, table candles, anchor crystal core sparkle: bright, small, above darkness so sources read as sources |
| 8 | Highlights | F | reach, target, hover path (and zone outline of the hovered tile, 4.9) |
| 9 | Zone labels | F (text cached) | plaques |
| 10 | Units | F | y-sorted: selection glow, contact shadow, figure sprite, night shade, initial tab, status badges, HP bar |
| 11 | Domain upper | F | Bulwark dome rim, Tempest bolts and wind, Pyre flame tongues, Sanctuary rays, Silence rings |
| 12 | Top labels | F | Domain labels, object HP badges |
| 13 | Hover | F | hover tile outline |
| 14 | FX | F | particles, projectiles, flashes, pulses, bell rings, floats (damage numbers) |
| 15 | Banner | F | banner card (not shaken) |

Rules: the darkness never covers layers 7-15. Units are not physically lit; they get a bounded night shade (3.5) so they sit in the scene without losing faction colour.

## 3. Lighting model

### 3.1 Composite

- Two low-res canvases owned by `gfx/lighting.ts`, **8 px per tile** regardless of `T` (256x176 for this map): `dark` and `glow`.
- Each frame (or only on change, 3.7):
  1. `dark`: clear; fill `rgba(tint, darkAlpha)`; add the vignette (radial gradient, inner radius `0.45*min(W,H)` transparent, outer `0.72*max(W,H)` `rgba(0,0,0,0.28)`); then `globalCompositeOperation='destination-out'`: draw the softened outdoor mask at `globalAlpha = moon`, then every light as a radial stamp (alpha stops `k` at 0, `0.7k` at 0.45, 0 at 1), then the **floor minimum**: the softened passable mask (`sites.passable`) at `globalAlpha = max(0, 1 - floorCap/darkAlpha)` so no passable tile is ever darker than `floorCap` (3.4) and floor texture stays readable in corridors, the tunnel and the towers.
  2. `glow`: clear; draw the outdoor mask at `globalAlpha = 0.16*moon/0.36` (cold sheen); then `lighter`: every light as a coloured radial stamp (alpha `0.34k` at 0, `0.10k` at 0.5, 0 at 0.9r; overhead lights `0.16k` / `0.05k`).
  3. On the main canvas, `imageSmoothingEnabled = true`, quality `high`: `drawImage(dark, 0,0, mapW*T, mapH*T)` with `source-over`, then `drawImage(glow, ...)` with `screen`. Restore smoothing to `false`.
- Light stamps are **pre-rendered sprites** (white radial gradient 64x64 for `dark`, per-colour 64x64 for `glow`), drawn scaled with `globalAlpha = k`. Do not call `createRadialGradient` per light per frame.
- Outdoor and passable masks: built once per map at 8 px/tile, then softened by drawing 9 copies offset by +-2 px at alpha 1/9 (no `ctx.filter`, Safari-safe).

### 3.2 Light sources

| Kind | Where (from `gfx/sites.ts`) | Pos in tile | Radius (tiles) | Intensity k | Colour | Flicker amp |
|---|---|---|---|---|---|---|
| Wall lantern | wall tiles whose south neighbour is floor-like ground (floor, pillar, rubble, throne, dais, table, crates; never door, stairs, water, bridge, brazier or bell), `hash(x,y,99) < 0.17` | `(x+0.5, y+0.85)` | 2.7 | 0.85 | `LIGHT.lantern` | 0.10 |
| Brazier | every `brazier` tile | `(x+0.5, y+0.35)` | 3.4 | 0.95 | `LIGHT.brazier` | 0.16 |
| Table candle | `table` tiles with `hash(x,y,5) < 0.5` | `(x+0.5, y+0.45)` | 1.3 | 0.35 | `LIGHT.lantern` | 0.08 |
| Great bell | every `bell` tile ("light it a little") | `(x+0.5, y+0.5)` | 1.6 | 0.30 | `LIGHT.overhead` | 0 |
| Overhead (no fixture) | every interior zone (all zones except `quay`, `innerGate`, `eastCourt`): `n = max(1, round(long/6))` lights at the centres of `n` equal segments of the zone bounding box's middle line along its long axis | as derived | `clamp(0.45*short + 1.2, 2.2, 3.4)` (`long`/`short` = box sides in tiles) | 0.50 | `LIGHT.overhead` | 0.05 |
| Ward anchor | each intact anchor | `(x+0.5, y+0.45)` | 2.0 | 0.70, pulse x(0.85+0.15 sin(t/520)) | `LIGHT.ward` | 0.12 |
| Seal | each `sealed` unit | tile centre | 1.8 | 0.60 | `LIGHT.seal` | 0.06 |
| Radiant orb | each Radiant | `(x+0.3, y+0.3)` | 1.1 | 0.35 | faction accent | 0.04 |
| Domain | owner (display pos) | tile centre | 4.0 | 0.60 | domain light | pyre 0.15, else 0.04 |
| Burning bridge | burned bridge tiles, 6 s after burn, then embers | tile centre | 2.6 then 1.2 | 0.90 then 0.30 | `rgb(255,120,50)` | 0.25 |
| FX flash | lightning, impacts, anchor shatter, bell | event pos | 1.5-2.5 | transient, eased to 0 | per effect | 0 |

**No site names a coordinate.** Every site (lanterns, braziers, candles, bell, overheads, reflection pairs, exits, edge openings) is derived in `gfx/sites.ts` from terrain, zones and exits, so the renderer follows the geometry pass and works on any map. Static sites become `LightSource`s once per map (`MapSites.staticLights`).

Flicker (per light, `t` in seconds, `s` = seed from `hash`): `f = 1 + amp * (0.6 sin(2pi*1.7t + 40s) + 0.4 sin(2pi*4.3t + 90s))`; intensity `k*f`, radius `r*(1 + 0.3(f-1))`. Reduced motion: `f = 1`.

### 3.3 Moonlight

Outdoor tiles (`sites.outdoor`): the outdoor zones `quay`, `innerGate`, `eastCourt`; every canal water tile, bridge and `stairs` tile; and every **non-zone** non-wall, non-door tile reached by a 4-way flood fill from those seeds through non-zone tiles, where the fill never enters a door, a zone tile, or a 1-wide corridor tile (a non-zone tile with walls, or the map edge, on both W and E or on both N and S; tiles on the map border are never corridors, so edge gaps such as Mira's exit stay open ground). This yields the south streets, the outer-gate gap and the east exit tile, and keeps the corridors indoors. Reflecting-pool water (inside an interior zone) is not outdoor. Never `bellTower`. Moon carves `moon` alpha from the darkness and adds the cold sheen. Interiors get no moon, only lanterns and overheads: rooms should feel like pools of warm light in dark stone, the outside like cold blue open ground.

### 3.4 Global light states

| Era | darkAlpha | floorCap | tint rgb | moon | lamp x | world desaturation |
|---|---|---|---|---|---|---|
| Midnight | 0.68 | 0.55 | 6,8,16 | 0.36 | 1.00 | 0 |
| First Bell | 0.64 | 0.52 | 7,9,18 | 0.36 | 1.00 | 0 |
| Second Bell | 0.58 | 0.48 | 12,13,22 | 0.34 | 0.95 | 0 |
| Dawn | 0.30 | 0.30 | 60,66,80 (grey) | 0.10 | 0.55 (lanterns gutter) | 0.45 |

`floorCap` is the darkest any passable tile may be (3.1); it keeps corridors, the servants' tunnel and the Princess's Tower readable (the mock's near-black corridors are a bug). **No coloured haze:** the darkness tint stays near neutral, the cold sheen is drawn on outdoor tiles only, and nothing purple is laid over interiors; interior floors keep their material hue under the darkness.

`lamp` multiplies lantern, brazier, candle, bell and overhead lights only (wards, seals, Domains, fire keep full strength). Desaturation: `globalCompositeOperation='saturation'`, fill `#808080` at the listed alpha over layers 1-4.

**Transitions:** the display era is set when the `bellRang` step *starts* (not from `state`, which is already ahead). All parameters lerp over `TIMING.bell` (1500 ms) with `easeInOutSine` (the renderer tracks the transition and hands it to every module as `GfxFrame.era` / `GfxFrame.env`, 9.2); desaturation is a live full-screen pass during the transition, then baked into the terrain cache (cache key includes the era flag). Reduced motion: 600 ms linear crossfade.

### 3.5 Readability above the darkness

- Units: drawn after the light layers. Light level `L` at the unit's display tile: `clamp(1 - darkAlpha + (outdoor ? 0.7*moon : 0) + sum_i k_i*(1 - d_i/r_i)*0.8, 0, 1)` (d = distance from tile centre to light). Draw the figure, then its cached night-silhouette sprite (figure filled with `NIGHT.tint` via `source-atop`) at alpha `0.38*(1-L)`. **Max shade 0.38.** Compute `L` once per tile per frame (memo).
- Highlights, labels, HP, badges, tooltip, banners: never shaded.
- Selection glow and Radiant orbs are additive-looking but drawn in the unit layer, not the lightmap.

### 3.6 Vignette

Baked into `dark` (3.1). Max `0.28` at corners; never applied above layer 5, so edge units (City Watch at x 0) stay readable.

### 3.7 Cost control

Rebuild `dark`/`glow` only when: a flickering light exists and motion is allowed (every frame), an era transition is running, or the light list changed (hash of positions/intensities). With reduced motion and nothing changing, reuse last frame's canvases.

## 4. Materials, structure and decorations

### 4.1 Material map (first match wins; `sites.material[y][x]`)

| Region | Material | Floor painter (per tile, varied by `hash(x,y,salt)`) |
|---|---|---|
| `throneHall` | marble | one slab per tile, checker A/B by `(x+y)%2`, one bezier vein, 1 px joints, top 1 px sheen |
| `wellspringHall` | well (its `water` tiles: `pool`, section 10) | 3x3 ceramic tiles per tile, random A/B, 1 px dark grout |
| `feastHall` | plank | 4 horizontal planks per tile, staggered butt joints `((x*7+j*3)%4)/4` |
| `princessTower` | parquet | 2x2 herringbone-like blocks, 2 grain lines per block |
| `bellTower` | boards | 4 vertical boards |
| `innerGate` | cobble (plaza variant) | 2x2 square setts |
| `servantsTunnel` | tunnel | rough stone, damp ellipse on 35 % of tiles |
| `eastCourt`, non-zone outdoor tiles (3.3) | cobble | 3x3 rounded cobbles, alternate rows offset half a stone |
| `quay`, `stairs` tiles anywhere | flag | large flags with half-tile offset joints, cold top sheen (steps drawn over it, section 10) |
| canal `water` / `bridge` tiles | canal | 4.6 |
| `water` inside any interior zone | pool | section 10 |
| `antechamber`, other non-zone interior floor | slab | slab with 1 px joints |

Rows are checked in this order: `stairs`, then water/bridge (canal or pool), then the zone rows. Non-floor terrain (pillar, rubble, table, crates, brazier, bell, door, throne, dais) gets the material of its region underneath; walls get `wall`.

### 4.2 Walls (2.5D, contained in their own tile)

- **Never overhang a floor tile.** A wall tile whose south neighbour is not a wall shows a *cap* (top `0.56T`) and a *front face* (bottom `0.44T`) inside its own tile; other wall tiles are full cap.
- Cap: `WALL.cap`, faint block joints (`rgba(255,255,255,0.035)` at half-tile, staggered by row) so large wall masses read as stone, not void. Rim light `WALL.capRim`, `max(1, round(T/22))` px, on cap edges whose neighbour (N, W, E) is not a wall.
- Face: gradient `WALL.faceTop` -> `WALL.face`, two brick courses (1 px `rgba(0,0,0,0.45)` mortar, joints every `T/2`, alternate courses offset `T/4`), `WALL.faceHighlight` 1 px at the cap/face seam.
- Contact shadow on the floor tile *below* a wall: linear gradient `rgba(0,0,0,0.60)` -> 0 over `0.42T`. Side occlusion on floor tiles with a wall to the W/E: `rgba(0,0,0,0.38)` -> 0 over `0.20T`.
- Lantern fixture on a face: bracket `0.04T x 0.10T` `#2a2018`, housing `0.18T x 0.20T` `#3a2a18`, glass `0.12T x 0.14T` `LIGHT.flameBody`, core `0.06T x 0.08T` `LIGHT.flameCore`, centred at `(x+0.5, y+0.67)`. Layer 7 redraws the core with alpha flicker `0.8 + 0.2 sin(now/90 + 50s)`.

### 4.3 Rooms

| Room | Decoration (all flat; contrast limits in checklist 2) |
|---|---|
| Throne Hall | Red carpet runner on the dais's two centre columns from the row below the dais to the hall's southern edge (inset `0.12T` each side), gold trim line inset `0.2T`. Dais/throne tiles: `carpetDark` with `carpet` inset `0.06T`, gold lozenge `rgba(201,162,74,0.22)`, and a **step face** `0.13T` (`#6e5a3a`, gold 1 px top) on dais tiles whose south neighbour is not dais, plus `0.10T` shadow on the floor below (dais is +1 DEF, so "a low step" is honest). Throne back drawn **on the wall tiles** directly north of the dais's two centre columns: `#7a1f2c` panel `0.76T` wide with gold border and a gold point; nothing on the dais tiles beyond the dais itself (they are Confront tiles). |
| Feast Hall | Wood planks. The banquet tables are `table` terrain, drawn as real tables (section 10). A few spilled goblets (`r 0.05T`, `rgba(201,162,74,0.35)`, flat) on floor tiles next to tables, `hash < 0.3`. |
| Antechamber | Slab. Loyalist banners on the **wall faces** directly north of antechamber tiles, at most 4: the face tiles with the lowest `hash(x,y,31)` that are not lantern sites and not next to a door: `#6a1f2a` swallow-tail `0.36T x 0.50T` starting `0.12T` above the face, gold sun disc `r 0.07T`. |
| Wellspring Hall | Ceramic tiles. The zone's `water` tiles are the **tiled reflecting pool** (section 10). Rune ring inlay on floor tiles only: two ellipses centred on the centroid of the zone's `throne`/`dais` tiles (zone centre if none), radii `(1.35T*1.6, 1.35T*0.85)` and `(1.6T*1.6, 1.6T*0.85)`, `MAT.well rune`, 16 rune ticks `0.08T x 0.12T` on the mid ellipse. Rite dais (the zone's `throne` tiles): flat glowing font inlay `#16323c`, inner square stroke `rgba(140,230,255,0.45)`. |
| Bell Tower | Boards. The great bell is a `bell` terrain tile (section 10); nothing is painted on the wall faces. |
| Princess's Tower | Parquet, violet rug `rgba(60,44,100,0.30)` over the zone's top two rows (floor tiles only, inset `0.3T` at the outer edge). Bookshelves on wall faces directly north of zone tiles (6 spines `0.10T x 0.30T` in `#5a2d3a #2d4a5a #5a4a2d #3a2d5a`). |
| Servants' tunnel | Tunnel stone, damp patches, no moon, lit by its lantern(s) and its derived overheads; `floorCap` (3.4) keeps the stone readable. |
| Corridors (1-wide non-zone runs, walls on both sides) | Slab with a blue runner `0.56T` wide along the corridor's axis; readable at Midnight thanks to `floorCap`. |
| Quay | Flags, moonlit; `crates` and `stairs` per section 10. Retaining wall: water tiles whose north neighbour is open ground (not `stairs`, which run down into the water) get a kerb face `0.16T` `WATER.kerbFace` + 1 px `rgba(160,180,220,0.18)` lip + `0.08T` shadow. Water tiles with open ground south get a `0.06T` `WATER.kerb` lip. |
| Courts / streets / plaza | Cobbles, moonlit. Braziers are `brazier` tiles (section 10); the plaza's pillars are plain piers. |

### 4.4 Rubble = honest low cover

Rubble is passable at cost 2, +1 DEF. It is drawn everywhere as **broken masonry**: one fallen block `0.30T x 0.18T` (`PILLAR.body`, lit top edge `PILLAR.top`) in a corner chosen by hash, plus 5 stones `0.06-0.14T` with `0.4` alpha drop shadows. No crates or barrels (those are `crates` terrain, section 10, and must not be confused with rubble). The centre of the tile stays free for the unit.

### 4.5 Pillars = passable cover at the back of the tile

Pillars are passable (cost 2, +2 DEF). The column stands at the **back (north) half** of its tile so a unit on it is drawn in front of it, "in cover": shaft x `0.5T +- 0.20T`, y `0.10T..0.50T`, 3 flutes, left-lit gradient; plinth `0.56T x 0.10T` at `0.46T`; capital `0.54T x 0.09T` at `0.05T`; shadow ellipse `(+0.10T, +0.06T)`, radii `0.30T x 0.11T`.

### 4.6 Canal and bridges

The canal is 2 tiles wide (section 10). **Water must read as water at 30 px** (the mock's canal was too dull and merged with the walls):

- Base (cached, layer 1): per canal column, a vertical gradient over the canal's full height (the run of water/bridge rows in that column): `deep` at 0, `mid` at 0.22, `surface` at 0.5, `mid` at 0.78, `deep` at 1, so the canal shows one bright blue-teal band along its middle. Kerbs per 4.3. A 1 px `WATER.bank` line on the water side of every edge where a water tile meets open ground or stairs (the bank edge line).
- Ripples (layer 2): per water tile, 3 wavelets at `y = 0.30T, 0.52T, 0.74T` of the tile, length `(0.35 + 0.3h)T`, drift `x = ((now/2600 + h) mod 1) * T` (alternate rows drift the other way), alpha `0.45 + 0.5*(0.5+0.5 sin(now/700 + 6.28h))` of `WATER.ripple`, `max(1, T/22)` px. They must be visible without zooming. Reduced motion: drawn once into the cache.
- Reflections (layer 2, `lighter`): every lantern/brazier within 3.2 rows of the canal in its column (`MapSites.reflections`) casts a **vertical shimmering streak**: on each water tile of that column, 5 stacked horizontal dashes at `0.18T + i*0.16T`, width `(0.30 - 0.03i)T * (0.7 + 0.3 sin(now/240 + 1.7i + 9s))`, alpha `(0.65 - 0.07i) * (1 - dy/4)`, colour = light colour times the era `lamp`, x jitter `0.04T sin(now/300 + i)`. Together they read as a column of broken light on the water. The moon adds a faint `rgba(180,200,255,0.10)` sheen band on the `surface` row. The pairs are precomputed per map.
- Bridges (cached) span the canal as **one continuous deck over all their tiles** (`MapSites.bridges`: tiles, axis): drop shadow on the water beside the deck `rgba(0,0,0,0.45)`, deck `0.80T` wide across the flow, plank seams every `0.2T` across the deck, rails `0.09T` along both sides for the whole span, posts `0.13T` only at the two ends of the span (on the bank side of the first and last tile). Burned: charred stumps `BRIDGE.charred` at both ends, a broken beam fragment per tile, plus 2 ember pixels per tile pulsing (layer 4) for the rest of the battle.

### 4.7 Doors and objects

| Object | Intact | Damaged (`hp < 50 %`) | Broken / destroyed |
|---|---|---|---|
| Ordinary door (terrain `door`, no object): **passable** | A visible **open door**, oriented to the passage (`MapSites.doors[].axis`): warm door frame posts `0.12T` in `DOOR.frame` on both jambs with a 1 px `LIGHT.flameBody` inner highlight, a threshold strip `0.16T` in `DOOR.threshold` across the passage at the wall line, and one door leaf (`DOOR.wood`, `0.10T` thick, `0.70T` long, darker edge `DOOR.woodDark`, iron ring dot) swung open 90 degrees against one jamb, with a `0.06T` shadow. The passage between the posts shows the floor. Must be findable at 30 px (the mock's floor-plan symbol was too faint). | n/a | n/a |
| Barred door (object): **impassable** | Full-tile closed leaves `0.92T x 0.80T` with plank lines, two iron bands, a heavy crossbar `0.14T` with iron ends, stone jambs `0.10T` in `WALL.cap` top and bottom (reads as part of the wall). HP badge above darkness. | crossbar rotated `-0.18 rad`, two dark cracks, bands kept | threshold strip, four splinters (`DOOR.woodDark`) against the jambs; floor visible; no HP badge |
| Ward anchor | floating crystal (diamond `0.30T x 0.44T`, gradient `ANCHOR.hi -> lo`, edge `ANCHOR.edge`) bobbing `0.03T` (period 3.3 s), small shadow, rune ellipse on the floor `0.34T x 0.13T`, light per 3.2 | crack line through the crystal, light flicker 0.25 | rune ellipse dim `rgba(90,100,140,0.35)`, three dull shards `ANCHOR.dead`, no light |
| Bridge | 4.6 | n/a | 4.6 charred |
| Portcullis (`gate` object) | section 10, closed | rising during its `arrive` step | section 10, open |

### 4.8 Exits and gates

- All map-edge openings (`MapSites.edges`: every non-wall tile on the map border, with its off-map direction) fade to black over `1.2T` toward the edge.
- **Escape exits** (`state.map.exits`): threshold glow `STATUS.escapee` at 0.25 on the tile, three chevrons pointing off-map (`0.22T`, alpha cycling 0.25 -> 0.8, 1200 ms stagger 150 ms; static in reduced motion), and a small escapee badge at the inner edge. Must be visible at 30 px.
- Reinforcement gates (edge openings that are not escape exits) have no chevrons; they light up only during `arrive` (6.3). The outer-gate gap carries the portcullis (section 10).

### 4.9 Zones

Always-on dashed zone outlines are removed (rooms are defined by walls and materials). Zone labels stay as plaques (`OVERLAY.plate`, 1 px `plateEdge`, text `COLORS.zoneLabel`, existing placement code). When the hovered tile belongs to a zone, outline that zone with a dashed `rgba(232,200,114,0.35)` line `max(1, T/24)` in layer 8 (helps the bell-tower objective).

## 5. Figures and unit tokens

### 5.1 Construction

- Sprites are `T x T` canvases cached in `gfx/figures.ts`, key `${faction}|${rank}|${character}|${variant}|${T}` (`variant`: `normal | shade | spent`). Evict all on `resize` when `T` changes. `shade` = figure filled `NIGHT.tint` via `source-atop`; `spent` = figure desaturated (draw then `saturation` fill `#808080` alpha 0.7, clipped by `source-atop`).
- Feet at `0.80T`. The figure is painted then scaled **x1.14 about the feet**. Height factor (before the scale): Soldier 0.86, Kindled 0.92, Radiant 0.92, Ascendant 1.00, Halden 0.84. Nothing may extend outside the tile (clamp spear tips at `0.06T`).
- Outline every shape with `outline`, `max(1, T/30)` px. Shade the right half of the body `rgba(0,0,0,0.28)` (light from the upper left).
- Facing: flip horizontally (`scale(-1,1)` about the tile centre) for the figure only; badges, tab and HP never flip.

### 5.2 Faction shape language (must work in greyscale at 30 px)

| Element | Rebels (Ashen Wolves) | Loyalists (palace, Dawn Lantern) |
|---|---|---|
| Ground plate | **Rhombus** `x 0.13..0.87, y 0.67..0.93`, `base` fill, `accent` rim `max(1.5, T/22)` | **Ellipse** `rx 0.36T, ry 0.13T`, `base` fill, gold `accent` rim |
| Head | **Wolf hood with two pointed ears** (ears rise `1.9 hr` above the head centre), dark hood, two `accent` eye glints | **Round helm dome** with visor slit and an **oval crest** (`#c0392b`) |
| Body hem | **Zigzag, tattered** (4 teeth) | **Straight** with ivory centre stripe and sun disc |
| Pauldrons | **Triangular** spikes (`steel`) | **Half-round** (`steel`) |
| Colour | storm blue, steel, cyan accent | gold, ivory, red crest |

### 5.3 Ranks (secondary silhouette)

| Rank | Silhouette | Weapon / mark |
|---|---|---|
| Soldier | smallest (0.86), no pauldrons | Rebel: hand axe (wedge head right). Loyalist: spear with leaf head, tip at the top of the tile |
| Kindled | 0.92, pauldrons | Mana-sheathed sword from hand `(0.70,0.62)` to `(0.82,0.20)`, blade `#bff0ff` / `#fff6d0` with a `T/9`-wide accent glow stroke |
| Radiant | 0.92, robe flares to `0.24..0.76` | Staff on the left side `x 0.24`, glowing orb `r 0.05T` + glow `r 0.15T` at the top (also a small light source, see 3.2) |
| Ascendant | tallest (1.00), **cape** wider than the body (`0.16..0.84` at the hem; zigzag for rebels), **double plate rim** (outer rhombus/ellipse +0.08T), **circlet** ellipse above the head in accent (`#7fe3ff` rebel, `#fff1b8` loyalist, Grimm `#ff8a2e`) with a soft glow | Greatsword `(0.76,0.66)` to `(0.84,0.08)` with gold crossguard (Varek) |

### 5.4 Named characters (unit `character` from `src/content/prologue.ts`)

| Character | Faction, rank | Recognisable mark |
|---|---|---|
| Varek | rebel Ascendant (Tempest) | storm-dark cape `#1a2a44`, **cyan lightning bolt** on the chest, greatsword, cyan circlet |
| Kaela | rebel Kindled (player's hero) | the only **red** on the rebel side: **red scarf** `#e0483a` streaming left from the neck; cyan blade |
| Grimm | rebel Ascendant (Pyre) | ember cape `#4a2a22`, **flame** emblem `#ff8a2e` on the chest, great axe, orange circlet |
| Emperor Halden | loyalist (rank soldier in data; drawn special) | small, hunched (0.84), ivory robe, white beard, **gold three-point crown**, no weapon |
| Crown Prince Elian | loyalist Ascendant (Sanctuary) | ivory robe and cape, golden hair, **sun halo**: 10 rays + soft glow behind the head; no circlet |
| Lady Orsa | loyalist Ascendant (Bulwark) | stone-coloured armour `#bfa774`, grey crest, **tower shield** `0.24T x 0.36T` `#8f8068` with gold rim and boss on the left |
| Princess Mira | loyalist Radiant (escapee) | **teal rounded cowl** `#2f6f6a`, ivory open **book** with teal glow instead of a staff |

All named units also get an **initial tab** at the top-left: dark plate `rgba(8,8,14,0.85)` `1.15fs x 1.1fs`, faction underline 1 px (`#bfe9ff` / `#ffe7a0`), serif bold initial, `fs = max(9 css px, 0.22T)` (same initial rule as `unitGlyph`). Generic units have no letter.

### 5.5 Per-frame unit drawing (`gfx/units.ts`)

| Element | Spec |
|---|---|
| Sort | by display y (then x) so lower units overlap upper ones correctly |
| Contact shadow | ellipse at `(0.5T, 0.82T)`, `0.34T x 0.12T`, `rgba(0,0,0,0.5)` |
| Idle bob | `0.015T * sin(now/380 + phase)`, `phase = hash(unitId)`; off when spent, reduced motion, or the unit is animating |
| Selection | ground glow radial `r 0.55T` at the feet (faction accent at 0.55) + four **corner brackets** `0.26T` long, `max(2, T/14)` px, white alpha `0.6 + 0.4*(0.5+0.5 sin(now/160))` (static 0.9 in reduced motion) |
| Acted / spent | acted only: alpha 0.80. Moved and acted: `spent` sprite at alpha 0.60, no bob |
| Night shade | 3.5 |
| Status badges | top-right, right-to-left in the order sealed, dueling, drained, escapee (escapee only while not sealed). Circle `r = max(5.5 css px, 0.14T)`, fill `rgba(8,8,14,0.88)`, ring `r/5` px in the status colour. Icons: dueling = **crossed swords**: two diagonal blades in light steel `#e8edf2` (`max(1.5, r/3)` px) each with a distinct crossguard bar and pommel dot, over the `STATUS.dueling` ring; it must never read as a plain X (the mock's badge still did); sealed = **padlock** plus a dashed ellipse `0.42T x 0.17T` around the feet, dash `T/10, T/14`, offset `-now/60`; drained = **cracked drop**; escapee = **arrow out**. The old red X is removed. |
| HP bar | x `0.14T`, width `0.72T`, height `max(3 css px, round(0.09T))`, bottom `2 px` above the tile edge; back `HP.back` with 1 px border; fill by ratio (`>0.6` good, `>0.3` mid, else low). Ascendants and Orsa/Elian: 1 px dark ticks every 10 HP. **Damage ghost:** when displayed HP drops, the lost segment shows `HP.ghost` and shrinks to 0 over 400 ms `easeOutQuad` (renderer keeps `lastHp` per id). Heal: the gained segment flashes `#bff5c2` 300 ms. |

## 6. Animation

### 6.1 Easing and conventions

Easings live in `gfx/ease.ts`: `linear`, `easeInQuad`, `easeOutQuad`, `easeInOutSine`, `easeOutCubic`, `easeOutBack` (overshoot 1.4). `p` = step progress 0..1 from `AnimationQueue.active`. Effects that outlive their step use `Effect.start/life` as today. `TIMING` durations are **unchanged**; they pace the queue and every visual below fits inside them.

### 6.2 Screen shake

Offset = `A * exp(-t/70ms) * n(t)`, `n` = value noise at 30 Hz, 2D, rounded to whole device px, applied to layers 1-14.

| Trigger ("big") | A | Duration |
|---|---|---|
| damage `amount >= 8` to a unit, or any hit that kills, or `died` with cause `confront` | `min(3 css px, 0.06T)` | 220 ms |
| Tempest or Pyre activation | `min(5 css px, 0.10T)` | 300 ms |
| barred door or anchor destroyed | `min(2 css px, 0.04T)` | 180 ms |

No shake in reduced motion, at `instant` speed, or while input is unlocked.

### 6.3 Step table

| Step kind (event) | TIMING (1x) | Visual |
|---|---|---|
| `move` (`moved`) | 85 ms per tile | Linear along the path (`lerpPath`), plus a hop `0.06T * sin(pi*local)` per tile. Facing = sign of the segment's dx. Footstep dust: 2 particles per tile entered (`rgba(150,140,130,0.5)`, r `0.04T`, life 350 ms, drift `0.1T` back, fade `easeOutQuad`). |
| `hit` (`damaged`, cause `attack`, melee: Manhattan 1) | 280 ms | Attacker lunge `0 -> 0.28T` toward the target over p 0-0.35 (`easeOutQuad`), back over 0.35-1 (`easeInOutSine`); attacker faces the target. Impact at p 0.35: target white flash (sprite redrawn `lighter` at alpha `0.85 -> 0` over 120 ms), knockback `0.12T` away over 0.35-0.55 (`easeOutQuad`) and back by p 1 (`easeOutBack`), 6 sparks in the attacker's accent (r `0.03T`, speed `1.5-3T/s`, life 300 ms). Damage number spawns at impact (`start = stepStart + 0.35*duration`). |
| `hit` ranged (Manhattan >= 2) | 280 ms | Projectile p 0-0.40, linear: Radiant = accent orb `r 0.08T` with `0.3T` fading trail (`lighter`); Varek at range 2 = short jagged cyan arc. Impact at p 0.40 as melee (no lunge; attacker recoils `0.06T` back at p 0-0.2). |
| `hit` cause `tempest` | 280 ms | Lightning bolt from `3T` above the target to its feet: 6-segment jagged polyline, white core `max(2, T/16)` + `#8fd8ff` glow `T/6` at 0.5, visible p 0-0.3, light flash r 1.5 k 0.8 -> 0. Target flash, no knockback. |
| `hit` cause `pyre` | 280 ms | 8 flame particles burst up from the target's feet (`#ff5a1f -> #ffb347 -> #ffe2a0`, life 400 ms), orange flash light r 1.2. |
| `hit` cause `duel` | 280 ms | Grimm and Orsa nudge `0.08T` toward each other (`easeOutQuad` there and back), a 5-spark clash at their midpoint in `#ffd08a`. |
| `hit` on an object | 280 ms | As melee/ranged; plus 4 splinters (door, `DOOR.wood`) or 4 blue shards (anchor). |
| `heal` (`healed`) | 240 ms | 6 gold-green motes `#cfe9a0 -> #fff6c8` rise `0.6T` (life 600 ms), soft ring `r 0.45T`, float `+N` `#9ff0a6`. |
| `death` (`died`) | 480 ms | p 0-0.2: white flash, tilt `0 -> 12 deg` away from the killer (`easeOutQuad`). p 0.2-1: dissolve upward: clip rect from the feet rising to the head (`easeInQuad`), 14 embers rise (`#ff9a4a -> #5a2a1a`, life 600-900 ms), 6 ash flakes (`#6a6570`) drifting down. Leaves an **ash decal** (layer 4: ellipse `0.40T x 0.14T`, `rgba(20,18,22,0.25)`, max 24, oldest dropped). |
| `remove` (`captured`) | 480 ms | Teal-gold shackle ring closes from `r 0.6T` to `0.25T` (`easeInQuad`), the unit scales `1 -> 0.8` and fades; float "Captured" as today. |
| `remove` (`escaped`) | 480 ms | Unit slides `0.6T` toward the exit's off-map side (`easeInQuad`) and fades; teal swirl of 8 particles at the exit; float "Escaped". |
| `objectBreak` door | 320 ms | 12 splinters along the passage axis (`DOOR.wood`/`woodDark`, `0.04-0.08T` rects, rotation, gravity `3T/s^2`, life 500-700 ms), dust puff (5 grey particles), shake 6.2. Art switches to broken at step start (override as today). |
| `objectBreak` anchor | 320 ms | Crystal shatters into 16 light shards (`#c8f4ff -> #6a7cff`, radial `2-4T/s`, life 500 ms, `lighter`), light flash r 2.5 k 0.9 -> 0 over 500 ms, rune ring fades over 320 ms. |
| `domain` (`domainActivated`) | 750 ms | Existing two diamond pulses stay. Edge grows from the owner outward p 0-0.6 (`easeOutCubic`); domain light ramps in. Bespoke per kind below. |
| `domainEnd` | 260 ms | Edge contracts `0.3T` inward and fades (`easeInQuad`), 6 particles in the domain colour puff out, light ramps out. If drained, the owner flashes grey and gets the drained badge at p 1. |
| `banner` (`bellRang`) | 1500 ms | On each `bell` tile (`MapSites.bells`): the rope swings `+-18 deg` damped (period 500 ms, decay 600 ms) and a bronze shimmer ring `BELL.hi` pulses on the bell's rim (fx draws over the cached bell; the bell body does not move); 3 gold rings `rgba(232,200,114,0.6 -> 0)` from the bell at 0/300/600 ms, each to `12T` radius over 1200 ms (`easeOutCubic`), line `0.12T -> 0.02T`; global light transition 3.4 starts. Banner card as today. |
| `banner` (others) | as today | Banner card restyled (7.1). |
| `arrive` (`reinforcementsArrived`) | 850 ms | Each unit, staggered 60 ms: slides in `0.8T` from the nearest map edge (west for the Watch, south for Lantern/Legion), alpha `0 -> 1` over p 0-0.6 (`easeOutCubic`); a warm lantern flare (light r 2.0, k 0.8 -> 0 over 850 ms) at the gate; 3 dust particles per unit; the wave's portcullis (if any) rises over p 0-0.5 (`easeOutCubic`, drawn by objects, section 10). Existing flash/pulse effects are replaced by this. |
| `burn` (`bridgeBurned`) | 480 ms | Fire on the bridge tile: 10 flame particles per tile for the step, light r 2.6 k 0.9; bridge art switches to charred at step start; afterwards ambient flames for 6 s (4 particles/s) and embers (1.2 r light) for the rest of the battle. |
| `seal` (`sealBroken`) | 800 ms | Elian's dashed seal ellipse snaps: 8 cyan link shards outward, ring pulse to `r 2T`, seal light off, halo brightens 0.3 for 400 ms. |
| `pause` (`duelEnded`) | 600 ms | Duel badges fade over 300 ms; small clash spark between the two. |
| `pause` (`gameOver`) | 400 ms | Vignette deepens by 0.15 (`easeOutQuad`). |
| `dialogue` | `dialogueDuration` | DOM card as today (7.2). The speaker's unit, if on the board, gets a soft white ring pulse (period 1.2 s) while the card is shown. |
| float numbers | life 950 ms | Pop: scale `0.6 -> 1.15 -> 1` over 0-180 ms (`easeOutBack`), rise `0.8T` (`easeOutCubic`), fade last 40 %. Font `800 max(13 css px, 0.52T)` system-ui, 2-px dark stroke. Big hits (6.2) `1.25x` size with `#ffd27a` stroke glow. |

Bespoke Domains (ground fill per 1.5 in layer 4, upper part in layer 11; edge = outline of the domain tiles, `max(2, T/12)` px):

| Domain | Ambient (while active) | Activation extra |
|---|---|---|
| Tempest (Varek) | 18 wind streaks (curved 3-point strokes `0.6-1.2T` long, `#dbe8ff` alpha 0.35, drift diagonally `2T/s`, life 600-900 ms); a random bolt (as the `tempest` hit, no damage) every 900-1600 ms on a random domain tile with a light flash; edge dashes `T/6, T/10` crawling `-now/40` | 3 bolts over 750 ms, shake |
| Pyre (Grimm) | flame tongues on every edge tile (triangles `0.18-0.30T` high, 2 per edge tile, height `sin(now/140 + i)`), 20 rising embers, heat shimmer (ground fill alpha `0.10 + 0.02 sin(now/200)`) | ring of fire sweeps outward with the edge, shake |
| Bulwark (Orsa) | **shield dome**: circle radius `3.4T` centred on the owner, hex lattice `rgba(236,217,168,0.22)` (hex size `0.6T`) clipped to the domain tiles, rim stroke `rgba(240,215,160,0.85)` 2 px with a top-left highlight arc; a shimmer band sweeps across every 2400 ms; edge drawn solid and thicker (`T/8`) because enemies cannot enter | dome rises: rim radius `0 -> 3.4T` `easeOutBack` |
| Sanctuary (Elian) | radiant light (light r 4, k 0.6), 12 slow motes rising, 12 soft sun rays from the owner rotating one turn per 20 s, alpha pulse 0.15-0.25 at 2.4 s | flash of warm white over the domain tiles (alpha 0.5 -> 0, 600 ms) |
| Silence (reserved) | darkens instead of lighting (adds a `0.15` darkness disc in `dark`), local desaturation 0.6 over the domain tiles, 2 slow violet rings contracting toward the owner every 1.6 s, 8 motes drifting inward | single violet pulse inward |

### 6.4 Speed setting and reduced motion

`src/ui/settings.ts` stores `{ speed: '1x' | '2x' | 'instant', reduceMotion: 'system' | 'on' | 'off' }` in `localStorage` key `lantern.settings.v1` (wrapped in try/catch; defaults `1x`, `system`). Effective `reduced = reduceMotion === 'on' || (reduceMotion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches)`, re-evaluated on the media query's `change`.

| | 1x | 2x | instant |
|---|---|---|---|
| Queue duration multiplier (applied in `controller.apply`, multiplied with `AI_SPEED`) | 1 | 0.5 | 0 for world steps |
| Banners (`bell`, objective, phase) | as today | x0.6 | fixed 450 ms (bell 700 ms) so they can still be read |
| `dialogue` steps | as today | x0.75 | 700 ms (the DOM card stays up >= 6 s and is clickable, as today) |
| Effect lifetimes (floats, flashes, particles) | 1 | x0.6 | floats x0.6; particles not spawned except impact sparks and break debris |
| Shake | yes | yes (A x0.7) | no |

Reduced motion (any speed): no shake; no idle bob; lights do not flicker; ripples and Domain patterns are static; no ambient particles (wind, embers, motes, footstep dust); burst particles capped at 4 per event (6 for breaks); lunge `0.10T`, knockback 0; death = 300 ms fade with 4 embers (inside the 480 ms step); bell = one ring, no swing; era change 600 ms crossfade; floats rise `0.3T`, no pop. Short fades are kept everywhere so state changes are still visible.

`locked` stays true until the queue drains at every speed (smoke tests rely on it).

### 6.5 Particle budget

One preallocated pool in `gfx/particles.ts` (struct of arrays, `Float32Array`s), **hard cap 192** live particles at any resolution; ambient sources share at most 64. When full, recycle the oldest ambient particle; never drop a burst. Particles are flat rects/circles (no gradients); additive ones are drawn in one `lighter` batch. Per-burst caps: hit sparks 6, footstep dust 2, death 14+6, door 12+5, anchor 16, bridge fire 10, seal 8, heal 6, arrive 3 per unit. Reduced motion: cap 40.

## 7. UI polish (DOM; layout, sizes and no-scroll unchanged)

### 7.1 Cards (`cards.ts`, `styles.ts`)

- `.card`: background `linear-gradient(180deg, #17141f, #0f0d15)`, border `1px solid #9c8344`, `box-shadow: inset 0 0 0 4px #14121c, inset 0 0 0 5px rgba(232,200,114,0.22), 0 10px 50px rgba(0,0,0,0.7)`. Padding and widths unchanged.
- Kicker gets an inline-SVG lantern icon (0.95em, `currentColor`). `h1` gets `text-shadow: 0 0 18px rgba(232,200,114,0.25)` and a rule beneath: 1 px gradient `transparent -> #9c8344 -> transparent` with a 6 px rotated-square gold diamond centred (`::after`).
- `#overlay`: `radial-gradient(ellipse at 50% 40%, rgba(40,28,20,0.85), rgba(4,4,8,0.97))`.
- Victory: border `#7fd18a` at 0.6 and inner ring `rgba(127,209,138,0.22)`; defeat: `#ef7a6a` equivalents.
- Objectives in cards and HUD use the SVG icons of 7.3.

### 7.2 Dialogue (`#dialogue`)

Add a 2.6 rem circular medallion at the left (inline SVG, faction plate shape: rhombus for rebels, circle for loyalists) showing the speaker's mark (bolt, scarf, flame, crown, sun, shield, book; narrator = bell). Text column unchanged; the card grows by the medallion width only within the existing `min(88%, 46rem)`.

### 7.3 HUD icons (`src/ui/icons.ts`, inline SVG strings, 1em, `currentColor`, `aria-hidden`)

- Objective rows: the existing 1.2 rem icon column shows the objective's icon (killEmperor crown, killElian sun, imprisonMira book, seizeBellTower bell, burnBridges flame) with a small status overlay (completed check `--ok`, failed cross `--bad`, pending ring `--gold-dim`). Row height unchanged.
- Clock row: after the era label, a bell track of three 0.9 em bells (filled `--gold` = rung, outline `--gold-dim` = pending) inline in the existing `.clock` flex row.
- Selected-unit `.token`: rebels clipped to a rhombus (`clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%)`, ring via `drop-shadow`), loyalists stay round, matching the board plates. Tile-info `.dot` likewise.
- Legend: swatches become mini SVG tokens (rhombus+ears vs circle+crest), rank silhouettes row, status badge icons replacing "x Dueling / o Sealed / v Drained".
- Speed control: `button.speed[data-cmd="speed"]` right-aligned in the clock panel's title row, `min-height: 1.6rem`, label `1x` / `2x` / `Instant` (with `aria-label="Animation speed"`), cycles on click and with the new key `S`. Reduced-motion override: a checkbox row in the legend panel.

## 8. Readability checklist

Reviewers check screenshots at 1280x720 (30 px tiles) and 1920x1080 (46 px), plus the smoke screenshots (`SMOKE_OUT=<dir> npm run smoke`).

1. Every wall reads as raised and impassable: cap + rim, and a face wherever its south neighbour is open. No passable tile has a cap, face or cast shadow, except low cover (pillars, rubble, tables, crates) drawn per 4.4, 4.5 and section 10, which is clearly lower than a wall.
2. Decor on passable floor is flat: luminance within 12 % of its floor, covering at most 35 % of the tile's centre area, no shadows. Quay steps read as passable steps down to the water, not as a wall.
3. Water (canal and reflecting pool), intact bridge and burned bridge are unambiguous at 30 px; the canal's surface band, ripples, reflection streaks and bank line are visible and the canal never merges with the walls.
4. Barred door (blocked), open door (passable, warm frame and leaf) and broken door (passable) are distinguishable at 30 px without hovering; an open door is easy to find.
4a. Blocking furniture reads as blocking: braziers (raised lit bowl) and the great bell are never mistaken for floor or cover; the closed portcullis reads as a solid grille and the open one as a raised grille, passable.
4b. Tables and crates read as low cover (an obstacle you can stand behind), distinct from walls and from rubble.
4c. Floor texture stays readable on every passable tile at Midnight, including the corridors, the servants' tunnel and the Princess's Tower (`floorCap`); there is no purple or coloured haze over interiors.
5. Faction is identifiable at 30 px **in greyscale** (desaturate the screenshot): rhombus plate + eared hood + zigzag hem vs ellipse plate + crest + straight hem.
6. Rank is identifiable at 46 px and guessable at 30 px: axe/spear, glowing blade, staff orb, cape + circlet + double rim.
7. All seven named characters are identifiable by their mark and initial tab.
8. Reach, target, hover outline and hover path are clearly visible on the darkest tile (tunnel), the brightest (lit feast hall, brazier plaza), on water-adjacent steps and inside every Domain. Domain fills never look like the blue move tiles.
9. The damage tooltip is fully visible and unobstructed; banners never overlap it while input is enabled.
10. Zone labels and object HP badges are at least 10 css px and never darkened.
11. HP bars and status badges are never covered by decor, lights, other units or Domain upper layers.
12. No unit is hidden by decoration: units draw above all decor; figure sprites stay inside their tile.
13. Unit night shade never exceeds 0.38: a unit in the darkest corner still shows its faction colour.
14. Dawn is visibly greyer than Midnight (same scene side by side), and the change starts with the bell, not before.
15. Escape exits (Mira's east exit, Elian's tunnel exit, wherever `state.map.exits` puts them) are visibly marked; reinforcement gates read as openings.
16. Spent units are clearly dimmer but keep their faction shape.
17. Effects leave no residue that implies state, except ash decals (alpha <= 0.25) and charred bridges (true state).
18. No horizontal or vertical page scroll at 1280x720 and 1920x1080 (smoke test passes).
19. Reduced motion: no shake, bob, flicker, drifting patterns or ambient particles.
20. Performance: Chrome performance panel at 1920x1080, dpr 1, 4x CPU throttle: idle frames <= 8 ms scripting+rendering; during Tempest + a burning bridge <= 12 ms. No frames rendered while the tab is hidden.

## 9. Implementation architecture

### 9.1 Modules

```
src/ui/
  renderer.ts     thin orchestrator: canvas, resize, hit-testing (tileAtClient, tileCenterCss), layer order, shake transform
  palette.ts      tokens (section 1) + COLORS aliases
  settings.ts     speed / reduced-motion store (SettingsStore, subscribe()), pure helpers: scaleStepDuration, applySpeed, effectLifeScale, shakeScale, particleCap, burstLimit, ambientAllowed, eraTransitionMs
  icons.ts        inline SVG strings for HUD, cards, dialogue
  gfx/
    types.ts      shared interfaces (below); frozen after WS0
    ease.ts       easing functions
    noise.ts      hash(x,y,salt), valueNoise1D/2D
    sites.ts      per-map analysis: material[][], outdoor[][], passable[][], light sites, reflection pairs, bridges, doors, stairs, exits, edges, gates (no coordinates)
    terrain.ts    static terrain cache (layer 1)
    materials.ts  floor painters per Material
    water.ts      canal and pool per-frame pass (layer 2)
    objects.ts    barred doors, anchors and portcullis gates (layer 3) + their lights
    lighting.ts   darkness/glow canvases, floor minimum, live desaturation, levelAt() (era state: renderer, 9.2)
    overlays.ts   highlights, path, hovered-zone outline, zone labels (text cache), object HP badges, Domain labels, hover
    figures.ts    sprite painters and cache
    units.ts      per-frame unit pass
    badges.ts     canvas status-badge painters
    particles.ts  particle pool
    fx.ts         step -> effects, effect drawing, floats, flashes, pulses, bell rings, shake, decals, banner
    domains.ts    Domain ground (layer 4) and upper (layer 11) visuals + lights
```

### 9.2 Interfaces (`gfx/types.ts`)

`src/ui/gfx/types.ts` is the frozen contract (WS0); its header lists who writes and reads every field. Summary:

- `Rgb`, `Era` (= `hudModel.BellEra`), `Speed`, `Motion { reduced, speed }`.
- `RenderInput` (controller -> renderer): the old fields plus `era` (display era) and `motion`. `effects` uses `Effect` from `gfx/fx.ts` (owned by WS4; re-exported from `renderer.ts`).
- `EraState { from, to, t }` and `EraLight { darkAlpha, floorCap, tint, moon, lamp, desat }` (rows in `palette.ERA_LIGHT`). The **renderer** tracks the transition when `input.era` changes (1500 ms `easeInOutSine`, 600 ms linear in reduced motion) and hands every pass `f.era` and the blended `f.env`; lighting does not own era state.
- `LightSource { kind, x, y, radius, intensity, color, flicker, seed, lamp, darken? }`: base values; lighting applies flicker and `env.lamp`.
- `UnitPose { dx, dy, flash, alpha, scale, tilt, clipFromFeet?, facing? }`, `IDENTITY_POSE`.
- `DisplayUnit { unit, ghost, pos, hp, selected }` and `DisplayDomain { domain, owner, center, tiles }`, built once per frame by the renderer.
- `MapSites` (section 3.2/3.3/4.1): grids `base`, `material`, `outdoor`, `passable`, `zone`, `corridor`; `zoneBoxes`; sites `lanterns`, `braziers`, `candles`, `bells`, `overheads`; frozen `staticLights`; `water`, `reflections`, `bridges`, `doors`, `stairs`, `exits`, `edges`, `gates`; `key` (stable for a battle: bridges count as built).
- `GfxFrame`: `ctx, T, dpr, px(), width, height, mapW, mapH, now, dt, motion, era, env, input, state, sites, units, domains, displayPos(), lights, poses, levelAt, shake`. One object reused per frame.
- Pass interfaces, one factory per module: `createTerrain(): TerrainPass { draw, drawSources }`, `createWater(): WaterPass { draw }`, `createObjects(): ObjectsPass { draw, collectLights, drawSources }`, `createLighting(): LightingPass { draw }` (sets `f.levelAt`), `createOverlays(): OverlaysPass { drawHighlights, drawZoneLabels, drawTopLabels, drawHover }`, `createUnits(): UnitsPass { collectLights, draw }`, `createFx(): FxPass { onStepStart, onStepEnd, computePoses, shakeOffset, drawDecals, collectLights, draw, drawBanner }`, `createDomains(): DomainsPass { drawGround, collectLights, drawUpper }`. All extend `GfxModule { reset(), clear() }`: `reset` drops size/map caches (resize, new map), `clear` forgets per-battle state (restart). No module-level mutable state.

The controller owns the display era (initialised from `bellEra(state)` at start/restart, switched in `onStart` of a `bellRang` step) and forwards step starts/ends to `Renderer.stepStarted/stepEnded` (-> `FxPass.onStepStart/onStepEnd` with `FxStepContext { state, overrides, now, motion }`). **No new `StepKind`s**; the event already carries what fx needs (`sourceId`, `cause`, positions); ranged vs melee is derived from display positions.

### 9.3 Renderer orchestration

```ts
draw(input) {
  const f = this.frame(input);   // sites (cached per map), era/env, units, domains, lights = staticLights, poses cleared, levelAt = 1
  clear(NIGHT.void);
  fx.computePoses(f); shake = fx.shakeOffset(f); translate(shake);          // layers 1-14 shaken
  terrain.draw(f); water.draw(f); objects.draw(f);                          // 1-3
  fx.drawDecals(f); domains.drawGround(f);                                  // 4
  objects.collectLights(f); units.collectLights(f); domains.collectLights(f); fx.collectLights(f);
  lighting.draw(f);                                                         // 5-6, sets f.levelAt
  objects.drawSources(f); terrain.drawSources(f);                           // 7
  overlays.drawHighlights(f); overlays.drawZoneLabels(f);                   // 8-9
  units.draw(f); domains.drawUpper(f);                                      // 10-11
  overlays.drawTopLabels(f); overlays.drawHover(f);                         // 12-13
  fx.draw(f);                                                               // 14
  untranslate(); fx.drawBanner(f);                                          // 15
}
```

After each pass the renderer resets `globalAlpha`, `globalCompositeOperation`, image smoothing and the line dash; passes restore their own transforms and clips.

### 9.4 Workstreams and file ownership (non-overlapping)

| WS | Scope | Owns (creates/edits) | Depends on |
|---|---|---|---|
| WS0 Foundation (first, small) | tokens, types, settings, sites, noise, ease; renderer skeleton that calls stub modules reproducing today's look (move existing code into the stubs); controller wiring for display era, motion, speed multiplier, visibility pause; `HudCallbacks.onSpeed` + `S` key stub | `palette.ts`, `settings.ts`, `gfx/types.ts`, `gfx/ease.ts`, `gfx/noise.ts`, `gfx/sites.ts`, `renderer.ts`, initial `controller.ts` and `hud.ts` callback lines, stub files for every module below | - |
| WS1 Terrain & objects | sections 4.1-4.8 (except 4.9) and 10, layer 1-3, layer 7 terrain sources | `gfx/terrain.ts`, `gfx/materials.ts`, `gfx/water.ts`, `gfx/objects.ts` | WS0 |
| WS2 Lighting & overlays | section 3 (incl. `floorCap`), 4.9, layer 5-6, 8-9, 12-13 | `gfx/lighting.ts`, `gfx/overlays.ts` | WS0 |
| WS3 Figures & units | section 5 | `gfx/figures.ts`, `gfx/units.ts`, `gfx/badges.ts` | WS0 |
| WS4 FX, Domains, animation | section 6, layer 4, 11, 14-15; speed/reduced-motion behaviour | `gfx/particles.ts`, `gfx/fx.ts`, `gfx/domains.ts`, `controller.ts` (after WS0), `animation.ts` (additive only) | WS0; reads `UnitPose` contract with WS3 |
| WS5 UI polish | section 7 | `styles.ts`, `cards.ts`, `hud.ts` (after WS0), `icons.ts`, `hudModel.ts` (additive only) | WS0 |

After WS1-WS5 an integrator (or WS0's agent) does one pass on `renderer.ts` only if a contract needs adjusting, then runs the checklist. New pure functions (settings scaling, sites, easing, figure cache keys) get new test files under `tests/ui/`; existing tests are not edited.

### 9.5 Hooks and contracts that must not change

- `window.__lantern` with `state`, `selection`, `started`, `locked`, `tileToClient(x, y)`.
- Selectors: `#begin-btn`, `#hud button.domain`, `#hud button[data-cmd="endTurn"]`, `#tooltip` (`style.display` block/none; text contains "dmg"), `#again-btn`, `#overlay` (`display: flex` while a card shows), `#game`, `#hud`, `#tileinfo`, `#dialogue`.
- Keys: Tab / Shift+Tab, Esc, E, W (S is new).
- `AnimationQueue`, `stepForEvent(e, speed)`, `stepsForEvents`, `TIMING`, `DisplayOverrides`, `addPendingOverrides`, `onStepStart`, `onStepEnd` keep their signatures and semantics; `locked` is true until the queue drains.
- `Renderer.resize`, `tileAtClient`, `tileCenterCss`, `tile`, `dpr`, `cssWidth`.
- Smoke flow (`scripts/smoke.mjs`) passes unchanged with no console errors.

### 9.6 Frame loop and performance rules

- `controller.frame`: skip `renderer.draw` when `document.hidden`; on `visibilitychange` to visible, reset `lastFrame` so `dt` does not spike; ambient particle emitters pause while hidden.
- Static caches: terrain (layer 1), outdoor mask, light stamps, figure sprites, zone-label text widths. All keyed by `T` and evicted on resize.
- Per frame budget at 46 px: <= 1 terrain blit, <= 40 water tiles, <= 64 light stamps at 256x176, 2 lightmap blits, <= 40 units x 3 `drawImage`, <= 192 particles, <= 20 text draws.
- No allocation in the hot path: reuse arrays for lights and poses; particles in typed arrays.

## 10. Map additions

All eight geometry proposals were accepted; a separate geometry pass places them in `src/content` (exact tiles are its call). Renderers find them **by terrain type, object kind and zone** (`gfx/sites.ts`), never by coordinates, and must look right wherever they land. Tile stats come from `TERRAIN` in `src/engine/data.ts`.

| Addition | Data | Stats | Drawn as |
|---|---|---|---|
| Banquet tables (Feast Hall) | terrain `table` | low cover, move 2, DEF +1 | Solid dark-wood **table tops** seen from above: top `0.84T x 0.62T` in `TABLE.top` set slightly north (`y 0.14..0.76T`), a 1 px `TABLE.topEdge` lit north/west edge, a short front edge `0.10T` in `TABLE.front` on the south side of the run and a `0.08T` shadow below it. Adjacent table tiles merge into one long table (no seams, edges only on the run's outline). A red runner `TABLE.runner` `0.18T` wide along the table's long axis; on each tile 2 plates (`r 0.07T`, `#d8cfbd` rim), a goblet dot (`#c9a24a`) and, where a candle light site exists (3.2), a candle (`0.04T x 0.10T` white with a `LIGHT.flameCore` tip redrawn in layer 7). Reads as an obstacle you can stand behind, clearly lower than walls (like rubble's low-cover language): no cap, no brick face. |
| Quay crates | terrain `crates` | low cover, as rubble (move 2, DEF +1) | Two or three **stacked intact crates** per tile (`0.34T` and `0.28T` squares, `CRATE.wood`, `CRATE.dark` outline and diagonal brace, `CRATE.band` corner bands), lit top-left, `0.08T` shadow to the south-east, placed toward the tile's back corners by hash so a unit standing there reads as behind cover. Never broken pieces (that is rubble). |
| Quay steps | terrain `stairs` | passable like floor (move 1, DEF 0) | Flat stone **steps descending toward the adjacent water** (direction = `MapSites.stairs[].dir`, south for the north bank): 4 treads per tile in `STAIR.tread`, each tread slightly darker toward the water, a 1 px `STAIR.riser` line between treads and a 1 px `STAIR.nosing` highlight on each tread's upper edge. The lowest tread meets the water with the bank line (4.6), no kerb face. No cast shadow and no face that implies a wall. |
| Braziers (inner-gate piers) | terrain `brazier` | impassable | A **raised iron bowl on three legs**: legs `BRAZIER.legs`, bowl ellipse `0.62T x 0.24T` in `BRAZIER.iron` with a `BRAZIER.rim` rim at `y 0.30T`, glowing coals `BRAZIER.coal` inside, a stone plinth `0.70T` square under it, shadow `0.10T`. Layer 7 draws three layered flame tongues (`#ff5a1f`, `#ffb347`, `#ffe2a0`) rising `0.30-0.45T` with flicker; it is a light source (3.2). It must read as blocking (raised and lit), not as floor. |
| Great bell (Bell Tower) | terrain `bell` | impassable | A **bronze bell seen from above**: concentric circles (outer lip `r 0.40T` `BELL.dark`, body `r 0.34T` `BELL.bronze`, crown `r 0.14T` `BELL.hi`, a highlight arc top-left), a timber yoke bar across it (`DOOR.woodDark`, `0.12T`), and a **rope** (`BELL.rope`, 2 px) hanging from the yoke to a coil on the nearest floor tile. A soft warm light (3.2) so it stands out in the dark tower. |
| Reflecting pool (Wellspring Hall) | `water` tiles inside the `wellspringHall` zone (material `pool`) | as water (impassable) | Not the canal style: a **tiled reflecting pool** with a raised stone rim `0.10T` (`POOL.rim`, top highlight `POOL.rimTop`) on every edge that meets floor, a basin of small square tiles (`POOL.deep` grout grid every `T/3` under `POOL.water`), calm surface (no ripples; a slow `0.15` alpha shimmer band crossing every 4 s, static in reduced motion) and a faint rune glow (`POOL.rune` ring or ticks along the inner rim, pulsing `0.7..1.0` over 3 s). Reflects nearby lights like the canal but at half strength. |
| Wider canal | 2 rows of `water`; bridges become multi-tile `bridge` objects | as before | 4.6: one bright surface band across both rows, kerb on the north bank, bank line on both banks; each bridge drawn as one continuous deck over all its tiles. Rows may shift; nothing assumes a row number. |
| Outer-gate portcullis | object `gate` (`tiles`, `wave`, `open`); display override `closedGates` | closed: blocks movement | **Closed** (`!open`, or its id is in `overrides.closedGates`): an iron grille across every gate tile: 5 vertical bars `0.08T` (`GATE.iron`, 1 px `GATE.ironHi` left edge), 3 horizontal bars, spiked bottom points, a `0.10T` shadow on the outward side; reads as blocking at 30 px. **Rising**: while the `arrive` step of its `wave` plays, the grille slides up out of the tile over p 0-0.5 (`easeOutCubic`), clipped at the top of the gap. **Open**: only the raised grille's bottom edge (`0.14T` of bars and spikes) at the top of each gate tile plus its shadow; the passage is clearly free. |

## 11. Prototype shortcuts (do not copy)

The `WIP mock prototype` commit exists to prove the look. Implement from this document; in particular:

- `src/ui/proto.ts` is one file mixing terrain, lighting, figures and badges; follow 9.1 instead.
- Light stamps call `createRadialGradient` per light per frame; use cached stamp sprites (3.1). `levelAt` loops over all lights per unit; memoise per tile per frame.
- Era comes from `bellEra(state)` (jumps before the bell plays) plus a `?era=` URL hack; Dawn desaturation is a full-screen pass every frame. Use the display era and bake (3.4).
- Coordinates for braziers, overheads, banners, shelves, carpet, cloths and the bell are hard-coded inline; derive every site in `sites.ts` from terrain and zones (3.2).
- `figureCache` is a module global that is never evicted on resize; no `spent` sprite variant (spent units only use alpha).
- Domains still use the old ground code and alpha (conflicts with the reach colour), and are drawn under the darkness at the old strength.
- No fx, particles, shake, facing updates, HP ghost, bell swing, speed setting or reduced-motion handling beyond static flicker/bob; death and remove still use the old fade.
- Escape-exit chevrons and zone outlines were dropped in the prototype; 4.8 and 4.9 restore them in the new style.
- Water reflection pairs are recomputed by scanning every row per light per frame.
- `scripts/mock-shot.mjs` is a throwaway screenshot helper.
