// ─────────────────────────────────────────────
//  SliderCurve.js  –  osu! slider curve math
//
//  Supports: B (Bezier), L (Linear),
//            P (Perfect circle arc), C (Catmull-Rom)
// ─────────────────────────────────────────────

const DETAIL = 50;   // samples per Bezier segment

export class SliderCurve {
  /**
   * Compute a dense array of points along the slider curve.
   * @param {string} type         'B' | 'L' | 'P' | 'C'
   * @param {{ x:number, y:number }[]} points  Control points (including head)
   * @param {number} length       Expected pixel length of the slider
   * @returns {{ x:number, y:number }[]}
   */
  static compute(type, points, length) {
    if (!points || points.length < 2) return points ?? [];

    let raw;
    switch (type) {
      case 'P': raw = perfectArc(points, length);  break;
      case 'L': raw = linearPath(points);          break;
      case 'C': raw = catmullPath(points);         break;
      case 'B':
      default:  raw = bezierPath(points);          break;
    }

    return trimToLength(raw, length);
  }

  /**
   * Given the computed path, return the position at parameter t (0–1).
   */
  /**
   * Tangent angle at t (radians). Returns the direction the curve is heading.
   * Uses a small epsilon sample either side for accuracy.
   */
  static tangentAngleAt(path, t, eps = 0.02) {
    if (!path || path.length < 2) return 0;
    const t0 = Math.max(0, t - eps);
    const t1 = Math.min(1, t + eps);
    const p0 = SliderCurve.positionAt(path, t0);
    const p1 = SliderCurve.positionAt(path, t1);
    return Math.atan2(p1.y - p0.y, p1.x - p0.x);
  }

  /**
   * Angle at the START of the curve (tangent leaving head).
   */
  static startAngle(path) {
    return SliderCurve.tangentAngleAt(path, 0, 0.02);
  }

  /**
   * Angle at the END of the curve (tangent arriving at tail).
   * Returns the direction cursor is travelling when it exits.
   */
  static endAngle(path) {
    return SliderCurve.tangentAngleAt(path, 1, 0.02);
  }

  static positionAt(path, t) {
    if (!path.length) return { x: 0, y: 0 };
    if (t <= 0) return path[0];
    if (t >= 1) return path[path.length - 1];

    // Use arc-length parameterisation stored in the path
    const target = t * arcLength(path);
    let   accum  = 0;
    for (let i = 1; i < path.length; i++) {
      const d = dist(path[i - 1], path[i]);
      if (accum + d >= target) {
        const localT = (target - accum) / d;
        return lerp2(path[i - 1], path[i], localT);
      }
      accum += d;
    }
    return path[path.length - 1];
  }
}

// ── Perfect circle arc ───────────────────────

function perfectArc(pts, length) {
  if (pts.length < 3) return linearPath(pts);
  const [a, b, c] = pts;

  // Circumscribed circle
  const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(D) < 1e-10) return linearPath(pts);

  const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) +
              (b.x ** 2 + b.y ** 2) * (c.y - a.y) +
              (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / D;
  const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) +
              (b.x ** 2 + b.y ** 2) * (a.x - c.x) +
              (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / D;

  const centre = { x: ux, y: uy };
  const radius = dist(centre, a);

  let startAngle = Math.atan2(a.y - centre.y, a.x - centre.x);
  let midAngle   = Math.atan2(b.y - centre.y, b.x - centre.x);
  let endAngle   = Math.atan2(c.y - centre.y, c.x - centre.x);

  // Determine sweep direction
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let sweep = endAngle - startAngle;

  if (cross < 0) {
    if (sweep > 0) sweep -= 2 * Math.PI;
  } else {
    if (sweep < 0) sweep += 2 * Math.PI;
  }

  // Limit sweep to match expected length
  const maxSweep = length / radius;
  if (Math.abs(sweep) > maxSweep) {
    sweep = Math.sign(sweep) * maxSweep;
  }

  const steps = Math.max(16, Math.round(Math.abs(sweep) * radius / 4));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + sweep * (i / steps);
    out.push({
      x: centre.x + radius * Math.cos(angle),
      y: centre.y + radius * Math.sin(angle),
    });
  }
  return out;
}

// ── Linear ───────────────────────────────────

function linearPath(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push(pts[i]);
    const steps = Math.max(2, Math.round(dist(pts[i], pts[i + 1]) / 4));
    for (let s = 1; s <= steps; s++) {
      out.push(lerp2(pts[i], pts[i + 1], s / steps));
    }
  }
  return out;
}

// ── Bezier ────────────────────────────────────

function bezierPath(pts) {
  // Split at duplicate adjacent control points → separate Bezier segments
  const segments = [];
  let current    = [pts[0]];

  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x === pts[i - 1].x && pts[i].y === pts[i - 1].y) {
      current.push(pts[i]);
      segments.push(current);
      current = [pts[i]];
    } else {
      current.push(pts[i]);
    }
  }
  if (current.length > 1) segments.push(current);
  else if (segments.length === 0) return pts;

  const out = [];
  for (const seg of segments) {
    const pts2 = bezierSegment(seg, DETAIL);
    if (out.length) pts2.shift();   // avoid duplicate junction
    out.push(...pts2);
  }
  return out;
}

/** De Casteljau evaluation for arbitrary degree */
function bezierSegment(pts, detail) {
  const out = [];
  for (let i = 0; i <= detail; i++) {
    out.push(deCasteljau(pts, i / detail));
  }
  return out;
}

function deCasteljau(pts, t) {
  let p = pts.map(pt => ({ ...pt }));
  for (let r = 1; r < p.length; r++) {
    for (let i = 0; i < p.length - r; i++) {
      p[i] = {
        x: (1 - t) * p[i].x + t * p[i + 1].x,
        y: (1 - t) * p[i].y + t * p[i + 1].y,
      };
    }
  }
  return p[0];
}

// ── Catmull-Rom ──────────────────────────────

function catmullPath(pts) {
  if (pts.length < 2) return pts;
  const out = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const steps = Math.max(8, Math.round(dist(p1, p2) / 4));

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      out.push(catmullPoint(p0, p1, p2, p3, t));
    }
  }
  return out;
}

function catmullPoint(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
       (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
       (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
       (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
       (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

// ── Helpers ──────────────────────────────────

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp2(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function arcLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i]);
  return total;
}

/** Trim or extend a path to match the target pixel length */
function trimToLength(path, targetLen) {
  if (!path.length) return path;
  const out    = [path[0]];
  let   accum  = 0;

  for (let i = 1; i < path.length; i++) {
    const d = dist(path[i - 1], path[i]);
    if (accum + d >= targetLen) {
      const remain = targetLen - accum;
      out.push(lerp2(path[i - 1], path[i], remain / d));
      break;
    }
    accum += d;
    out.push(path[i]);
  }
  return out;
}
