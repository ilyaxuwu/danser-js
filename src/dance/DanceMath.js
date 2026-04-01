// ─────────────────────────────────────────────
//  DanceMath.js
// ─────────────────────────────────────────────

export const lerp    = (a, b, t) => a + (b - a) * t;
export const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const dist2   = (ax,ay,bx,by) => Math.hypot(bx-ax, by-ay);

/** Wrap angle to (-π, π] */
export function wrap(a) {
  while (a >  Math.PI) a -= 2*Math.PI;
  while (a < -Math.PI) a += 2*Math.PI;
  return a;
}

/** Smallest unsigned difference between two angles, result in [0,π] */
export function angleDiff(a, b) {
  const d = Math.abs(wrap(a - b));
  return d > Math.PI ? 2*Math.PI - d : d;
}

// ── Easing ────────────────────────────────────
/** Symmetric ease-in-out cubic (danser-go default) */
export function easeIO(t) {
  return t < 0.5 ? 4*t*t*t : 1-((-2*t+2)**3)/2;
}

export function easeOutQuad(t) {
  return t * (2 - t);
}

// ── Combinatorics & Bezier ────────────────────
const memoBinom = {};
export function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const hash = (n << 8) | k;
  if (memoBinom[hash]) return memoBinom[hash];
  let res = 1;
  for (let i = 1; i <= k; i++) res = (res * (n - i + 1)) / i;
  memoBinom[hash] = res;
  return res;
}

export function sampleBezier(pts, t) {
  t = clamp(t, 0, 1);
  const n = pts.length - 1;
  let x = 0, y = 0;
  for (let i = 0; i <= n; i++) {
    const b = binomial(n, i) * Math.pow(1 - t, n - i) * Math.pow(t, i);
    x += b * pts[i].x;
    y += b * pts[i].y;
  }
  return { x, y };
}

// ── Circle arc geometry ───────────────────────
/**
 * Build a circle arc from (fx,fy) to (tx,ty) subtending `theta` radians.
 *
 * sign=+1 → arc bulges LEFT of the (from→to) chord
 * sign=-1 → arc bulges RIGHT
 *
 * Returns { cx,cy,r,sa,da,d }:
 *   cx,cy  = circle centre
 *   r      = radius
 *   sa     = start angle on circle
 *   da     = signed delta angle (short arc, |da|≤π)
 *   d      = chord length
 *
 * Guarantees: getPositionAt(0)==(fx,fy), getPositionAt(1)==(tx,ty) exactly.
 */
export function buildArc(fx, fy, tx, ty, theta, sign) {
  const dx = tx-fx, dy = ty-fy;
  const d  = Math.hypot(dx, dy);

  // Degenerate: same point
  if (d < 0.5) return { cx:fx, cy:fy, r:15, sa:0, da:theta*sign, d:0 };

  // θ must stay < π so the arc always goes FORWARD (no C-shape)
  theta = clamp(theta, 0.01, Math.PI * 0.97);

  const R    = d / (2 * Math.sin(theta / 2));
  const mx   = (fx+tx)/2, my = (fy+ty)/2;
  const perp = Math.atan2(dy, dx) + Math.PI/2;
  const h    = R * Math.cos(theta / 2);       // always ≥ 0 since θ ≤ π

  const cx = mx + Math.cos(perp)*h*sign;
  const cy = my + Math.sin(perp)*h*sign;
  const sa = Math.atan2(fy-cy, fx-cx);
  let   da = Math.atan2(ty-cy, tx-cx) - sa;

  // Normalise to short arc in (-π, π]
  da = wrap(da);

  return { cx, cy, r:R, sa, da, d };
}

/**
 * Sample position on arc at t∈[0,1] with optional easing.
 */
export function sampleArc(arc, t, ease = easeIO) {
  if (arc.d < 0.5) return { x:arc.cx, y:arc.cy };
  const e   = ease(clamp(t,0,1));
  const ang = arc.sa + arc.da * e;
  return { x: arc.cx + Math.cos(ang)*arc.r, y: arc.cy + Math.sin(ang)*arc.r };
}

/**
 * Direction (radians) the cursor is travelling at the END of the arc (t=1).
 * Used for momentum-based sign selection.
 */
export function exitAngle(arc) {
  if (arc.d < 0.5) return 0;
  const endAng = arc.sa + arc.da;
  return endAng + (arc.da >= 0 ? Math.PI/2 : -Math.PI/2);
}

/**
 * Choose sign (+1 or -1) so that the new arc's EXIT ANGLE is closest
 * to `prevExit`. Keeps motion flowing in the same direction.
 */
export function chooseSign(fx, fy, tx, ty, theta, prevExit) {
  const a1 = buildArc(fx,fy,tx,ty,theta,+1);
  const a2 = buildArc(fx,fy,tx,ty,theta,-1);
  const d1 = angleDiff(prevExit, exitAngle(a1));
  const d2 = angleDiff(prevExit, exitAngle(a2));
  return d1 <= d2 ? +1 : -1;
}

/**
 * Like buildArc but reduces theta until the arc stays within
 * the osu! playfield [margin, 512-margin] × [margin, 384-margin].
 * Prevents off-screen arcs from being clamped (which causes misses).
 */
export function buildArcSafe(fx, fy, tx, ty, theta, sign, margin=6) {
  const lo = margin, hiX = 512-margin, hiY = 384-margin;
  let t = theta;
  for (let i = 0; i < 10; i++) {
    const arc = buildArc(fx,fy,tx,ty,t,sign);
    if (arc.d < 0.5) return arc;
    let ok = true;
    for (let s=1; s<16; s++) {
      const p = sampleArc(arc, s/16);
      if (p.x<lo || p.x>hiX || p.y<lo || p.y>hiY) { ok=false; break; }
    }
    if (ok) return arc;
    t *= 0.72;
    if (t < 0.04) break;
  }
  return buildArc(fx,fy,tx,ty,0.04,sign);
}
export function angleBetween(centre, p1, p2) {
  const a = Math.sqrt(dist2(centre.x, centre.y, p1.x, p1.y));
  const b = Math.sqrt(dist2(centre.x, centre.y, p2.x, p2.y));
  const c = Math.sqrt(dist2(p1.x, p1.y, p2.x, p2.y));
  if (a < 0.0001 || b < 0.0001) return 0;
  return Math.acos(clamp((a * a + b * b - c * c) / (2 * a * b), -1, 1));
}
