import { describe, expect, it } from 'vitest';
import { bellTrack, speakerLook } from '../../src/ui/hudModel';
import { icon, iconBody, medallion, objectiveIcon, objectiveIconName, rankIcon, tokenIcon, type IconName } from '../../src/ui/icons';
import { STYLES } from '../../src/ui/styles';
import { uiGame } from './fixture';

const NAMES: IconName[] = [
  'crown', 'sun', 'book', 'bell', 'bellOff', 'flame', 'check', 'cross', 'ring', 'lantern', 'bolt', 'scarf', 'shield',
  'swords', 'padlock', 'drop', 'arrowOut', 'heart', 'sword', 'boot', 'target', 'banner', 'domain', 'speed',
];

describe('icons', () => {
  it('every icon is a 1em, decorative inline svg with real artwork', () => {
    for (const n of NAMES) {
      const svg = icon(n);
      expect(svg, n).toMatch(/^<svg /);
      expect(svg, n).toContain('width="1em"');
      expect(svg, n).toContain('height="1em"');
      expect(svg, n).toContain('aria-hidden="true"');
      expect(svg, n).toContain('currentColor');
      expect(iconBody(n).length, n).toBeGreaterThan(20);
      expect(iconBody(n), n).toMatch(/<(path|circle)/);
    }
  });

  it('stays compact (bundle size)', () => {
    const total = NAMES.reduce((n, k) => n + iconBody(k).length, 0);
    expect(total).toBeLessThan(6000);
  });

  it('tokens and ranks are decorative svgs', () => {
    expect(tokenIcon('rebel')).toContain('aria-hidden="true"');
    expect(tokenIcon('loyalist')).toContain('<ellipse');
    for (const r of ['soldier', 'kindled', 'radiant', 'ascendant'] as const) expect(rankIcon(r)).toContain('currentColor');
  });

  it('objectives map to their glyph and status overlay', () => {
    expect(objectiveIconName('killEmperor')).toBe('crown');
    expect(objectiveIconName('killElian')).toBe('sun');
    expect(objectiveIconName('imprisonMira')).toBe('book');
    expect(objectiveIconName('seizeBellTower')).toBe('bell');
    expect(objectiveIconName('burnBridges')).toBe('flame');
    expect(objectiveIcon('killEmperor', 'completed')).toContain('ic-check');
    expect(objectiveIcon('killEmperor', 'failed')).toContain('ic-cross');
    expect(objectiveIcon('killEmperor', 'pending')).toContain('ic-ring');
  });

  it('medallions use a rhombus for rebels and a circle otherwise', () => {
    expect(medallion('rebel', 'bolt')).toContain('<path d="M20 1.5');
    expect(medallion('loyalist', 'crown')).toContain('<circle');
    expect(medallion('narrator', 'bell')).toContain('<circle');
  });
});

describe('hud view-model additions', () => {
  it('lists the bells in order with their rung state', () => {
    const s = structuredClone(uiGame());
    const t = bellTrack(s);
    expect(t.map((b) => b.id)).toEqual(['firstBell', 'secondBell', 'dawn']);
    expect(t.every((b) => !b.rung)).toBe(true);
    s.bells[0]!.rung = true;
    expect(bellTrack(s).filter((b) => b.rung)).toHaveLength(1);
  });

  it('picks a medallion mark per speaker', () => {
    expect(speakerLook('Varek')).toEqual({ mark: 'bolt', plate: 'rebel' });
    expect(speakerLook('Kaela')).toEqual({ mark: 'scarf', plate: 'rebel' });
    expect(speakerLook('Grimm')).toEqual({ mark: 'flame', plate: 'rebel' });
    expect(speakerLook('Emperor Halden')).toEqual({ mark: 'crown', plate: 'loyalist' });
    expect(speakerLook('Crown Prince Elian')).toEqual({ mark: 'sun', plate: 'loyalist' });
    expect(speakerLook('Lady Orsa')).toEqual({ mark: 'shield', plate: 'loyalist' });
    expect(speakerLook('Princess Mira')).toEqual({ mark: 'book', plate: 'loyalist' });
    expect(speakerLook('Narrator')).toEqual({ mark: 'bell', plate: 'narrator' });
    expect(speakerLook('Somebody Else')).toEqual({ mark: 'bell', plate: 'narrator' });
  });
});

describe('styles hooks', () => {
  it('keeps the selectors the browser tests rely on', () => {
    for (const sel of ['#overlay', '#dialogue', '#tooltip', 'button.speed', '.card.victory', '.card.defeat']) {
      expect(STYLES, sel).toContain(sel);
    }
    expect(STYLES).toMatch(/#overlay \{[^}]*display: flex/);
  });
});
