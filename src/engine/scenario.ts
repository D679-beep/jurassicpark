// ScenarioDef -> GameState. Validates the definition and throws a
// ScenarioValidationError listing every problem found.
import {
  BARRACKS_ROUTE_TAG,
  BELL_NAMES,
  BELL_ORDER,
  CHARACTER_IDS,
  DEFAULT_BELL_ROUNDS,
  DEFAULT_LEGEND,
  DOMAIN_KINDS,
  FACTIONS,
  OBJECTIVE_INFO,
  OBJECTIVE_ORDER,
  RANKS,
  RANK_STATS,
  RULES,
  STATUSES,
  TAG_NO_RESIST,
  TERRAIN,
  TERRAIN_TYPES,
  ZONES,
} from './data';
import { defaultDomainFor } from './domains';
import { comparePos, posKey, toPos } from './geometry';
import { ScenarioValidationError } from './errors';
import { seedToRngState } from './rng';
import type {
  BellId,
  BellState,
  CharacterId,
  DialogueTrigger,
  Exit,
  GameState,
  MapObject,
  ObjectiveId,
  Pos,
  PosLike,
  RectDef,
  ScenarioDef,
  Terrain,
  Unit,
  UnitPlacement,
  WaveState,
  ZoneDef,
} from './types';

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

function isPosLike(p: unknown): p is PosLike {
  if (Array.isArray(p)) return p.length === 2 && isInt(p[0]) && isInt(p[1]);
  return typeof p === 'object' && p !== null && isInt((p as Pos).x) && isInt((p as Pos).y);
}

function fmt(p: Pos): string {
  return `(${p.x},${p.y})`;
}

function isRect(z: ZoneDef): z is RectDef {
  return typeof (z as RectDef).w === 'number';
}

const VALID_TRIGGERS = new Set<string>([
  'confront',
  'sealBroken',
  'duelEnded',
  'miraCaptured',
  'miraEscaped',
  'miraDied',
  'elianKilled',
  'elianEscaped',
  'bellTowerSeized',
  'bridgesBurned',
  ...BELL_ORDER,
  ...DOMAIN_KINDS.map((d) => `domain:${d}`),
]);

/** Validates a ScenarioDef and builds the initial GameState (round 1, player phase). */
export function createGame(def: ScenarioDef): GameState {
  const issues: string[] = [];
  const err = (m: string): void => {
    issues.push(m);
  };
  const id = typeof def?.id === 'string' ? def.id : '(unnamed)';
  if (typeof def !== 'object' || def === null) throw new ScenarioValidationError(id, ['definition must be an object']);
  if (typeof def.id !== 'string' || def.id === '') err('id must be a non-empty string');
  if (typeof def.name !== 'string') err('name must be a string');
  if (!FACTIONS.includes(def.playerFaction)) err(`playerFaction must be one of ${FACTIONS.join(', ')}`);
  if (!isInt(def.seed)) err('seed must be an integer');

  // --- map ---
  const legend: Record<string, Terrain> = { ...DEFAULT_LEGEND, ...(def.legend ?? {}) };
  for (const [ch, t] of Object.entries(def.legend ?? {})) {
    if (ch.length !== 1) err(`legend key "${ch}" must be a single character`);
    if (!TERRAIN_TYPES.includes(t)) err(`legend "${ch}" maps to unknown terrain "${String(t)}"`);
  }
  const rows = Array.isArray(def.map) ? def.map : [];
  if (rows.length === 0) err('map must have at least one row');
  const width = rows[0]?.length ?? 0;
  if (rows.length > 0 && width === 0) err('map rows must not be empty');
  const terrain: Terrain[][] = rows.map((row, y) => {
    if (row.length !== width) err(`map row ${y} has length ${row.length}, expected ${width}`);
    return [...row].map((ch, x) => {
      const t = legend[ch];
      if (!t || !TERRAIN_TYPES.includes(t)) {
        err(`map char "${ch}" at (${x},${y}) is not in the legend`);
        return 'wall';
      }
      return t;
    });
  });
  const height = rows.length;
  const inB = (p: Pos): boolean => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
  const tAt = (p: Pos): Terrain | undefined => terrain[p.y]?.[p.x];
  const passable = (p: Pos): boolean => {
    const t = tAt(p);
    return t !== undefined && TERRAIN[t].moveCost !== null;
  };
  const posList = (list: unknown, where: string): Pos[] => {
    if (!Array.isArray(list)) {
      err(`${where} must be an array of positions`);
      return [];
    }
    const out: Pos[] = [];
    for (const p of list) {
      if (!isPosLike(p)) {
        err(`${where} contains an invalid position ${JSON.stringify(p)}`);
        continue;
      }
      const q = toPos(p);
      if (!inB(q)) err(`${where} position ${fmt(q)} is outside the ${width}x${height} map`);
      else out.push(q);
    }
    return out;
  };

  // --- zones ---
  const zones: Record<string, Pos[]> = {};
  for (const [zid, z] of Object.entries(def.zones ?? {})) {
    const tiles = new Map<string, Pos>();
    const addRect = (r: RectDef): void => {
      if (![r.x, r.y, r.w, r.h].every(isInt) || r.w < 1 || r.h < 1) {
        err(`zone "${zid}" has an invalid rect ${JSON.stringify(r)}`);
        return;
      }
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const p = { x, y };
          if (!inB(p)) {
            err(`zone "${zid}" rect extends outside the map at ${fmt(p)}`);
            return;
          }
          tiles.set(posKey(p), p);
        }
      }
    };
    if (typeof z !== 'object' || z === null) {
      err(`zone "${zid}" must be a rect or { rects, tiles }`);
      continue;
    }
    if (isRect(z)) addRect(z);
    else {
      for (const r of z.rects ?? []) addRect(r);
      for (const p of posList(z.tiles ?? [], `zone "${zid}" tiles`)) tiles.set(posKey(p), p);
    }
    if (tiles.size === 0) err(`zone "${zid}" has no tiles`);
    zones[zid] = [...tiles.values()].sort(comparePos);
  }
  const inZone = (p: Pos, zid: string): boolean => (zones[zid] ?? []).some((t) => t.x === p.x && t.y === p.y);

  // --- ids ---
  const ids = new Set<string>();
  const claimId = (oid: unknown, what: string): boolean => {
    if (typeof oid !== 'string' || oid === '') {
      err(`${what} has a missing or empty id`);
      return false;
    }
    if (ids.has(oid)) {
      err(`duplicate id "${oid}" (${what}); unit, object, wave and exit ids must be unique`);
      return false;
    }
    ids.add(oid);
    return true;
  };

  // --- objects ---
  const objects: MapObject[] = [];
  const blockingTiles = new Set<string>();
  const bridgeTiles = new Set<string>();
  for (const o of def.objects ?? []) {
    claimId(o.id, `object ${JSON.stringify(o.id)}`);
    const where = `object "${o.id}"`;
    if (o.kind === 'door' || o.kind === 'anchor') {
      if (!isPosLike(o.pos)) {
        err(`${where} has an invalid pos`);
        continue;
      }
      const p = toPos(o.pos);
      if (!inB(p)) {
        err(`${where} at ${fmt(p)} is outside the map`);
        continue;
      }
      const defaultHp = o.kind === 'door' ? RULES.defaultDoorHp : RULES.anchorHp;
      const hp = o.hp ?? defaultHp;
      const odef = o.def ?? 0;
      if (!isInt(hp) || hp < 1) err(`${where} hp must be a positive integer`);
      if (!isInt(odef) || odef < 0) err(`${where} def must be a non-negative integer`);
      if (o.kind === 'door' && tAt(p) !== 'door') err(`${where}: barred door at ${fmt(p)} must be on door terrain (found ${tAt(p)})`);
      if (o.kind === 'anchor' && !passable(p)) err(`${where}: ward anchor at ${fmt(p)} must be on passable terrain`);
      if (blockingTiles.has(posKey(p))) err(`${where}: another door/anchor already occupies ${fmt(p)}`);
      blockingTiles.add(posKey(p));
      objects.push({ id: o.id, kind: o.kind, pos: p, hp, maxHp: hp, def: odef, destroyed: false });
    } else if (o.kind === 'bridge') {
      const tiles = posList(o.tiles, `${where} tiles`);
      if (tiles.length === 0) err(`${where} must have at least one tile`);
      for (const t of tiles) {
        if (tAt(t) !== 'bridge') err(`${where} tile ${fmt(t)} must be bridge terrain (found ${tAt(t)})`);
        if (bridgeTiles.has(posKey(t))) err(`${where} tile ${fmt(t)} belongs to another bridge`);
        bridgeTiles.add(posKey(t));
      }
      objects.push({ id: o.id, kind: 'bridge', tiles: tiles.sort(comparePos), tags: [...(o.tags ?? [])], burned: false });
    } else {
      err(`${where} has unknown kind "${(o as { kind: unknown }).kind}"`);
    }
  }
  // Every bridge tile is burnable: undeclared bridge tiles become single-tile bridges.
  terrain.forEach((row, y) =>
    row.forEach((t, x) => {
      if (t === 'bridge' && !bridgeTiles.has(posKey({ x, y }))) {
        const bid = `bridge@${x},${y}`;
        if (claimId(bid, 'auto bridge')) objects.push({ id: bid, kind: 'bridge', tiles: [{ x, y }], tags: [], burned: false });
      }
    }),
  );

  // --- units ---
  const characters = new Set<CharacterId>();
  const occupied = new Set<string>();
  const buildUnit = (p: UnitPlacement, where: string, needsPos: boolean, fallbackPos: Pos | null): Unit | null => {
    claimId(p.id, where);
    if (!FACTIONS.includes(p.faction)) err(`${where}: faction must be one of ${FACTIONS.join(', ')}`);
    if (!RANKS.includes(p.rank)) {
      err(`${where}: rank must be one of ${RANKS.join(', ')}`);
      return null;
    }
    const base = RANK_STATS[p.rank];
    const st = p.stats ?? {};
    const maxHp = st.maxHp ?? st.hp ?? base.hp;
    const hp = st.hp ?? maxHp;
    const atk = st.atk ?? base.atk;
    const dfn = st.def ?? base.def;
    const move = st.move ?? base.move;
    const rmin = st.rangeMin ?? base.rangeMin;
    const rmax = st.rangeMax ?? Math.max(base.rangeMax, rmin);
    if (!isInt(maxHp) || maxHp < 1) err(`${where}: maxHp must be a positive integer`);
    if (!isInt(hp) || hp < 1 || hp > maxHp) err(`${where}: hp must be an integer in 1..maxHp`);
    if (!isInt(atk) || atk < 0) err(`${where}: atk must be a non-negative integer`);
    if (!isInt(dfn) || dfn < 0) err(`${where}: def must be a non-negative integer`);
    if (!isInt(move) || move < 0) err(`${where}: move must be a non-negative integer`);
    if (!isInt(rmin) || rmin < 1) err(`${where}: rangeMin must be an integer >= 1`);
    if (!isInt(rmax) || rmax < rmin) err(`${where}: rangeMax must be an integer >= rangeMin`);
    if (p.character !== undefined) {
      if (!CHARACTER_IDS.includes(p.character)) err(`${where}: unknown character "${p.character}"`);
      else if (characters.has(p.character)) err(`${where}: character "${p.character}" is placed more than once`);
      else characters.add(p.character);
    }
    const statuses = p.statuses ?? [];
    for (const s of statuses) if (!STATUSES.includes(s)) err(`${where}: unknown status "${s}"`);
    const tags = p.tags ?? [];
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) err(`${where}: tags must be strings`);
    let domain = p.domain === undefined ? (p.rank === 'ascendant' ? defaultDomainFor(p) : null) : p.domain;
    if (domain !== null && !DOMAIN_KINDS.includes(domain)) {
      err(`${where}: unknown domain "${domain}"`);
      domain = null;
    }
    if (domain !== null && p.rank !== 'ascendant') err(`${where}: only Ascendants can have a Domain`);
    if (p.guardZone !== undefined && zones[p.guardZone] === undefined) err(`${where}: guardZone "${p.guardZone}" is not a zone`);
    if (p.character === 'halden' && !tags.includes(TAG_NO_RESIST)) err(`${where}: Halden must have the "${TAG_NO_RESIST}" tag`);

    let pos: Pos;
    if (p.pos !== undefined) {
      if (!isPosLike(p.pos)) {
        err(`${where}: invalid pos`);
        return null;
      }
      pos = toPos(p.pos);
      if (!inB(pos)) err(`${where}: pos ${fmt(pos)} is outside the map`);
      else if (!passable(pos)) err(`${where}: pos ${fmt(pos)} is impassable terrain (${tAt(pos)})`);
      else if (blockingTiles.has(posKey(pos))) err(`${where}: pos ${fmt(pos)} holds a barred door or ward anchor`);
    } else if (needsPos || !fallbackPos) {
      err(`${where}: pos is required`);
      return null;
    } else {
      pos = fallbackPos;
    }
    if (needsPos) {
      if (occupied.has(posKey(pos))) err(`${where}: pos ${fmt(pos)} is already occupied`);
      occupied.add(posKey(pos));
    }
    return {
      id: p.id,
      name: p.name ?? p.id,
      faction: p.faction,
      rank: p.rank,
      character: p.character ?? null,
      hp,
      maxHp,
      atk,
      def: dfn,
      move,
      range: { min: rmin, max: rmax },
      pos,
      hasMoved: false,
      hasActed: false,
      statuses: [...new Set(statuses)],
      tags: [...new Set(tags)],
      domain,
      domainUsed: false,
      guardZone: p.guardZone ?? null,
    };
  };

  if (!Array.isArray(def.units)) err('units must be an array');
  const units: Unit[] = [];
  for (const p of Array.isArray(def.units) ? def.units : []) {
    const u = buildUnit(p, `unit "${p.id}"`, true, null);
    if (u) units.push(u);
  }

  // --- bells ---
  const bellRounds: Record<BellId, number> = { ...DEFAULT_BELL_ROUNDS, ...(def.bells ?? {}) };
  for (const [bid, r] of Object.entries(def.bells ?? {})) {
    if (!BELL_ORDER.includes(bid as BellId)) err(`bells: unknown bell "${bid}"`);
    if (!isInt(r) || r < 2) err(`bells.${bid} must be an integer round >= 2`);
  }
  for (let i = 1; i < BELL_ORDER.length; i++) {
    const a = BELL_ORDER[i - 1]!;
    const b = BELL_ORDER[i]!;
    if (!(bellRounds[a] < bellRounds[b])) err(`bells must be strictly increasing: ${a} (${bellRounds[a]}) < ${b} (${bellRounds[b]})`);
  }
  const bells: BellState[] = BELL_ORDER.map((bid) => ({
    id: bid,
    name: BELL_NAMES[bid],
    baseRound: bellRounds[bid],
    round: bellRounds[bid],
    rung: false,
  }));

  // --- waves ---
  const waves: WaveState[] = [];
  for (const w of def.waves ?? []) {
    const where = `wave "${w.id}"`;
    claimId(w.id, where);
    if (!BELL_ORDER.includes(w.bell)) err(`${where}: unknown bell "${String(w.bell)}"`);
    const delay = w.delay ?? 0;
    if (!isInt(delay) || delay < 0) err(`${where}: delay must be a non-negative integer`);
    const spawnTiles = posList(w.spawnTiles, `${where} spawnTiles`);
    if (spawnTiles.length === 0) err(`${where}: needs at least one spawn tile`);
    for (const t of spawnTiles) if (!passable(t)) err(`${where}: spawn tile ${fmt(t)} is impassable`);
    const wunits: Unit[] = [];
    (Array.isArray(w.units) ? w.units : []).forEach((p, i) => {
      const fallback = spawnTiles[i % Math.max(1, spawnTiles.length)] ?? null;
      const u = buildUnit(p, `${where} unit "${p.id}"`, false, fallback);
      if (!u) return;
      if (u.statuses.includes('sealed') || u.statuses.includes('dueling')) err(`${where} unit "${p.id}": reinforcements cannot start sealed or dueling`);
      wunits.push(u);
    });
    if (wunits.length === 0) err(`${where}: needs at least one unit`);
    waves.push({ id: w.id, name: w.name ?? w.id, bell: w.bell, delay, spawnTiles, units: wunits, spawned: false, arrivedRound: null });
  }

  // --- exits ---
  const exits: Exit[] = [];
  for (const e of def.exits ?? []) {
    const where = `exit "${e.id}"`;
    claimId(e.id, where);
    const tiles = posList(e.tiles, `${where} tiles`);
    if (tiles.length === 0) err(`${where}: needs at least one tile`);
    for (const t of tiles) if (!passable(t)) err(`${where}: tile ${fmt(t)} is impassable`);
    if (e.zone !== undefined && zones[e.zone] === undefined) err(`${where}: zone "${e.zone}" is not defined`);
    exits.push({ id: e.id, zone: e.zone ?? null, tiles, units: [...(e.units ?? [])] });
  }

  // --- set pieces ---
  const dueling = units.filter((u) => u.statuses.includes('dueling'));
  let duel: GameState['duel'] = null;
  if (dueling.length > 0) {
    const [a, b] = dueling;
    if (dueling.length !== 2 || !a || !b) err(`exactly two units may start dueling (found ${dueling.length})`);
    else if (a.faction === b.faction) err('the two duelists must be on opposing factions');
    else if (zones[ZONES.feastHall] === undefined) err('dueling units require a "feastHall" zone');
    else if (!inZone(a.pos, ZONES.feastHall) || !inZone(b.pos, ZONES.feastHall)) err('both duelists must start inside feastHall');
    else duel = { unitIds: [a.id, b.id], active: true };
  }

  // --- objectives ---
  const has = (c: CharacterId): boolean => characters.has(c);
  const routeBridges = objects.filter((o) => o.kind === 'bridge' && o.tags.includes(BARRACKS_ROUTE_TAG));
  const prereq: Record<ObjectiveId, string | null> = {
    killEmperor: has('halden') && has('varek') ? null : 'requires characters "halden" and "varek"',
    killElian: has('elian') ? null : 'requires character "elian"',
    imprisonMira: has('mira') ? null : 'requires character "mira"',
    seizeBellTower: zones[ZONES.bellTower] ? null : 'requires a "bellTower" zone',
    burnBridges: routeBridges.length > 0 ? null : `requires at least one bridge tagged "${BARRACKS_ROUTE_TAG}"`,
  };
  let objectiveIds: ObjectiveId[];
  if (def.objectives !== undefined) {
    objectiveIds = [];
    for (const oid of def.objectives) {
      if (!OBJECTIVE_ORDER.includes(oid)) err(`objectives: unknown objective "${String(oid)}"`);
      else if (prereq[oid]) err(`objective "${oid}" ${prereq[oid]}`);
      else if (!objectiveIds.includes(oid)) objectiveIds.push(oid);
    }
  } else {
    objectiveIds = OBJECTIVE_ORDER.filter((oid) => prereq[oid] === null);
  }

  // --- dialogue ---
  const dialogue: GameState['dialogue'] = {};
  for (const [trig, lines] of Object.entries(def.dialogue ?? {})) {
    if (!VALID_TRIGGERS.has(trig)) err(`dialogue: unknown trigger "${trig}"`);
    if (!Array.isArray(lines) || lines.some((l) => typeof l?.speaker !== 'string' || typeof l?.text !== 'string')) {
      err(`dialogue "${trig}" must be an array of { speaker, text } strings`);
      continue;
    }
    dialogue[trig as DialogueTrigger] = lines.map((l) => ({ speaker: l.speaker, text: l.text }));
  }

  if (issues.length > 0) throw new ScenarioValidationError(id, issues);

  const playerFaction = def.playerFaction;
  const aiFaction = playerFaction === 'rebel' ? 'loyalist' : 'rebel';
  return {
    scenarioId: def.id,
    scenarioName: def.name,
    seed: def.seed,
    rng: seedToRngState(def.seed),
    map: { width, height, terrain, zones, objects, exits },
    units,
    removedUnits: [],
    round: 1,
    phase: 'player',
    activeFaction: playerFaction,
    playerFaction,
    aiFaction,
    bells,
    waves,
    modifiers: { bellTowerSeized: false, bridgesBurned: false },
    domains: [],
    duel,
    sealBroken: false,
    objectives: objectiveIds.map((oid) => ({ id: oid, name: OBJECTIVE_INFO[oid].name, type: OBJECTIVE_INFO[oid].type, status: 'pending' })),
    outcome: {
      emperorKilled: false,
      elianOutcome: 'alive',
      miraOutcome: 'free',
    },
    dialogue,
    gameOver: false,
    result: null,
  };
}
