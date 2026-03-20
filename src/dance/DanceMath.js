// ─────────────────────────────────────────────
//  DanceMath.js  –  Shared math for movers
// ─────────────────────────────────────────────

/** Linear interpolation */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Ease in-out cubic */
export const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** Distance between two points */
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Angle from point a to point b */
export const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

/** Rotate a point around an origin by `rad` */
export const rotate = (pt, origin, rad) => {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx  = pt.x - origin.x;
  const dy  = pt.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
};

/** Point on a quadratic bezier */
export const quadBezier = (p0, p1, p2, t) => ({
  x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
  y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
});

/** Clamp */
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
