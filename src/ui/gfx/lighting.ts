// Darkness and glow lightmaps (visual-style.md section 3; layers 5-6), the
// live desaturation pass during an era transition, and levelAt() for the
// unit night shade (3.5).
// Owner: WS2 (Lighting & overlays). WS0 STUB: the pre-overhaul board had no
// lightmap (lantern glows are baked into the terrain cache), so this pass
// draws nothing and leaves `f.levelAt` at its default (fully lit). WS2
// builds the 8 px/tile `dark` and `glow` canvases from `f.lights`,
// `f.env` (darkAlpha, floorCap, tint, moon, lamp, desat), `f.era` and the
// outdoor/passable masks from `f.sites`, applies flicker unless
// `f.motion.reduced`, and sets `f.levelAt`.
import type { GfxFrame, LightingPass } from './types';

export function createLighting(): LightingPass {
  return {
    reset() {},
    clear() {},
    draw(_f: GfxFrame) {
      // WS2: darkness, glow, floor minimum, live desaturation; set f.levelAt.
    },
  };
}
