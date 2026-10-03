import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/engine';
import { prologueScenario } from '../../src/content';
import { makeNameLookup, objectName } from '../../src/ui/names';

describe('prologue object names', () => {
  const state = createGame(prologueScenario);

  it('gives every prologue object and exit a readable name (no raw ids)', () => {
    const lookup = makeNameLookup(state);
    for (const o of state.map.objects) {
      const n = lookup(o.id);
      expect(n).toBe(objectName(o));
      expect(n).not.toMatch(/^(Door|Anchor|Bridge)[A-Z ]/);
      expect(n).not.toBe(o.id);
    }
    for (const e of state.map.exits) expect(lookup(e.id)).not.toMatch(/Exit$/);
  });

  it('names the barred doors, anchors and bridges', () => {
    const lookup = makeNameLookup(state);
    expect(lookup('doorWellSouth')).toBe('Wellspring south door');
    expect(lookup('anchorA')).toBe('Ward anchor (west)');
    expect(lookup('bridgeCenter')).toBe('Center bridge');
  });
});
