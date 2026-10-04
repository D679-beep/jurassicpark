// Scenario variants for the balance log. Each undoes tuning changes from the
// current prologue, so one change can be measured on its own:
//   --variant undo-orsa (etc.)  the current content with one v0.3 change undone
//   --variant v0.2              the previous pass (all v0.3 changes undone)
//   --variant no-duel (etc.)    v0.2 with one v0.1 -> v0.2 change undone
//   --variant v0.1              the untuned scenario
import type { ObjectDef, ScenarioDef, UnitPlacement } from '../../src/engine';
import { prologueScenario } from '../../src/content';

type Edit = (s: ScenarioDef) => ScenarioDef;

const mapUnits = (s: ScenarioDef, f: (u: UnitPlacement) => UnitPlacement | null): ScenarioDef => ({
  ...s,
  units: s.units.map(f).filter((u): u is UnitPlacement => u !== null),
});

const withoutStats = (u: UnitPlacement): UnitPlacement => {
  const { stats: _stats, ...rest } = u;
  return rest;
};

/** anchorC back on (16,11), inside doorWellSouth. */
const revertAnchor: Edit = (s) => ({
  ...s,
  objects: (s.objects ?? []).map((o) => (o.id === 'anchorC' && o.kind === 'anchor' ? { ...o, pos: [16, 11] as const } : o)),
});

/** Throne Hall garrison back to 2 Kindled + 2 Soldiers, no Radiant. */
const revertThrone: Edit = (s) =>
  mapUnits(s, (u) => {
    if (u.id === 'g-throne-4') return null;
    if (u.id === 'g-throne-3' || u.id === 'g-ante-1') return { ...u, rank: 'soldier' };
    return u;
  });

/** Only the antechamber guard back to a Soldier. */
const revertAnte: Edit = (s) => mapUnits(s, (u) => (u.id === 'g-ante-1' ? { ...u, rank: 'soldier' } : u));

/** Grimm and Orsa back to baseline Ascendant stats. */
const revertDuel: Edit = (s) => mapUnits(s, (u) => (u.id === 'grimm' || u.id === 'orsa' ? withoutStats(u) : u));

/** Elian back to full 40 HP. */
const revertElian: Edit = (s) => mapUnits(s, (u) => (u.id === 'elian' ? withoutStats(u) : u));

// --- v0.3 "Rebel-favoured" changes, one undo each (applied to the current content) ---

const mapObjects = (s: ScenarioDef, f: (o: ObjectDef) => ObjectDef): ScenarioDef => ({ ...s, objects: (s.objects ?? []).map(f) });

const setStats = (u: UnitPlacement, stats: UnitPlacement['stats'] | undefined): UnitPlacement => {
  const rest = withoutStats(u);
  return stats && Object.keys(stats).length > 0 ? { ...rest, stats } : rest;
};

/** Orsa back to the v0.2 duel stats: 44 HP, ATK 8 (DEF 5 stays). */
const undoOrsa: Edit = (s) => mapUnits(s, (u) => (u.id === 'orsa' ? setStats(u, { ...u.stats, hp: 44, atk: 8 }) : u));

/** The Radiant guard back on the Throne Hall's east pillar (18,2), in its old place in the unit list. */
const undoRadiant: Edit = (s) => {
  if (s.units.some((u) => u.id === 'g-throne-4')) return s;
  const radiant: UnitPlacement = { id: 'g-throne-4', name: 'Palace Guard', faction: 'loyalist', rank: 'radiant', pos: [18, 2], guardZone: 'throneHall' };
  const at = s.units.findIndex((u) => u.id === 'g-throne-3') + 1;
  return { ...s, units: [...s.units.slice(0, at), radiant, ...s.units.slice(at)] };
};

/** The antechamber guard back to a Kindled. */
const undoAnte: Edit = (s) => mapUnits(s, (u) => (u.id === 'g-ante-1' ? { ...u, rank: 'kindled' } : u));

/** Mira back to the Radiant baseline ATK 6. */
const undoMira: Edit = (s) => mapUnits(s, (u) => (u.id === 'mira' ? setStats(u, { ...u.stats, atk: 6 }) : u));

/** The tower's upper guard back to a Kindled. */
const undoTower: Edit = (s) => mapUnits(s, (u) => (u.id === 'g-tower-1' ? { ...u, rank: 'kindled' } : u));

const doorHp =
  (id: string, hp: number): Edit =>
  (s) =>
    mapObjects(s, (o) => (o.id === id && o.kind === 'door' ? { ...o, hp } : o));

/** doorWellSouth back to 14 HP. */
const undoSouthDoor = doorHp('doorWellSouth', 14);

const V03_UNDO: Edit[] = [undoOrsa, undoRadiant, undoAnte, undoMira, undoTower, undoSouthDoor];

/** The previous pass (v0.2): every v0.3 change undone. */
const toV02: Edit = (s) => V03_UNDO.reduce((acc, e) => e(acc), s);

export const VARIANTS: Record<string, Edit> = {
  current: (s) => s,
  // v0.3 changes, one at a time.
  'undo-orsa': undoOrsa,
  'undo-radiant': undoRadiant,
  'undo-ante': undoAnte,
  'undo-throne': (s) => undoAnte(undoRadiant(s)),
  'undo-mira': undoMira,
  'undo-tower': undoTower,
  'undo-south-door': undoSouthDoor,
  // The previous pass, and its own single-change variants (applied on top of v0.2).
  'v0.2': toV02,
  'v0.1': (s) => revertElian(revertDuel(revertThrone(revertAnchor(toV02(s))))),
  'no-anchor': (s) => revertAnchor(toV02(s)),
  'no-throne': (s) => revertThrone(toV02(s)),
  'ante-soldier': (s) => revertAnte(toV02(s)),
  'no-duel': (s) => revertDuel(toV02(s)),
  'no-elian': (s) => revertElian(toV02(s)),
};

export function scenarioVariant(name: string): ScenarioDef {
  const edit = VARIANTS[name];
  if (!edit) throw new Error(`unknown variant "${name}" (known: ${Object.keys(VARIANTS).join(', ')})`);
  return edit(prologueScenario);
}
