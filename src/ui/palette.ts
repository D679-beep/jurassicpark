// Palette tokens for "Night of Ashen Lanterns" (visual-style.md section 1).
// Owner: WS0 (Foundation). Tokens are grouped `as const` objects; gfx modules
// import the groups they need. `COLORS`, `FACTION_STYLE` and `DOMAIN_STYLE`
// are the pre-overhaul names, kept so hud.ts, controller.ts and the stub
// passes compile and look as before; new code uses the grouped tokens.
import type { DomainKind, Faction } from '../engine';
import type { Era, EraLight, Rgb } from './gfx/types';

// --- 1.1 night and light --------------------------------------------------------

export const NIGHT = {
  void: '#05060c',
  /** Darkness colour at Midnight (near neutral, no haze). */
  tint: [6, 8, 16] as Rgb,
  moon: [120, 150, 215] as Rgb,
} as const;

export const LIGHT = {
  lantern: [255, 176, 90] as Rgb,
  brazier: [255, 150, 70] as Rgb,
  overhead: [255, 200, 140] as Rgb,
  ward: [120, 170, 255] as Rgb,
  seal: [150, 220, 255] as Rgb,
  fire: [255, 120, 50] as Rgb,
  flameCore: '#ffe6a8',
  flameBody: '#f2b04e',
} as const;

// --- 1.2 materials ----------------------------------------------------------------

export const MAT = {
  marble: { a: '#36343f', b: '#2f2d39', vein: 'rgba(225,220,255,0.07)', joint: 'rgba(0,0,0,0.30)' },
  carpet: { base: '#5a1824', dark: '#3c0e17', trim: '#c9a24a' },
  plank: { a: '#3d2b1e', b: '#35261b', seam: 'rgba(0,0,0,0.38)', sheen: 'rgba(255,220,170,0.03)' },
  slab: { a: '#2c2b34', b: '#292830', joint: 'rgba(0,0,0,0.32)' },
  runner: { base: 'rgba(32,40,70,0.55)', trim: 'rgba(201,162,74,0.22)' },
  flag: { a: '#2d3443', b: '#283040', moonEdge: 'rgba(180,200,255,0.035)' },
  cobble: { a: '#2b303b', b: '#333946', gap: '#181b22' },
  well: { a: '#1c2b33', b: '#22343d', rune: 'rgba(120,225,255,0.26)' },
  tunnel: { a: '#232027', b: '#1e1c22', damp: 'rgba(40,70,80,0.22)' },
  parquet: { a: '#30283a', b: '#2a2333', rug: 'rgba(60,44,100,0.30)' },
  boards: { a: '#33281f', b: '#2d231b' },
} as const;

// --- 1.3 structure, water, furniture ---------------------------------------------

export const WALL = {
  cap: '#1c1a26',
  capRim: '#4f4a66',
  faceTop: '#2b2738',
  face: '#121019',
  faceHighlight: 'rgba(200,190,255,0.16)',
  contact: 'rgba(0,0,0,0.60)',
  contactSide: 'rgba(0,0,0,0.38)',
} as const;

export const PILLAR = { top: '#5a5468', body: '#3c3748', plinth: '#2e2a38', shadow: 'rgba(0,0,0,0.5)' } as const;

export const DOOR = {
  wood: '#5e3d22',
  woodDark: '#3a2312',
  iron: '#8f96a3',
  bar: '#2b1a0c',
  frame: '#b08850',
  threshold: '#8a6a3e',
} as const;

export const WATER = {
  deep: '#0a2034',
  mid: '#134466',
  surface: '#1f7192',
  ripple: 'rgba(170,225,245,0.55)',
  bank: 'rgba(185,215,240,0.55)',
  kerb: '#2a2f3b',
  kerbFace: '#171a22',
} as const;

export const BRIDGE = { wood: '#6d4a2b', dark: '#3b2614', rail: '#8a6238', charred: '#1a110a', ember: '#ff7a2e' } as const;

export const ANCHOR = { hi: '#e6f8ff', lo: '#6a7cff', edge: 'rgba(60,70,200,0.9)', dead: '#3b3946' } as const;

export const POOL = { water: '#15485a', deep: '#0c2c3a', rim: '#3a4950', rimTop: '#71878f', rune: 'rgba(120,225,255,0.50)' } as const;

export const TABLE = {
  top: '#4c3322',
  topEdge: '#7a5634',
  front: '#24170e',
  runner: 'rgba(140,36,48,0.85)',
  plate: '#d8cfbd',
  goblet: '#c9a24a',
} as const;

export const CRATE = { wood: '#6a4b2c', dark: '#2e2014', band: '#8a6a40' } as const;

export const STAIR = { tread: '#3a4354', riser: '#1b2029', nosing: 'rgba(200,215,245,0.22)' } as const;

export const BRAZIER = { iron: '#2a1f18', rim: '#7a6650', coal: '#ff7a2e', legs: '#16110c' } as const;

export const BELL = { bronze: '#9c7a3c', hi: '#e0bd72', dark: '#4e3a1a', rope: '#bfa071' } as const;

export const GATE = { iron: '#4c525e', ironHi: '#a3abb8', shadow: 'rgba(0,0,0,0.45)' } as const;

// --- 1.4 factions -----------------------------------------------------------------

export interface FactionTokens {
  cloak: string;
  cloakDark: string;
  steel: string;
  accent: string;
  trim: string;
  base: string;
  skin: string;
  outline: string;
  /** HUD colour (--storm / --loyal). */
  hud: string;
  /** Phase pill background. */
  pill: string;
  /** Initial-tab underline. */
  tab: string;
}

export const FACTION: Record<Faction, FactionTokens> = {
  rebel: {
    cloak: '#3f6690',
    cloakDark: '#22364f',
    steel: '#a9b9c9',
    accent: '#6fd3ff',
    trim: '#d6e2ee',
    base: '#111a26',
    skin: '#c9a88a',
    outline: 'rgba(4,5,10,0.9)',
    hud: '#7fb4e6',
    pill: '#23384f',
    tab: '#bfe9ff',
  },
  loyalist: {
    cloak: '#e0b955',
    cloakDark: '#9d7426',
    steel: '#efe6cf',
    accent: '#fff1b8',
    trim: '#fff8e4',
    base: '#2a200c',
    skin: '#d8b896',
    outline: 'rgba(4,5,10,0.9)',
    hud: '#e3bd5f',
    pill: '#4d3d17',
    tab: '#ffe7a0',
  },
};

/** Loyalist helm crest. */
export const CREST = '#c0392b';

/** Named-character marks (1.4 / 5.4). */
export const MARK = {
  varek: '#7fe3ff',
  varekCape: '#1a2a44',
  kaela: '#e0483a',
  grimm: '#ff8a2e',
  grimmCape: '#4a2a22',
  halden: '#ffd24a',
  elian: '#fff6c8',
  orsa: '#bfa774',
  orsaShield: '#8f8068',
  orsaShieldRim: '#e0c47a',
  mira: '#2f6f6a',
  miraGlow: '#7fe0d0',
} as const;

// --- 1.5 overlays, status, HP, domains ---------------------------------------------

export const OVERLAY = {
  reach: 'rgba(70,140,255,0.30)',
  reachEdge: 'rgba(150,200,255,0.85)',
  target: 'rgba(255,72,60,0.36)',
  targetEdge: '#ff7864',
  edgeOuter: 'rgba(0,0,0,0.55)',
  path: 'rgba(200,228,255,0.95)',
  pathCasing: 'rgba(4,8,20,0.8)',
  hover: 'rgba(255,255,255,0.85)',
  plate: 'rgba(8,8,14,0.74)',
  plateEdge: 'rgba(232,200,114,0.32)',
  zoneOutline: 'rgba(232,200,114,0.35)',
  zoneLabel: 'rgba(232,200,114,0.62)',
} as const;

export const STATUS = {
  dueling: '#ff7a5c',
  sealed: '#8cdcff',
  drained: '#b5a8d6',
  escapee: '#7fe0d0',
  badgeFill: 'rgba(8,8,14,0.88)',
} as const;

export const HP = {
  good: '#6fcf6f',
  mid: '#e8c040',
  low: '#e05040',
  back: 'rgba(0,0,0,0.7)',
  ghost: 'rgba(255,255,255,0.85)',
  heal: '#bff5c2',
} as const;

export interface DomainLook {
  ground: string;
  edge: string;
  label: string;
  light: Rgb;
  particles: readonly string[];
}

/** New Domain styles (1.5). Ground alpha is deliberately low so reach tiles stay distinct. */
export const DOMAIN: Record<DomainKind, DomainLook> = {
  tempest: { ground: 'rgba(110,130,230,0.10)', edge: 'rgba(170,200,255,0.9)', label: '#bcd4ff', light: [120, 160, 255], particles: ['#dbe8ff', '#ffffff', '#8fd8ff'] },
  pyre: { ground: 'rgba(255,100,40,0.12)', edge: 'rgba(255,140,60,0.95)', label: '#ffb27a', light: [255, 120, 50], particles: ['#ff5a1f', '#ffb347', '#ffe2a0'] },
  bulwark: { ground: 'rgba(205,180,130,0.10)', edge: 'rgba(240,215,160,0.95)', label: '#ecd9a8', light: [230, 205, 150], particles: ['rgba(236,217,168,0.22)'] },
  sanctuary: { ground: 'rgba(255,245,180,0.10)', edge: 'rgba(255,250,210,0.9)', label: '#fff5c8', light: [255, 240, 190], particles: ['#fff6c8'] },
  silence: { ground: 'rgba(120,90,160,0.12)', edge: 'rgba(170,140,210,0.8)', label: '#d0c0f0', light: [150, 120, 200], particles: ['#b9a6e0'] },
};

// --- 3.4 global light per era -------------------------------------------------------

export const ERA_LIGHT: Readonly<Record<Era, Readonly<EraLight>>> = {
  Midnight: { darkAlpha: 0.68, floorCap: 0.55, tint: [6, 8, 16], moon: 0.36, lamp: 1, desat: 0 },
  'First Bell': { darkAlpha: 0.64, floorCap: 0.52, tint: [7, 9, 18], moon: 0.36, lamp: 1, desat: 0 },
  'Second Bell': { darkAlpha: 0.58, floorCap: 0.48, tint: [12, 13, 22], moon: 0.34, lamp: 0.95, desat: 0 },
  Dawn: { darkAlpha: 0.3, floorCap: 0.3, tint: [60, 66, 80], moon: 0.1, lamp: 0.55, desat: 0.45 },
};

/**
 * Blends two era rows at `t` (0..1, already eased) into `out` (reused to
 * avoid allocation; a fresh object when omitted).
 */
export function blendEraLight(a: Readonly<EraLight>, b: Readonly<EraLight>, t: number, out?: EraLight): EraLight {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const m = (x: number, y: number): number => (k === 0 ? x : k === 1 ? y : x + (y - x) * k);
  // Settled states (the common case) reuse the table's tint: no allocation.
  const tint: Rgb =
    k === 0 ? a.tint : k === 1 ? b.tint : [Math.round(m(a.tint[0], b.tint[0])), Math.round(m(a.tint[1], b.tint[1])), Math.round(m(a.tint[2], b.tint[2]))];
  const o = out ?? { darkAlpha: 0, floorCap: 0, tint, moon: 0, lamp: 0, desat: 0 };
  o.darkAlpha = m(a.darkAlpha, b.darkAlpha);
  o.floorCap = m(a.floorCap, b.floorCap);
  o.tint = tint;
  o.moon = m(a.moon, b.moon);
  o.lamp = m(a.lamp, b.lamp);
  o.desat = m(a.desat, b.desat);
  return o;
}

/** `rgba()` string for an Rgb and alpha. */
export function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// --- legacy names (pre-overhaul look; used by the stub passes and the HUD) -----------

export const COLORS = {
  background: '#0b0a10',
  floorA: '#272430',
  floorB: '#2a2734',
  floorSeam: 'rgba(0,0,0,0.28)',
  outdoorA: '#24262d',
  outdoorB: '#272a31',
  wall: '#100e16',
  wallBrick: '#1a1724',
  wallTop: '#2a2536',
  lantern: '#f2c35e',
  doorWood: '#5e3d22',
  doorWoodDark: '#3d2614',
  doorIron: '#a3a9b3',
  rubble: '#4b4654',
  rubbleDark: '#36323e',
  water: '#123049',
  waterWave: '#2a618a',
  bridgeWood: '#76512e',
  bridgeRail: '#3b2614',
  charred: '#20140c',
  ember: '#ff7a2e',
  pillar: '#4d4859',
  pillarHi: '#6d6680',
  pillarShadow: 'rgba(0,0,0,0.45)',
  carpet: '#4a1c29',
  carpetTrim: '#c9a24a',
  zoneLine: 'rgba(232,200,114,0.20)',
  exit: 'rgba(200,230,255,0.55)',
  anchorCore: '#c8f4ff',
  anchorGlow: 'rgba(120,170,255,0.75)',
  anchorDead: '#3b3946',
  // Aliases of the section 1 tokens (spec: keep these keys).
  zoneLabel: OVERLAY.zoneLabel,
  reach: OVERLAY.reach,
  reachEdge: OVERLAY.reachEdge,
  target: OVERLAY.target,
  targetEdge: OVERLAY.targetEdge,
  hover: OVERLAY.hover,
  path: OVERLAY.path,
  hpGood: HP.good,
  hpMid: HP.mid,
  hpLow: HP.low,
  hpBack: HP.back,
  gold: '#e8c872',
  text: '#e8e2d0',
} as const;

export interface FactionStyle {
  fill: string;
  fillDark: string;
  edge: string;
  glyph: string;
  ring: string;
}

/** Legacy round-token colours (stub units pass). */
export const FACTION_STYLE: Record<Faction, FactionStyle> = {
  // Storm and ash.
  rebel: { fill: '#3e5f82', fillDark: '#253a52', edge: '#b4c3d1', glyph: '#f0f4f8', ring: '#7fd6ff' },
  // Gold and white.
  loyalist: { fill: '#dcb559', fillDark: '#a9822c', edge: '#fff7df', glyph: '#2a1c06', ring: '#ffffff' },
};

/** Legacy Domain colours (stub domains pass, controller pulses). New code uses DOMAIN. */
export const DOMAIN_STYLE: Record<DomainKind, { fill: string; edge: string; label: string }> = {
  tempest: { fill: 'rgba(110,150,255,0.20)', edge: 'rgba(150,190,255,0.85)', label: '#bcd4ff' },
  pyre: { fill: 'rgba(255,100,40,0.22)', edge: 'rgba(255,140,60,0.9)', label: '#ffb27a' },
  bulwark: { fill: 'rgba(205,180,130,0.20)', edge: 'rgba(230,205,150,0.85)', label: '#ecd9a8' },
  sanctuary: { fill: 'rgba(255,245,180,0.18)', edge: 'rgba(255,250,210,0.9)', label: '#fff5c8' },
  silence: { fill: 'rgba(120,90,160,0.2)', edge: 'rgba(170,140,210,0.8)', label: '#d0c0f0' },
};

export function hpColor(ratio: number): string {
  return ratio > 0.6 ? HP.good : ratio > 0.3 ? HP.mid : HP.low;
}
