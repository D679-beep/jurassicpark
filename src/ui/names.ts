// Human-readable names for ids, zones, terrain, Domains and interactions. Pure.
import type { DomainKind, Faction, GameState, InteractionKind, MapObject, Rank, Status, Terrain } from '../engine';

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
  table: 'Banquet table',
  crates: 'Crates',
  stairs: 'Quay steps',
  brazier: 'Brazier',
  bell: 'Great bell',
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

/**
 * Display names for known map objects, keyed by id. Content objects carry no
 * display name, so the prologue's doors, ward anchors and bridges are listed here.
 * Ids not in the table fall back to {@link derivedObjectName}.
 */
const OBJECT_NAMES: Record<string, string> = {
  doorThroneMain: 'Throne Hall main door',
  doorThroneWest: 'Throne Hall west door',
  doorThroneEast: 'Throne Hall east door',
  doorWellNorth: 'Wellspring north door',
  doorWellSouth: 'Wellspring south door',
  anchorA: 'Ward anchor (west)',
  anchorB: 'Ward anchor (east)',
  anchorC: 'Ward anchor (south)',
  bridgeWest: 'West bridge',
  bridgeCenter: 'Center bridge',
  bridgeEast: 'East bridge',
};

const EXIT_NAMES: Record<string, string> = {
  miraExit: "Mira's escape route",
  elianExit: "Elian's tunnel exit",
};

/** Name derived from the id alone: "doorThroneMain" -> "Throne Main door", "anchorA" -> "Ward anchor A". */
export function derivedObjectName(o: Pick<MapObject, 'id' | 'kind'>): string {
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

/** Readable object name: an explicit `name` if the object has one, else the table, else derived from the id. */
export function objectName(o: Pick<MapObject, 'id' | 'kind'> & { name?: string }): string {
  return o.name || OBJECT_NAMES[o.id] || derivedObjectName(o);
}

export function exitName(id: string): string {
  return EXIT_NAMES[id] ?? humanize(id);
}

/** Looks up a display name for any unit (in play or removed), object or wave id. */
export interface NameLookup {
  (id: string | null | undefined): string;
  /** The faction of an AI-controlled unit (in play, removed or in a wave), or undefined for any other id. */
  aiFactionOf?(id: string): Faction | undefined;
}

export function makeNameLookup(...states: (GameState | null | undefined)[]): NameLookup {
  const names = new Map<string, string>();
  const aiUnits = new Map<string, Faction>();
  for (const s of states) {
    if (!s) continue;
    for (const u of s.units) {
      names.set(u.id, u.name);
      if (u.faction === s.aiFaction) aiUnits.set(u.id, u.faction);
    }
    for (const r of s.removedUnits) {
      names.set(r.unit.id, r.unit.name);
      if (r.unit.faction === s.aiFaction) aiUnits.set(r.unit.id, r.unit.faction);
    }
    for (const o of s.map.objects) names.set(o.id, objectName(o));
    for (const w of s.waves) {
      names.set(w.id, w.name);
      for (const u of w.units) {
        if (!names.has(u.id)) names.set(u.id, u.name);
        if (u.faction === s.aiFaction) aiUnits.set(u.id, u.faction);
      }
    }
    for (const e of s.map.exits) names.set(e.id, exitName(e.id));
  }
  const lookup: NameLookup = (id) => (id ? names.get(id) ?? humanize(id) : 'Someone');
  lookup.aiFactionOf = (id) => aiUnits.get(id);
  return lookup;
}
