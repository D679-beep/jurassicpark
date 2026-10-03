// Human-readable names for ids, zones, terrain, Domains and interactions. Pure.
import type { DomainKind, GameState, InteractionKind, MapObject, Rank, Status, Terrain } from '../engine';

/** "throneHall" -> "Throne Hall", "g-throne-1" -> "G Throne 1". */
export function humanize(id: string): string {
  const spaced = id
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

const ZONE_NAMES: Record<string, string> = {
  throneHall: 'Throne Hall',
  wellspringHall: 'Wellspring Hall',
  feastHall: 'Feast Hall',
  princessTower: "Princess's Tower",
  bellTower: 'Bell Tower',
  innerGate: 'Inner Gate',
  servantsTunnel: "Servants' Tunnel",
  antechamber: 'Antechamber',
  eastCourt: 'East Court',
  quay: 'Quay',
};

export function zoneName(id: string): string {
  return ZONE_NAMES[id] ?? humanize(id);
}

export const TERRAIN_NAMES: Record<Terrain, string> = {
  floor: 'Floor',
  wall: 'Wall',
  door: 'Door',
  rubble: 'Rubble',
  water: 'Canal',
  bridge: 'Bridge',
  pillar: 'Pillar',
  throne: 'Throne dais',
  dais: 'Dais',
};

export const RANK_NAMES: Record<Rank, string> = {
  soldier: 'Soldier',
  kindled: 'Kindled',
  radiant: 'Radiant',
  ascendant: 'Ascendant',
};

export const DOMAIN_NAMES: Record<DomainKind, string> = {
  tempest: 'Tempest',
  pyre: 'Pyre',
  bulwark: 'Bulwark',
  sanctuary: 'Sanctuary',
  silence: 'Silence',
};

export const STATUS_NAMES: Record<Status, string> = {
  sealed: 'Sealed',
  dueling: 'Dueling',
  drained: 'Drained',
};

export const INTERACTION_NAMES: Record<InteractionKind, string> = {
  confront: 'Confront',
  capture: 'Capture',
  burnBridge: 'Burn Bridge',
  escape: 'Escape',
};

/** "doorThroneMain" -> "Throne Main door", "anchorA" -> "Ward anchor A", "bridgeEast" -> "East bridge". */
export function objectName(o: Pick<MapObject, 'id' | 'kind'>): string {
  const rest = (prefix: string): string | null => {
    if (!o.id.toLowerCase().startsWith(prefix)) return null;
    const r = humanize(o.id.slice(prefix.length));
    return r === '' ? null : r;
  };
  if (o.kind === 'door') {
    const r = rest('door');
    return r ? `${r} door` : `Barred door ${humanize(o.id)}`;
  }
  if (o.kind === 'anchor') {
    const r = rest('anchor');
    return r ? `Ward anchor ${r}` : `Ward anchor ${humanize(o.id)}`;
  }
  const r = rest('bridge');
  return r ? `${r} bridge` : humanize(o.id);
}

/** Looks up a display name for any unit (in play or removed), object or wave id. */
export type NameLookup = (id: string | null | undefined) => string;

export function makeNameLookup(...states: (GameState | null | undefined)[]): NameLookup {
  const names = new Map<string, string>();
  for (const s of states) {
    if (!s) continue;
    for (const u of s.units) names.set(u.id, u.name);
    for (const r of s.removedUnits) names.set(r.unit.id, r.unit.name);
    for (const o of s.map.objects) names.set(o.id, objectName(o));
    for (const w of s.waves) {
      names.set(w.id, w.name);
      for (const u of w.units) if (!names.has(u.id)) names.set(u.id, u.name);
    }
    for (const e of s.map.exits) names.set(e.id, humanize(e.id));
  }
  return (id) => (id ? names.get(id) ?? humanize(id) : 'Someone');
}
