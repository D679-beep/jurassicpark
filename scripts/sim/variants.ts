// Scenario variants for the balance log: each undoes one tuning change from
// the current prologue, so `npm run sim -- --variant v0.1` replays the
// untuned scenario and `--variant no-duel` (etc.) isolates one change.
import type { ScenarioDef, UnitPlacement } from '../../src/engine';
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

export const VARIANTS: Record<string, Edit> = {
  current: (s) => s,
  'v0.1': (s) => revertElian(revertDuel(revertThrone(revertAnchor(s)))),
  'no-anchor': revertAnchor,
  'no-throne': revertThrone,
  'ante-soldier': revertAnte,
  'no-duel': revertDuel,
  'no-elian': revertElian,
};

export function scenarioVariant(name: string): ScenarioDef {
  const edit = VARIANTS[name];
  if (!edit) throw new Error(`unknown variant "${name}" (known: ${Object.keys(VARIANTS).join(', ')})`);
  return edit(prologueScenario);
}
