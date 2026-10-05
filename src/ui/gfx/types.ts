// Shared contracts of the canvas renderer (docs/design/visual-style.md, 9.2).
// Owner: WS0 (Foundation). FROZEN after WS0: WS1-WS5 work in parallel on
// disjoint files and coordinate only through these types. Changing anything
// here needs the integrator (see 9.4).
//
// Who writes / reads what (one frame, in renderer.ts order, section 2 / 9.3):
//
//   renderer.ts  builds the GfxFrame: ctx, sizes, time, motion, era, env,
//                input, state, sites, units, domains, displayPos; clears `lights`
//                (then pushes `sites.staticLights`) and `poses`; resets
//                `levelAt` to "fully lit"; applies `shake` around layers 1-14.
//   fx           computePoses()  -> writes `poses`         (first, every frame)
//                shakeOffset()   -> renderer stores it in `shake`
//   terrain      draw()          layer 1   reads sites, env.desat, overrides
//   water        draw()          layer 2   reads sites.water/reflections, staticLights
//   objects      draw()          layer 3   reads state.map.objects, overrides
//   fx           drawDecals()    layer 4a
//   domains      drawGround()    layer 4b  reads domains
//   objects / units / domains / fx  collectLights() -> push onto `lights`
//   lighting     draw()          layers 5-6, reads lights/env/era/sites,
//                                writes `levelAt` (units read it for night shade)
//   objects      drawSources()   layer 7 (anchor core sparkle)
//   terrain      drawSources()   layer 7 (lantern cores, brazier fire, candles)
//   overlays     drawHighlights(), drawZoneLabels()   layers 8-9
//   units        draw()          layer 10  reads units, poses, levelAt
//   domains      drawUpper()     layer 11
//   overlays     drawTopLabels(), drawHover()          layers 12-13
//   fx           draw()          layer 14  (floats, particles, flashes, pulses)
//   -- shake transform removed --
//   fx           drawBanner()    layer 15
//
// Cross-workstream rules:
//   - Passes may change any canvas state but must leave the transform and
//     clip as they found them (save/restore); renderer.ts resets alpha,
//     composite, smoothing and line dash after every pass.
//   - Era desaturation (3.4): while `era.t < 1` lighting.draw() applies the
//     live saturation pass at `env.desat` over layers 1-4; once `era.t >= 1`
//     terrain bakes `env.desat` into its cache (part of the cache key) and
//     lighting skips the pass.
//   - `sites.staticLights` are frozen and shared: never mutate them; apply
//     flicker and `env.lamp` to local values in lighting.
//   - Death/capture/escape visuals belong to fx: computePoses() writes the
//     ghost's alpha/scale/tilt/clipFromFeet; units draws whatever pose it
//     gets and has no fade of its own.
//   - Object HP badges and Domain labels are overlays (layer 12), not
//     objects/domains. Zone outlines are overlays (hovered zone only, 4.9);
//     terrain draws none.
//
// Outside the frame: the controller tells the renderer when a step starts
// or ends (`Renderer.stepStarted/stepEnded`), which forwards to
// `FxPass.onStepStart/onStepEnd` with an `FxStepContext`. `Renderer.restart()`
// calls `clear()` on every module; `Renderer.resize()` and a map change call
// `reset()` on every module.
import type { ActiveDomain, GameState, Pos, Terrain, Unit } from '../../engine';
import type { AnimStep, DisplayOverrides } from '../animation';
import type { BellEra } from '../hudModel';
import type { Selection } from '../selection';
import type { ThreatOverlay } from '../threatView';
import type { Effect } from './fx';

// --- basics -------------------------------------------------------------------

export type Rgb = readonly [number, number, number];

/** Display era (= hudModel.BellEra). Owned by the controller, set when a `bellRang` step starts. */
export type Era = BellEra;

/** Animation speed setting (settings.ts, spec 6.4). */
export type Speed = '1x' | '2x' | 'instant';

/** Effective motion settings for this frame (settings.ts). */
export interface Motion {
  /** prefers-reduced-motion (or the explicit override): no shake, bob, flicker, drift, ambient particles. */
  readonly reduced: boolean;
  readonly speed: Speed;
}

// --- renderer input (controller -> renderer) ----------------------------------

/**
 * A marker the overlays pass draws above the units: the crown on the Emperor's
 * tile. `ready` = the player can Confront right now (glows, with a label),
 * `reachable` = Varek can get there this turn, `idle` = just a pointer to
 * where to go.
 */
export interface BoardMark {
  kind: 'crown';
  pos: Pos;
  state: 'idle' | 'reachable' | 'ready';
  /** Short plaque text shown when `ready`. */
  label: string;
}

/** Everything the controller hands the renderer each frame. Written by controller.ts only. */
export interface RenderInput {
  state: GameState;
  overrides: DisplayOverrides;
  active: { step: AnimStep; progress: number } | null;
  selection: Selection;
  showHighlights: boolean;
  hover: Pos | null;
  hoverPath: Pos[] | null;
  /** Enemy reach tint (T key, or a hovered enemy); absent or null = none. Drawn only while `showHighlights`. */
  threat?: ThreatOverlay | null;
  /** Objective markers (the crown on the Emperor). */
  marks?: readonly BoardMark[];
  /** Controller-spawned effects (floats, flashes, pulses, banners). Type owned by fx.ts (WS4). */
  effects: readonly Effect[];
  /** performance.now() of this frame. */
  now: number;
  /** Display era (lags `state` until the bell step plays). */
  era: Era;
  motion: Motion;
}

// --- era / global light -------------------------------------------------------

/** Era transition, tracked by renderer.ts. `t` 0..1 linear progress (1 = settled on `to`). */
export interface EraState {
  readonly from: Era;
  readonly to: Era;
  readonly t: number;
}

/** Global light parameters (spec 3.4), one row per era in palette.ERA_LIGHT. */
export interface EraLight {
  /** Darkness alpha over the board. */
  darkAlpha: number;
  /** Darkest any passable tile may be (3.1 floor minimum). */
  floorCap: number;
  /** Darkness colour. */
  tint: Rgb;
  /** Moonlight strength on outdoor tiles. */
  moon: number;
  /** Multiplier for lamp lights (LightSource.lamp). */
  lamp: number;
  /** World desaturation 0..1 over layers 1-4. */
  desat: number;
}

// --- lights -------------------------------------------------------------------

export type LightKind =
  | 'lantern'
  | 'brazier'
  | 'candle'
  | 'bell'
  | 'overhead'
  | 'anchor'
  | 'seal'
  | 'orb'
  | 'domain'
  | 'fire'
  | 'flash';

/**
 * A light for the lightmap (spec 3.2). Positions in tile units (fractional,
 * tile x spans [x, x+1)). Intensity and radius are the *base* values:
 * lighting.ts applies flicker (unless motion.reduced) and `env.lamp` for
 * `lamp` lights. Static lights come from `sites.staticLights` (do not mutate
 * those); dynamic ones are pushed by collectLights() each frame (modules may
 * reuse their own LightSource objects to avoid allocation).
 */
export interface LightSource {
  kind: LightKind;
  x: number;
  y: number;
  /** Tiles. */
  radius: number;
  /** 0..1. */
  intensity: number;
  color: Rgb;
  /** Flicker amplitude, 0 = steady. */
  flicker: number;
  /** 0..1, per-light phase seed. */
  seed: number;
  /** Scaled by the era's lamp factor (lanterns, braziers, candles, bell, overheads). */
  lamp: boolean;
  /** Silence: adds darkness instead of light. */
  darken?: boolean;
}

// --- units --------------------------------------------------------------------

/**
 * Per-unit animation pose, written by fx.computePoses() each frame, read by
 * units.draw(). A unit without an entry uses IDENTITY_POSE.
 */
export interface UnitPose {
  /** Offset in tile units (lunge, knockback, hop, slide). */
  dx: number;
  dy: number;
  /** 0..1 white overlay (impact flash). */
  flash: number;
  /** 0..1 multiplied into the unit's alpha. */
  alpha: number;
  /** Scale about the feet. */
  scale: number;
  /** Radians, about the feet. */
  tilt: number;
  /** 0..1 dissolve: fraction of the figure clipped away from the feet up (death). */
  clipFromFeet?: number;
  /** Facing override (1 = right, -1 = left). Units keep the last facing per id when absent. */
  facing?: 1 | -1;
}

export const IDENTITY_POSE: Readonly<UnitPose> = Object.freeze({ dx: 0, dy: 0, flash: 0, alpha: 1, scale: 1, tilt: 0 });

/** A unit to draw this frame (built once per frame by renderer.ts, in state order; units.ts sorts). */
export interface DisplayUnit {
  readonly unit: Unit;
  /** Removed from the state but still shown (pending death/capture/escape). */
  readonly ghost: boolean;
  /** Display position in tiles (pending move / path interpolation), fractional while moving. */
  readonly pos: Pos;
  /** Displayed HP (overrides.hp ?? unit.hp). */
  readonly hp: number;
  readonly selected: boolean;
}

/**
 * An active Domain to draw this frame (built by renderer.ts; Domains hidden
 * by `overrides.hiddenDomains` are left out). While the owner is shown
 * mid-move, `tiles` is the diamond around its rounded display tile.
 */
export interface DisplayDomain {
  readonly domain: ActiveDomain;
  readonly owner: Unit;
  /** Owner display position (fractional while moving). */
  readonly center: Pos;
  readonly tiles: readonly Pos[];
}

// --- per-map analysis (gfx/sites.ts) -------------------------------------------

/** Floor painter per tile (spec 4.1). `canal`/`pool` = water; `wall` = wall tiles. */
export type Material =
  | 'marble'
  | 'well'
  | 'plank'
  | 'parquet'
  | 'boards'
  | 'plaza'
  | 'cobble'
  | 'tunnel'
  | 'flag'
  | 'slab'
  | 'canal'
  | 'pool'
  | 'wall';

export type Axis = 'ns' | 'ew';

export interface Dir {
  readonly dx: number;
  readonly dy: number;
}

/** A light fixture on a tile; `lx, ly` = light position in tiles; index into staticLights. */
export interface LightSite {
  readonly x: number;
  readonly y: number;
  readonly lx: number;
  readonly ly: number;
  readonly seed: number;
  readonly light: number;
}

export interface OverheadSite {
  readonly zone: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly light: number;
}

/** A canal/pool tile. `bridge` = id of the bridge object over it (draw water only once it burned). */
export interface WaterTile {
  readonly x: number;
  readonly y: number;
  readonly pool: boolean;
  readonly bridge: string | null;
}

/** A static light reflected on a water tile in its column (spec 4.6). */
export interface ReflectionPair {
  /** Index into MapSites.staticLights. */
  readonly light: number;
  readonly x: number;
  readonly y: number;
  /** Rows from the light to the water tile centre (absolute, > 0). */
  readonly dy: number;
}

export interface BridgeSpan {
  readonly id: string;
  readonly tiles: readonly Pos[];
  /** Direction of travel over the deck ('ns' crosses an east-west canal). */
  readonly axis: Axis;
}

export interface DoorSite {
  readonly x: number;
  readonly y: number;
  /** Direction of the passage through the door ('ns' = walls to the W and E). */
  readonly axis: Axis;
  /** Barred-door object on this tile, if any. */
  readonly objectId: string | null;
}

export interface StairSite {
  readonly x: number;
  readonly y: number;
  /** Direction the steps descend (toward the water). */
  readonly dir: Dir;
}

export interface ExitSite {
  readonly id: string;
  readonly tiles: readonly Pos[];
  /** Off-map direction. */
  readonly dir: Dir;
  readonly units: readonly string[];
}

/** A non-wall tile on the map border (map-edge opening). */
export interface EdgeSite {
  readonly x: number;
  readonly y: number;
  /** Off-map direction. */
  readonly dir: Dir;
  /** Escape exit id when the tile is an exit tile. */
  readonly exit: string | null;
}

export interface GateSite {
  readonly id: string;
  readonly tiles: readonly Pos[];
  readonly wave: string;
  /** Axis the grille spans ('ew' = tiles in one row). */
  readonly axis: Axis;
  /** Toward the outside (off-map when on the border). */
  readonly outward: Dir;
}

export interface ZoneBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Per-map analysis, built once per map by sites.ts (`buildSites`) and cached
 * by the renderer. Derived from terrain, zones, exits and static object
 * placement only, never from coordinates, so it follows any geometry change.
 * Stable for a whole battle: bridges count as built (`base`) even after they
 * burn. Grids are [y][x].
 */
export interface MapSites {
  /** Cache key (scenario id + map as built). */
  readonly key: string;
  readonly w: number;
  readonly h: number;
  /** Terrain as built: every bridge object's tiles are 'bridge' (burned or not). */
  readonly base: readonly (readonly Terrain[])[];
  readonly material: readonly (readonly Material[])[];
  /** Moonlit (spec 3.3). Never true on walls. */
  readonly outdoor: readonly (readonly boolean[])[];
  /** Standable terrain as built (doors and bridges included, water/walls/brazier/bell excluded). */
  readonly passable: readonly (readonly boolean[])[];
  /** First zone (in map.zones order) containing the tile. */
  readonly zone: readonly (readonly (string | null)[])[];
  /** 1-wide corridor tiles outside every zone (walls on both sides, not on the border): axis of the corridor. */
  readonly corridor: readonly (readonly (Axis | null)[])[];
  readonly zoneBoxes: Readonly<Record<string, ZoneBox>>;
  readonly lanterns: readonly LightSite[];
  readonly braziers: readonly LightSite[];
  readonly candles: readonly LightSite[];
  readonly bells: readonly LightSite[];
  readonly overheads: readonly OverheadSite[];
  /** All of the above as lights, in that order (lanterns, braziers, candles, bells, overheads). Frozen. */
  readonly staticLights: readonly Readonly<LightSource>[];
  readonly water: readonly WaterTile[];
  readonly reflections: readonly ReflectionPair[];
  readonly bridges: readonly BridgeSpan[];
  readonly doors: readonly DoorSite[];
  readonly stairs: readonly StairSite[];
  readonly exits: readonly ExitSite[];
  readonly edges: readonly EdgeSite[];
  readonly gates: readonly GateSite[];
}

// --- the frame ----------------------------------------------------------------

/**
 * One frame's drawing context. One object is reused across frames (no
 * per-frame allocation); modules must not keep references to its arrays
 * beyond the call.
 */
export interface GfxFrame {
  readonly ctx: CanvasRenderingContext2D;
  /** Tile edge in device px (includes dpr). */
  readonly T: number;
  readonly dpr: number;
  /** CSS px -> device px, rounded. */
  px(css: number): number;
  /** Canvas size in device px. */
  readonly width: number;
  readonly height: number;
  readonly mapW: number;
  readonly mapH: number;
  readonly now: number;
  /** ms since the previous drawn frame (capped at 100). */
  readonly dt: number;
  readonly motion: Motion;
  readonly era: EraState;
  /** Blended global light for `era` (eased). */
  readonly env: Readonly<EraLight>;
  readonly input: RenderInput;
  /** = input.state. */
  readonly state: GameState;
  readonly sites: MapSites;
  /** Units to draw (visible units + ghosts), state order. */
  readonly units: readonly DisplayUnit[];
  /** Active, visible Domains with their display tiles. */
  readonly domains: readonly DisplayDomain[];
  /** Display position of any unit (pending move / path interpolation). */
  displayPos(u: Unit): Pos;
  /** Lights for this frame: starts as sites.staticLights, then collectLights() pushes. */
  readonly lights: LightSource[];
  /** Written by fx.computePoses(), read by units. */
  readonly poses: Map<string, UnitPose>;
  /**
   * Light level 0..1 at a tile position (spec 3.5). Reset to () => 1 each
   * frame; lighting.draw() replaces it; units read it after lighting.
   */
  levelAt: (x: number, y: number) => number;
  /** Screen-shake offset in device px applied to layers 1-14 (renderer writes from fx.shakeOffset). */
  readonly shake: { x: number; y: number };
}

// --- module contracts -----------------------------------------------------------
// Each gfx module exports one factory returning its pass object; the renderer
// owns one instance per canvas. Module-level mutable state is not allowed
// (it would leak across renderers and never be evicted).
//
//   terrain.ts   export function createTerrain(): TerrainPass       (WS1)
//   water.ts     export function createWater(): WaterPass           (WS1)
//   objects.ts   export function createObjects(): ObjectsPass       (WS1)
//   lighting.ts  export function createLighting(): LightingPass     (WS2)
//   overlays.ts  export function createOverlays(): OverlaysPass     (WS2)
//   units.ts     export function createUnits(): UnitsPass           (WS3; uses figures.ts + badges.ts)
//   fx.ts        export function createFx(): FxPass; export type Effect   (WS4; uses particles.ts)
//   domains.ts   export function createDomains(): DomainsPass       (WS4)
// WS-internal helpers (figures.ts, badges.ts, particles.ts, materials.ts)
// are free-form; only their owning workstream imports them.

export interface GfxModule {
  /** Drop size- or map-dependent caches (resize, tile size change, new map). */
  reset(): void;
  /** Forget per-battle runtime state (restart). */
  clear(): void;
}

export interface TerrainPass extends GfxModule {
  /** Layer 1: blit the static terrain cache (rebuild when its key changes). */
  draw(f: GfxFrame): void;
  /** Layer 7: lantern cores, brazier fire, table candles (above the darkness). */
  drawSources(f: GfxFrame): void;
}

export interface WaterPass extends GfxModule {
  /** Layer 2: ripples, reflections, pool shimmer, on water tiles only. */
  draw(f: GfxFrame): void;
}

export interface ObjectsPass extends GfxModule {
  /** Layer 3: barred doors, ward anchors, portcullis gates. */
  draw(f: GfxFrame): void;
  /** Push anchor lights. */
  collectLights(f: GfxFrame): void;
  /** Layer 7: anchor core sparkle. */
  drawSources(f: GfxFrame): void;
}

export interface LightingPass extends GfxModule {
  /** Layers 5-6 (darkness, glow) and the live desaturation pass; sets f.levelAt. */
  draw(f: GfxFrame): void;
}

export interface OverlaysPass extends GfxModule {
  /** Layer 8: reach, target, hover path, hovered-zone outline. */
  drawHighlights(f: GfxFrame): void;
  /** Layer 9: zone plaques. */
  drawZoneLabels(f: GfxFrame): void;
  /** Layer 12: Domain labels, object HP badges. */
  drawTopLabels(f: GfxFrame): void;
  /** Layer 13: hover tile outline. */
  drawHover(f: GfxFrame): void;
}

export interface UnitsPass extends GfxModule {
  /** Push seal and Radiant-orb lights. */
  collectLights(f: GfxFrame): void;
  /** Layer 10: y-sorted units with shadows, selection, badges, HP bars. */
  draw(f: GfxFrame): void;
}

/** What fx gets when a step starts or ends (outside the frame). */
export interface FxStepContext {
  /** The current (already advanced) state; use the step's event for positions. */
  readonly state: GameState;
  readonly overrides: DisplayOverrides;
  readonly now: number;
  readonly motion: Motion;
}

export interface FxPass extends GfxModule {
  onStepStart(step: AnimStep, c: FxStepContext): void;
  onStepEnd(step: AnimStep, c: FxStepContext): void;
  /** First thing each frame: write f.poses for animating units. */
  computePoses(f: GfxFrame): void;
  /** Screen-shake offset in device px for this frame ({0,0} when none). */
  shakeOffset(f: GfxFrame): { x: number; y: number };
  /** Layer 4a: ash decals, bridge embers. */
  drawDecals(f: GfxFrame): void;
  /** Push effect lights (flashes, fire, burning bridges). */
  collectLights(f: GfxFrame): void;
  /** Layer 14: particles, projectiles, flashes, pulses, rings, floats (f.input.effects). */
  draw(f: GfxFrame): void;
  /** Layer 15: banner card (not shaken). */
  drawBanner(f: GfxFrame): void;
}

export interface DomainsPass extends GfxModule {
  /** Layer 4b: ground fill and patterns. */
  drawGround(f: GfxFrame): void;
  /** Push Domain lights (and Silence darkeners). */
  collectLights(f: GfxFrame): void;
  /** Layer 11: dome rims, bolts, flames, rays, rings. */
  drawUpper(f: GfxFrame): void;
}
