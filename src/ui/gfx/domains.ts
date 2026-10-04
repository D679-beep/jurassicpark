// Domain visuals: ground fill and patterns (layer 4b), upper layer (domes,
// bolts, flames, rays, rings; layer 11) and Domain lights (visual-style.md
// 1.5, 6.3 "Bespoke Domains").
// Owner: WS4 (FX, Domains, animation). WS0 STUB: the pre-overhaul Domain
// drawing (tinted tiles, drifting streak / cross pattern, edge outline),
// moved here unchanged from renderer.ts and fed from `f.domains`. WS4
// replaces it with the palette.DOMAIN looks (ground alpha low enough that
// Domains never resemble the blue move tiles).
import { posKey, type DomainKind, type Pos } from '../../engine';
import { DOMAIN_STYLE } from '../palette';
import type { DomainsPass, GfxFrame } from './types';

export function createDomains(): DomainsPass {
  return {
    reset() {},
    clear() {},
    drawGround(f: GfxFrame) {
      const { ctx, T } = f;
      for (const dd of f.domains) {
        const style = DOMAIN_STYLE[dd.domain.kind];
        const set = new Set(dd.tiles.map(posKey));
        ctx.fillStyle = style.fill;
        for (const p of dd.tiles) ctx.fillRect(p.x * T, p.y * T, T, T);
        drawDomainPattern(ctx, dd.domain.kind, dd.tiles, T, f.now);
        ctx.strokeStyle = style.edge;
        ctx.lineWidth = Math.max(1, Math.round(T / 14));
        ctx.beginPath();
        for (const p of dd.tiles) outlineEdges(ctx, p, T, (q) => set.has(posKey(q)));
        ctx.stroke();
      }
    },
    collectLights(_f: GfxFrame) {
      // WS4: Domain lights (and Silence darkeners).
    },
    drawUpper(_f: GfxFrame) {
      // WS4: Bulwark dome, Tempest bolts and wind, Pyre flames, Sanctuary rays, Silence rings.
    },
  };
}

/** Adds path segments for each edge of tile p whose neighbour is outside the set. */
function outlineEdges(ctx: CanvasRenderingContext2D, p: Pos, T: number, inside: (q: Pos) => boolean): void {
  const x0 = p.x * T;
  const y0 = p.y * T;
  if (!inside({ x: p.x, y: p.y - 1 })) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + T, y0);
  }
  if (!inside({ x: p.x + 1, y: p.y })) {
    ctx.moveTo(x0 + T, y0);
    ctx.lineTo(x0 + T, y0 + T);
  }
  if (!inside({ x: p.x, y: p.y + 1 })) {
    ctx.moveTo(x0, y0 + T);
    ctx.lineTo(x0 + T, y0 + T);
  }
  if (!inside({ x: p.x - 1, y: p.y })) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y0 + T);
  }
}

function drawDomainPattern(ctx: CanvasRenderingContext2D, kind: DomainKind, tiles: readonly Pos[], T: number, now: number): void {
  const style = DOMAIN_STYLE[kind];
  ctx.save();
  ctx.strokeStyle = style.edge;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = Math.max(1, T / 24);
  ctx.beginPath();
  const shift = (((now / 60) % T) + T) % T;
  for (const p of tiles) {
    const x0 = p.x * T;
    const y0 = p.y * T;
    if (kind === 'tempest' || kind === 'pyre') {
      // Diagonal streaks drifting over time.
      const o = kind === 'tempest' ? shift : T - shift;
      ctx.moveTo(x0 + o * 0.5, y0);
      ctx.lineTo(x0, y0 + o * 0.5);
      ctx.moveTo(x0 + T, y0 + o * 0.5);
      ctx.lineTo(x0 + o * 0.5, y0 + T);
    } else {
      ctx.moveTo(x0 + T * 0.5, y0 + T * 0.3);
      ctx.lineTo(x0 + T * 0.5, y0 + T * 0.7);
      ctx.moveTo(x0 + T * 0.3, y0 + T * 0.5);
      ctx.lineTo(x0 + T * 0.7, y0 + T * 0.5);
    }
  }
  ctx.stroke();
  ctx.restore();
}
