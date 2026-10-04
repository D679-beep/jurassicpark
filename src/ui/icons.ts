// Inline SVG icon strings for the HUD, cards and dialogue (visual-style.md
// 7.2, 7.3): 1em, `currentColor`, `aria-hidden="true"`. Compact path data on
// a 16x16 grid; filled shapes use the root `fill`, stroked ones go through S().
// Owner: WS5 (UI polish).

import type { ObjectiveId, ObjectiveStatus } from '../engine';

export type IconName =
  // objectives
  | 'crown'
  | 'sun'
  | 'book'
  | 'bell'
  | 'bellOff'
  | 'flame'
  // objective status overlays
  | 'check'
  | 'cross'
  | 'ring'
  // cards
  | 'lantern'
  // dialogue marks
  | 'bolt'
  | 'scarf'
  | 'shield'
  // status badges (legend)
  | 'swords'
  | 'padlock'
  | 'drop'
  | 'arrowOut'
  // stats
  | 'heart'
  | 'sword'
  | 'boot'
  | 'target'
  // clock, domain, speed
  | 'banner'
  | 'domain'
  | 'speed';

const F = (d: string): string => `<path d="${d}"/>`;
const E = (d: string): string => `<path fill-rule="evenodd" d="${d}"/>`;
const S = (d: string, w = 1.5): string =>
  `<path fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;

const BELL = 'M8 1.6a1 1 0 0 1 1 1v.5c2 .5 3.3 2.2 3.3 4.4v2.3l1.5 2H2.2l1.5-2V7.5c0-2.2 1.3-3.9 3.3-4.4v-.5a1 1 0 0 1 1-1z';

const BODY: Record<IconName, string> = {
  crown: F('M1.4 4.6l3.7 3L8 2.4l2.9 5.2 3.7-3-.6 7.1H2zM2 13h12v1.7H2z'),
  sun: F('M8 4.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z') + S('M8 1.2v1.9M8 12.9v1.9M1.2 8h1.9M12.9 8h1.9M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3', 1.4),
  book: F('M1.4 3.3C3.9 2.6 6.2 2.8 7.4 4v8.9C6.2 11.9 3.9 11.7 1.4 12.4zM8.6 4c1.2-1.2 3.5-1.4 6-.7v9.1c-2.5-.7-4.8-.5-6 .5z'),
  bell: F(BELL + 'zM6.4 13.4h3.2a1.6 1.6 0 0 1-3.2 0z'),
  bellOff: S(BELL + 'z', 1.2) + S('M6.6 13.6a1.5 1.5 0 0 0 2.8 0', 1.2),
  flame: E('M8 .8c.9 2.7 4.4 4.4 4.4 8.1A4.4 4.4 0 0 1 8 15.2a4.4 4.4 0 0 1-4.4-6.3c0-1.5.6-2.5 1.4-3.3.2 1.2.7 1.7 1.3 2C6.1 5 6.9 3 8 .8zM8 13.4c1.2 0 2-.9 2-2 0-1.3-1-2-2-3.1-1 1.1-2 1.8-2 3.1 0 1.1.8 2 2 2z'),
  check: S('M2.8 8.6l3.3 3.3 7.1-7.6', 2),
  cross: S('M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8', 2),
  ring: '<circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  lantern: S('M6.2 3.2a1.8 1.8 0 0 1 3.6 0', 1.1) + E('M4.8 3.8h6.4l-.6 1.6H5.4zM5.2 6h5.6l1.4 3.4-1.5 3.1H5.3L3.8 9.4zM8 7.4c-1 1.1-1.6 1.8-1.6 2.5a1.6 1.6 0 0 0 3.2 0C9.6 9.2 9 8.5 8 7.4zM5 13.1h6v1.4H5z'),
  bolt: F('M9.6.8 3.6 9h3.7L6.2 15.2l6.6-8.7H9z'),
  scarf: S('M12.4 5.6C10.2 3.6 8.4 7.4 6 5.6 4.4 4.4 3.2 4.6 1.8 5.8M11.8 8.4c-2-1-3.4 2.4-5.4 1.2-1.4-.9-2.4-.8-3.8.4', 2.1) + F('M13.3 4.6a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2z'),
  shield: E('M3.2 1.8h9.6v6.5c0 3-2.2 5-4.8 6.1-2.6-1.1-4.8-3.1-4.8-6.1zM7.3 4h1.4v7.2H7.3z'),
  swords: S('M2.6 2.6 12.6 12.6M13.4 2.6 3.4 12.6M8 12l4-4M4 8l4 4', 1.7) + F('M14 13.6a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0zM4.4 13.6a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0z'),
  padlock: S('M5.3 7.2V5.3a2.7 2.7 0 0 1 5.4 0v1.9', 1.6) + F('M3.3 7h9.4c.3 0 .5.2.5.5v6.2c0 .3-.2.5-.5.5H3.3c-.3 0-.5-.2-.5-.5V7.5c0-.3.2-.5.5-.5z'),
  drop: F('M8 1.2c2.3 3.2 4.6 5.4 4.6 8.2a4.6 4.6 0 0 1-9.2 0C3.4 6.6 5.7 4.4 8 1.2z'),
  arrowOut: S('M9.6 2.6h3.8v3.8M13.4 2.6 7.6 8.4M11 10.6v2.8H2.6V5h2.8', 1.6),
  heart: F('M8 14.4C3.2 11 1.4 8.5 1.4 6a3.3 3.3 0 0 1 6.6-.8A3.3 3.3 0 0 1 14.6 6c0 2.5-1.8 5-6.6 8.4z'),
  sword: S('M13.4 2.6 6.4 9.6M4.2 8.4l3.4 3.4M3.2 13l2.2-2.2', 1.7),
  boot: F('M5 1.8h4v4.4c0 .9.5 1.3 1.3 1.7l2.5 1.2c.6.3 1 .9 1 1.6v2.6H3.2z'),
  target: '<circle cx="8" cy="8" r="4.3" fill="none" stroke="currentColor" stroke-width="1.5"/>' + F('M8 6.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z') + S('M8 1v2.4M8 12.6V15M1 8h2.4M12.6 8H15', 1.4),
  banner: S('M3.6 1.8v12.6', 1.6) + F('M4.4 2.4h8.6l-2.2 3 2.2 3H4.4z'),
  domain: S('M8 1.4l5.8 3.3v6.6L8 14.6l-5.8-3.3V4.7z', 1.4) + F('M8 6.1a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z'),
  speed: S('M2.8 3.4 7 8l-4.2 4.6M8.6 3.4 12.8 8l-4.2 4.6', 1.7),
};

/** The shapes of an icon without the `<svg>` wrapper (for nesting, 16x16 grid). */
export function iconBody(name: IconName): string {
  return BODY[name];
}

const wrap = (body: string, cls: string): string =>
  `<svg class="ic ${cls}" viewBox="0 0 16 16" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;

/** SVG markup for an icon: 1em, `currentColor`, hidden from assistive tech. */
export function icon(name: IconName): string {
  return wrap(BODY[name], `ic-${name}`);
}

// --- faction tokens and ranks (legend) -----------------------------------------------

/** Mini token: rebels = rhombus base + eared hood, loyalists = oval base + crested helm (5.2). */
export function tokenIcon(faction: 'rebel' | 'loyalist'): string {
  const body =
    faction === 'rebel'
      ? '<path d="M1.2 12.6 8 9.6l6.8 3L8 15.6z" fill="#111a26" stroke="#6fd3ff" stroke-width="1"/>' +
        '<path d="M4.6 12.2 5.4 7.6h5.2l.8 4.6L8 11z" fill="#3f6690" stroke="#a9b9c9" stroke-width=".6"/>' +
        '<path d="M5 7.2 5.1 1.6 7 3.7h2l1.9-2.1L11 7.2a3 3 0 0 1-6 0z" fill="#22364f" stroke="#a9b9c9" stroke-width=".7"/>' +
        '<path d="M6.2 5.8h1M8.8 5.8h1" stroke="#6fd3ff" stroke-width="1.1" stroke-linecap="round"/>'
      : '<ellipse cx="8" cy="12.9" rx="6.8" ry="2.5" fill="#2a200c" stroke="#fff1b8" stroke-width="1"/>' +
        '<path d="M4.6 12.4 5.4 7.8h5.2l.8 4.6z" fill="#e0b955" stroke="#fff8e4" stroke-width=".6"/>' +
        '<ellipse cx="8" cy="1.9" rx="1.1" ry="1.5" fill="#c0392b"/>' +
        '<path d="M5 7.4a3 3 0 0 1 6 0z" fill="#efe6cf" stroke="#a89f88" stroke-width=".6"/>' +
        '<path d="M6.2 6.4h3.6" stroke="#2a200c" stroke-width="1" stroke-linecap="round"/>';
  return wrap(body, `ic-token ic-${faction}`);
}

export type RankName = 'soldier' | 'kindled' | 'radiant' | 'ascendant';

const HEAD = '<circle cx="8" cy="5.6" r="2"/>';
const RANK_BODY: Record<RankName, string> = {
  // smallest, no pauldrons, spear
  soldier: HEAD + F('M5.8 14.2V10c0-1.4 1-2.2 2.2-2.2s2.2.8 2.2 2.2v4.2z') + S('M12.6 2.4v11.8', 1.2) + F('M12.6 1.2l1.1 2.2h-2.2z'),
  // pauldrons + glowing blade
  kindled: HEAD + F('M4.6 9.6c0-1 .9-1.9 2-1.9h2.8c1.1 0 2 .9 2 1.9v4.6H4.6z') + S('M13 1.6 11.8 8.6', 1.3),
  // robe flare + staff with orb
  radiant: HEAD + F('M8 7.8c1.5 0 2.4.8 2.8 2.4l1 4H4.2l1-4C5.6 8.6 6.5 7.8 8 7.8z') + S('M3.4 3.6v10.6', 1.2) + '<circle cx="3.4" cy="2.6" r="1.4"/>',
  // tallest: cape + double rim + circlet
  ascendant: '<ellipse cx="8" cy="3" rx="2.1" ry=".8" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="8" cy="5.9" r="1.9"/>' + F('M8 7.8c2 0 3.2 1 3.8 3.1l1.6 3.3H2.6l1.6-3.3C4.8 8.8 6 7.8 8 7.8z'),
};

/** Rank silhouette glyph for the legend (5.3). */
export function rankIcon(rank: RankName): string {
  return wrap(RANK_BODY[rank], `ic-rank ic-${rank}`);
}

// --- objective glyphs ---------------------------------------------------------------------

const OBJECTIVE_ICON: Record<ObjectiveId, IconName> = {
  killEmperor: 'crown',
  killElian: 'sun',
  imprisonMira: 'book',
  seizeBellTower: 'bell',
  burnBridges: 'flame',
};

/** The objective's own glyph (7.3). */
export function objectiveIconName(id: ObjectiveId): IconName {
  return OBJECTIVE_ICON[id] ?? 'ring';
}

/**
 * Objective glyph with its status overlay: a small check (done), cross
 * (failed) or ring (pending) in the lower-right corner.
 */
export function objectiveIcon(id: ObjectiveId, status: ObjectiveStatus): string {
  const mark = status === 'completed' ? 'check' : status === 'failed' ? 'cross' : 'ring';
  return (
    `<span class="oi ${status}">${icon(objectiveIconName(id))}` +
    `<span class="oi-mark">${icon(mark)}</span></span>`
  );
}

// --- dialogue medallion (7.2) --------------------------------------------------------------

const MARK_COLOR = {
  bolt: '#7fe3ff',
  scarf: '#e0483a',
  flame: '#ff8a2e',
  crown: '#ffd24a',
  sun: '#fff6c8',
  shield: '#e0c47a',
  book: '#7fe0d0',
  bell: '#e8c872',
} as const;

/** Circular medallion: the faction plate (rhombus for rebels) with the speaker's mark. */
export function medallion(plate: 'rebel' | 'loyalist' | 'narrator', mark: keyof typeof MARK_COLOR): string {
  const rebel = plate === 'rebel';
  const shape = rebel
    ? '<path d="M20 1.5 38.5 20 20 38.5 1.5 20z" fill="#111a26" stroke="#6fd3ff" stroke-width="1.6"/>'
    : plate === 'loyalist'
      ? '<circle cx="20" cy="20" r="18.2" fill="#2a200c" stroke="#fff1b8" stroke-width="1.6"/>'
      : '<circle cx="20" cy="20" r="18.2" fill="#1b1826" stroke="#9c8344" stroke-width="1.6"/>';
  const [k, t] = rebel ? [1.05, 11.6] : [1.3, 9.6];
  const c = MARK_COLOR[mark];
  return (
    `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">${shape}` +
    `<g transform="translate(${t} ${t}) scale(${k})" fill="${c}" color="${c}">${BODY[mark]}</g></svg>`
  );
}
