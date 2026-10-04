// Canvas 2D renderer: the thin orchestrator of visual-style.md 9.3.
// Owner: WS0 (Foundation); after WS1-WS5 only the integrator edits it.
// It owns the canvas, sizing and hit-testing, builds one GfxFrame per frame
// (sites, display units and Domains, era transition, lights, poses) and
// calls the gfx passes in the layer order of section 2. All drawing lives
// in src/ui/gfx/*; the contracts are in gfx/types.ts.
import { RULES, diamondTiles, domainTiles, posEq, type GameState, type MapState, type Pos, type Unit } from '../engine';
import type { AnimStep } from './animation';
import { lerpPath } from './layout';
import { ERA_LIGHT, NIGHT, blendEraLight } from './palette';
import { eraTransitionMs } from './settings';
import { clamp01, easeInOutSine } from './gfx/ease';
import { createDomains } from './gfx/domains';
import { createFx } from './gfx/fx';
import { createLighting } from './gfx/lighting';
import { createObjects } from './gfx/objects';
import { createOverlays } from './gfx/overlays';
import { buildSites, sitesKey } from './gfx/sites';
import { createTerrain } from './gfx/terrain';
import { createUnits } from './gfx/units';
import { createWater } from './gfx/water';
import type {
  DisplayDomain,
  DisplayUnit,
  Era,
  EraLight,
  FxStepContext,
  GfxFrame,
  GfxModule,
  LightSource,
  MapSites,
  RenderInput,
  UnitPose,
} from './gfx/types';

export type { Effect } from './gfx/fx';
export type { RenderInput } from './gfx/types';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const FULLY_LIT = (): number => 1;


export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** Tile edge in device pixels. */
  tile = 16;
  /** Device pixels per CSS pixel. */
  dpr = 1;
  /** Board width in CSS px (tile * map width / dpr). */
  cssWidth = 0;

  private readonly terrain = createTerrain();
  private readonly water = createWater();
  private readonly objects = createObjects();
  private readonly lighting = createLighting();
  private readonly overlays = createOverlays();
  private readonly units = createUnits();
  private readonly fx = createFx();
  private readonly domains = createDomains();
  private readonly modules: readonly GfxModule[] = [
    this.terrain,
    this.water,
    this.objects,
    this.lighting,
    this.overlays,
    this.units,
    this.fx,
    this.domains,
  ];

  private sites: MapSites | null = null;
  private sitesMap: MapState | null = null;
  private input: RenderInput | null = null;
  private lastNow = 0;

  // Era transition (3.4): set when the controller's display era changes.
  private readonly era: { from: Era; to: Era; t: number } = { from: 'Midnight', to: 'Midnight', t: 1 };
  private eraStart = 0;
  private eraSnap = true;
  private readonly env: EraLight = { ...ERA_LIGHT.Midnight };

  private readonly displayUnits: DisplayUnit[] = [];
  private readonly displayDomains: DisplayDomain[] = [];
  private readonly domainMemo = new Map<string, { state: GameState; cx: number; cy: number; tiles: Pos[] }>();
  private readonly lights: LightSource[] = [];
  private readonly poses = new Map<string, UnitPose>();
  private readonly shake = { x: 0, y: 0 };
  private frameObj: Mutable<GfxFrame> | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  /** Sizes the canvas for a CSS tile size at a device pixel ratio. */
  resize(cssTile: number, dpr: number, mapW: number, mapH: number): void {
    const ratio = dpr > 0 ? dpr : 1;
    // Floor so a fractional ratio (1.25, 1.5) never makes the board larger than the layout allowed.
    const tile = Math.max(4, Math.floor(cssTile * ratio + 1e-6));
    const changed = tile !== this.tile || ratio !== this.dpr;
    this.tile = tile;
    this.dpr = ratio;
    const w = tile * mapW;
    const h = tile * mapH;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.cssWidth = w / ratio;
    this.canvas.style.width = `${w / ratio}px`;
    this.canvas.style.height = `${h / ratio}px`;
    if (changed) for (const m of this.modules) m.reset();
  }

  /** A CSS-pixel size in device pixels (for legibility minimums). */
  private px(css: number): number {
    return Math.round(css * this.dpr);
  }

  /** Converts a CSS-pixel offset inside the canvas to a tile. */
  tileAtClient(offsetX: number, offsetY: number, mapW: number, mapH: number): Pos | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const dx = (offsetX * this.canvas.width) / rect.width;
    const dy = (offsetY * this.canvas.height) / rect.height;
    const x = Math.floor(dx / this.tile);
    const y = Math.floor(dy / this.tile);
    if (x < 0 || y < 0 || x >= mapW || y >= mapH) return null;
    return { x, y };
  }

  /** Tile centre in CSS px relative to the canvas (for DOM tooltips). */
  tileCenterCss(p: Pos): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width / this.canvas.width;
    const sy = rect.height / this.canvas.height;
    return { x: (p.x + 0.5) * this.tile * sx, y: (p.y + 0.5) * this.tile * sy };
  }

  // --- step and lifecycle hooks (controller -> fx) ------------------------------

  /** A queued step starts playing (after onStepStart updated the overrides). */
  stepStarted(step: AnimStep, c: FxStepContext): void {
    this.fx.onStepStart(step, c);
  }

  /** A queued step finished (after onStepEnd updated the overrides). */
  stepEnded(step: AnimStep, c: FxStepContext): void {
    this.fx.onStepEnd(step, c);
  }

  /** A new battle: forget per-battle state and snap the era without a transition. */
  restart(): void {
    for (const m of this.modules) m.clear();
    this.eraSnap = true;
    this.domainMemo.clear();
  }

  // --- frame ------------------------------------------------------------------------

  draw(input: RenderInput): void {
    const f = this.frame(input);
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = NIGHT.void;
    ctx.fillRect(0, 0, f.width, f.height);

    this.fx.computePoses(f);
    const s = this.fx.shakeOffset(f);
    this.shake.x = Math.round(s.x);
    this.shake.y = Math.round(s.y);
    ctx.setTransform(1, 0, 0, 1, this.shake.x, this.shake.y);

    this.terrain.draw(f);
    this.sanitize();
    this.water.draw(f);
    this.sanitize();
    this.objects.draw(f);
    this.sanitize();
    this.fx.drawDecals(f);
    this.sanitize();
    this.domains.drawGround(f);
    this.sanitize();

    this.objects.collectLights(f);
    this.units.collectLights(f);
    this.domains.collectLights(f);
    this.fx.collectLights(f);
    this.lighting.draw(f);
    this.sanitize();

    this.objects.drawSources(f);
    this.sanitize();
    this.terrain.drawSources(f);
    this.sanitize();
    this.overlays.drawHighlights(f);
    this.sanitize();
    this.overlays.drawZoneLabels(f);
    this.sanitize();
    this.units.draw(f);
    this.sanitize();
    this.domains.drawUpper(f);
    this.sanitize();
    this.overlays.drawTopLabels(f);
    this.sanitize();
    this.overlays.drawHover(f);
    this.sanitize();
    this.fx.draw(f);
    this.sanitize();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.fx.drawBanner(f);
    this.sanitize();
  }

  /** Resets the state a pass could leave behind, so passes stay independent. */
  private sanitize(): void {
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.setLineDash([]);
  }

  private displayPos(u: Unit): Pos {
    const input = this.input;
    if (!input) return u.pos;
    const a = input.active;
    if (a && a.step.event.type === 'moved' && a.step.event.unitId === u.id) {
      return lerpPath(a.step.event.from, a.step.event.path, a.progress);
    }
    return input.overrides.pos[u.id] ?? u.pos;
  }

  private ensureSites(state: GameState): MapSites {
    if (!this.sites || state.map !== this.sitesMap) {
      this.sitesMap = state.map;
      const key = sitesKey(state.map, state.scenarioId);
      if (!this.sites || this.sites.key !== key) {
        this.sites = buildSites(state.map, state.scenarioId);
        for (const m of this.modules) m.reset();
      }
    }
    return this.sites;
  }

  private updateEra(input: RenderInput, now: number): void {
    const era = this.era;
    if (this.eraSnap) {
      this.eraSnap = false;
      era.from = input.era;
      era.to = input.era;
      era.t = 1;
    } else if (input.era !== era.to) {
      era.from = era.to;
      era.to = input.era;
      this.eraStart = now;
    }
    if (era.from !== era.to) {
      era.t = clamp01((now - this.eraStart) / eraTransitionMs(input.motion));
      if (era.t >= 1) era.from = era.to;
    } else era.t = 1;
    const k = input.motion.reduced ? era.t : easeInOutSine(era.t);
    blendEraLight(ERA_LIGHT[era.from], ERA_LIGHT[era.to], k, this.env);
  }

  private buildUnits(input: RenderInput): void {
    const { state, overrides } = input;
    const list = this.displayUnits;
    list.length = 0;
    const selId = input.selection.mode === 'unit' ? input.selection.unitId : null;
    for (const u of state.units) {
      if (overrides.hidden[u.id]) continue;
      list.push({ unit: u, ghost: false, pos: this.displayPos(u), hp: overrides.hp[u.id] ?? u.hp, selected: u.id === selId });
    }
    for (const g of Object.values(overrides.ghosts)) {
      if (state.units.some((u) => u.id === g.id)) continue;
      list.push({ unit: g, ghost: true, pos: this.displayPos(g), hp: overrides.hp[g.id] ?? g.hp, selected: false });
    }
  }

  private buildDomains(input: RenderInput): void {
    const { state } = input;
    const list = this.displayDomains;
    list.length = 0;
    for (const d of state.domains) {
      if (input.overrides.hiddenDomains[d.ownerId]) continue;
      const owner = state.units.find((u) => u.id === d.ownerId);
      if (!owner) continue;
      const center = this.displayPos(owner);
      let memo = this.domainMemo.get(d.ownerId);
      if (!memo || memo.state !== state || memo.cx !== center.x || memo.cy !== center.y) {
        const tiles = posEq(center, owner.pos)
          ? domainTiles(state, d)
          : diamondTiles({ x: Math.round(center.x), y: Math.round(center.y) }, RULES.domainRadius, state.map.width, state.map.height);
        memo = { state, cx: center.x, cy: center.y, tiles };
        this.domainMemo.set(d.ownerId, memo);
      }
      list.push({ domain: d, owner, center, tiles: memo.tiles });
    }
  }

  private frame(input: RenderInput): GfxFrame {
    this.input = input;
    const now = input.now;
    const dt = this.lastNow === 0 ? 16 : Math.max(0, Math.min(100, now - this.lastNow));
    this.lastNow = now;
    const sites = this.ensureSites(input.state);
    this.updateEra(input, now);
    this.buildUnits(input);
    this.buildDomains(input);
    this.lights.length = 0;
    for (const l of sites.staticLights) this.lights.push(l);
    this.poses.clear();

    let f = this.frameObj;
    if (!f) {
      f = {
        ctx: this.ctx,
        T: this.tile,
        dpr: this.dpr,
        px: (css: number) => this.px(css),
        width: this.canvas.width,
        height: this.canvas.height,
        mapW: input.state.map.width,
        mapH: input.state.map.height,
        now,
        dt,
        motion: input.motion,
        era: this.era,
        env: this.env,
        input,
        state: input.state,
        sites,
        units: this.displayUnits,
        domains: this.displayDomains,
        displayPos: (u: Unit) => this.displayPos(u),
        lights: this.lights,
        poses: this.poses,
        levelAt: FULLY_LIT,
        shake: this.shake,
      };
      this.frameObj = f;
    }
    f.T = this.tile;
    f.dpr = this.dpr;
    f.width = this.canvas.width;
    f.height = this.canvas.height;
    f.mapW = input.state.map.width;
    f.mapH = input.state.map.height;
    f.now = now;
    f.dt = dt;
    f.motion = input.motion;
    f.input = input;
    f.state = input.state;
    f.sites = sites;
    f.levelAt = FULLY_LIT;
    return f;
  }
}
