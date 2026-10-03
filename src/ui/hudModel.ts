// Pure view-model helpers for the HUD: bell era, next bell, objectives, unit
// and tile summaries. No DOM.
import {
  BELL_ORDER,
  TERRAIN,
  activeDomainOf,
  bridgeAt,
  domainRoundsRemaining,
  domainsAt,
  effectiveStats,
  exitsAt,
  findObject,
  getNextBell,
  terrainAt,
  unitAt,
  upcomingWaves,
  zonesAt,
  type GameState,
  type ObjectiveId,
  type ObjectiveStatus,
  type ObjectiveType,
  type Pos,
  type Unit,
} from '../engine';
import {
  DOMAIN_NAMES,
  RANK_NAMES,
  STATUS_NAMES,
  TERRAIN_NAMES,
  exitName,
  humanize,
  objectName,
  zoneName,
} from './names';

export type BellEra = 'Midnight' | 'First Bell' | 'Second Bell' | 'Dawn';

const ERA_BY_BELL = { firstBell: 'First Bell', secondBell: 'Second Bell', dawn: 'Dawn' } as const;

/** The latest bell that has rung, or Midnight before any. */
export function bellEra(state: GameState): BellEra {
  let era: BellEra = 'Midnight';
  for (const id of BELL_ORDER) {
    if (state.bells.find((b) => b.id === id)?.rung) era = ERA_BY_BELL[id];
  }
  return era;
}

export function nextBellText(state: GameState): string {
  const next = getNextBell(state);
  if (!next) return 'No bells remain.';
  const n = next.roundsRemaining;
  const when = n <= 0 ? 'now' : n === 1 ? 'in 1 round' : `in ${n} rounds`;
  return `${next.name} ${when} (round ${next.round})`;
}

export function nextWaveText(state: GameState): string | null {
  const w = upcomingWaves(state)[0];
  if (!w || !Number.isFinite(w.round)) return null;
  return `${w.name}: ${w.unitCount} units, round ${w.round}`;
}

export const OBJECTIVE_HINTS: Record<ObjectiveId, string> = {
  killEmperor: 'Bring Varek beside the Emperor and Confront him before Dawn.',
  killElian: 'Only an Ascendant can harm him while sealed. Fails if he escapes.',
  imprisonMira: 'Weaken her to half HP with Kaela, then Capture. Keep Wolves off her.',
  seizeBellTower: 'End a turn with a rebel in the bell tower and no loyalist there: bells delayed 2 rounds.',
  burnBridges: 'Burn the centre and east canal bridges: the Second Bell knights come 2 rounds later.',
};

export interface ObjectiveRow {
  id: ObjectiveId;
  name: string;
  type: ObjectiveType;
  status: ObjectiveStatus;
  icon: string;
  hint: string;
}

export function statusIcon(s: ObjectiveStatus): string {
  return s === 'completed' ? '✓' : s === 'failed' ? '✗' : '○';
}

export function objectiveRows(state: GameState): ObjectiveRow[] {
  return state.objectives.map((o) => ({
    id: o.id,
    name: o.name,
    type: o.type,
    status: o.status,
    icon: statusIcon(o.status),
    hint: OBJECTIVE_HINTS[o.id] ?? '',
  }));
}

/** One-letter glyph for a unit token: named characters by initial, troops by rank (lowercase). */
export function unitGlyph(u: Pick<Unit, 'character' | 'name' | 'rank'>): string {
  if (u.character) return (u.name.replace(/^(Emperor|Crown Prince|Princess|Lady|Lord)\s+/i, '')[0] ?? '?').toUpperCase();
  switch (u.rank) {
    case 'soldier':
      return 's';
    case 'kindled':
      return 'k';
    case 'radiant':
      return 'r';
    case 'ascendant':
      return 'A';
  }
}

export interface UnitSummary {
  id: string;
  name: string;
  faction: Unit['faction'];
  rank: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  move: number;
  range: string;
  statuses: string[];
  notes: string[];
  turn: string;
}

export function unitSummary(state: GameState, u: Unit): UnitSummary {
  const st = effectiveStats(u);
  const notes: string[] = [];
  if (u.domain && u.rank === 'ascendant') {
    const active = activeDomainOf(state, u.id);
    if (active) notes.push(`${DOMAIN_NAMES[u.domain]} active, ${domainRoundsRemaining(state, active)} round(s) left`);
    else notes.push(`Domain: ${DOMAIN_NAMES[u.domain]}${u.domainUsed ? ' (spent)' : ''}`);
  }
  if (u.tags.includes('noResist')) notes.push('Does not resist. Only Varek can Confront him.');
  if (u.tags.includes('anchorBreaker')) notes.push('Anchor breaker');
  if (u.guardZone) notes.push(`Guards ${zoneName(u.guardZone)}`);
  if (u.rank === 'ascendant') notes.push('Non-Ascendants deal at most 1 damage.');
  let turn = '';
  if (u.faction === state.activeFaction) {
    if (u.hasMoved && u.hasActed) turn = 'Done this turn';
    else if (u.hasMoved) turn = 'Moved, can still act';
    else if (u.hasActed) turn = 'Acted, can still move';
    else turn = 'Ready';
  }
  return {
    id: u.id,
    name: u.name,
    faction: u.faction,
    rank: RANK_NAMES[u.rank],
    hp: u.hp,
    maxHp: u.maxHp,
    atk: st.atk,
    def: st.def,
    move: st.move,
    range: st.rangeMin === st.rangeMax ? `${st.rangeMax}` : `${st.rangeMin}–${st.rangeMax}`,
    statuses: u.statuses.map((s) => STATUS_NAMES[s]),
    notes,
    turn,
  };
}

export interface TileInfo {
  pos: Pos;
  terrain: string;
  moveCost: string;
  defense: number;
  zones: string[];
  features: string[];
  unit: UnitSummary | null;
}

export function tileInfo(state: GameState, p: Pos): TileInfo | null {
  const t = terrainAt(state, p);
  if (!t) return null;
  const info = TERRAIN[t];
  const features: string[] = [];
  for (const o of state.map.objects) {
    if (o.kind === 'bridge') continue;
    if (o.pos.x === p.x && o.pos.y === p.y) {
      const label = objectName(o);
      features.push(o.destroyed ? `${label} (${o.kind === 'door' ? 'broken open' : 'shattered'})` : `${label}: ${o.hp}/${o.maxHp} HP`);
    }
  }
  const bridge = bridgeAt(state, p);
  if (bridge) features.push(`${objectName(bridge)}${bridge.burned ? ' (burned)' : ''}`);
  for (const e of exitsAt(state, p)) features.push(`Exit: ${exitName(e.id)}`);
  for (const d of domainsAt(state, p)) features.push(`Inside ${DOMAIN_NAMES[d.kind]}`);
  const u = unitAt(state, p);
  return {
    pos: p,
    terrain: TERRAIN_NAMES[t],
    moveCost: info.moveCost === null ? 'impassable' : String(info.moveCost),
    defense: info.defense,
    zones: zonesAt(state, p).map(zoneName),
    features,
    unit: u ? unitSummary(state, u) : null,
  };
}

/** Convenience for tests and the HUD: find an object by id and name it. */
export function objectLabel(state: GameState, id: string): string {
  const o = findObject(state, id);
  return o ? objectName(o) : humanize(id);
}
