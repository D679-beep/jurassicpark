// Night-time palace palette: dark stone, lantern-gold accents, canal blue.
import type { DomainKind, Faction } from '../engine';

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
  zoneLabel: 'rgba(232,200,114,0.62)',
  exit: 'rgba(200,230,255,0.55)',
  anchorCore: '#c8f4ff',
  anchorGlow: 'rgba(120,170,255,0.75)',
  anchorDead: '#3b3946',
  reach: 'rgba(70,140,255,0.30)',
  reachEdge: 'rgba(130,185,255,0.75)',
  target: 'rgba(255,72,60,0.34)',
  targetEdge: 'rgba(255,120,100,0.95)',
  hover: 'rgba(255,255,255,0.85)',
  path: 'rgba(170,210,255,0.9)',
  hpGood: '#6fcf6f',
  hpMid: '#e8c040',
  hpLow: '#e05040',
  hpBack: 'rgba(0,0,0,0.7)',
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

export const FACTION_STYLE: Record<Faction, FactionStyle> = {
  // Storm and ash.
  rebel: { fill: '#3e5f82', fillDark: '#253a52', edge: '#b4c3d1', glyph: '#f0f4f8', ring: '#7fd6ff' },
  // Gold and white.
  loyalist: { fill: '#dcb559', fillDark: '#a9822c', edge: '#fff7df', glyph: '#2a1c06', ring: '#ffffff' },
};

export const DOMAIN_STYLE: Record<DomainKind, { fill: string; edge: string; label: string }> = {
  tempest: { fill: 'rgba(110,150,255,0.20)', edge: 'rgba(150,190,255,0.85)', label: '#bcd4ff' },
  pyre: { fill: 'rgba(255,100,40,0.22)', edge: 'rgba(255,140,60,0.9)', label: '#ffb27a' },
  bulwark: { fill: 'rgba(205,180,130,0.20)', edge: 'rgba(230,205,150,0.85)', label: '#ecd9a8' },
  sanctuary: { fill: 'rgba(255,245,180,0.18)', edge: 'rgba(255,250,210,0.9)', label: '#fff5c8' },
  silence: { fill: 'rgba(120,90,160,0.2)', edge: 'rgba(170,140,210,0.8)', label: '#d0c0f0' },
};

export function hpColor(ratio: number): string {
  return ratio > 0.6 ? COLORS.hpGood : ratio > 0.3 ? COLORS.hpMid : COLORS.hpLow;
}
