// Easing and small interpolation helpers (visual-style.md 6.1).
// Owner: WS0 (Foundation). Pure; shared by every gfx module.

export type Ease = (t: number) => number;

export const clamp01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Local progress of `t` inside [a, b] (0 before, 1 after). */
export const segment = (t: number, a: number, b: number): number => (b <= a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)));

export const linear: Ease = (t) => clamp01(t);

export const easeInQuad: Ease = (t) => {
  const x = clamp01(t);
  return x * x;
};

export const easeOutQuad: Ease = (t) => {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
};

export const easeInOutSine: Ease = (t) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

export const easeOutCubic: Ease = (t) => {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
};

/** Overshooting ease-out; spec overshoot 1.4. Peaks a little above 1 before settling. */
export function easeOutBackWith(overshoot: number): Ease {
  const s = overshoot;
  return (t) => {
    const x = clamp01(t) - 1;
    return 1 + (s + 1) * x * x * x + s * x * x;
  };
}

export const easeOutBack: Ease = easeOutBackWith(1.4);

/** Rise then fall: 0 -> 1 at `peak` -> 0 at 1, each side shaped by `ease`. */
export function there(t: number, peak = 0.5, ease: Ease = easeOutQuad): number {
  const x = clamp01(t);
  return x <= peak ? ease(segment(x, 0, peak)) : ease(1 - segment(x, peak, 1));
}
