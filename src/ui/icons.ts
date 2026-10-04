// Inline SVG icon strings for the HUD, cards and dialogue (visual-style.md
// 7.2, 7.3): 1em, `currentColor`, `aria-hidden="true"`.
// Owner: WS5 (UI polish). WS0 STUB: the names are fixed here so WS5 can fill
// in the artwork; every icon is currently an empty placeholder (nothing in
// the HUD uses them yet).

export type IconName =
  // objectives
  | 'crown'
  | 'sun'
  | 'book'
  | 'bell'
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
  | 'arrowOut';

/** SVG markup for an icon (empty until WS5 draws them). */
export function icon(_name: IconName): string {
  return '';
}
