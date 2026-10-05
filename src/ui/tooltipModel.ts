// What the hover tooltip says for a tile, as plain data (the controller turns
// it into HTML). Pure.
import { findUnit, type GameState } from '../engine';
import { interactionName } from './interactions';
import { makeNameLookup } from './names';
import { attackForecast, forecastText, type Selection, type TileIntent } from './selection';

export type TooltipLineKind = 'dmg' | 'desc' | 'act' | 'muted';

export interface TooltipModel {
  /** `attack` keeps the red forecast look, `interact` the amber one. */
  cls: 'attack' | 'interact';
  title: string;
  /** Small grey text after the title (the target's HP). */
  sub?: string;
  lines: { kind: TooltipLineKind; text: string }[];
}

/** The tooltip for the tile the pointer is on, or null when there is nothing to say. */
export function tooltipFor(state: GameState, sel: Selection, intent: TileIntent | null, touch: boolean): TooltipModel | null {
  if (sel.mode !== 'unit' || !intent || intent.kind === 'move') return null;
  const name = makeNameLookup(state);
  const click = touch ? 'Tap again' : 'Click';
  switch (intent.kind) {
    case 'attack': {
      const f = attackForecast(state, sel.unitId, intent.target.id);
      if (!f) return null;
      return {
        cls: 'attack',
        title: name(intent.target.id),
        sub: `HP ${f.targetHp}`,
        lines: [
          { kind: 'dmg', text: forecastText(f) },
          { kind: 'muted', text: `${click} to attack` },
        ],
      };
    }
    case 'interact': {
      const t = intent.target;
      const lines: TooltipModel['lines'] = [
        { kind: 'desc', text: t.hint },
        { kind: 'act', text: `${click} to ${interactionName(t.interaction)}` },
      ];
      if (intent.alsoAttack) {
        const f = attackForecast(state, sel.unitId, intent.alsoAttack.id);
        lines.push({ kind: 'muted', text: `Shift+click to attack instead${f ? ` (${forecastText(f)})` : ''}` });
      }
      return { cls: 'interact', title: t.label, lines };
    }
    case 'approach': {
      const o = intent.option;
      const who = findUnit(state, sel.unitId)?.name ?? 'The unit';
      return {
        cls: 'interact',
        title: o.label,
        lines: [
          { kind: 'desc', text: `${who} is too far away, but can reach ${o.stand.length === 1 ? 'a tile' : `${o.stand.length} tiles`} beside ${name(o.id)} this turn.` },
          { kind: 'desc', text: o.hint },
          { kind: 'act', text: `${click} to walk there and ${interactionName(o.interaction)}` },
        ],
      };
    }
    case 'stand': {
      const o = intent.options[0]!;
      return {
        cls: 'interact',
        title: `${interactionName(o.interaction)} from here`,
        lines: [
          { kind: 'desc', text: `From this tile you can ${o.label}.` },
          { kind: 'muted', text: `${click} to move here, then click ${name(o.id)}.` },
        ],
      };
    }
  }
}
