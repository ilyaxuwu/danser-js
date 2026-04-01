// ─────────────────────────────────────────────
//  DanceAlgorithm.js
//  Pure Math Flower Cursor Dancing (AngleOffsetMover)
//  1:1 Port from danser-go (angleoffset.go)
// ─────────────────────────────────────────────

import {
  clamp, dist2, wrap, angleDiff, angleBetween,
  easeIO, sampleBezier
} from './DanceMath.js';
import { config } from '../config/Config.js';

export const FlowerSettings = {
  angleOffset:       90,
  distanceMult:      0.666,
  streamAngleOffset: 90,
  longJump:          -1,
  longJumpMult:      0.7,
  longJumpOnEqualPos:false,
  spinnerRPM:        2000,
  spinnerOuter:      92,
  spinnerInner:      66,
  sliderCriticalHoldMs: 100,
  sliderEntryConflictWindowMs: 100,
};

/**
 * AngleOffsetMover (Flower)
 * Ported from danser-go/app/dance/movers/angleoffset.go
 */
export class FlowerMover {
  constructor() {
    this.reset();
  }

  reset() {
    this._pts = [];
    this._lastPoint = { x: 0, y: 0 };
    this._lastAngle = 0;
    this._invert = 1;
  }

  init(from, to, gapMs, spinner = false, nextTarget = null) {
    const s = FlowerSettings;
    const fx = from.endX ?? from.x;
    const fy = from.endY ?? from.y;
    const tx = to.x, ty = to.y;

    const startPos = { x: fx, y: fy };
    const endPos = { x: tx, y: ty };
    const distance = Math.hypot(tx - fx, ty - fy);

    this._startTime = from.endTime ?? from.time;
    this._endTime = to.time;
    const timeDelta = this._endTime - this._startTime;

    const ok1 = from.objectType === 'slider';
    const ok2 = to.objectType === 'slider';

    // Sync settings from config (if available)
    const distMult = Number(config.get('dance.distanceMult')) || s.distanceMult || 0.666;
    const angleOff = (Number(config.get('dance.angleOffset')) || s.angleOffset || 90) * Math.PI / 180;
    const streamAngleOff = (Number(config.get('dance.streamAngleOffset')) || s.streamAngleOffset || 90) * Math.PI / 180;

    const longJumpThreshold = Number(config.get('dance.longJumpDist')) ?? -1;
    const longJumpMult = Number(config.get('dance.longJumpMult')) || 0.7;
    const streamMs = Number(config.get('dance.streamMs')) || s.streamMs || 130;

    let scaledDistance = distance * distMult;

    // Keep slider dummy transitions tight so the cursor stays score-safe on slider paths.
    if (to._isSliderDummy || from._isSliderDummy) {
      const safeCap = Math.max(10, distance * 0.35);
      scaledDistance = Math.min(scaledDistance, safeCap);
    }

    // Long Jump logic (authenticity)
    if (from.time > 0 && longJumpThreshold >= -1 && timeDelta > longJumpThreshold) {
      scaledDistance = Math.max(scaledDistance, timeDelta * longJumpMult);
    }

    let points = [];

    // Initialize lastPoint on first use to prevent wild jump from 0,0
    if (this._lastPoint.x === 0 && this._lastPoint.y === 0) {
      this._lastPoint = { x: fx - (tx - fx), y: fy - (ty - fy) }; 
    }

    if (isStreamSequence(from, to, nextTarget, timeDelta, streamMs)) {
      this._invert *= -1;

      const nx = distance > 0.001 ? -(ty - fy) / distance : 0;
      const ny = distance > 0.001 ? (tx - fx) / distance : 0;
      const wiggle = clamp(
        distance * 0.34,
        Math.max(10, distance * 0.18),
        Math.max(16, distance * 0.46),
      );
      const sign = this._invert;
      const pt1 = {
        x: fx + (tx - fx) * 0.28 + nx * wiggle * sign,
        y: fy + (ty - fy) * 0.28 + ny * wiggle * sign,
      };
      const pt2 = {
        x: fx + (tx - fx) * 0.72 - nx * wiggle * sign,
        y: fy + (ty - fy) * 0.72 - ny * wiggle * sign,
      };

      this._lastAngle = Math.atan2(ty - fy, tx - fx);
      points = [startPos, pt1, pt2, endPos];
    } else if (distance < 0.5) {
      if (s.longJumpOnEqualPos) {
        scaledDistance = timeDelta * (s.longJumpMult || 0.7);
        this._lastAngle += Math.PI;

        let pt1 = {
          x: fx + Math.cos(this._lastAngle) * scaledDistance,
          y: fy + Math.sin(this._lastAngle) * scaledDistance
        };

        if (ok1 && from.endAngle != null) {
          pt1 = {
            x: fx + Math.cos(from.endAngle) * scaledDistance,
            y: fy + Math.sin(from.endAngle) * scaledDistance
          };
        }

        if (!ok2) {
          const angle = this._lastAngle - angleOff * this._invert;
          const pt2 = {
            x: tx + Math.cos(angle) * scaledDistance,
            y: ty + Math.sin(angle) * scaledDistance
          };
          this._lastAngle = angle;
          points = [startPos, pt1, pt2, endPos];
        } else {
          const pt2 = {
            x: tx + Math.cos(to.startAngle || 0) * scaledDistance,
            y: ty + Math.sin(to.startAngle || 0) * scaledDistance
          };
          points = [startPos, pt1, pt2, endPos];
        }
      } else {
        points = [startPos, endPos];
      }
    } else if (ok1 && ok2) {
      this._invert *= -1;
      const pt1 = {
        x: fx + Math.cos(from.endAngle ?? 0) * scaledDistance,
        y: fy + Math.sin(from.endAngle ?? 0) * scaledDistance
      };
      const pt2 = {
        x: tx + Math.cos(to.startAngle ?? 0) * scaledDistance,
        y: ty + Math.sin(to.startAngle ?? 0) * scaledDistance
      };
      points = [startPos, pt1, pt2, endPos];
    } else if (ok1) {
      this._invert *= -1;
      this._lastAngle = Math.atan2(ty - fy, tx - fx) - angleOff * this._invert;
      const pt1 = {
        x: fx + Math.cos(from.endAngle ?? 0) * scaledDistance,
        y: fy + Math.sin(from.endAngle ?? 0) * scaledDistance
      };
      const pt2 = {
        x: tx + Math.cos(this._lastAngle) * scaledDistance,
        y: ty + Math.sin(this._lastAngle) * scaledDistance
      };
      points = [startPos, pt1, pt2, endPos];
    } else if (ok2) {
      this._lastAngle += Math.PI;
      const pt1 = {
        x: fx + Math.cos(this._lastAngle) * scaledDistance,
        y: fy + Math.sin(this._lastAngle) * scaledDistance
      };
      const pt2 = {
        x: tx + Math.cos(to.startAngle ?? 0) * scaledDistance,
        y: ty + Math.sin(to.startAngle ?? 0) * scaledDistance
      };
      points = [startPos, pt1, pt2, endPos];
    } else {
      // Normal Sharp Angle / Stream logic
      if (angleBetween(startPos, this._lastPoint, endPos) >= angleOff) {
        this._invert *= -1;
        scaledDistance = distance * (Number(config.get('dance.distanceMult')) || 0.666);
        // Use stream angle offset if provided
        const sOff = streamAngleOff;
        const angle = Math.atan2(ty - fy, tx - fx) - sOff * this._invert;
        const pt1 = {
          x: fx + Math.cos(this._lastAngle + Math.PI) * scaledDistance,
          y: fy + Math.sin(this._lastAngle + Math.PI) * scaledDistance
        };
        const pt2 = {
          x: tx + Math.cos(angle) * scaledDistance,
          y: ty + Math.sin(angle) * scaledDistance
        };
        this._lastAngle = angle;
        points = [startPos, pt1, pt2, endPos];
      } else {
        const angle = Math.atan2(ty - fy, tx - fx) - angleOff * this._invert;
        const pt1 = {
          x: fx + Math.cos(this._lastAngle + Math.PI) * scaledDistance,
          y: fy + Math.sin(this._lastAngle + Math.PI) * scaledDistance
        };
        const pt2 = {
          x: tx + Math.cos(angle) * scaledDistance,
          y: ty + Math.sin(angle) * scaledDistance
        };

        this._lastAngle = angle;
        points = [startPos, pt1, pt2, endPos];
      }
    }

    this._pts = points;
    this._lastPoint = startPos;
  }

  getPositionAt(t) {
    return sampleBezier(this._pts, t);
  }
}

// ─────────────────────────────────────────────
//  Factory
// ─────────────────────────────────────────────
function isPlainCircleObject(obj) {
  return !!obj &&
    obj.objectType === 'circle' &&
    !obj._isSliderDummy &&
    !obj.sliderPoint &&
    !obj.doubleClick;
}

function isStreamSequence(from, to, nextTarget, gapMs, streamMs) {
  if (!isPlainCircleObject(from) || !isPlainCircleObject(to) || !isPlainCircleObject(nextTarget)) {
    return false;
  }

  if (!(gapMs > 0) || gapMs > streamMs) {
    return false;
  }

  const nextGap = (nextTarget.time ?? Infinity) - (to.time ?? 0);
  if (!(nextGap > 0) || nextGap > streamMs * 1.2) {
    return false;
  }

  const aLen = Math.hypot((to.x ?? 0) - (from.x ?? 0), (to.y ?? 0) - (from.y ?? 0));
  const bLen = Math.hypot((nextTarget.x ?? 0) - (to.x ?? 0), (nextTarget.y ?? 0) - (to.y ?? 0));
  return aLen > 6 && bLen > 6;
}

export const MOVERS = { 
  flower: () => new FlowerMover(),
};
