// ─────────────────────────────────────────────
//  DanceMath.js  –  Advanced easing & Bezier curves
//  for exaggerated danser-go Flower style
// ─────────────────────────────────────────────

export const lerp = (a, b, t) => a + (b - a) * t;

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

export const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

export function easeOutQuint(t) {
  return 1 - Math.pow(1 - t, 5);
}

export function easeInOutQuint(t) {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeInOutBack(t) {
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  return t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
}

export function smootherStep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

export function quadBezier(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

export function rotate(pt, origin, rad) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx  = pt.x - origin.x;
  const dy  = pt.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}
