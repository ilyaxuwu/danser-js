// ─────────────────────────────────────────────
//  DanceAlgorithm.js  –  Flower Mover
//
//  True circumscribed circle arc.
//  Large angles = always visibly curving.
//  easeOutCubic = smooth arrival, no sudden stop.
// ─────────────────────────────────────────────

export const FlowerSettings = {
  petAngle:       2.4,
  angleRandom:    0.3,
  zigzag:         true,
  flowDir:        'alternate',

  longJump:       true,
  longJumpDist:   120,
  longJumpAngle:  3.2,
  longJumpMult:   2.2,

  streamAngle:    0.65,
  streamThresh:   140,

  skipStackAngle: 2.0,
  spinnerMult:    3.5,

  minArcHeight:   180,

  idleThreshold:  800,
  idleRadius:     140,
  aggressiveness:       1.5,
  sliderAggressiveness: 2.0,
  spinnerRPM:     477,
  spinnerArms:    5,
  spinnerOuter:   92,
  spinnerInner:   36,

  exaggeration:   2.5,
  flowContinuity: 0.85,
  bezierTension:  0.6,
};

// easeOutCubic: fast travel → smooth arrival (f'(1) = 0 guaranteed)
export function smoothArrival(t) {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

// symmetric ease-in-out (for sliders)
export function eio(t) {
  return t < 0.5 ? 4*t*t*t : 1-((-2*t+2)**3)/2;
}

export class FlowerMover {
  constructor() {
    this._cx = 256; this._cy = 192;
    this._r  = 1;
    this._sa = 0;   this._da = 0;
    this._fn = smoothArrival;
  }

  init(from, to, gapMs = 999, fromSpinner = false, fn = smoothArrival) {
    this._fn = fn;
    const s  = FlowerSettings;

    const fx = from.endX ?? from.x;
    const fy = from.endY ?? from.y;
    const tx = to.x, ty = to.y;
    const dx = tx - fx, dy = ty - fy;
    const d  = Math.hypot(dx, dy);

    // ── Arc angle ─────────────────────────────
    let arc;
    if (d < 3) {
      arc = s.skipStackAngle;
    } else if (gapMs <= 5) {
      arc = s.skipStackAngle;
    } else if (gapMs < s.streamThresh) {
      arc = s.streamAngle;
    } else if (s.longJump && d >= s.longJumpDist) {
      arc = s.longJumpAngle * s.longJumpMult;
    } else {
      arc = s.petAngle + (Math.random() - 0.5) * 2 * s.angleRandom;
    }

    if (fromSpinner) arc += Math.PI * s.spinnerMult;
    arc = Math.max(0.1, Math.min(arc, Math.PI * 0.97));

    // ── Direction ──────────────────────────────
    let sign;
    if (s.flowDir === 'left')       sign = -1;
    else if (s.flowDir === 'right') sign =  1;
    else if (s.zigzag) { sign = FlowerMover._globalSign; FlowerMover._globalSign *= -1; }
    else sign = Math.random() < 0.5 ? 1 : -1;

    // ── Circle arc geometry ────────────────────
    if (d < 3) {
      // Same position — spin in place
      this._cx = fx + 1; this._cy = fy + 1;
      this._r  = 30;
      this._sa = Math.atan2(fy - this._cy, fx - this._cx);
      this._da = arc * sign;
      return;
    }

    // ── Build circle arc with guaranteed minimum bulge ─────────────────
    // Strategy: compute from the arc angle as usual, then enforce
    // that the circle centre is at least minArcHeight away from the chord.
    // This means short moves ALWAYS have a dramatic visible curve.
    const minH = s.minArcHeight ?? 0;

    // Standard circumscribed circle
    let R  = d / (2 * Math.sin(arc / 2));
    const mx   = (fx + tx) / 2, my = (fy + ty) / 2;
    const perp = Math.atan2(dy, dx) + Math.PI / 2;
    let h  = R * Math.cos(arc / 2);

    // The bulge (arc height above chord) = R - h = R*(1-cos(θ/2))
    const bulge = R - h;

    if (minH > 0 && bulge < minH) {
      // Increase the bulge by moving the centre farther from the chord.
      // New centre offset from midpoint = midH such that:
      //   new_R = sqrt(midH^2 + (d/2)^2)
      //   new_bulge = new_R - midH = minH
      // → midH = new_R - minH, and new_R^2 = midH^2 + (d/2)^2
      // → (new_R - minH)^2 + minH^2 ... let midH = x:
      //   (x+minH)^2 = x^2 + (d/2)^2
      //   x^2 + 2*x*minH + minH^2 = x^2 + (d/2)^2
      //   2*x*minH = (d/2)^2 - minH^2
      //   x = ((d/2)^2 - minH^2) / (2*minH)
      const halfD = d / 2;
      // midH can be negative when minH > halfD — that creates a >180° arc (extra dramatic)
      const midH  = (halfD*halfD - minH*minH) / (2*minH);
      R = Math.sqrt(midH*midH + halfD*halfD);
      // When midH<0 the arc goes "the long way" — cursor swoops wide before arriving
      h = midH;
    }

    this._cx = mx + Math.cos(perp) * h * sign;
    this._cy = my + Math.sin(perp) * h * sign;
    this._r  = R;
    this._sa = Math.atan2(fy - this._cy, fx - this._cx);

    const ea = Math.atan2(ty - this._cy, tx - this._cx);
    let da = ea - this._sa;
    while (da >  Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    if (sign > 0 && da < 0) da += 2 * Math.PI;
    if (sign < 0 && da > 0) da -= 2 * Math.PI;
    this._da = da;
  }

  getPositionAt(t) {
    const e   = this._fn(t);
    const ang = this._sa + this._da * e;
    return {
      x: this._cx + Math.cos(ang) * this._r,
      y: this._cy + Math.sin(ang) * this._r,
    };
  }
}

FlowerMover._globalSign = 1;
export const MOVERS = { flower: FlowerMover };
