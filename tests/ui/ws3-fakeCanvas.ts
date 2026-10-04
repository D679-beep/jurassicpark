// Recording fake of CanvasRenderingContext2D for WS3 painter tests (not a
// test file). Tracks the current transform and records the device-space
// bounds of everything filled or stroked, so tests can check that sprites
// stay inside their canvas, and counts drawImage calls.

type M = [number, number, number, number, number, number];

const ident = (): M => [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): FakeContext;
}

export class FakeContext {
  private m: M = ident();
  private stack: { m: M; lineWidth: number; clipped: boolean }[] = [];
  private path: [number, number][] = [];
  /** Inside a clip: fills are bounded by the clip, so only the clip path is checked. */
  private clipped = false;
  readonly bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  drawImages = 0;
  fills = 0;
  strokes = 0;
  canvas: FakeCanvas;
  // Settable state (ignored).
  lineWidth = 1;
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  lineCap = 'butt';
  lineJoin = 'miter';
  lineDashOffset = 0;
  font = '';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'low';

  constructor(canvas?: FakeCanvas) {
    this.canvas = canvas ?? { width: 0, height: 0, getContext: () => this };
  }

  private pt(x: number, y: number): [number, number] {
    const m = this.m;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  private add(x: number, y: number): void {
    this.path.push(this.pt(x, y));
  }
  private grow(x: number, y: number, pad: number): void {
    const b = this.bounds;
    b.minX = Math.min(b.minX, x - pad);
    b.minY = Math.min(b.minY, y - pad);
    b.maxX = Math.max(b.maxX, x + pad);
    b.maxY = Math.max(b.maxY, y + pad);
  }

  save(): void {
    this.stack.push({ m: [...this.m] as M, lineWidth: this.lineWidth, clipped: this.clipped });
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) {
      this.m = s.m;
      this.lineWidth = s.lineWidth;
      this.clipped = s.clipped;
    }
  }
  translate(x: number, y: number): void {
    this.m = mul(this.m, [1, 0, 0, 1, x, y]);
  }
  scale(x: number, y: number): void {
    this.m = mul(this.m, [x, 0, 0, y, 0, 0]);
  }
  rotate(a: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.m = mul(this.m, [c, s, -s, c, 0, 0]);
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.m = [a, b, c, d, e, f];
  }

  beginPath(): void {
    this.path = [];
  }
  closePath(): void {}
  moveTo(x: number, y: number): void {
    this.add(x, y);
  }
  lineTo(x: number, y: number): void {
    this.add(x, y);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.add(cx, cy);
    this.add(x, y);
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.add(c1x, c1y);
    this.add(c2x, c2y);
    this.add(x, y);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    // Sample the swept arc.
    let span = ccw ? a0 - a1 : a1 - a0;
    while (span < 0) span += Math.PI * 2;
    if (span > Math.PI * 2) span = Math.PI * 2;
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const a = ccw ? a0 - (span * i) / n : a0 + (span * i) / n;
      this.add(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    let span = ccw ? a0 - a1 : a1 - a0;
    while (span < 0) span += Math.PI * 2;
    if (span > Math.PI * 2) span = Math.PI * 2;
    const n = 32;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const a = ccw ? a0 - (span * i) / n : a0 + (span * i) / n;
      const ex = Math.cos(a) * rx;
      const ey = Math.sin(a) * ry;
      this.add(x + ex * c - ey * s, y + ex * s + ey * c);
    }
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.add(x, y);
    this.add(x + w, y);
    this.add(x + w, y + h);
    this.add(x, y + h);
  }
  fill(): void {
    this.fills++;
    if (this.clipped) return;
    for (const [x, y] of this.path) this.grow(x, y, 0);
  }
  stroke(): void {
    this.strokes++;
    const pad = this.lineWidth / 2;
    for (const [x, y] of this.path) this.grow(x, y, pad);
  }
  clip(): void {
    this.clipped = true;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fills++;
    if (this.clipped) return;
    for (const [px, py] of [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ] as const) {
      const [tx, ty] = this.pt(px, py);
      this.grow(tx, ty, 0);
    }
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
  }
  clearRect(): void {}
  fillText(): void {}
  strokeText(): void {}
  measureText(s: string): { width: number } {
    return { width: s.length * 6 };
  }
  setLineDash(): void {}
  drawImage(): void {
    this.drawImages++;
  }
  createRadialGradient(): { addColorStop(): void } {
    return { addColorStop() {} };
  }
  createLinearGradient(): { addColorStop(): void } {
    return { addColorStop() {} };
  }
}

export function asCtx(f: FakeContext): CanvasRenderingContext2D {
  return f as unknown as CanvasRenderingContext2D;
}

/** Installs a fake `document.createElement('canvas')` for code that builds sprites. Returns an uninstaller. */
export function installFakeDocument(): () => void {
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  g.document = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      const c: FakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
      };
      const ctx = new FakeContext(c);
      return c;
    },
  };
  return () => {
    g.document = prev;
  };
}
