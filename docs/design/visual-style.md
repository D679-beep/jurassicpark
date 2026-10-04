# Visual Style: Night of Ashen Lanterns

Status: v1.0 art direction for the prologue map, graphics and animation overhaul. Binding for implementers. Companion to `docs/design/prologue-map.md` (geometry, zones) and `docs/design/prologue-slice.md` (rules).

Reference mock: the `art-direction` branch, commit "WIP mock prototype" (`src/ui/proto.ts`, screenshots `mock-1920.png`, `mock-1280.png`, `mock-closeup.png`, `mock-1920-dawn.png`). The prototype proves the look; **this document, not the prototype code, is the contract** (see section 11 for its shortcuts).

## 0. Non-negotiables

1. **Gameplay is untouched.** No changes to `src/engine`, `src/ai`, `src/content`, rules, map geometry, unit positions or existing tests. The UI reads `GameState` and `GameEvent`s only.
2. **Readability beats mood.** Highlights, units, HP, status, labels and the damage tooltip are always drawn *above* the darkness layer (section 2).
3. **Decor never invents geometry.** Anything on a passable tile is flat, low-contrast and casts no shadow. Anything that looks raised (cap, face, shadow) is a wall, a closed barred door, or passable cover (pillar, rubble) drawn by the rules in section 4.
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
| `NIGHT.tint` | `rgb(5,9,24)` | darkness colour at Midnight |
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
| `MAT.feastCloth` | `rgba(120,32,44,0.30)` | spilled goblets `rgba(201,162,74,0.35)` / plates `rgba(220,210,190,0.18)` |
| `MAT.slab` | `#2c2b34` / `#292830` | antechamber, corridors; joint `rgba(0,0,0,0.32)` |
| `MAT.runner` | `rgba(32,40,70,0.55)` | corridor runner, trim `rgba(201,162,74,0.22)` |
| `MAT.flag` | `#2d3443` / `#283040` | quay flagstones, moon edge `rgba(180,200,255,0.035)` |
| `MAT.cobble` | `#2b303b` / `#333946`, gap `#181b22` | courts, streets, inner-gate plaza |
| `MAT.well` | `#1c2b33` / `#22343d` | Wellspring tiles, rune `rgba(120,225,255,0.26)` |
| `MAT.tunnel` | `#232027` / `#1e1c22` | damp `rgba(40,70,80,0.22)` |
| `MAT.parquet` | `#30283a` / `#2a2333` | Princess's Tower, rug `rgba(60,44,100,0.45)` |
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
| `WATER.deep` / `mid` | `#081626` / `#0f2a44` |
| `WATER.ripple` | `rgba(120,170,225,0.22)` |
| `WATER.kerb` / `kerbFace` | `#2a2f3b` / `#171a22` |
| `BRIDGE.wood` / `dark` / `rail` | `#6d4a2b` / `#3b2614` / `#8a6238` |
| `BRIDGE.charred` | `#1a110a`, ember `#ff7a2e` |
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
| 1 | Terrain | C | floors per material, flat decor, contact shadows, pillars, rubble, open doors, bridge decks, burned-bridge remains, 2.5D walls, wall decor (banners, shelves, bell, throne back), lantern fixtures, map-edge openings, escape-exit thresholds. Key: `T`, terrain, unburned-bridge overrides, era-desaturation flag (3.6). |
| 2 | Canal | F | ripples, lantern and moon reflections on water tiles only |
| 3 | Objects | F | barred doors and ward anchors (intact/damaged/broken) |
| 4 | Ground FX | F | ash decals, Domain ground fill + ground patterns, scorch on burned bridges |
| 5 | Darkness | F | low-res darkness canvas upscaled, `source-over` |
| 6 | Light glow | F | low-res glow canvas upscaled, `screen` |
| 7 | Light sources | F | lantern flame pixels, brazier fire, anchor crystal core sparkle: bright, small, above darkness so sources read as sources |
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
  1. `dark`: clear; fill `rgba(tint, darkAlpha)`; add the vignette (radial gradient, inner radius `0.45*min(W,H)` transparent, outer `0.72*max(W,H)` `rgba(0,0,0,0.28)`); then `globalCompositeOperation='destination-out'`: draw the softened outdoor mask at `globalAlpha = moon`, then every light as a radial stamp (alpha stops `k` at 0, `0.7k` at 0.45, 0 at 1).
  2. `glow`: clear; draw the outdoor mask at `globalAlpha = 0.16*moon/0.36` (cold sheen); then `lighter`: every light as a coloured radial stamp (alpha `0.34k` at 0, `0.10k` at 0.5, 0 at 0.9r; overhead lights `0.16k` / `0.05k`).
  3. On the main canvas, `imageSmoothingEnabled = true`, quality `high`: `drawImage(dark, 0,0, mapW*T, mapH*T)` with `source-over`, then `drawImage(glow, ...)` with `screen`. Restore smoothing to `false`.
- Light stamps are **pre-rendered sprites** (white radial gradient 64x64 for `dark`, per-colour 64x64 for `glow`), drawn scaled with `globalAlpha = k`. Do not call `createRadialGradient` per light per frame.
- Outdoor mask: built once per map at 8 px/tile, then softened by drawing 9 copies offset by +-2 px at alpha 1/9 (no `ctx.filter`, Safari-safe).

### 3.2 Light sources

| Kind | Where (from `gfx/sites.ts`) | Pos in tile | Radius (tiles) | Intensity k | Colour | Flicker amp |
|---|---|---|---|---|---|---|
| Wall lantern | wall tiles whose south neighbour is floor/pillar/rubble/throne (never door or water), `hash(x,y,99) < 0.17` | `(x+0.5, y+0.85)` | 2.7 | 0.85 | `LIGHT.lantern` | 0.10 |
| Brazier | inner-gate piers `(12,16) (19,16) (12,20) (19,20)` | `(x+0.5, y+0.12)` | 3.4 | 0.95 | `LIGHT.brazier` | 0.16 |
| Overhead (no fixture) | `(4.5,3.0,r3.2) (4.5,6.2,r2.6) (16,3.6,r3.4) (26.5,3.8,r3.4) (3.5,19,r2.2) (5,10.9,r2.4)` | as listed | listed | 0.50 | `LIGHT.overhead` | 0.05 |
| Ward anchor | each intact anchor | `(x+0.5, y+0.45)` | 2.0 | 0.70, pulse x(0.85+0.15 sin(t/520)) | `LIGHT.ward` | 0.12 |
| Seal | each `sealed` unit | tile centre | 1.8 | 0.60 | `LIGHT.seal` | 0.06 |
| Radiant orb | each Radiant | `(x+0.3, y+0.3)` | 1.1 | 0.35 | faction accent | 0.04 |
| Domain | owner (display pos) | tile centre | 4.0 | 0.60 | domain light | pyre 0.15, else 0.04 |
| Burning bridge | burned bridge tiles, 6 s after burn, then embers | tile centre | 2.6 then 1.2 | 0.90 then 0.30 | `rgb(255,120,50)` | 0.25 |
| FX flash | lightning, impacts, anchor shatter, bell | event pos | 1.5-2.5 | transient, eased to 0 | per effect | 0 |

Site lists that name coordinates are a **per-scenario table** in `sites.ts` keyed by `scenarioId === 'prologue'`; other maps fall back to the hashed lanterns only.

Flicker (per light, `t` in seconds, `s` = seed from `hash`): `f = 1 + amp * (0.6 sin(2pi*1.7t + 40s) + 0.4 sin(2pi*4.3t + 90s))`; intensity `k*f`, radius `r*(1 + 0.3(f-1))`. Reduced motion: `f = 1`.

### 3.3 Moonlight

Outdoor tiles (`sites.outdoor`): zones `quay`, `innerGate`, `eastCourt`; every non-zone passable tile with `y >= 15` (south streets); the exit tile `(31,12)`; all water and bridge tiles. Never `bellTower`. Moon carves `moon` alpha from the darkness and adds the cold sheen. Interiors get no moon, only lanterns and overheads: rooms should feel like pools of warm light in dark stone, the outside like cold blue open ground.

### 3.4 Global light states

| Era | darkAlpha | tint rgb | moon | lamp x | world desaturation |
|---|---|---|---|---|---|
| Midnight | 0.68 | 5,9,24 | 0.36 | 1.00 | 0 |
| First Bell | 0.64 | 6,10,26 | 0.36 | 1.00 | 0 |
| Second Bell | 0.58 | 12,14,30 | 0.34 | 0.95 | 0 |
| Dawn | 0.30 | 60,66,80 (grey) | 0.10 | 0.55 (lanterns gutter) | 0.45 |

`lamp` multiplies lantern, brazier and overhead lights only (wards, seals, Domains, fire keep full strength). Desaturation: `globalCompositeOperation='saturation'`, fill `#808080` at the listed alpha over layers 1-4.

**Transitions:** the display era is set when the `bellRang` step *starts* (not from `state`, which is already ahead). All parameters lerp over `TIMING.bell` (1500 ms) with `easeInOutSine`; desaturation is a live full-screen pass during the transition, then baked into the terrain cache (cache key includes the era flag). Reduced motion: 600 ms linear crossfade.

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
| `wellspringHall` | well | 3x3 ceramic tiles per tile, random A/B, 1 px dark grout |
| `feastHall` | plank | 4 horizontal planks per tile, staggered butt joints `((x*7+j*3)%4)/4` |
| `princessTower` | parquet | 2x2 herringbone-like blocks, 2 grain lines per block |
| `bellTower` | boards | 4 vertical boards |
| `innerGate` | cobble (plaza variant) | 2x2 square setts |
| `servantsTunnel` | tunnel | rough stone, damp ellipse on 35 % of tiles |
| `eastCourt`, non-zone `y>=15`, `(31,12)` | cobble | 3x3 rounded cobbles, alternate rows offset half a stone |
| `quay` | flag | large flags with half-tile offset joints, cold top sheen |
| `antechamber`, other non-zone interior floor | slab | slab with 1 px joints |

### 4.2 Walls (2.5D, contained in their own tile)

- **Never overhang a floor tile.** A wall tile whose south neighbour is not a wall shows a *cap* (top `0.56T`) and a *front face* (bottom `0.44T`) inside its own tile; other wall tiles are full cap.
- Cap: `WALL.cap`, faint block joints (`rgba(255,255,255,0.035)` at half-tile, staggered by row) so large wall masses read as stone, not void. Rim light `WALL.capRim`, `max(1, round(T/22))` px, on cap edges whose neighbour (N, W, E) is not a wall.
- Face: gradient `WALL.faceTop` -> `WALL.face`, two brick courses (1 px `rgba(0,0,0,0.45)` mortar, joints every `T/2`, alternate courses offset `T/4`), `WALL.faceHighlight` 1 px at the cap/face seam.
- Contact shadow on the floor tile *below* a wall: linear gradient `rgba(0,0,0,0.60)` -> 0 over `0.42T`. Side occlusion on floor tiles with a wall to the W/E: `rgba(0,0,0,0.38)` -> 0 over `0.20T`.
- Lantern fixture on a face: bracket `0.04T x 0.10T` `#2a2018`, housing `0.18T x 0.20T` `#3a2a18`, glass `0.12T x 0.14T` `LIGHT.flameBody`, core `0.06T x 0.08T` `LIGHT.flameCore`, centred at `(x+0.5, y+0.67)`. Layer 7 redraws the core with alpha flicker `0.8 + 0.2 sin(now/90 + 50s)`.

### 4.3 Rooms

| Room | Decoration (all flat; contrast limits in checklist 2) |
|---|---|
| Throne Hall | Red carpet runner x 15..16 (inset `0.12T` each side), y 3..6, gold trim line inset `0.2T`. Dais/throne tiles: `carpetDark` with `carpet` inset `0.06T`, gold lozenge `rgba(201,162,74,0.22)`, and a **step face** `0.13T` (`#6e5a3a`, gold 1 px top) on dais tiles whose south neighbour is not dais, plus `0.10T` shadow on the floor below (dais is +1 DEF, so "a low step" is honest). Throne back drawn **on the wall tiles** `(15,0)-(16,0)`: `#7a1f2c` panel `0.76T` wide with gold border and a gold point; nothing on `(15,1)/(16,1)` beyond the dais (they are Confront tiles). |
| Feast Hall | Wood planks. "Long tables" are **not drawn as tables**: two banquet cloths dragged to the floor, rows y 2 and y 6, x 2..7, `0.44T` high, `MAT.feastCloth`, 9 spilled goblets/plates per cloth (`r = 0.05T` dots). No legs, no top face, no shadow. Reads as the aftermath of an overturned feast. |
| Antechamber | Slab. Loyalist banners on the **wall faces** of row 6 at x 11, 13, 18, 20: `#6a1f2a` swallow-tail `0.36T x 0.50T` starting `0.12T` above the face, gold sun disc `r 0.07T`. |
| Wellspring Hall | Ceramic tiles. Rune ring inlay: two ellipses centred `(16, 10.5)` radii `(1.35T*1.6, 1.35T*0.85)` and `(1.6T*1.6, 1.6T*0.85)`, `MAT.well rune`, 16 rune ticks `0.08T x 0.12T` on the mid ellipse. Rite dais `(15,10) (16,10)`: flat glowing font inlay `#16323c`, inner square stroke `rgba(140,230,255,0.45)`. **No pool or water on the floor** (it would read as impassable). |
| Bell Tower | Boards. Bronze bell (`#9c7a3c`, highlight `#d9b46a`, `0.48T` wide) on the **wall face** of `(3,17)`. Faint rope coil `rgba(190,160,110,0.45)` `r 0.16T` at `(3.5,18.45)`. |
| Princess's Tower | Parquet, violet rug `rgba(60,44,100,0.45)` x 24.3..29.7, y 1.3..2.7. Bookshelves on the north wall faces x 24..29 (6 spines `0.10T x 0.30T` in `#5a2d3a #2d4a5a #5a4a2d #3a2d5a`). |
| Servants' tunnel | Tunnel stone, damp patches, no moon, lit only by its lantern(s) and the overhead at `(5,10.9)`. |
| Corridors (x 10, x 21) | Slab with a blue runner `0.56T` wide on floor tiles y 1..12. |
| Quay | Flags, moonlit. Retaining wall: water tiles whose north neighbour is open get a kerb face `0.16T` `WATER.kerbFace` + 1 px `rgba(160,180,220,0.18)` lip + `0.08T` shadow. Water tiles with open ground south get a `0.06T` `WATER.kerb` lip. |
| Courts / streets / plaza | Cobbles, moonlit. Braziers on the four inner-gate piers (4.5). |

### 4.4 Rubble = honest low cover

Rubble is passable at cost 2, +1 DEF. Outdoors it is drawn as **broken crates and a barrel** (crates `0.30T` and `0.26T`, `#5a4128` with `#2e2014` outline and diagonal plank, barrel `r 0.10T` `#4a3a2a`) placed in the tile's corners (`(0.25,0.27)`, `(0.74,0.70)`, `(0.74,0.26)`), plus 5 stones `0.06-0.14T` with `0.4` alpha drop shadows. Indoors only the stones. The centre of the tile stays free for the unit.

### 4.5 Pillars = passable cover at the back of the tile

Pillars are passable (cost 2, +2 DEF). The column stands at the **back (north) half** of its tile so a unit on it is drawn in front of it, "in cover": shaft x `0.5T +- 0.20T`, y `0.10T..0.50T`, 3 flutes, left-lit gradient; plinth `0.56T x 0.10T` at `0.46T`; capital `0.54T x 0.09T` at `0.05T`; shadow ellipse `(+0.10T, +0.06T)`, radii `0.30T x 0.11T`. Inner-gate piers carry a brazier bowl (`r 0.20T x 0.08T`, `#2a1f18`) on the capital with three layered flame tongues (layer 7).

### 4.6 Canal and bridges

- Base (cached): vertical gradient `deep -> mid -> deep` per water tile, kerbs per 4.3.
- Ripples (layer 2): per water tile, 2 wavelets at `y = 0.38T, 0.64T`, length `(0.35 + 0.3h)T`, drift `x = ((now/2600 + h) mod 1) * T`, alpha `0.35 + 0.5*(0.5+0.5 sin(now/700 + 6.28h))` of `WATER.ripple`, `T/30` px. Reduced motion: drawn once into the cache.
- Reflections (layer 2, `lighter`): for each lantern/brazier within 3.2 rows of a water tile in its column, 5 stacked streaks per water tile at `0.18T + i*0.16T`, width `(0.30 - 0.03i)T * (0.7 + 0.3 sin(now/240 + 1.7i + 9s))`, alpha `(0.55 - 0.07i) * (1 - dy/4)`, colour = light colour, x jitter `0.04T sin(now/300 + i)`. Precompute the (light, water tile) pairs per map.
- Bridge (cached): drop shadow on water `rgba(0,0,0,0.45)`, deck `0.80T` wide, 5 plank seams, rails `0.09T` at both sides, 4 posts `0.13T`. Burned: charred stumps `BRIDGE.charred` + 2 ember pixels pulsing (layer 4) for the rest of the battle.

### 4.7 Doors and objects

| Object | Intact | Damaged (`hp < 50 %`) | Broken / destroyed |
|---|---|---|---|
| Ordinary door (terrain `door`, no object): **passable** | Architect's-plan symbol, oriented to the passage: jamb stubs `0.10T` (`WALL.cap` + rim), threshold `0.08T` `rgba(120,112,135,0.55)`, two leaves (`0.07T` thick) swung open against the jambs, dashed swing arcs `rgba(232,200,114,0.28)`. Floor stays visible. | n/a | n/a |
| Barred door (object): **impassable** | Full-tile closed leaves `0.92T x 0.80T` with plank lines, two iron bands, a heavy crossbar `0.14T` with iron ends, stone jambs `0.10T` in `WALL.cap` top and bottom (reads as part of the wall). HP badge above darkness. | crossbar rotated `-0.18 rad`, two dark cracks, bands kept | threshold strip, four splinters (`DOOR.woodDark`) against the jambs; floor visible; no HP badge |
| Ward anchor | floating crystal (diamond `0.30T x 0.44T`, gradient `ANCHOR.hi -> lo`, edge `ANCHOR.edge`) bobbing `0.03T` (period 3.3 s), small shadow, rune ellipse on the floor `0.34T x 0.13T`, light per 3.2 | crack line through the crystal, light flicker 0.25 | rune ellipse dim `rgba(90,100,140,0.35)`, three dull shards `ANCHOR.dead`, no light |
| Bridge | 4.6 | n/a | 4.6 charred |

### 4.8 Exits and gates

- All map-edge openings fade to black over `1.2T` toward the edge (west gate y 13-14, tunnel y 10-11, east `(31,12)`, south gap x 22..25).
- **Escape exits** (`state.map.exits`): threshold glow `STATUS.escapee` at 0.25 on the tile, three chevrons pointing off-map (`0.22T`, alpha cycling 0.25 -> 0.8, 1200 ms stagger 150 ms; static in reduced motion), and a small escapee badge at the inner edge. Must be visible at 30 px.
- Reinforcement gates (west gate tiles, south gap) are not exits: no chevrons; they light up only during `arrive` (6.3).

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
| Status badges | top-right, right-to-left in the order sealed, dueling, drained, escapee (escapee only while not sealed). Circle `r = max(5.5 css px, 0.14T)`, fill `rgba(8,8,14,0.88)`, ring `r/5` px in the status colour. Icons: dueling = **crossed swords**; sealed = **padlock** plus a dashed ellipse `0.42T x 0.17T` around the feet, dash `T/10, T/14`, offset `-now/60`; drained = **cracked drop**; escapee = **arrow out**. The old red X is removed. |
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
| `banner` (`bellRang`) | 1500 ms | Bell sprite on `(3,17)` swings `+-18 deg` damped (period 500 ms, decay 600 ms); 3 gold rings `rgba(232,200,114,0.6 -> 0)` from the bell at 0/300/600 ms, each to `12T` radius over 1200 ms (`easeOutCubic`), line `0.12T -> 0.02T`; global light transition 3.4 starts. Banner card as today. |
| `banner` (others) | as today | Banner card restyled (7.1). |
| `arrive` (`reinforcementsArrived`) | 850 ms | Each unit, staggered 60 ms: slides in `0.8T` from the nearest map edge (west for the Watch, south for Lantern/Legion), alpha `0 -> 1` over p 0-0.6 (`easeOutCubic`); a warm lantern flare (light r 2.0, k 0.8 -> 0 over 850 ms) at the gate; 3 dust particles per unit. Existing flash/pulse effects are replaced by this. |
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

1. Every wall reads as raised and impassable: cap + rim, and a face wherever its south neighbour is open. No passable tile has a cap, face or cast shadow, except pillars and rubble drawn per 4.4/4.5.
2. Decor on passable tiles is flat: luminance within 12 % of its floor, covering at most 35 % of the tile's centre area, no shadows. Banquet cloths do not read as tables; the Wellspring floor has no water.
3. Water, intact bridge and burned bridge are unambiguous at 30 px.
4. Barred door (blocked), open door (passable) and broken door (passable) are distinguishable at 30 px without hovering.
5. Faction is identifiable at 30 px **in greyscale** (desaturate the screenshot): rhombus plate + eared hood + zigzag hem vs ellipse plate + crest + straight hem.
6. Rank is identifiable at 46 px and guessable at 30 px: axe/spear, glowing blade, staff orb, cape + circlet + double rim.
7. All seven named characters are identifiable by their mark and initial tab.
8. Reach, target, hover outline and hover path are clearly visible on the darkest tile (tunnel), the brightest (lit feast hall, brazier plaza) and inside every Domain. Domain fills never look like reach tiles.
9. The damage tooltip is fully visible and unobstructed; banners never overlap it while input is enabled.
10. Zone labels and object HP badges are at least 10 css px and never darkened.
11. HP bars and status badges are never covered by decor, lights, other units or Domain upper layers.
12. No unit is hidden by decoration: units draw above all decor; figure sprites stay inside their tile.
13. Unit night shade never exceeds 0.38: a unit in the darkest corner still shows its faction colour.
14. Dawn is visibly greyer than Midnight (same scene side by side), and the change starts with the bell, not before.
15. Escape exits (Mira `(31,12)`, Elian `(0,10..11)`) are visibly marked; reinforcement gates read as openings.
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
  settings.ts     speed / reduced-motion store, speedFactor(kind, setting), subscribe()
  icons.ts        inline SVG strings for HUD, cards, dialogue
  gfx/
    types.ts      shared interfaces (below); frozen after WS0
    ease.ts       easing functions
    noise.ts      hash(x,y,salt), valueNoise1D/2D
    sites.ts      per-map analysis: material[][], outdoor[][], lantern/brazier/overhead sites, reflection pairs, exits; scenario table
    terrain.ts    static terrain cache (layer 1)
    materials.ts  floor painters per Material
    water.ts      canal per-frame pass (layer 2)
    objects.ts    barred doors and anchors (layer 3) + their lights
    lighting.ts   darkness/glow canvases, era state + transitions, levelAt()
    overlays.ts   highlights, path, hovered-zone outline, zone labels (text cache), object HP badges, Domain labels, hover
    figures.ts    sprite painters and cache
    units.ts      per-frame unit pass
    badges.ts     canvas status-badge painters
    particles.ts  particle pool
    fx.ts         step -> effects, effect drawing, floats, flashes, pulses, bell rings, shake, decals, banner
    domains.ts    Domain ground (layer 4) and upper (layer 11) visuals + lights
```

### 9.2 Interfaces (`gfx/types.ts`)

```ts
export type Rgb = readonly [number, number, number];
export type Era = 'Midnight' | 'First Bell' | 'Second Bell' | 'Dawn'; // = hudModel.BellEra
export interface Motion { reduced: boolean; speed: '1x' | '2x' | 'instant' }

export interface LightSource {
  x: number; y: number;          // tile units, fractional
  radius: number;                // tiles
  intensity: number;             // 0..1
  color: Rgb;
  flicker: number;               // amplitude, 0 = steady
  seed: number;                  // 0..1
  lamp: boolean;                 // scaled by the era's lamp factor
  darken?: boolean;              // Silence: adds darkness instead
}

export interface UnitPose {      // written by fx before units draw; identity = {0,0,0,1,1,0}
  dx: number; dy: number;        // tile units
  flash: number;                 // 0..1 white overlay
  alpha: number; scale: number; tilt: number; // radians
  clipFromFeet?: number;         // 0..1 dissolve
  facing?: 1 | -1;
}

export interface GfxFrame {
  ctx: CanvasRenderingContext2D;
  T: number; dpr: number; px(css: number): number;
  now: number; dt: number;
  motion: Motion;
  era: { from: Era; to: Era; t: number }; // t 0..1 transition progress
  input: RenderInput;            // from renderer.ts, extended below
  sites: MapSites;               // cached per map by sites.ts
  displayPos(u: Unit): Pos;      // existing logic (pending moves, lerpPath)
  lights: LightSource[];         // static sites + pushed by objects/domains/units/fx before lighting draws
  poses: Map<string, UnitPose>;
}
```

`RenderInput` gains `era: Era` (display era) and `motion: Motion`. The controller owns the display era: initialised from `bellEra(state)` at start/restart, updated in `onStart` of a step whose event is `bellRang`. `Effect` moves to `gfx/fx.ts` (re-exported from `renderer.ts` until the controller import is updated). **No new `StepKind`s**; the event already carries what fx needs (`sourceId`, `cause`, positions); ranged vs melee is derived from display positions.

### 9.3 Renderer orchestration

```ts
draw(input) {
  const f = this.frame(input);               // builds GfxFrame, sites, static lights
  clear(f); this.shake.begin(f);
  terrain.draw(f); water.draw(f); objects.draw(f);
  fx.drawDecals(f); domains.drawGround(f);
  units.collectLights(f); fx.collectLights(f);
  lighting.draw(f);
  objects.drawSources(f); terrainSources.draw(f); // lantern cores, braziers (layer 7; in terrain.ts)
  overlays.drawHighlights(f); overlays.drawZoneLabels(f);
  fx.computePoses(f); units.draw(f);
  domains.drawUpper(f); overlays.drawTopLabels(f); overlays.drawHover(f);
  fx.draw(f); this.shake.end(f); fx.drawBanner(f);
}
```

### 9.4 Workstreams and file ownership (non-overlapping)

| WS | Scope | Owns (creates/edits) | Depends on |
|---|---|---|---|
| WS0 Foundation (first, small) | tokens, types, settings, sites, noise, ease; renderer skeleton that calls stub modules reproducing today's look (move existing code into the stubs); controller wiring for display era, motion, speed multiplier, visibility pause; `HudCallbacks.onSpeed` + `S` key stub | `palette.ts`, `settings.ts`, `gfx/types.ts`, `gfx/ease.ts`, `gfx/noise.ts`, `gfx/sites.ts`, `renderer.ts`, initial `controller.ts` and `hud.ts` callback lines, stub files for every module below | - |
| WS1 Terrain & objects | sections 4.1-4.8 (except 4.9), layer 1-3, layer 7 terrain sources | `gfx/terrain.ts`, `gfx/materials.ts`, `gfx/water.ts`, `gfx/objects.ts` | WS0 |
| WS2 Lighting & overlays | section 3, 4.9, layer 5-6, 8-9, 12-13 | `gfx/lighting.ts`, `gfx/overlays.ts` | WS0 |
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

## 10. Ideas that would need a geometry change (proposals only, not part of this work)

1. Real banquet tables in the Feast Hall as impassable or cover terrain (would change Orsa's and Grimm's duel space).
2. A shallow reflecting pool in the Wellspring Hall (water tiles) around the rite dais; would also block anchor routes.
3. Crates and carts on the quay as dedicated cover terrain instead of reusing rubble positions.
4. A bell tile (impassable) in the middle of the Bell Tower, with the rope as an interactable.
5. A portcullis object in the outer gate gap (x 22..25, y 21) that opens on Second Bell, giving the arrival a physical gate.
6. Braziers as blocking objects in the inner-gate plaza (currently they sit on the passable pillar piers).
7. Quay steps down to the canal (a row of `stairs` terrain) so the north bank reads as a real terrace.
8. A wider (2-tile) canal so reflections and burning bridges have room to read.

## 11. Prototype shortcuts (do not copy)

The `WIP mock prototype` commit exists to prove the look. Implement from this document; in particular:

- `src/ui/proto.ts` is one file mixing terrain, lighting, figures and badges; follow 9.1 instead.
- Light stamps call `createRadialGradient` per light per frame; use cached stamp sprites (3.1). `levelAt` loops over all lights per unit; memoise per tile per frame.
- Era comes from `bellEra(state)` (jumps before the bell plays) plus a `?era=` URL hack; Dawn desaturation is a full-screen pass every frame. Use the display era and bake (3.4).
- Coordinates for braziers, overheads, banners, shelves, carpet, cloths and the bell are hard-coded inline; put them in the `sites.ts` scenario table.
- `figureCache` is a module global that is never evicted on resize; no `spent` sprite variant (spent units only use alpha).
- Domains still use the old ground code and alpha (conflicts with the reach colour), and are drawn under the darkness at the old strength.
- No fx, particles, shake, facing updates, HP ghost, bell swing, speed setting or reduced-motion handling beyond static flicker/bob; death and remove still use the old fade.
- Escape-exit chevrons and zone outlines were dropped in the prototype; 4.8 and 4.9 restore them in the new style.
- Water reflection pairs are recomputed by scanning every row per light per frame.
- `scripts/mock-shot.mjs` is a throwaway screenshot helper.
